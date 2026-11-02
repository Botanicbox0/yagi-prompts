-- PLAYBOOK · core migration 0024 — which kind of ModelArk group a person holds (founder, 2026-09-14:
-- "가상 라이브러리로 올리면 되겠다", confirmed in writing by BytePlus's account manager 2026-09-13).
--
-- LivenessFace: born from the H5 camera check; the bank compares every later photo to that face.
-- AIGC:         the "digital character" library — created directly by CreateAssetGroup, no camera,
--               no comparison. The product runs on AIGC now (lib/flags.ts ASSET_LIBRARY_MODE); the
--               liveness path stays available and can be required per account (terms §5.3).
-- The column exists so a liveness-mode check never mistakes an AIGC group for a verified face.
alter table identity_groups add column if not exists group_type text not null default 'LivenessFace'
  check (group_type in ('LivenessFace', 'AIGC'));
