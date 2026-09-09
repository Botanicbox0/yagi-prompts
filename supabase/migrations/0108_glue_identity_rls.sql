-- PLAYBOOK · glue migration 0108 — identity RLS (mirrors 0107 for render_jobs).
--
-- Deny-all with no policies: a person's group id and asset ids are the server's business; the
-- browser only ever sees "verified / not yet" through the verify page and the studio's access call.
do $$
declare
  t text;
begin
  foreach t in array array['identity_groups', 'identity_assets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
