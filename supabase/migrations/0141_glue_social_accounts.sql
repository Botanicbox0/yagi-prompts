-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0141 — social_accounts posture (pairs with 0057)
-- A member's linked accounts, their screenshots' keys and the worker's leases are not for any browser
-- key to read or write; the app's server role does everything (the 0131 shape).
do $$ declare t text; begin
 foreach t in array array['social_accounts','social_account_writes','social_verify_workers'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
