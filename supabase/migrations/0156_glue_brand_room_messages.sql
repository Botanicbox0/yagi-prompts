-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0156 — project room conversation posture (pairs with 0082)
-- RLS on with no policies = closed to every browser key. The room API and /admin run on the app's
-- server role (the 0152 shape).
do $$ declare t text; begin
 foreach t in array array['brand_room_messages','brand_room_reactions','brand_room_reads'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
