-- Price history is available only to server-side readers. No customer API writes.
-- A future enrollment implementation must validate consent + release readiness
-- before requesting a narrowly scoped agreement writer. No writer is enabled now.
do $$
declare tbl text;
begin
  foreach tbl in array array['creator_plan_versions', 'creator_subscription_terms'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('alter table public.%I force row level security', tbl);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', tbl);
  end loop;
end;
$$;
grant select on public.creator_plan_versions, public.creator_subscription_terms to service_role;
revoke all on function public.reject_creator_terms_mutation() from anon, authenticated, service_role;
