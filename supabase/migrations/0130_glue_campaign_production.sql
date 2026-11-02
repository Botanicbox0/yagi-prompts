-- 클라우드 적용 필요. No direct creator/brand Data API writes or public reads.
do $$ declare private_table text; begin
  foreach private_table in array array['campaign_productions','campaign_render_jobs'] loop
    execute format('alter table public.%I enable row level security',private_table);
    execute format('alter table public.%I force row level security',private_table);
    execute format('revoke all on public.%I from anon, authenticated',private_table);
  end loop;
end $$;
revoke all on campaign_productions,campaign_render_jobs from anon,authenticated;
grant select,insert,update,delete on campaign_productions,campaign_render_jobs to service_role;
revoke all on function guard_campaign_render_lineage() from public,anon,authenticated;
