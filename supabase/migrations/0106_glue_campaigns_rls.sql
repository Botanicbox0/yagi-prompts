-- PLAYBOOK · glue migration 0106 — campaigns RLS (mirrors 0104 for contests).
--
-- Deny-all with no policies: the browser client can do nothing but auth, every read goes through
-- the cached public projection (`campaigns` tag) or the service-role data client, and every write
-- goes through the admin dispatcher or the creator actions on the server.
do $$
declare
  t text;
begin
  foreach t in array array['campaigns', 'campaign_applications', 'campaign_application_writes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
