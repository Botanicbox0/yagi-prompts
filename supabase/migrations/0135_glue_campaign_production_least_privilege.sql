-- Cloud application required. Follow-up to the already-applied 0045/0130 migrations.
-- Server paths only read, insert and update these records; no DELETE/TRUNCATE path exists.
-- Revoke ALL first to remove Supabase default grants such as TRUNCATE/REFERENCES/TRIGGER.
revoke all on public.campaign_productions,public.campaign_render_jobs from service_role;
grant select,insert,update on public.campaign_productions,public.campaign_render_jobs to service_role;
