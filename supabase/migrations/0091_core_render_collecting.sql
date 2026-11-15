-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0091 — who is fetching a finished film (2026-11-16)
--
-- Safe in either order. The code reads and writes the column through `lib/renders/collect.ts`, which
-- swallows a missing column with one log line: before this file is applied a finished film is
-- collected exactly as before (the first ending stands, `markRenderSucceeded`/`markRenderFailed`).
--
--   render_jobs.collecting   `{ "<pass id>": <epoch ms> }` — the passes that are, right now, copying a
--                            film the provider has finished into our private `renders` bucket. The
--                            owner's open page, the provider callback and the tick all poll the same
--                            task, so several passes fetch the same film at once. A pass adds itself
--                            before the download and takes itself out when it gives up. While another
--                            pass is listed (and its stamp is younger than the collect lease, 10 min —
--                            longer than any function runs), a pass that could not fetch or store the
--                            film does not end the job: the film may be in the other pass's hands.
--                            Nothing reads it once the job has ended.
--
-- No glue partner: 0107 revoked every client privilege on `render_jobs` at table level and only the
-- server writes this, so the new column inherits no grant and needs no policy.

alter table render_jobs add column if not exists collecting jsonb;
