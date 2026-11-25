-- 클라우드 적용 필요 — TWINGS · glue migration 0195 — pairs with 0194 (the brand project spine)
-- No new table and no new policy. The new columns (`brand_projects.origin`, `brand_project_id` on three studio
-- tables) inherit their tables' posture; this file re-asserts it, as 0165 did for 0091, so the pair is safe to
-- apply on its own. Browser roles get nothing: no table-level and no column-level privilege on any of the four
-- tables (checked against every glue file up to 0193: 0113 revoked everything from public, anon and
-- authenticated on brand_projects and later files only granted column UPDATEs to service_role; the studio
-- tables were revoked from browser roles in 0152, 0162, 0164, 0165, 0168, 0171 and 0173). Revoking ALL on a
-- table also revokes any column privilege on it.
do $$ declare t text; begin
 foreach t in array array['brand_studio_jobs','brand_studio_assets','brand_studio_video_projects'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

-- brand_projects keeps 0113's shape: select and insert for the server role, UPDATE column by column
-- (0113, 0117, 0120, 0148, 0160), never DELETE. Re-asserted for browser roles only; the server role's
-- existing grants are not touched.
do $$ declare t text; begin
 foreach t in array array['brand_projects'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- Renaming a project and "야기 팀에 맡기기" (docs/BRAND-PROJECT-SPINE.md §3.3, §3.6) need these four columns.
-- Slice 1 itself only INSERTs 'self' rows (the table-level INSERT of 0113 already covers the new column); the
-- grant is here so the later slices need no new glue. Nothing for browser roles.
grant update(origin,title,objective,production_mode) on public.brand_projects to service_role;
