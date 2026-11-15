-- CLOUD APPLICATION REQUIRED before TWINGS_PHOTO_CHECK is turned on. Without it the code reports the
-- check as off (lib/identity/photo-check-service.ts probes for both columns) and nothing changes.
--
-- The advisory photo check (founder, 2026-11-15): one check per saved photo, run once and kept so the
-- studio never pays twice for the same photo. Only the server's verdict is stored — `{ status, issues }`
-- with status good | check | retake — never the model's raw answer, and nothing that identifies anyone.
-- It is advice: no constraint, trigger or code path makes saving, choosing or paying depend on it.
alter table identity_selfies
  add column photo_check jsonb,
  add column photo_checked_at timestamptz;

alter table identity_selfies
  add constraint identity_selfies_photo_check_shape check (
    photo_check is null or (
      jsonb_typeof(photo_check) = 'object'
      and photo_check->>'status' in ('good', 'check', 'retake')
      and jsonb_typeof(photo_check->'issues') = 'array'
    )
  ),
  add constraint identity_selfies_photo_check_stamped check ((photo_check is null) = (photo_checked_at is null));

-- No glue file: 0137_glue_identity_selfies.sql grants select, insert, update on the WHOLE table to
-- service_role (table-level, not column-level) and leaves anon/authenticated with no grant under forced
-- RLS, so both new columns inherit exactly that posture.
