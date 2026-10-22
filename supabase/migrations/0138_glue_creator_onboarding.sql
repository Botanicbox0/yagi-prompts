-- CLOUD APPLICATION REQUIRED with 0051. No browser access: applications are shaped by authenticated services.
do $$ declare t text; begin
 foreach t in array array['platform_creator_applications'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
