-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0149 — public_media_copies posture (pairs with 0073)
-- No browser key reads or writes this: the app's server role reads the verified keys and only the
-- copy run writes them (the 0147 shape).
do $$ declare t text; begin
 foreach t in array array['public_media_copies'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
