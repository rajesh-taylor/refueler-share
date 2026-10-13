-- B12-4a (12 Oct 2026) — Registered-rail sign-in: magic-link tokens, sessions,
-- Chartered org admins. Design: docs/B12-SR-spec-v1.md S6 (wins) + B12 §4.6.
--
-- Registered rail ONLY. Bearer principals (Sovereign, Bearer-rail Chartered,
-- Silent Drop) never get a row here and never receive a magic link (X2, X3).
-- Nothing here is ever mirrored to KV: a KV writer must not be able to mint a
-- session (X1).
--
-- token_hash   = BLAKE3(32-byte token)       — the token itself lives only in the email link fragment
-- session_hash = BLAKE3(32-byte session id)  — the id itself lives only in the __Host- cookie
-- Both are high-entropy secrets, so unkeyed BLAKE3 (house rule).
-- No IP, no user agent, no location — ever. last_seen_at is rounded to the minute.
--
-- Principals: 'citizen'   → principal_ref = subscribers.stripe_customer_id
--             'org_admin' → principal_ref = chartered_orgs.org_account_id (uuid text)
--
-- Access: RLS on, no policies; table privileges revoked from anon/authenticated.
-- The Worker calls the SECURITY DEFINER functions below with the service role.
-- Times are unix seconds (bigint) from public._api_now() (KV-Fix-2).

create table public.chartered_orgs (
  org_account_id      uuid   primary key,                 -- stable, assigned at onboarding (B12-SR A2)
  stripe_customer_id  text   check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  admin_email         text   not null check (admin_email = lower(btrim(admin_email)) and admin_email like '%_@_%'),
  created_at          bigint not null
);
create index chartered_orgs_admin_email_idx on public.chartered_orgs (admin_email);

