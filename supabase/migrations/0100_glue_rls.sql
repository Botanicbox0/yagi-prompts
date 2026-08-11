-- PLAYBOOK · M0 · SUPABASE GLUE migration 0100  (NOT applied by the PGlite test harness)
-- Deny-all security posture, PLAN §6:
--   "The browser's Supabase client performs auth only; zero client-side data queries.
--    RLS ENABLED AND FORCED on every table with no policies (deny-all for anon/authenticated)."
--
-- Requires Supabase-managed roles (anon, authenticated, service_role), which do not exist in
-- PGlite — hence the core/glue split (see supabase/README.md).

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','playbooks','playbook_revisions','steps','blocks','default_policy',
    'publish_assets','subscriptions','stripe_events','notification_jobs',
    'notification_deliveries','events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

-- FORCE RLS applies to table owners too. The `publisher` role writes inside the SECURITY
-- DEFINER publish RPCs and owns no table, so it needs BYPASSRLS to transit the deny-all
-- posture. service_role already carries BYPASSRLS on Supabase.
do $$
begin
  alter role publisher with bypassrls;
exception when insufficient_privilege then
  raise warning 'could not set BYPASSRLS on publisher — publish RPCs will fail under FORCE RLS. '
                'Run as a superuser: ALTER ROLE publisher WITH BYPASSRLS;';
end
$$;

-- The RPCs are the only privileged surface exposed to app code, and only to the server.
revoke execute on function prepare_publish(uuid)              from public;
revoke execute on function publish_revision(uuid, uuid, text) from public;
revoke execute on function canonical_manifest(uuid)           from public;

grant execute on function prepare_publish(uuid)              to service_role;
grant execute on function publish_revision(uuid, uuid, text) to service_role;
grant execute on function canonical_manifest(uuid)           to service_role;
