-- CLOUD APPLICATION REQUIRED. A saved photo is owner-only through authenticated server routes;
-- no browser role may read or write the rows or the private object directly.
do $$
declare t text;
begin
  foreach t in array array['identity_selfies'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end
$$;
-- No delete: removing a photo sets `deleted_at` (paid orders keep their lineage); the rows and the
-- `{id}/selfie.png` objects go only with the account (docs/RUNBOOK-deletion.md).
grant select,insert,update on public.identity_selfies to service_role;
