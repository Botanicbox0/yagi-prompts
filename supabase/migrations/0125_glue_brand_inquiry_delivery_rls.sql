-- Service-role/Postgres server access only, matching brand_inquiries.
do $$
declare t text;
begin
  foreach t in array array['brand_inquiry_deliveries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end
$$;
