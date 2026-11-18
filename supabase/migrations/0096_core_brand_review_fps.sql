-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0096 — a film's frame rate on the studio asset
-- (docs/BRAND-ROOMS-FEEDBACK.md §11, review stage 2).
--
--   brand_studio_assets (+)  fps  numeric(7,3), null = not measured
--
-- The review stage steps one real frame and shows `m:ss:ff`. The rate is read from the file's own boxes
-- when the team delivers a film or a member uploads one (lib/brand-studio/files.ts `videoFrameRate`),
-- snapped to a common rate (23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60) when within 0.5 %. The asset row
-- is where the film's other measurements already live (width, height, duration_ms); every review of that
-- file reads it from there. Rows written before this, studio results and files the probe cannot read stay
-- null and the player measures the rate itself while the film plays.
--
-- Safe on the live table: a nullable column with no default (no rewrite) and a check every existing row
-- satisfies. Safe to deploy the code first: the server looks for this column (`assetFpsReady`) and, until
-- it exists, neither reads nor writes it.
--
-- Pairs with glue 0168 (re-asserts the table's posture from 0152; a new column needs no new grant).

alter table brand_studio_assets
  add column if not exists fps numeric(7,3);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_assets_fps') then
    alter table brand_studio_assets add constraint brand_studio_assets_fps
      check (fps is null or (fps >= 1 and fps <= 240));
  end if;
end $$;
