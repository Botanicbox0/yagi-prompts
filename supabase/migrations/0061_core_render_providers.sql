-- 0061 — render_jobs.provider learns the two R2 engines (docs/PLATFORM-2.0.md §7.3, §18 R2).
--
-- 0017 pinned `provider` to 'openai' | 'modelark'. The Kling adapter (lib/kling/*) and the Gemini
-- image adapter (lib/images/gemini.ts) record 'kling' and 'google' on the row, the same way the
-- others do (lib/renders/repo.ts `RenderProvider`). Nothing else about the column changes: it is
-- still NULL until a job is handed over, still indexed with provider_task_id for the poll.
--
-- 클라우드 적용 필요 — 코드 배포 전에. 적용하지 않으면 Kling·Gemini 잡이 CHECK 위반으로 실패한다
-- (기존 OpenAI·ModelArk 잡은 영향 없음).

alter table render_jobs drop constraint if exists render_jobs_provider_check;
alter table render_jobs
  add constraint render_jobs_provider_check
  check (provider is null or provider in ('openai', 'modelark', 'kling', 'google'));
