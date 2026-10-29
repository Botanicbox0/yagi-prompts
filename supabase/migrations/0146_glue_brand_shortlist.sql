-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0146 — brand_shortlist_candidates posture (pairs with 0066)
-- No browser key reads or writes the shortlist: the brand sees it through the authenticated campaign
-- page and the studio through /admin, both on the app's server role (the 0140 shape).
do $$ declare t text; begin
 foreach t in array array['brand_shortlist_candidates'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
