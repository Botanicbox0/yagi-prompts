-- No browser role may read encrypted billing tokens, provider order keys or mutate usage.
do $$
declare private_table text;
begin
  foreach private_table in array array['creator_subscriptions', 'creator_subscription_periods', 'creator_subscription_usage', 'creator_subscription_key_cleanup'] loop
    execute format('alter table public.%I enable row level security', private_table);
    execute format('alter table public.%I force row level security', private_table);
    execute format('revoke all on public.%I from public, anon, authenticated', private_table);
    execute format('grant select, insert, update, delete on public.%I to service_role', private_table);
  end loop;
end $$;
