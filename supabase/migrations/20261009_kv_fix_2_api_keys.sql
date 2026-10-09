-- KV-Fix-2 (9 Oct 2026) — API keys and credit pools move from KV to Supabase.
-- Design: docs/KV-Audit-v1.md §4.2. KV is compromised for write (B12-SR X1):
-- a KV record could be forged (become a client), rolled back (revive a revoked
-- key, refill a balance) or raced (two issues overspend). These tables are the
-- arbiter for authentication, spend, allocation and revocation.
--
-- Access: RLS on, no policies; table privileges revoked from anon/authenticated.
-- The Worker calls the SECURITY DEFINER functions below with the service role.
-- Times in the pool are unix seconds (bigint), matching worker/src/quota.js.
-- Applied to project tihgvdokeofnjxjkenmm via the Supabase MCP (shared with
-- refueler.io; Share tables carry no prefix, like spent_tokens).

create table public.api_keys (
  key_hash        bytea primary key check (octet_length(key_hash) = 32),       -- SHA-256(rfs_live_ / rfs_test_live_)
  sign_key_hash   bytea not null check (octet_length(sign_key_hash) = 32),     -- SHA-256(rfs_sign_ / rfs_test_sign_)
  org_account_id  uuid not null,                                               -- stable, never key-derived (B12-SR A2)
  rail            text not null default 'identity'
                  check (rail = 'identity' or (sandbox and rail = 'anonymous')),
  sandbox         boolean not null default false,
  active          boolean not null default true,
  grace_until     timestamptz,                                                 -- rotation: old key valid until then
  expires_at      timestamptz,                                                 -- sandbox keys: 30 days
  label           text check (label is null or char_length(label) <= 64),      -- admin display only
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index api_keys_org_idx on public.api_keys (org_account_id);

create table public.api_credit_pools (
  org_account_id  uuid primary key,
  plan            text not null check (plan in ('identity_api', 'personal_api', 'sandbox')),
  allocation      bigint not null check (allocation >= 0),
  remaining       bigint not null check (remaining >= 0),
  overage_credits bigint not null default 0 check (overage_credits >= 0),
  overage_ceiling bigint not null default 0 check (overage_ceiling >= 0),
  period_start    bigint not null,
  period_end      bigint not null,
  status          text not null check (status in ('active', 'cancelled')),
  updated_at      bigint not null
);

alter table public.api_keys         enable row level security;
alter table public.api_credit_pools enable row level security;
revoke all on public.api_keys, public.api_credit_pools from public, anon, authenticated;

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public._api_now() returns bigint
language sql stable set search_path = public, pg_temp as $$
  select floor(extract(epoch from now()))::bigint
$$;

-- Calendar month on the billing anniversary, UTC, clamped (31 Jan → 28/29 Feb).
-- Same result as addOneMonth() in worker/src/quota.js.
create or replace function public._api_add_month(p bigint) returns bigint
language sql immutable set search_path = public, pg_temp as $$
  select floor(extract(epoch from (((to_timestamp(p) at time zone 'UTC') + interval '1 month') at time zone 'UTC')))::bigint
$$;

create or replace function public._api_pool_json(r public.api_credit_pools) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'plan', r.plan, 'allocation', r.allocation, 'remaining', r.remaining,
    'overage_credits', r.overage_credits, 'overage_ceiling', r.overage_ceiling,
    'period_start', r.period_start, 'period_end', r.period_end,
    'status', r.status, 'updated_at', r.updated_at)
$$;

-- ── Keys ─────────────────────────────────────────────────────────────────────

-- Valid key → its record; unknown, revoked (past grace) or expired → null.
create or replace function public.api_key_lookup(p_key_hash text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sign_key_hash',  encode(k.sign_key_hash, 'hex'),
    'org_account_id', k.org_account_id,
    'rail',           k.rail,
    'sandbox',        k.sandbox,
    'created_at',     floor(extract(epoch from k.created_at))::bigint,
    'expires_at',     floor(extract(epoch from k.expires_at))::bigint)
  from public.api_keys k
  where k.key_hash = decode(p_key_hash, 'hex')
    and (k.active or (k.grace_until is not null and k.grace_until > now()))
    and (k.expires_at is null or k.expires_at > now())
