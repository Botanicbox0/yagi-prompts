-- CLOUD APPLICATION REQUIRED. Payment keys and photos are server-only.
do $$
declare t text;
begin
  foreach t in array array['billing_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
grant select, insert, update, delete on public.billing_payments to service_role;