create table public.auth_tokens (
  token_hash      bytea  primary key check (octet_length(token_hash) = 32),
  principal_kind  text   not null check (principal_kind in ('citizen', 'org_admin')),
  principal_ref   text   not null,
  expires_at      bigint not null,
  used_at         bigint,
  constraint auth_tokens_ref_shape check (
    (principal_kind = 'citizen'   and principal_ref ~ '^cus_[A-Za-z0-9]+$') or
    (principal_kind = 'org_admin' and principal_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
);
create index auth_tokens_principal_idx on public.auth_tokens (principal_kind, principal_ref);

create table public.auth_sessions (
  session_hash         bytea  primary key check (octet_length(session_hash) = 32),
  principal_kind       text   not null check (principal_kind in ('citizen', 'org_admin')),
  principal_ref        text   not null,
  created_at           bigint not null,
  last_seen_at         bigint not null check (last_seen_at % 60 = 0),
  idle_expires_at      bigint not null,
  absolute_expires_at  bigint not null,
  constraint auth_sessions_ref_shape check (
    (principal_kind = 'citizen'   and principal_ref ~ '^cus_[A-Za-z0-9]+$') or
    (principal_kind = 'org_admin' and principal_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')),
  constraint auth_sessions_times check (
    idle_expires_at <= absolute_expires_at and absolute_expires_at - created_at <= 86400)
);
create index auth_sessions_principal_idx on public.auth_sessions (principal_kind, principal_ref, created_at);

-- Sign-in looks subscribers up by email; case-insensitive.
create index if not exists subscribers_email_lower_idx on public.subscribers (lower(btrim(email)));

alter table public.chartered_orgs enable row level security;
alter table public.auth_tokens    enable row level security;
alter table public.auth_sessions  enable row level security;
revoke all on public.chartered_orgs, public.auth_tokens, public.auth_sessions from public, anon, authenticated;
grant all on public.chartered_orgs, public.auth_tokens, public.auth_sessions to service_role;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public._auth_hex32(p text) returns bytea
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p !~ '^[0-9a-f]{64}$' then
    raise exception 'auth: expected 64 lowercase hex characters';
  end if;
  return decode(p, 'hex');
end $$;

-- Does this principal exist right now?
create or replace function public._auth_principal_exists(p_kind text, p_ref text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select case p_kind
    when 'citizen'   then exists (select 1 from public.subscribers where stripe_customer_id = p_ref)
    when 'org_admin' then exists (select 1 from public.chartered_orgs where org_account_id::text = p_ref)
    else false end
$$;

-- Kill every token and session of one principal. Used by sign-out-everywhere,
-- superadmin revocation and the email-change triggers (S6.7).
create or replace function public._auth_kill_principal(p_kind text, p_ref text) returns integer
language plpgsql set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.auth_tokens where principal_kind = p_kind and principal_ref = p_ref;
  delete from public.auth_sessions where principal_kind = p_kind and principal_ref = p_ref;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Email → principals (POST /auth/magic, inside waitUntil) ──────────────────
-- Returns [{kind, ref}], at most 3 of each kind. An email that is both a Citizen
-- and an org admin gets one email with one link per principal (S6.1).
create or replace function public.auth_principals_for_email(p_email text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(p), '[]'::jsonb) from (
    (select jsonb_build_object('kind', 'citizen', 'ref', s.stripe_customer_id) as p
       from public.subscribers s
      where lower(btrim(s.email)) = lower(btrim(p_email)) and s.stripe_customer_id is not null
      order by s.stripe_customer_id limit 3)
    union all
    (select jsonb_build_object('kind', 'org_admin', 'ref', o.org_account_id::text)
       from public.chartered_orgs o
      where o.admin_email = lower(btrim(p_email))
      order by o.org_account_id limit 3)
  ) x
$$;

-- ── Tokens ───────────────────────────────────────────────────────────────────

-- Store BLAKE3(token). TTL fixed at 15 minutes here, not by the caller (S6.3).
create or replace function public.auth_token_issue(p_token_hash text, p_kind text, p_ref text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t bigint := public._api_now();
begin
  if not public._auth_principal_exists(p_kind, p_ref) then
    raise exception 'auth: unknown principal';
  end if;
  delete from public.auth_tokens where expires_at <= t;       -- lazy tidy: nothing kept past expiry
  insert into public.auth_tokens (token_hash, principal_kind, principal_ref, expires_at)
  values (public._auth_hex32(p_token_hash), p_kind, p_ref, t + 900);
end $$;

-- Atomic single use (S6.3). Returns {kind, ref} once; null for unknown, used,
-- expired, or a principal that no longer exists.
create or replace function public.auth_token_consume(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t bigint := public._api_now(); k text; r text;
begin
  update public.auth_tokens set used_at = t
   where token_hash = public._auth_hex32(p_token_hash) and used_at is null and expires_at > t
  returning principal_kind, principal_ref into k, r;
  if k is null or not public._auth_principal_exists(k, r) then
    return null;
  end if;
  return jsonb_build_object('kind', k, 'ref', r);
end $$;

-- ── Sessions ─────────────────────────────────────────────────────────────────

-- New session at every sign-in (no pre-auth session exists, so no fixation).
-- TTLs come from the Worker's table (auth.js; S6.5) and are bounded here.
-- Keeps at most p_cap live sessions per principal; the oldest go first.
create or replace function public.auth_session_create(
  p_session_hash text, p_kind text, p_ref text, p_idle_ttl integer, p_abs_ttl integer, p_cap integer
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t bigint := public._api_now(); evicted integer;
begin
  if p_idle_ttl not between 60 and 86400 or p_abs_ttl not between p_idle_ttl and 86400
     or p_cap not between 1 and 50 then
    raise exception 'auth: bad session parameters';
  end if;
  if not public._auth_principal_exists(p_kind, p_ref) then
    raise exception 'auth: unknown principal';
  end if;
  insert into public.auth_sessions
    (session_hash, principal_kind, principal_ref, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
  values (public._auth_hex32(p_session_hash), p_kind, p_ref, t, t - t % 60, t + p_idle_ttl, t + p_abs_ttl);
  delete from public.auth_sessions where session_hash in (
    select session_hash from public.auth_sessions
     where principal_kind = p_kind and principal_ref = p_ref
     order by created_at desc, session_hash offset p_cap);
  get diagnostics evicted = row_count;
  return jsonb_build_object('created_at', t, 'idle_expires_at', t + p_idle_ttl,
                            'absolute_expires_at', t + p_abs_ttl, 'evicted', evicted);
end $$;

-- Look up a session; slide the idle window. Expired → row deleted, null.
create or replace function public.auth_session_check(p_session_hash text, p_idle_ttl integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t bigint := public._api_now(); h bytea := public._auth_hex32(p_session_hash); s public.auth_sessions;
begin
  if p_idle_ttl not between 60 and 86400 then raise exception 'auth: bad idle ttl'; end if;
  select * into s from public.auth_sessions where session_hash = h for update;
  if not found then return null; end if;
  if s.idle_expires_at <= t or s.absolute_expires_at <= t then
    delete from public.auth_sessions where session_hash = h;
    return null;
  end if;
  update public.auth_sessions
     set last_seen_at = t - t % 60, idle_expires_at = least(t + p_idle_ttl, s.absolute_expires_at)
   where session_hash = h
  returning * into s;
  return jsonb_build_object('kind', s.principal_kind, 'ref', s.principal_ref,
                            'idle_expires_at', s.idle_expires_at, 'absolute_expires_at', s.absolute_expires_at);
end $$;

-- Sign out this session.
create or replace function public.auth_session_delete(p_session_hash text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.auth_sessions where session_hash = public._auth_hex32(p_session_hash);
  return found;
end $$;

-- Sign out everywhere: every session (and unused token) of this session's principal.
create or replace function public.auth_session_delete_all(p_session_hash text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text; r text;
begin
  select principal_kind, principal_ref into k, r from public.auth_sessions
   where session_hash = public._auth_hex32(p_session_hash);
  if k is null then return 0; end if;
  return public._auth_kill_principal(k, r);
end $$;

-- ── Admin ────────────────────────────────────────────────────────────────────

-- Superadmin revocation (S6.7). SQL only; Navy Office has no per-account view.
create or replace function public.auth_revoke_principal(p_kind text, p_ref text) returns integer
language sql security definer set search_path = public, pg_temp as $$
  select public._auth_kill_principal(p_kind, p_ref)
$$;

-- Nightly tidy (03:00 cron): nothing outlives its expiry.
create or replace function public.auth_sweep() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare t bigint := public._api_now(); nt integer; ns integer;
begin
  delete from public.auth_tokens where expires_at <= t;
  get diagnostics nt = row_count;
  delete from public.auth_sessions where idle_expires_at <= t or absolute_expires_at <= t;
  get diagnostics ns = row_count;
  return jsonb_build_object('tokens', nt, 'sessions', ns);
end $$;

-- ── Email changes kill sign-in (S6.7) ────────────────────────────────────────
-- Whatever path changes an email (Stripe webhook, superadmin SQL), the old
-- address's tokens and sessions die with it. Deleting the principal does too.

create or replace function public._auth_subscribers_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform public._auth_kill_principal('citizen', old.stripe_customer_id);
    return old;
  end if;
  if old.email is distinct from new.email or old.stripe_customer_id is distinct from new.stripe_customer_id then
    perform public._auth_kill_principal('citizen', old.stripe_customer_id);
  end if;
  return new;
end $$;
create trigger subscribers_auth_kill after update or delete on public.subscribers
  for each row execute function public._auth_subscribers_changed();

create or replace function public._auth_orgs_changed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    perform public._auth_kill_principal('org_admin', old.org_account_id::text);
    return old;
  end if;
  if old.admin_email is distinct from new.admin_email or old.org_account_id is distinct from new.org_account_id then
    perform public._auth_kill_principal('org_admin', old.org_account_id::text);
  end if;
  return new;
end $$;
create trigger chartered_orgs_auth_kill after update or delete on public.chartered_orgs
  for each row execute function public._auth_orgs_changed();

-- ── Privileges ───────────────────────────────────────────────────────────────

do $$
declare f text;
begin
  foreach f in array array[
    'public._auth_hex32(text)', 'public._auth_principal_exists(text, text)',
    'public._auth_kill_principal(text, text)',
    'public.auth_principals_for_email(text)',
    'public.auth_token_issue(text, text, text)', 'public.auth_token_consume(text)',
    'public.auth_session_create(text, text, text, integer, integer, integer)',
    'public.auth_session_check(text, integer)', 'public.auth_session_delete(text)',
    'public.auth_session_delete_all(text)', 'public.auth_revoke_principal(text, text)',
    'public.auth_sweep()',
    'public._auth_subscribers_changed()', 'public._auth_orgs_changed()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
