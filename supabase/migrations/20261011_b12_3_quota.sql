-- B12-3 (11 Oct 2026) — storage quota (occupancy) for Registered-rail accounts.
-- Design: docs/B12-spec-v1.1.md §1 + docs/B12-SR-spec-v1.md S1 (SR wins).
-- Quota = chunks held at once (32 MiB units). Credits (api_credit_pools) are a
-- separate meter and are never merged with this one.
--
-- quota_ref = HMAC-SHA256(QUOTA_REF_KEY, "refueler.share.quotaref.v1" ‖ 0x00 ‖ org16),
-- computed by the Worker from an AUTHENTICATED principal only. No email, Stripe
-- ID or org id is stored here; the join to identity is recomputed, never stored.
-- session_hash = BLAKE3(upload session token): links nothing without the token.
--
-- Access: RLS on, no policies; table privileges revoked from anon/authenticated.
-- The Worker calls the SECURITY DEFINER functions below with the service role.
-- Lock order everywhere: quota_accounts row first, then quota_reservations rows.
-- Times are unix seconds (bigint) from public._api_now() (KV-Fix-2).

create table public.quota_accounts (
  quota_ref        bytea primary key check (octet_length(quota_ref) = 32),
  kind             text    not null check (kind in ('registered', 'chartered')),
  limit_chunks     integer not null check (limit_chunks >= 0),
  used_chunks      integer not null default 0 check (used_chunks >= 0),
  reserved_chunks  integer not null default 0 check (reserved_chunks >= 0),
  max_in_flight    integer not null default 20 check (max_in_flight between 1 and 1000),
  updated_at       bigint  not null,          -- every reserve / finalise / release / provision
  reconciled_at    bigint                     -- last nightly reconcile that wrote this row
);

create table public.quota_reservations (
  session_hash  bytea   primary key check (octet_length(session_hash) = 32),
  quota_ref     bytea   not null references public.quota_accounts (quota_ref) on delete cascade,
  chunks        integer not null check (chunks between 1 and 8000),   -- MAX_TRANSFER_CHUNKS
  expires_at    bigint  not null                                      -- = upload session expiry
);
create index quota_reservations_ref_idx on public.quota_reservations (quota_ref);

alter table public.quota_accounts     enable row level security;
alter table public.quota_reservations enable row level security;
revoke all on public.quota_accounts, public.quota_reservations from public, anon, authenticated;
grant all on public.quota_accounts, public.quota_reservations to service_role;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public._quota_hex32(p text) returns bytea
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p !~ '^[0-9a-f]{64}$' then
    raise exception 'quota: expected 64 lowercase hex characters';
  end if;
  return decode(p, 'hex');
end $$;

create or replace function public._quota_json(a public.quota_accounts) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'kind', a.kind, 'limit_chunks', a.limit_chunks, 'used_chunks', a.used_chunks,
    'reserved_chunks', a.reserved_chunks, 'max_in_flight', a.max_in_flight)
$$;

-- Drop the account's expired reservations and recompute reserved_chunks from the
-- rows that remain. Caller holds the account row lock.
create or replace function public._quota_refresh_reserved(q bytea, t bigint) returns integer
language plpgsql set search_path = public, pg_temp as $$
declare r integer;
begin
  delete from public.quota_reservations where quota_ref = q and expires_at <= t;
  select coalesce(sum(chunks), 0)::integer into r from public.quota_reservations where quota_ref = q;
  update public.quota_accounts set reserved_chunks = r where quota_ref = q;
  return r;
end $$;

