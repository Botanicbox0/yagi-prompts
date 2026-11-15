-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0090 — brand studio: take a run off the wall
--   brand_studio_jobs.deleted_at: set when a member removes a run that ended with no result (failed or
--   stopped) from the gallery wall. The row is never deleted: its status, reason, usage and cost stay for
--   audit and billing. Until this is applied the app neither filters on the column nor offers the action
--   (lib/brand-studio/repo.ts `jobSoftDeleteReady`).

alter table brand_studio_jobs
  add column if not exists deleted_at timestamptz;
