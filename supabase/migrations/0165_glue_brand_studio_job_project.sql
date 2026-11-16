-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0165 — pairs with 0091 (brand_studio_jobs.project_id)
-- No new table and no new policy. The column inherits the posture `brand_studio_jobs` got in 0152
-- (RLS on + forced, no browser policies, service_role only), and `brand_studio_video_projects` keeps the
-- one from 0162; the unique key 0091 adds there changes nothing about access. Strictly, nothing in this file
-- is needed. It re-asserts both tables the way 0164 does for 0090, so the pair is safe to apply on its own.
do $$ declare t text; begin
 foreach t in array array['brand_studio_jobs','brand_studio_video_projects'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
