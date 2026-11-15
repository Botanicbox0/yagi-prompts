-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0164 — pairs with 0090 (brand_studio_jobs.deleted_at)
-- No new table and no new policy: the column inherits the table's posture from 0152 (RLS on + forced, no
-- browser policies, service_role only). Re-asserted here so the pair is safe to apply on its own.
do $$ begin
  execute 'alter table public.brand_studio_jobs enable row level security';
  execute 'alter table public.brand_studio_jobs force row level security';
  execute 'revoke all on public.brand_studio_jobs from public,anon,authenticated';
  execute 'grant select,insert,update,delete on public.brand_studio_jobs to service_role';
end $$;
