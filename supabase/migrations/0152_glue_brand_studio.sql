-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0152 — brand studio v2 posture (pairs with 0076)
-- RLS on with no policies = closed to every browser key. The studio API, the webhook, the lane route
-- and /admin all run on the app's server role (the 0150 shape).
do $$ declare t text; begin
 foreach t in array array['brand_studio_assets','brand_studio_jobs','brand_studio_outputs','brand_studio_allowances','brand_studio_lanes'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
