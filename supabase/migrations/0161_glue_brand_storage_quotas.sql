-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0161 — brand storage quotas deny-all RLS posture (pairs with 0086)
-- No browser key reads or writes these tables directly: brand workspaces read their summary through the
-- authenticated server loader, and the studio edits overrides through /admin on the server role.
do $$ declare t text; begin
 foreach t in array array['brand_storage_quotas','brand_storage_quota_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
