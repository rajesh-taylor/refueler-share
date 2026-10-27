-- ─────────────────────────────────────────────────────────────────────────────
-- 20261001_baseline_dashboard_tables.sql — the three tables made in the
-- Supabase dashboard before migrations lived in this repo (Stripe-Account-1,
-- 27 Oct 2026). Dated first so a fresh local stack (`supabase start`) can apply
-- 20261012_b12_4a_auth.sql, whose trigger sits on public.subscribers.
--
-- Copied from production's catalogue (columns, defaults, keys, indexes, checks,
-- RLS and policies read 27 Oct 2026). Every statement is if-not-exists, so on
-- production it changes nothing: never apply it there by hand.
--
-- subscribers_tier_check is the pre-Stripe-Account-1 set; the next migration
-- (20261027_stripe_account_1_citizen.sql) replaces it.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.subscribers (
  stripe_customer_id  text        primary key,
  email               text,
  tier                text        not null default 'free'
                                  constraint subscribers_tier_check check (tier = any (array['free', 'creative', 'max'])),
  status              text        not null default 'inactive'
                                  constraint subscribers_status_check check (status = any (array['active', 'inactive', 'cancelled'])),
  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  cancelled_at        timestamptz
);
create index if not exists subscribers_email_idx on public.subscribers (email);

create table if not exists public.spent_tokens (
  serial     text        primary key,
  melted_at  timestamptz not null default now()
);

create table if not exists public.double_spend_attempts (
  id            bigserial   primary key,
  serial        text        not null,
  uuid          text        not null,
  attempted_at  timestamptz not null default now()
);
create index if not exists double_spend_attempts_serial_idx       on public.double_spend_attempts (serial);
create index if not exists double_spend_attempts_attempted_at_idx on public.double_spend_attempts (attempted_at);

alter table public.subscribers           enable row level security;
alter table public.spent_tokens          enable row level security;
alter table public.double_spend_attempts enable row level security;

-- Deny-all policies, as production has them. The Worker uses the service role.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscribers' and policyname = 'deny_all_anon_subscribers') then
    create policy deny_all_anon_subscribers on public.subscribers for all to anon, authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'spent_tokens' and policyname = 'deny_all_anon_spent_tokens') then
    create policy deny_all_anon_spent_tokens on public.spent_tokens for all to anon, authenticated using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'double_spend_attempts' and policyname = 'deny anon') then
    create policy "deny anon" on public.double_spend_attempts for all to anon using (false);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'double_spend_attempts' and policyname = 'deny authenticated') then
    create policy "deny authenticated" on public.double_spend_attempts for all to authenticated using (false);
  end if;
end $$;
