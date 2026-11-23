-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0187 — billing cycle columns (pairs with 0186)
-- No new table. Re-asserts the deny-all posture of the two tables 0186 changes (0177 gave it; new columns need nothing more).
do $$ declare t text; begin
 foreach t in array array[
   'brand_invoices',
   'brand_allowance_grants'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
