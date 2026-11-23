-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0177 — B2B billing core deny-all RLS posture (pairs with 0176)
-- No browser key reads or writes these tables directly: brand owners/admins read and edit their own
-- organization's billing data via authenticated server API routes, and the studio manages plans,
-- defaults, discounts, invoices, and grants via /admin on the server role.
do $$ declare t text; begin
 foreach t in array array[
   'brand_plan_allowance_defaults',
   'brand_plan_allowance_default_events',
   'brand_discount_codes',
   'brand_discounts',
   'brand_discount_redemptions',
   'brand_discount_code_attempts',
   'brand_billing_profiles',
   'brand_invoices',
   'brand_invoice_events',
   'brand_allowance_grants'
 ] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('alter table public.%I force row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;