-- ── Provision / set limits (admin) ──────────────────────────────────────────
-- Upsert. Never touches used/reserved: lowering a limit below usage blocks new
-- initiates only; nothing live is deleted early (B12 §1.9).
create or replace function public.quota_provision(
  p_quota_ref text, p_kind text, p_limit_chunks integer, p_max_in_flight integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare q bytea := public._quota_hex32(p_quota_ref); a public.quota_accounts;
begin
  insert into public.quota_accounts (quota_ref, kind, limit_chunks, max_in_flight, updated_at)
  values (q, p_kind, p_limit_chunks, p_max_in_flight, public._api_now())
  on conflict (quota_ref) do update
    set kind = excluded.kind, limit_chunks = excluded.limit_chunks,
        max_in_flight = excluded.max_in_flight, updated_at = excluded.updated_at
  returning * into a;
  return public._quota_json(a);
end $$;

create or replace function public.quota_get(p_quota_ref text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public._quota_json(a) from public.quota_accounts a where a.quota_ref = public._quota_hex32(p_quota_ref)
$$;

-- ── Reserve at initiate (B12-SR S1.6) ───────────────────────────────────────
-- One transaction, account row locked: concurrent initiates on one account are
-- serialised, so at limit−1 exactly one of N wins. Never SELECT-then-UPDATE.
create or replace function public.quota_reserve(
  p_quota_ref text, p_session_hash text, p_need integer, p_expires_at bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q bytea := public._quota_hex32(p_quota_ref);
  s bytea := public._quota_hex32(p_session_hash);
  t bigint := public._api_now();
  a public.quota_accounts;
  r integer;
  n integer;
begin
  if p_need is null or p_need < 1 or p_need > 8000 then
    raise exception 'quota_reserve: need out of range';
  end if;
  if p_expires_at is null or p_expires_at <= t or p_expires_at > t + 7 * 86400 then
    raise exception 'quota_reserve: expiry out of range';
  end if;

  select * into a from public.quota_accounts where quota_ref = q for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'quota_not_provisioned');
  end if;

  r := public._quota_refresh_reserved(q, t);
  select count(*)::integer into n from public.quota_reservations where quota_ref = q;
  if n >= a.max_in_flight then
    return jsonb_build_object('ok', false, 'code', 'too_many_in_flight',
      'limit_chunks', a.limit_chunks, 'used_chunks', a.used_chunks, 'reserved_chunks', r);
  end if;
  if a.used_chunks::bigint + r + p_need > a.limit_chunks then
    return jsonb_build_object('ok', false, 'code', 'quota_exceeded',
      'limit_chunks', a.limit_chunks, 'used_chunks', a.used_chunks, 'reserved_chunks', r);
  end if;

  insert into public.quota_reservations (session_hash, quota_ref, chunks, expires_at)
  values (s, q, p_need, p_expires_at);
  update public.quota_accounts
     set reserved_chunks = r + p_need, updated_at = t
   where quota_ref = q;
  return jsonb_build_object('ok', true,
    'limit_chunks', a.limit_chunks, 'used_chunks', a.used_chunks, 'reserved_chunks', r + p_need);
end $$;

-- ── Finalise: reserved → used, idempotent (B12-SR S1.7) ─────────────────────
-- The reservation row is the once-only token: no row → no-op (retried finalise,
-- or a deletion already cancelled it).
create or replace function public.quota_finalise(p_session_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s bytea := public._quota_hex32(p_session_hash);
  t bigint := public._api_now();
  q bytea;
  c integer;
begin
  select quota_ref into q from public.quota_reservations where session_hash = s;
  if not found then
    return jsonb_build_object('ok', true, 'converted', 0);
  end if;
  perform 1 from public.quota_accounts where quota_ref = q for update;   -- lock order: account first
  delete from public.quota_reservations where session_hash = s returning chunks into c;
  if not found then
    return jsonb_build_object('ok', true, 'converted', 0);
  end if;
  update public.quota_accounts
     set reserved_chunks = greatest(reserved_chunks - c, 0),
         used_chunks     = used_chunks + c,
         updated_at      = t
   where quota_ref = q;
  return jsonb_build_object('ok', true, 'converted', c);
end $$;

-- ── Release: credit-back on deletion, and cancel at a failed initiate ───────
-- Called only by the path that WON the R2 manifest latch (or by initiate on its
-- own failure), so it runs at most once per transfer. Same arguments from every
-- deletion path: (quota_ref, session_hash, total_chunks, upload_complete).
--   reservation still present → delete it, reserved −= its chunks (conversion
--     never happened, and now never will: finalise finds no row)
--   else, complete           → used −= p_chunks
--   else, not complete       → nothing held (reservation already expired)
create or replace function public.quota_release(
  p_quota_ref text, p_session_hash text, p_chunks integer, p_complete boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q bytea := public._quota_hex32(p_quota_ref);
  s bytea := public._quota_hex32(p_session_hash);
  t bigint := public._api_now();
  a public.quota_accounts;
  c integer;
begin
  if p_chunks is null or p_chunks < 1 or p_chunks > 8000 then
    raise exception 'quota_release: chunks out of range';
  end if;
  select * into a from public.quota_accounts where quota_ref = q for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'quota_not_provisioned');
  end if;
  delete from public.quota_reservations where session_hash = s and quota_ref = q returning chunks into c;
  if found then
    update public.quota_accounts set reserved_chunks = greatest(reserved_chunks - c, 0), updated_at = t
     where quota_ref = q;
    return jsonb_build_object('ok', true, 'released', 'reservation', 'chunks', c);
  end if;
  if p_complete then
    update public.quota_accounts set used_chunks = greatest(used_chunks - p_chunks, 0), updated_at = t
     where quota_ref = q;
    return jsonb_build_object('ok', true, 'released', 'used', 'chunks', p_chunks,
                              'clamped', a.used_chunks < p_chunks);
  end if;
  return jsonb_build_object('ok', true, 'released', 'none', 'chunks', 0);
end $$;

-- ── Nightly reconcile (B12-SR S1.9) ─────────────────────────────────────────
-- p_t0 = quota_now() read BEFORE the Worker scanned R2. p_rows = one entry per
-- quota_ref with live, complete, non-soak manifests:
--   [{ "q": hex64, "used": int, "done": [session_hash hex64, …] }]
-- Accounts absent from p_rows have zero live chunks. A row touched at or after
-- p_t0 is skipped tonight (optimistic concurrency) — only its reserved figure is
-- refreshed, which is always safe because it is recomputed inside this lock.
-- "done" = sessions whose manifest is complete: their reservation rows (left by
-- a finalise conversion that failed) are dropped, since used now counts them.
create or replace function public.quota_now() returns bigint
language sql stable security definer set search_path = public, pg_temp as $$
  select public._api_now()
$$;

create or replace function public.quota_reconcile(p_t0 bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t bigint := public._api_now();
  a public.quota_accounts;
  e jsonb;
  computed integer;
  done bytea[];
  r integer;
  n_accounts integer := 0; n_corrected integer := 0; n_skipped integer := 0; drift bigint := 0;
begin
  if p_t0 is null or p_t0 > t then raise exception 'quota_reconcile: bad t0'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'quota_reconcile: rows must be an array'; end if;

  for a in select * from public.quota_accounts order by quota_ref for update loop
    n_accounts := n_accounts + 1;
    select x into e from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) x
     where public._quota_hex32(x->>'q') = a.quota_ref limit 1;
    computed := coalesce((e->>'used')::integer, 0);
    if computed < 0 then raise exception 'quota_reconcile: negative used'; end if;

    if a.updated_at < p_t0 then
      select coalesce(array_agg(public._quota_hex32(h)), '{}') into done
        from jsonb_array_elements_text(coalesce(e->'done', '[]'::jsonb)) h;
      delete from public.quota_reservations where quota_ref = a.quota_ref and session_hash = any(done);
      r := public._quota_refresh_reserved(a.quota_ref, t);
      if a.used_chunks <> computed then
        n_corrected := n_corrected + 1;
        drift := drift + abs(a.used_chunks - computed);
      end if;
      update public.quota_accounts set used_chunks = computed, reconciled_at = t where quota_ref = a.quota_ref;
    else
      n_skipped := n_skipped + 1;
      r := public._quota_refresh_reserved(a.quota_ref, t);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'accounts', n_accounts, 'corrected', n_corrected,
                            'drift_chunks', drift, 'skipped', n_skipped);
end $$;

-- ── Execute: service role only ──────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._quota_hex32(text)', 'public._quota_json(public.quota_accounts)',
    'public._quota_refresh_reserved(bytea, bigint)',
    'public.quota_provision(text, text, integer, integer)', 'public.quota_get(text)',
    'public.quota_reserve(text, text, integer, bigint)', 'public.quota_finalise(text)',
    'public.quota_release(text, text, integer, boolean)',
    'public.quota_now()', 'public.quota_reconcile(bigint, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
