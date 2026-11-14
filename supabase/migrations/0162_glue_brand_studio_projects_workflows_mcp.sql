-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0162 — studio pro suite v5 RLS posture (pairs with 0087)
-- RLS on + forced with no browser policies; all access goes through server service_role handlers.
do $$ declare t text; begin
 foreach t in array array[
  'brand_studio_video_projects',
  'brand_studio_workflows',
  'brand_studio_playbooks',
  'brand_studio_mcp_tokens'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
