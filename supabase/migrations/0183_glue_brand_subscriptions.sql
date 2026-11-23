-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0183 — B2B brand subscriptions deny-all RLS posture (pairs with 0182)
-- No browser key reads or writes these tables directly; server APIs and cron jobs operate via service_role only.
do $$ declare t text; begin
 foreach t in array array[
   'brand_subscriptions',
   'brand_subscription_events'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
