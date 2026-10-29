-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0071 — AI creative cover image
-- (docs/PLATFORM-2.0.md §20.2, founder request 2026-10-29: "LinkedIn처럼 프로필 사진이랑 배경 사진")
--
-- A creative's page opens on a wide banner with their photo over its lower edge. The cover follows
-- the avatar (0065) in every rule: the creative uploads it in the studio; the file is re-encoded
-- (a 2:1 JPEG, no metadata) into the PRIVATE renders bucket under `{user_id}/cover_<hex>.jpg`; it
-- is served only by the app (`/creative-media/cover-{handle}-<hex>.jpg`) and only while
-- `public_profile` is on. The key itself never leaves the server.
--
-- platform_creators keeps 0131's deny-all posture, which the new column inherits, so no glue file.
-- Readers find the column through `to_jsonb(row)` (lib/makers/profile.ts), so code deployed before
-- this file keeps answering exactly as before — with no cover.
alter table platform_creators
  add column if not exists cover_key text check (cover_key is null or char_length(cover_key) <= 120);
