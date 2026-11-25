-- 클라우드 적용 필요 — TWINGS · core migration 0194 — the brand project spine, slice 1
-- (docs/BRAND-PROJECT-SPINE.md §3.2, §3.4, §3.6; founder instruction 2026-11-25).
--
-- One project for both sides: `brand_projects` gets `origin`. 'team' is every row that exists today (the
-- column default, so no existing row changes); 'self' is a project a customer made for their own filing
-- in the studio. A 'self' row is never client-visible (the first layer of §3.4): the check below makes that
-- a database rule, not only a code rule. Studio runs, uploads and films can be filed in a project through
-- `brand_project_id` (null = unfiled). The old `brand_studio_jobs.project_id` (0091) is left exactly as it is.
--
-- Safe to deploy the code first: the server looks for these columns (lib/brand-studio/brand-projects.ts,
-- `spineColumnsReady`) and keeps the spine closed until they exist, whatever `BRAND_PROJECT_SPINE` says; the
-- team-side reads that must never see a 'self' row work with or without `origin` (`TEAM_PROJECTS`).
--
-- Nothing is opened between this file and glue 0195: new columns inherit each table's posture (RLS on and
-- forced, no browser policy, browser roles revoked: 0113 for brand_projects, 0152/0162/0168/0171/0173 for the
-- studio tables). The only grant 0195 adds is UPDATE of four brand_projects columns to the server role; until
-- it lands the server simply cannot rename or convert a project, which slice 1 never does.
--
-- Pairs with glue 0195. Re-runnable: every statement is guarded or idempotent.

alter table brand_projects add column if not exists origin text not null default 'team';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_projects_origin' and conrelid = 'brand_projects'::regclass) then
    alter table brand_projects add constraint brand_projects_origin check (origin in ('team', 'self'));
  end if;
  -- §3.4 first layer, as a rule of the table: a project the customer made for themselves is never shown on
  -- the team side. "야기 팀에 맡기기" (slice 6) flips `origin` and `client_visible` in one statement.
  if not exists (select 1 from pg_constraint where conname = 'brand_projects_self_hidden' and conrelid = 'brand_projects'::regclass) then
    alter table brand_projects add constraint brand_projects_self_hidden check (origin <> 'self' or client_visible = false);
  end if;
end $$;

-- The two column checks of 0027 carry generated names. They are replaced by name (0053:39 drops a check the
-- same way): a 'self' project needs only a name (1–120 characters) and may have no goal; every other row keeps
-- exactly the rule it had (title 3–120, objective 3–2000, both after btrim).
alter table brand_projects drop constraint if exists brand_projects_title_check;
alter table brand_projects add constraint brand_projects_title_check
  check (length(btrim(title)) between (case when origin = 'self' then 1 else 3 end) and 120);
alter table brand_projects drop constraint if exists brand_projects_objective_check;
alter table brand_projects add constraint brand_projects_objective_check
  check (length(btrim(objective)) between (case when origin = 'self' then 0 else 3 end) and 2000);

-- The customer's project list: this organization's projects of one origin, most recently touched first.
create index if not exists idx_brand_projects_origin on brand_projects (organization_id, origin, updated_at desc);

alter table brand_studio_jobs add column if not exists brand_project_id uuid;
alter table brand_studio_assets add column if not exists brand_project_id uuid;
alter table brand_studio_video_projects add column if not exists brand_project_id uuid;

do $$ begin
  -- A project and what is filed in it always belong to one organization: the pair is the key
  -- (`brand_projects` has unique (organization_id, id) since 0027). `brand_projects` rows are never deleted by
  -- the application (no DELETE grant); should one be removed by hand, what was filed in it becomes unfiled
  -- and stays where it is: `set null (brand_project_id)` keeps `organization_id` (PostgreSQL 15+, as 0091).
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_jobs_brand_project_fk') then
    alter table brand_studio_jobs
      add constraint brand_studio_jobs_brand_project_fk
      foreign key (organization_id, brand_project_id)
      references brand_projects (organization_id, id)
      on delete set null (brand_project_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_assets_brand_project_fk') then
    alter table brand_studio_assets
      add constraint brand_studio_assets_brand_project_fk
      foreign key (organization_id, brand_project_id)
      references brand_projects (organization_id, id)
      on delete set null (brand_project_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_video_projects_brand_project_fk') then
    alter table brand_studio_video_projects
      add constraint brand_studio_video_projects_brand_project_fk
      foreign key (organization_id, brand_project_id)
      references brand_projects (organization_id, id)
      on delete set null (brand_project_id);
  end if;
end $$;

-- "What is in this project, newest first" (and the foreign keys' own lookups). Unfiled rows are not indexed.
create index if not exists idx_brand_studio_jobs_brand_project
  on brand_studio_jobs (organization_id, brand_project_id, created_at desc)
  where brand_project_id is not null;
create index if not exists idx_brand_studio_assets_brand_project
  on brand_studio_assets (organization_id, brand_project_id, created_at desc)
  where brand_project_id is not null;
create index if not exists idx_brand_studio_video_projects_brand_project
  on brand_studio_video_projects (organization_id, brand_project_id, updated_at desc)
  where brand_project_id is not null;
