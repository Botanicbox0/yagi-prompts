-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0099 — 4-stage creator casting pipeline (docs/BRAND-SHORTLIST.md)
--
-- Apply this file BEFORE the code that reads it ships: the brand's casting cards and the studio's
-- triage select `reviewing_at`. No glue file: 0146's table-wide grant to service_role covers new columns.
--
--   brand_shortlist_candidates.reviewing_at/by   the brand put a shared candidate into "검토"
--                                                (Reviewing). Mutually exclusive with `picked_at`
--                                                ("선정") and `passed_at` ("제외"): at most one of
--                                                the three stage timestamps may be set at once.

alter table brand_shortlist_candidates add column if not exists reviewing_at timestamptz;
alter table brand_shortlist_candidates add column if not exists reviewing_by uuid references profiles(id) on delete set null;
alter table brand_shortlist_candidates drop constraint if exists brand_shortlist_pass_shape;
alter table brand_shortlist_candidates drop constraint if exists brand_shortlist_choice_shape;
alter table brand_shortlist_candidates add constraint brand_shortlist_choice_shape
  check (
    ((picked_at is not null)::int + (reviewing_at is not null)::int + (passed_at is not null)::int) <= 1
    and (picked_at is not null or picked_by is null)
    and (reviewing_at is not null or reviewing_by is null)
    and (passed_at is not null or passed_by is null)
  );
