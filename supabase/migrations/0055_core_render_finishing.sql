-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0055 — the wait's last stage and the film's own share frame (docs/PLATFORM-2.0.md §3.2-4·5, 2026-10-23)
--
-- Safe in either order. The code reads and writes both columns through `lib/renders/extras.ts`,
-- which swallows a missing column with one log line: before this file is applied the wait page
-- simply never shows "마무리" and a film's share card keeps the template poster, as today.
--
--   render_jobs.finishing_at  when the pass first saw the provider's "done" — the moment the result
--                             starts its copy into our private `renders` bucket, before the share
--                             link and the notice. Written once (`finishing_at is null`) while the job
--                             is still `running`; the wait page maps it to its third stage.
--   render_jobs.poster_key    `{renderId}/poster.jpg` in the private `renders` bucket: one frame of the
--                             finished film, captured in the owner's own browser (Vercel functions have
--                             no ffmpeg) and re-encoded by `POST /api/renders/[id]/poster`. The share
--                             page uses it as the OG image behind the same 3-day token as the film.
--
-- No glue partner: 0107 revoked every client privilege on `render_jobs` at table level and only the
-- server writes these, so new columns inherit no grant and need no policy.

alter table render_jobs add column if not exists finishing_at timestamptz;
alter table render_jobs add column if not exists poster_key text
  check (poster_key is null or poster_key ~ '^[0-9a-f-]{36}/poster\.jpg$');
