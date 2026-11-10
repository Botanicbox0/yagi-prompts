-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0154 — brand studio library posture (pairs with 0081)
-- RLS on with no policies = closed to every browser key. The library API runs on the app's server role
-- (the 0150 / 0152 shape).
do $$ declare t text; begin
 foreach t in array array['brand_studio_folders','brand_studio_folder_items','brand_studio_likes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
