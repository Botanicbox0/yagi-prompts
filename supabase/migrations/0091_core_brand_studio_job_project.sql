-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0091 — a studio run can belong to a project
-- (docs/BRAND-STUDIO-V6-PLAN.md §3, §7 C; founder question 2026-11-16 "asset에서는 프로젝트별로 asset이 보여야하지 않나?").
--
-- The project is the one the studio already has: `brand_studio_video_projects` (0087). No new container
-- table. `project_id` is nullable and stays null for everything made before this, for runs made with no
-- project chosen, and for the internal fill runs (`params.purpose = 'fill'`).
--
-- Safe to deploy the code first: the server looks for this column (`jobProjectColumnReady`) and keeps the
-- feature closed until it exists, whatever `BRAND_STUDIO_PROJECTS` says.
--
-- Pairs with glue 0165. A new column is already covered by the table's posture from 0152 (forced RLS, no
-- browser policies, service_role only); 0165 only re-asserts it, as 0164 does for 0090.

alter table brand_studio_jobs
  add column if not exists project_id uuid;

do $$ begin
  -- A project and its runs always belong to one organization: the pair is the key.
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_video_projects_org_key') then
    alter table brand_studio_video_projects
      add constraint brand_studio_video_projects_org_key unique (id, organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_jobs_project_fk') then
    -- Projects are soft-deleted (`deleted_at`); a hard delete only happens with the whole organization.
    -- `set null (project_id)` leaves the run in place and in no project (PostgreSQL 15+).
    alter table brand_studio_jobs
      add constraint brand_studio_jobs_project_fk
      foreign key (project_id, organization_id)
      references brand_studio_video_projects (id, organization_id)
      on delete set null (project_id);
  end if;
end $$;

create index if not exists idx_brand_studio_jobs_project
  on brand_studio_jobs (project_id, created_at desc)
  where project_id is not null;
