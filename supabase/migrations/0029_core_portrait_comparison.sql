-- Cloud application required before deploying portrait comparison.
-- Keep existing portraits, selections and paid render lineage. Old second Sunburst = retry.
drop index identity_portrait_inflight;
alter table identity_portrait_attempts drop constraint identity_portrait_attempts_slot_check;
alter table identity_portrait_attempts drop constraint identity_portrait_attempts_model_check;
alter table identity_portrait_attempts drop constraint identity_portrait_attempts_user_id_request_id_key;
update identity_portrait_attempts set slot=3 where slot=2;
alter table identity_portrait_attempts
  add column rejected_initial_at timestamptz,
  add constraint identity_portrait_model_slot check (
    (slot in (1,3) and model='gpt-image-2.5-sunburst') or
    (slot=2 and model='dola-seedream-5-0-pro-260628')),
  add constraint identity_portrait_request_slot unique(user_id,request_id,slot);
-- Existing partial slot uniqueness reserves each model once, even during uncertain outcomes.
-- Two initial models may run together; a second request cannot reserve their slots again.
create index identity_portrait_pending_owner on identity_portrait_attempts(user_id)
  where status in ('queued','running','uncertain');
