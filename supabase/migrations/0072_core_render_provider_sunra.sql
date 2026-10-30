-- 0072 — render_jobs.provider learns 'sunra', the manual backup (docs/SUNRA-PROVIDER.md).
-- Apply before SUNRA_VIDEO_BACKUP=on; with the flag off nothing writes the new value.

alter table render_jobs drop constraint if exists render_jobs_provider_check;
alter table render_jobs
  add constraint render_jobs_provider_check
  check (provider is null or provider in ('openai', 'modelark', 'kling', 'google', 'sunra'));
