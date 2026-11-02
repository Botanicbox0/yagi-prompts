-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0068 — shortlist triage (docs/BRAND-SHORTLIST.md "선별")
--
-- Apply this file (and 0148) BEFORE the code that reads it ships: the studio's triage and the client
-- cards select these columns, and the importer writes `avatar_tone`.
--
--   brand_shortlist_candidates.excluded_at/by   the studio set a candidate aside. The row stays, so the
--                                               next import of the same handle refreshes it instead of
--                                               bringing it back as new. An excluded candidate is
--                                               never shared at the same time.
--   brand_shortlist_candidates.avatar_tone      the picture's dominant colour (#rrggbb), the card's wash.
--   brand_projects.shortlist_criteria           the campaign's saved ranges. Shown as a label and used to
--                                               mark waiting candidates as inside or outside them;
--                                               nothing is ever shared or excluded by it on its own.

alter table brand_shortlist_candidates add column if not exists excluded_at timestamptz;
alter table brand_shortlist_candidates add column if not exists excluded_by uuid references profiles(id) on delete set null;
alter table brand_shortlist_candidates add column if not exists avatar_tone text;
alter table brand_shortlist_candidates drop constraint if exists brand_shortlist_exclude_shape;
alter table brand_shortlist_candidates add constraint brand_shortlist_exclude_shape
  check ((excluded_at is null or shared_at is null) and (excluded_at is not null or excluded_by is null));
alter table brand_shortlist_candidates drop constraint if exists brand_shortlist_avatar_tone;
alter table brand_shortlist_candidates add constraint brand_shortlist_avatar_tone
  check (avatar_tone is null or (avatar_key is not null and avatar_tone ~ '^#[0-9a-f]{6}$'));

-- Ranges only: `{"followers":{"min":1000,"max":50000},"engagement":{"min":1.5}}`. The key check keeps
-- anything else (a note, a fee ceiling) out of the object, as 0066 does for the figures.
alter table brand_projects add column if not exists shortlist_criteria jsonb;
alter table brand_projects drop constraint if exists brand_projects_shortlist_criteria;
alter table brand_projects add constraint brand_projects_shortlist_criteria check (
  shortlist_criteria is null or (
    jsonb_typeof(shortlist_criteria) = 'object'
    and (shortlist_criteria - array['followers','views','engagement','adShare']) = '{}'::jsonb
  )
);
