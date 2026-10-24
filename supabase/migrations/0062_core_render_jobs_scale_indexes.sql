-- 0062_core_render_jobs_scale_indexes.sql
-- Scale indexes for high-concurrency render wait polling (`estimateRenderMinutes`) and
-- recent render summaries (`summarizeRenderJobs`) at 1,000–10,000 DAU.

create index if not exists render_jobs_succeeded_engine_finished_idx
  on public.render_jobs (engine, finished_at desc)
  where status = 'succeeded' and finished_at is not null;

create index if not exists render_jobs_created_at_idx
  on public.render_jobs (created_at desc);
