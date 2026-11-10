-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0155 — brand studio review posture (pairs with 0080)
-- RLS on with no policies = closed to every browser key. The review API and /admin run on the app's
-- server role (the 0152 shape).
do $$ declare t text; begin
 foreach t in array array['brand_studio_reviews','brand_studio_review_comments'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
