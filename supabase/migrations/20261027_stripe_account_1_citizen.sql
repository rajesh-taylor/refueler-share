-- ─────────────────────────────────────────────────────────────────────────────
-- 20261027_stripe_account_1_citizen.sql — wire tier 'citizen' (Stripe-Account-1)
--
-- ONE-SHOT, at the deploy sitting, in this order: (1) old Stripe account: the
-- two Plans prices carry lookup keys share-citizen-monthly / -yearly; (2) this
-- file in the SQL editor; (3) `npm run deploy` in worker/. Between (2) and (3)
-- the old Worker's 'max' writes are refused by the new check (it logs and
-- drops them); keep the gap to minutes. The new Worker answers a refused write
-- with 500, so from then on Stripe retries.
--
-- 1. Clears every subscribers row. All of them are old-account test rows: no
--    paying Citizen exists (plan v1 §1). The b12_4a trigger ends their
--    sessions. Their quota_accounts rows (keyed by an HMAC of the cus_ id) are
--    orphaned test data and stay. Once the deploy is live, an old-account
--    subscription that is still active comes back as 'citizen' on its next
--    webhook (the Worker re-fetches it).
-- 2. Replaces the tier check: free | citizen only. A stray old name can never
--    be written again.
-- 3. citizen_entitlement() is paid only on tier 'citizen' (defence in depth;
--    the Worker checks the tier too).
--
-- Rajesh's read first (SQL editor):
--   select tier, status, count(*) from public.subscribers group by 1, 2 order by 1, 2;
-- ─────────────────────────────────────────────────────────────────────────────

begin;

delete from public.subscribers;

alter table public.subscribers drop constraint if exists subscribers_tier_check;
alter table public.subscribers add constraint subscribers_tier_check check (tier in ('free', 'citizen'));

-- Paid = tier 'citizen' AND status 'active' AND current_period_end in the
-- future. A missing period end is NOT paid (fail closed). Returns { tier, paid }
-- — tier is the wire value, never the email. Service role only.
create or replace function public.citizen_entitlement(p_ref text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select jsonb_build_object(
              'tier', s.tier,
              'paid', (s.tier = 'citizen' and s.status = 'active'
                       and s.current_period_end is not null
                       and s.current_period_end > now()))
       from public.subscribers s
      where s.stripe_customer_id = p_ref),
    jsonb_build_object('tier', 'free', 'paid', false))
$$;

revoke all on function public.citizen_entitlement(text) from public, anon, authenticated;
grant execute on function public.citizen_entitlement(text) to service_role;

commit;
