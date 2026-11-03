-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0151 — brand identity layer posture (pairs with 0075)
-- No browser key reads or writes these tables: the brand reads and edits through the authenticated
-- workspace and the studio manages through /admin, both on the app's server role (the 0146 shape).
do $$ declare t text; begin
 foreach t in array array['brand_identities','brand_identity_events','brand_memory_events','brand_looks'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
