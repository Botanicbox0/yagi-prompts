-- PLAYBOOK · core migration 0020 — a render held behind the face check (docs/TEMPLATES-IA.md §8.2,
-- founder 2026-09-10: "유저가 얼굴 등록부터 영상 생성까지 아주 스무스하게").
--
-- Before: a ModelArk render with a photo was refused at enqueue until the person had verified, so
-- they verified, came back, and uploaded the photo again. Now the photo is stored and the job is
-- created as `held`; the identity callback releases every held job of that person to `queued` the
-- moment the bank confirms the face, and the pass runs at once — one upload, one check, one film.
alter table render_jobs drop constraint if exists render_jobs_status_check;
alter table render_jobs add constraint render_jobs_status_check
  check (status in ('held','queued','running','succeeded','failed'));

create index if not exists render_jobs_held_idx on render_jobs (user_id) where status = 'held';
