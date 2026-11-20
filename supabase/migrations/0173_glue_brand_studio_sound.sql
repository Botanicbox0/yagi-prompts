-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0173 — pairs with 0172 (sound studio jobs and results)
-- No new table and no new policy: the wider checks and the waveform column inherit the tables' posture from
-- 0152 (RLS on + forced, no browser policies, service_role only). Re-asserted here so the pair is safe to apply
-- on its own.
do $$ begin
  execute 'alter table public.brand_studio_jobs enable row level security';
  execute 'alter table public.brand_studio_jobs force row level security';
  execute 'revoke all on public.brand_studio_jobs from public,anon,authenticated';
  execute 'grant select,insert,update,delete on public.brand_studio_jobs to service_role';
  execute 'alter table public.brand_studio_outputs enable row level security';
  execute 'alter table public.brand_studio_outputs force row level security';
  execute 'revoke all on public.brand_studio_outputs from public,anon,authenticated';
  execute 'grant select,insert,update,delete on public.brand_studio_outputs to service_role';
end $$;