$$;

create or replace function public.api_key_create(
  p_key_hash text, p_sign_key_hash text, p_org uuid, p_rail text,
  p_sandbox boolean, p_expires_at timestamptz, p_label text
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.api_keys (key_hash, sign_key_hash, org_account_id, rail, sandbox, expires_at, label)
  values (decode(p_key_hash, 'hex'), decode(p_sign_key_hash, 'hex'), p_org, p_rail, p_sandbox, p_expires_at, p_label)
$$;

-- Revokes at once (no grace). Returns the org, or null if the key is unknown.
create or replace function public.api_key_revoke(p_key_hash text) returns uuid
language sql security definer set search_path = public, pg_temp as $$
  update public.api_keys
     set active = false, grace_until = null, updated_at = now()
   where key_hash = decode(p_key_hash, 'hex')
  returning org_account_id
$$;

-- Admin lookup by hash regardless of state (provision/cancel/reset by live key).
create or replace function public.api_key_org(p_key_hash text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('org_account_id', org_account_id, 'rail', rail,
                            'sandbox', sandbox, 'active', active)
  from public.api_keys where key_hash = decode(p_key_hash, 'hex')
$$;

-- ── Pools ────────────────────────────────────────────────────────────────────

create or replace function public.api_pool_get(p_org uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public._api_pool_json(p) from public.api_credit_pools p where p.org_account_id = p_org
$$;

-- Fresh pool (overwrites: re-provision resets the period). Allocation comes from
-- the plan constants in worker/src/quota.js — one source.
create or replace function public.api_pool_provision(
  p_org uuid, p_plan text, p_allocation bigint, p_overage_ceiling bigint,
  p_period_start bigint, p_period_end bigint
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.api_credit_pools;
begin
  insert into public.api_credit_pools as p
    (org_account_id, plan, allocation, remaining, overage_credits, overage_ceiling,
     period_start, period_end, status, updated_at)
  values (p_org, p_plan, p_allocation, p_allocation, 0,
          case when p_plan = 'identity_api' then p_overage_ceiling else 0 end,
          p_period_start, p_period_end, 'active', public._api_now())
  on conflict (org_account_id) do update set
    plan = excluded.plan, allocation = excluded.allocation, remaining = excluded.remaining,
    overage_credits = 0, overage_ceiling = excluded.overage_ceiling,
    period_start = excluded.period_start, period_end = excluded.period_end,
    status = 'active', updated_at = excluded.updated_at
  returning * into r;
  return public._api_pool_json(r);
end $$;

create or replace function public.api_pool_cancel(p_org uuid, p_immediate boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.api_credit_pools;
begin
  select * into r from public.api_credit_pools where org_account_id = p_org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'record_absent'); end if;
  if r.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true, 'record', public._api_pool_json(r));
  end if;
  update public.api_credit_pools
     set status = 'cancelled', updated_at = public._api_now(),
         remaining = case when p_immediate then 0 else remaining end
   where org_account_id = p_org
  returning * into r;
  return jsonb_build_object('ok', true, 'already_cancelled', false, 'record', public._api_pool_json(r));
end $$;

-- Atomic spend: the row lock closes the overspend race. Rules are exactly
-- applyQuotaSpend() in worker/src/quota.js (cancellation before lazy reset;
-- one-step reset; personal + sandbox hard stop; identity metered overage).
-- A refused spend writes nothing (the reset is not persisted, as in JS).
create or replace function public.api_credits_spend(p_org uuid, p_cost bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r       public.api_credit_pools;
  v_now   bigint := public._api_now();
  v_short bigint;
  v_over  bigint;
begin
  if p_cost is null or p_cost < 1 then raise exception 'api_credits_spend: cost must be >= 1'; end if;
  select * into r from public.api_credit_pools where org_account_id = p_org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'quota_not_provisioned'); end if;

  if r.status = 'cancelled' then
    if v_now >= r.period_end or r.remaining <= 0 then
      return jsonb_build_object('ok', false, 'code', 'account_cancelled', 'shortfall_credits', p_cost);
    end if;
  elsif v_now >= r.period_end and r.plan <> 'sandbox' then
    r.remaining       := r.allocation;
    r.overage_credits := 0;
    r.period_start    := r.period_end;
    r.period_end      := public._api_add_month(r.period_end);
  end if;

  if r.plan in ('personal_api', 'sandbox') then
    if r.remaining < p_cost then
      return jsonb_build_object('ok', false, 'code', 'quota_exhausted',
        'shortfall_credits', p_cost - r.remaining, 'remaining_credits', r.remaining);
    end if;
    r.remaining := r.remaining - p_cost;
  elsif r.remaining >= p_cost then
    r.remaining := r.remaining - p_cost;
  else
    v_short := p_cost - r.remaining;
    v_over  := r.overage_credits + v_short;
    if v_over > r.overage_ceiling then
      return jsonb_build_object('ok', false, 'code', 'overage_ceiling',
        'remaining_credits', 0, 'overage_credits', r.overage_credits,
        'overage_ceiling', r.overage_ceiling, 'shortfall_credits', v_short);
    end if;
    r.remaining       := 0;
    r.overage_credits := v_over;
  end if;

  r.updated_at := v_now;
  update public.api_credit_pools
     set remaining = r.remaining, overage_credits = r.overage_credits,
         period_start = r.period_start, period_end = r.period_end, updated_at = r.updated_at
   where org_account_id = p_org;
  return jsonb_build_object('ok', true, 'record', public._api_pool_json(r));
end $$;

-- Undo a spend whose work then failed (blind signature error at issue).
-- Overage first, then remaining, capped at allocation.
create or replace function public.api_credits_refund(p_org uuid, p_cost bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.api_credit_pools; v_back_over bigint;
begin
  if p_cost is null or p_cost < 1 then raise exception 'api_credits_refund: cost must be >= 1'; end if;
  select * into r from public.api_credit_pools where org_account_id = p_org for update;
  if not found then return null; end if;
  v_back_over := least(r.overage_credits, p_cost);
  update public.api_credit_pools
     set overage_credits = overage_credits - v_back_over,
         remaining       = least(allocation, remaining + (p_cost - v_back_over)),
         updated_at      = public._api_now()
   where org_account_id = p_org
  returning * into r;
  return public._api_pool_json(r);
end $$;

-- Navy Office API stats: production pools only.
create or replace function public.api_pool_stats() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'provisioned', count(*),
    'active',      count(*) filter (where status = 'active'),
    'by_plan',     coalesce((select jsonb_object_agg(plan, n) from
                     (select plan, count(*) n from public.api_credit_pools
                       where plan <> 'sandbox' group by plan) s), '{}'::jsonb))
  from public.api_credit_pools where plan <> 'sandbox'
$$;

-- ── Execute: service role only ───────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._api_now()', 'public._api_add_month(bigint)', 'public._api_pool_json(public.api_credit_pools)',
    'public.api_key_lookup(text)', 'public.api_key_create(text,text,uuid,text,boolean,timestamptz,text)',
    'public.api_key_revoke(text)', 'public.api_key_org(text)', 'public.api_pool_get(uuid)',
    'public.api_pool_provision(uuid,text,bigint,bigint,bigint,bigint)', 'public.api_pool_cancel(uuid,boolean)',
    'public.api_credits_spend(uuid,bigint)', 'public.api_credits_refund(uuid,bigint)', 'public.api_pool_stats()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
