-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0139 — push_subscriptions posture (pairs with 0053)
-- A push endpoint is a capability: whoever holds it can wake that device. No browser key may read or
-- write the table; the app's server role does everything (the 0131 shape).
do $$ declare t text; begin
 foreach t in array array['push_subscriptions'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
