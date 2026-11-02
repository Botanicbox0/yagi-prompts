-- CLOUD APPLICATION REQUIRED. Every photo is owner-only through authenticated server routes.
do $$
declare t text;
begin
  foreach t in array array['identity_portrait_attempts','identity_portrait_selections'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
  end loop;
end
$$;
grant select,insert,update on public.identity_portrait_attempts,public.identity_portrait_selections to service_role;
