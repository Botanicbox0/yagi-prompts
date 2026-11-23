-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0185 — workspace approvals deny-all RLS posture (pairs with 0184)
-- No browser key reads or writes this table directly; the admin console and the hourly job use service_role only.
-- `brand_allowance_grants` keeps the posture 0177 gave it (its new columns need nothing more).
do $$ declare t text; begin
 foreach t in array array[
   'brand_workspace_approvals'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
