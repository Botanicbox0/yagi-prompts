-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0085 — project intake brief, project-only entitlements and share unlock buckets (docs/BRAND-PROJECTS-E.md)
--
-- Additive widening for Bundle E ("야기 팀과" rebuild):
--   brand_feature_policies (~)      `denied_features` also accepts 'self_studio' so non-subscribing
--                                   commissioned clients can enter Project Rooms & Asset Hub while
--                                   self-serve Image/Video Studio stays closed. Morphic and
--                                   'generative_media'-denied organizations remain 100% closed.
--   brand_plan_assignments (~)      `plan_id` also accepts 'project_only' (0 KRW/month subscription,
--                                   per-project contract).
--   brand_projects (+)              `intake_brief` jsonb — structured 3-step brief intake (track,
--                                   summary, brief text/files, deliverables, schedule, budget band,
--                                   contact & approver). Nullable so existing briefs stay untouched.
--   brand_room_shares (+)           `unlock_buckets` jsonb — per-client-hash passphrase failure windows
--                                   so one address guessing wrong never locks out legitimate clients (R-09).
--   brand_room_share_visits (+)     `idx_brand_room_share_visits_cleanup` on (share_id, hour).

alter table brand_feature_policies drop constraint if exists brand_feature_policies_known;
alter table brand_feature_policies add constraint brand_feature_policies_known check (
  denied_features <@ array['generative_media','self_studio','sound','color_grading','brand_learning','campaigns','creator_pool','agent_access']::text[]
);

alter table brand_plan_assignments drop constraint if exists brand_plan_assignments_plan;
update brand_plan_assignments
   set plan_id = case plan_id
     when 'b2b_39' then 'b2b_29'
     when 'b2b_69' then 'b2b_49'
     when 'b2b_99' then 'b2b_69'
     else plan_id
   end
 where plan_id in ('b2b_39','b2b_69','b2b_99');
alter table brand_plan_assignments add constraint brand_plan_assignments_plan check (
  plan_id in ('b2b_29','b2b_49','b2b_69','project_only')
);

alter table brand_projects add column if not exists intake_brief jsonb;
alter table brand_projects drop constraint if exists brand_projects_intake_brief_object;
alter table brand_projects add constraint brand_projects_intake_brief_object
  check (intake_brief is null or jsonb_typeof(intake_brief) = 'object');

alter table brand_room_shares add column if not exists unlock_buckets jsonb not null default '{}'::jsonb;
alter table brand_room_shares drop constraint if exists brand_room_shares_unlock_buckets_object;
alter table brand_room_shares add constraint brand_room_shares_unlock_buckets_object
  check (jsonb_typeof(unlock_buckets) = 'object');

create index if not exists idx_brand_room_share_visits_cleanup
  on brand_room_share_visits (share_id, hour);
