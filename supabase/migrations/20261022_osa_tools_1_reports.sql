-- OSA-Tools-1 (22 Oct 2026) — the report register (Online Safety Act report route).
-- Design: private docs/OSA-Tools-plan-v1.md §4–§5 (§11 confirmed by Rajesh, 22 Oct:
-- Supabase, functions only; never KV).
--
-- One row per report, keyed by its case reference R-YYYY-NNN (training rows
-- T-YYYY-NNN, own counter, so a drill never uses up or shows a real number).
-- Never in any table: reporter email or name, IP address, the key part after
-- the #, the full transfer ID (UUID), file details. uuid8 = the first 8
-- characters of the transfer ID. The CHECKs below are the guarantee: no code
-- path can store '@', '#' or 'http' in free text.
--
-- report_events is append-only (names of fields changed, never values).
-- Real rows can never be deleted; training rows only, by report_delete_training.
--
-- Access: RLS on, no policies; privileges revoked from public/anon/authenticated.
-- The Worker calls the SECURITY DEFINER functions below with the service role
-- and passes `by` ('admin' | 'helper'); the helper limits are enforced here too.
-- Times are unix seconds (bigint) from public._api_now() (KV-Fix-2).

create table public.report_counters (
  prefix  text    not null check (prefix in ('R', 'T')),
  year    integer not null check (year between 2026 and 9999),
  last    integer not null default 0 check (last between 0 and 9999),
  primary key (prefix, year)
);

create table public.report_register (
  case_ref       text    primary key check (case_ref ~ '^[RT]-[0-9]{4}-[0-9]{3,4}$'),
  training       boolean not null,
  received_at    bigint  not null check (received_at > 0),
  route          text    not null check (route in ('report@', 'support@', 'privacy@', 'signal', 'other')),
  uuid8          text             check (uuid8 ~ '^[0-9a-f]{8}$'),
  category       text    not null check (category in ('csea', 'terrorism', 'iia', 'extreme_porn', 'fraud',
                                                      'other_illegal', 'terms', 'complaint', 'appeal', 'no_link')),
  decision       text    not null default 'open'
                                  check (decision in ('open', 'removed', 'not_removed', 'already_gone', 'manifestly_unfounded')),
  reason         text             check (char_length(reason) <= 500 and reason !~* '(@|#|http)'),
  takedown_at    bigint,
  takedown_by    text             check (takedown_by in ('admin', 'helper')),
  nca_ref        text             check (char_length(nca_ref) <= 64 and nca_ref ~ '^[A-Za-z0-9-]*$'),
  reporter_told  text             check (reporter_told in ('y', 'n', 'no_contact')),
  key_removed    boolean not null default false,
  closed_at      bigint,
  opened_by      text    not null check (opened_by in ('admin', 'helper')),
  updated_at     bigint  not null,
  check (training = (case_ref like 'T-%')),
  check ((decision = 'open') = (closed_at is null)),
  check ((takedown_at is null) = (takedown_by is null))
);
create index report_register_uuid8_idx on public.report_register (uuid8);

create table public.report_events (
  id        bigint  generated always as identity primary key,
  case_ref  text    not null references public.report_register (case_ref),
  at        bigint  not null,
  by        text    not null check (by in ('admin', 'helper')),
  action    text    not null check (action in ('open', 'update', 'takedown', 'close', 'category_change')),
  fields    text[]  not null default '{}'
            check (fields <@ array['training', 'received_at', 'route', 'uuid8', 'category', 'decision', 'reason',
                                   'takedown_at', 'takedown_by', 'nca_ref', 'reporter_told', 'key_removed']::text[])
);
create index report_events_case_idx on public.report_events (case_ref);

alter table public.report_counters enable row level security;
alter table public.report_register enable row level security;
alter table public.report_events   enable row level security;
revoke all on public.report_counters, public.report_register, public.report_events from public, anon, authenticated;
grant all on public.report_counters, public.report_register, public.report_events to service_role;

-- ── Guards (hold even for the service role) ─────────────────────────────────
-- A real row is never deleted; its case reference, prefix, time received and
-- opener never change. Events are never edited, and deleted only with their
-- training row.

create or replace function public._report_register_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if not old.training then raise exception 'report_register: real rows are never deleted'; end if;
    return old;
  end if;
  if new.case_ref is distinct from old.case_ref or new.training is distinct from old.training
     or new.received_at is distinct from old.received_at or new.opened_by is distinct from old.opened_by then
    raise exception 'report_register: case_ref, training, received_at and opened_by never change';
  end if;
  return new;
end $$;

create trigger report_register_guard before update or delete on public.report_register
  for each row execute function public._report_register_guard();

