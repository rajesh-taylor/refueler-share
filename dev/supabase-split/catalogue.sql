-- dev/supabase-split/catalogue.sql — Supabase-Split-1. Read-only. Fingerprints Share's
-- schema so two projects can be compared: one row per kind of object, a count and a hash.
-- Names and definitions only, never a row of data.
-- auth_token_issue: production's copy lost one SQL comment, so comments are stripped for it.
-- table_priv_rpc_only: api_keys and api_credit_pools have no service_role table access on
-- a replay ('' on the new project, 'S,I' on the shared one), which is tighter and intended.
with share(t) as (values ('subscribers'),('spent_tokens'),('double_spend_attempts'),('api_keys'),('api_credit_pools'),('quota_accounts'),('quota_reservations'),('chartered_orgs'),('auth_tokens'),('auth_sessions'),('report_counters'),('report_register'),('report_events')),
fns as (select p.oid from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname ~ '^(_?api_|_?quota_|_?auth_|_?report_|citizen_)'),
o as (
select 'column' k, table_name||'.'||column_name n, md5(concat_ws('|',data_type,is_nullable,regexp_replace(coalesce(column_default,''),'public\.','','g'),is_identity)) h from information_schema.columns where table_schema='public' and table_name in (select t from share)
union all select 'constraint', r.relname||'.'||c.conname, md5(pg_get_constraintdef(c.oid)) from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace ns on ns.oid=r.relnamespace where ns.nspname='public' and r.relname in (select t from share)
union all select 'index', indexname, md5(indexdef) from pg_indexes where schemaname='public' and tablename in (select t from share)
union all select 'trigger', c.relname||'.'||t.tgname, md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where not t.tgisinternal and ns.nspname='public' and c.relname in (select t from share)
union all select 'rls', relname, relrowsecurity::text from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and relname in (select t from share)
union all select 'policy', tablename||'.'||policyname, md5(concat_ws('|',cmd,roles::text,qual,with_check)) from pg_policies where schemaname='public' and tablename in (select t from share)
union all select 'function', oid::regprocedure::text, md5(pg_get_functiondef(oid)) from fns where oid::regprocedure::text not like 'auth_token_issue(%'
union all select 'auth_token_issue', oid::regprocedure::text, md5(regexp_replace(pg_get_functiondef(oid),'\s*--[^\n]*','','g')) from fns where oid::regprocedure::text like 'auth_token_issue(%'
union all select 'func_acl', f.oid::regprocedure::text, (select string_agg(distinct grantee::regrole::text, ',') from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) where p.oid=f.oid and privilege_type='EXECUTE') from fns f
union all select case when t in ('api_keys','api_credit_pools') then 'table_priv_rpc_only' else 'table_priv' end, t, concat_ws(',', case when has_table_privilege('service_role','public.'||t,'select') then 'S' end, case when has_table_privilege('service_role','public.'||t,'insert') then 'I' end) from share
)
select k as kind, count(*) as objects, md5(string_agg(n||'='||coalesce(h,''), ';' order by n collate "C")) as fingerprint from o group by k order by k collate "C";
