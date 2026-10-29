-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0148 — shortlist triage (pairs with 0068)
-- brand_projects grants updates column by column (0113, 0117, 0120); the saved shortlist criteria is
-- one more. brand_shortlist_candidates already has a table-wide grant (0146), which covers its new columns.
grant update(shortlist_criteria) on brand_projects to service_role;
