-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0172 — sound studio jobs and results
-- (docs/BRAND-SOUND-STUDIO.md §7.2).
--
--   brand_studio_jobs.kind     (+) 'music', 'sound_effect'
--   brand_studio_outputs.kind  (+) 'audio'
--   brand_studio_outputs (+)   waveform  jsonb, null until the first browser that plays the result saves it
--
-- Both job kinds land now so the sound-effect slice (SS5) needs no migration of its own. Safe on the live
-- tables: the wider checks accept every existing row, and the new column is nullable with no default (no
-- rewrite). Apply before the code that writes the new kinds is deployed; until then the sound studio's
-- generation stays behind BRAND_SOUND_STUDIO (default off).
--
-- Pairs with glue 0173 (re-asserts the two tables' posture from 0152; no new table, no new grant).

alter table brand_studio_jobs drop constraint if exists brand_studio_jobs_kind;
alter table brand_studio_jobs add constraint brand_studio_jobs_kind
  check (kind in ('image','region_edit','video','video_remix','video_final','music','sound_effect'));

alter table brand_studio_outputs drop constraint if exists brand_studio_outputs_kind;
alter table brand_studio_outputs add constraint brand_studio_outputs_kind
  check (kind in ('image','video','audio'));

-- A few hundred peak values (0..1) per result, written once by the first browser that decodes the file.
alter table brand_studio_outputs add column if not exists waveform jsonb;
