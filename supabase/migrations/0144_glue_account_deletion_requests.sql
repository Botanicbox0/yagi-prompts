-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0144 — account_deletion_requests posture (pairs with 0064)
-- A deletion request carries the member's address until it closes. No browser key reads or writes
-- it; the app's server role does everything (the 0131 / 0141 shape).
do $$ declare t text; begin
 foreach t in array array['account_deletion_requests'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
