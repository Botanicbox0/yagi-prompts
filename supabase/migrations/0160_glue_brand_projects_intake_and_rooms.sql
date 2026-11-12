-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0160 — project intake brief column grant (pairs with 0085)
-- brand_projects grants updates column by column (0113, 0117, 0120, 0148); `intake_brief` is one more.
-- brand_feature_policies, brand_plan_assignments and brand_room_shares already carry table-wide service_role grants.
grant update(intake_brief) on public.brand_projects to service_role;
