-- CLOUD APPLICATION REQUIRED. A selfie is owner-only through authenticated server routes;
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
grant select,insert,update on public.identity_selfies to service_role;
