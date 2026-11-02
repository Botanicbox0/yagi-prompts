-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0070 — the brand's own sorting and booked creators (docs/BRAND-SHORTLIST.md)
--
-- Apply this file BEFORE the code that reads it ships: the brand's cards and the studio's triage select
-- these columns. No glue file: 0146's table-wide grant to service_role covers new columns.
--
--   brand_shortlist_candidates.passed_at/by   the brand set a shared candidate aside ("제외" on its own
--                                             page). Unlike the studio's exclusion it does not hide the
--                                             card; the brand can bring it back. A candidate is never
--                                             preferred and passed at the same time.
--   brand_shortlist_candidates.confirmed_at   the creator's booking for this campaign is confirmed.
--                                             Written by the import (`confirmed`), read by the brand as
--                                             "섭외 확정". Sharing stays a person's decision.

alter table brand_shortlist_candidates add column if not exists passed_at timestamptz;
alter table brand_shortlist_candidates add column if not exists passed_by uuid references profiles(id) on delete set null;
alter table brand_shortlist_candidates add column if not exists confirmed_at timestamptz;
alter table brand_shortlist_candidates drop constraint if exists brand_shortlist_pass_shape;
alter table brand_shortlist_candidates add constraint brand_shortlist_pass_shape
  check ((passed_at is null or picked_at is null) and (passed_at is not null or passed_by is null));
