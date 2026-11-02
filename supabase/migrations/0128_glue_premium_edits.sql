-- The private recipe and edit preparation never become a browser/PostgREST projection.
do $$
declare private_table text;
begin
  foreach private_table in array array['creator_subscription_renders'] loop
    execute format('alter table public.%I enable row level security', private_table);
    execute format('alter table public.%I force row level security', private_table);
    execute format('revoke all on public.%I from public, anon, authenticated', private_table);
    execute format('grant select, insert, update, delete on public.%I to service_role', private_table);
  end loop;
end $$;
