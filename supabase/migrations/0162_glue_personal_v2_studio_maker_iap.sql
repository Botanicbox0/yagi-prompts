-- CLOUD APPLICATION REQUIRED — TWINGS · glue migration 0162 — Store IAP deny-all RLS posture (pairs with 0087)
-- Browser/anon clients never query or mutate store_iap_wallets or store_iap_transactions directly;
-- verified server API routes run on the service role after receipt verification.
do $$ declare t text; begin
  foreach t in array array['store_iap_wallets','store_iap_transactions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public,anon,authenticated', t);
    execute format('grant select,insert,update,delete on public.%I to service_role', t);
  end loop;
end $$;
