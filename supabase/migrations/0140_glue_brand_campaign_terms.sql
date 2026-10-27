-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0140 — campaign_targets posture (pairs with 0056)
-- Who a private campaign is shown to is not for any browser key to read or write; the app's server
-- role does everything (the 0131 shape). The new columns on existing tables keep those tables' policies.
do $$ declare t text; begin
 foreach t in array array['campaign_targets'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
