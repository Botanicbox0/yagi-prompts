-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0158 — share link posture (pairs with 0084)
-- RLS on with no policies = closed to every browser key. The share page, the room API and /admin run on
-- the app's server role (the 0152 shape). The review tables 0084 widens already have this posture (0155).
do $$ declare t text; begin
 foreach t in array array['brand_room_shares','brand_room_share_visits'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
