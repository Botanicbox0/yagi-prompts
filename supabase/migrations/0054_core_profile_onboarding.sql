-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0054 — first-run sheet (docs/PLATFORM-2.0.md §3.2-1, 2026-10-23)
--
-- Apply this file BEFORE deploying the code that reads it. Without the column the first-run sheet
-- simply never opens (GET /api/account/onboarding answers "nothing to show"), so the order matters
-- only for the sheet itself, not for sign-in or the catalogue.
--
-- Founder direction (2026-10-22): the first time a new account reaches the video catalogue it sees
-- one sheet — "① 포맷을 고르세요 ② 정면 셀카 한 장 ③ 완성되면 알려드려요" — once, skippable.
--
--   profiles.onboarded_at  when this account dismissed that sheet (skip, close, or either of its two
--                          buttons). NULL = not seen yet. Written only by the server route
--                          (app/api/account/onboarding), first dismissal wins; no client grant and
--                          no new policy, so no glue migration accompanies this file.
--
-- No backfill on purpose: an account that signed up before this ships sees the sheet once on its
-- next visit to the catalogue (the public sale has not opened, so that is every account so far).

alter table profiles add column if not exists onboarded_at timestamptz;
