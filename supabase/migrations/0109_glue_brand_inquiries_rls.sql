-- PLAYBOOK · glue migration 0109 — brand_inquiries RLS (mirrors 0108).
--
-- Deny-all with no policies: an enquiry is written by the API route with the service role and read
-- by the admin board. No browser session ever reaches the table directly.
do $$
declare
  t text;
begin
  foreach t in array array['brand_inquiries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force  row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;