create or replace function public._report_events_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then raise exception 'report_events: append-only'; end if;
  if old.case_ref not like 'T-%' then raise exception 'report_events: real events are never deleted'; end if;
  return old;
end $$;

create trigger report_events_guard before update or delete on public.report_events
  for each row execute function public._report_events_guard();

-- ── Helpers ──────────────────────────────────────────────────────────────────

create or replace function public._report_by(p text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p not in ('admin', 'helper') then raise exception 'report: by must be admin or helper'; end if;
  return p;
end $$;

create or replace function public._report_json(r public.report_register) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select to_jsonb(r)
$$;

-- ── Open a report: issue the next case reference, atomically ────────────────
-- One counter row per (prefix, year); the upsert takes the row lock, so
-- concurrent opens get consecutive numbers and never the same one.
-- Year = UTC year of received_at.
create or replace function public.report_open(
  p_by text, p_training boolean, p_received_at bigint, p_route text,
  p_uuid8 text, p_category text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b   text   := public._report_by(p_by);
  t   bigint := public._api_now();
  pre text   := case when p_training then 'T' else 'R' end;
  y   integer;
  n   integer;
  ref text;
  r   public.report_register;
begin
  if p_training is null then raise exception 'report_open: training is required'; end if;
  if p_received_at is null or p_received_at < 1767225600 or p_received_at > t + 300 then
    raise exception 'report_open: received_at out of range';
  end if;
  y := extract(year from (to_timestamp(p_received_at) at time zone 'UTC'))::integer;

  insert into public.report_counters (prefix, year, last) values (pre, y, 1)
  on conflict (prefix, year) do update set last = public.report_counters.last + 1
  returning last into n;
  if n > 9999 then raise exception 'report_open: counter full for %', y; end if;
  ref := pre || '-' || y || '-' || case when n < 1000 then lpad(n::text, 3, '0') else n::text end;

  insert into public.report_register
    (case_ref, training, received_at, route, uuid8, category, reason, opened_by, updated_at)
  values (ref, p_training, p_received_at, p_route, p_uuid8, p_category, p_reason, b, t)
  returning * into r;

  insert into public.report_events (case_ref, at, by, action, fields)
  values (ref, t, b, 'open', array_remove(array['training', 'received_at', 'route',
          case when p_uuid8 is not null then 'uuid8' end, 'category',
          case when p_reason is not null then 'reason' end], null));

  return jsonb_build_object('ok', true, 'case_ref', ref, 'row', public._report_json(r));
end $$;

-- ── Update / close ──────────────────────────────────────────────────────────
-- p_patch keys: category, decision, reason, nca_ref, reporter_told, key_removed
-- (anything else raises). A JSON null clears reason / nca_ref / reporter_told.
-- Helper: CSEA and terrorism rows only, and never a category change.
-- Leaving 'open' sets closed_at (event 'close'); returning to 'open' clears it.
create or replace function public.report_update(p_by text, p_case_ref text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b       text   := public._report_by(p_by);
  t       bigint := public._api_now();
  r       public.report_register;
  n       public.report_register;
  k       text;
  changed text[] := '{}';
begin
  if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'report_update: patch must be an object'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('category', 'decision', 'reason', 'nca_ref', 'reporter_told', 'key_removed') then
      raise exception 'report_update: field % cannot be updated', k;
    end if;
  end loop;

  select * into r from public.report_register where case_ref = p_case_ref for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if b = 'helper' and r.category not in ('csea', 'terrorism') then
    return jsonb_build_object('ok', false, 'code', 'helper_category');
  end if;
  if b = 'helper' and p_patch ? 'category' and (p_patch->>'category') is distinct from r.category then
    return jsonb_build_object('ok', false, 'code', 'helper_category_change');
  end if;

  n := r;
  if p_patch ? 'category'      then n.category      := p_patch->>'category';      end if;
  if p_patch ? 'decision'      then n.decision      := p_patch->>'decision';      end if;
  if p_patch ? 'reason'        then n.reason        := p_patch->>'reason';        end if;
  if p_patch ? 'nca_ref'       then n.nca_ref       := p_patch->>'nca_ref';       end if;
  if p_patch ? 'reporter_told' then n.reporter_told := p_patch->>'reporter_told'; end if;
  if p_patch ? 'key_removed'   then n.key_removed   := coalesce((p_patch->>'key_removed')::boolean, false); end if;

  if n.decision is distinct from r.decision then changed := changed || 'decision'::text; end if;
  if n.reason is distinct from r.reason then changed := changed || 'reason'::text; end if;
  if n.nca_ref is distinct from r.nca_ref then changed := changed || 'nca_ref'::text; end if;
  if n.reporter_told is distinct from r.reporter_told then changed := changed || 'reporter_told'::text; end if;
  if n.key_removed is distinct from r.key_removed then changed := changed || 'key_removed'::text; end if;

  if n.category is not distinct from r.category and cardinality(changed) = 0 then
    return jsonb_build_object('ok', true, 'unchanged', true, 'row', public._report_json(r));
  end if;

  if n.decision = 'open' then n.closed_at := null;
  elsif r.decision = 'open' then n.closed_at := t;
  end if;
  n.updated_at := t;

  update public.report_register set
    category = n.category, decision = n.decision, reason = n.reason, nca_ref = n.nca_ref,
    reporter_told = n.reporter_told, key_removed = n.key_removed, closed_at = n.closed_at,
    updated_at = n.updated_at
  where case_ref = r.case_ref
  returning * into n;

  if n.category is distinct from r.category then
    insert into public.report_events (case_ref, at, by, action, fields) values (r.case_ref, t, b, 'category_change', array['category']);
  end if;
  if cardinality(changed) > 0 then
    insert into public.report_events (case_ref, at, by, action, fields)
    values (r.case_ref, t, b, case when r.decision = 'open' and n.decision <> 'open' then 'close' else 'update' end, changed);
  end if;

  return jsonb_build_object('ok', true, 'row', public._report_json(n));
end $$;

-- ── Take-down record (first called by OSA-Tools-2) ──────────────────────────
-- The Worker destroys first, records second. Checks again what the Worker
-- checked before destroying: open row, same uuid8, helper → CSEA/terrorism only.
-- A second call for a row already marked is a no-op.
create or replace function public.report_takedown(p_by text, p_case_ref text, p_uuid8 text, p_at bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b text   := public._report_by(p_by);
  t bigint := public._api_now();
  r public.report_register;
begin
  if p_at is null or p_at < 1767225600 or p_at > t + 300 then raise exception 'report_takedown: at out of range'; end if;
  select * into r from public.report_register where case_ref = p_case_ref for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if r.takedown_at is not null then
    return jsonb_build_object('ok', true, 'already', true, 'row', public._report_json(r));
  end if;
  if r.decision <> 'open' then return jsonb_build_object('ok', false, 'code', 'case_closed'); end if;
  if r.uuid8 is null or r.uuid8 is distinct from p_uuid8 then
    return jsonb_build_object('ok', false, 'code', 'case_mismatch');
  end if;
  if b = 'helper' and r.category not in ('csea', 'terrorism') then
    return jsonb_build_object('ok', false, 'code', 'helper_category');
  end if;

  update public.report_register set takedown_at = p_at, takedown_by = b, updated_at = t
   where case_ref = r.case_ref returning * into r;
  insert into public.report_events (case_ref, at, by, action, fields)
  values (r.case_ref, t, b, 'takedown', array['takedown_at', 'takedown_by']);
  return jsonb_build_object('ok', true, 'row', public._report_json(r));
end $$;

-- ── Read ────────────────────────────────────────────────────────────────────

create or replace function public.report_get(p_case_ref text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select public._report_json(r) from public.report_register r where r.case_ref = p_case_ref
$$;

-- Newest first, training rows included (each carries training: true).
create or replace function public.report_list(p_limit integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public._report_json(r) order by r.received_at desc, r.case_ref desc), '[]'::jsonb)
  from (select * from public.report_register
        order by received_at desc, case_ref desc
        limit greatest(1, least(coalesce(p_limit, 200), 500))) r
$$;

-- p_training false → real rows only (the register export); true → training rows only (drills).
create or replace function public.report_export(p_training boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'exported_at', public._api_now(),
    'rows',   coalesce((select jsonb_agg(public._report_json(r) order by r.case_ref)
                          from public.report_register r where r.training = coalesce(p_training, false)), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id)
                          from public.report_events e
                          join public.report_register r on r.case_ref = e.case_ref
                         where r.training = coalesce(p_training, false)), '[]'::jsonb))
$$;

-- Training rows only (and their events). Real rows: refused by the guard trigger.
create or replace function public.report_delete_training() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  delete from public.report_events where case_ref like 'T-%';
  delete from public.report_register where training;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

-- ── Execute: service role only ──────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._report_register_guard()', 'public._report_events_guard()',
    'public._report_by(text)', 'public._report_json(public.report_register)',
    'public.report_open(text, boolean, bigint, text, text, text, text)',
    'public.report_update(text, text, jsonb)',
    'public.report_takedown(text, text, text, bigint)',
    'public.report_get(text)', 'public.report_list(integer)',
    'public.report_export(boolean)', 'public.report_delete_training()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
