-- ─────────────────────────────────────────────────────────────────────────────
-- 20261013_b12_4a2_citizen.sql — Citizen entitlement at initiate (B12-4a-2)
--
-- One read the Worker makes with a signed-in Citizen's principal ref
-- (subscribers.stripe_customer_id, from the S6 session — never a request field).
-- Paid = status 'active' AND current_period_end in the future. A missing period
-- end is NOT paid (fail closed; the Stripe webhook always writes one).
-- Returns { tier, paid } — tier is the wire value ('max'), never the email.
-- Service role only, like every auth_* function.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.citizen_entitlement(p_ref text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object(
              'tier', s.tier,
              'paid', (s.status = 'active' and s.current_period_end is not null
                       and s.current_period_end > now()))
       from public.subscribers s
      where s.stripe_customer_id = p_ref),
    jsonb_build_object('tier', 'free', 'paid', false))
$$;

revoke all on function public.citizen_entitlement(text) from public, anon, authenticated;
grant execute on function public.citizen_entitlement(text) to service_role;
