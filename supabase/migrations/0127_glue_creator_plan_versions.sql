-- Price history is available only to server-side readers. No customer API writes.
-- A future enrollment implementation must validate consent + release readiness
-- before requesting a narrowly scoped agreement writer. No writer is enabled now.
revoke all on public.creator_plan_versions, public.creator_subscription_terms from public, anon, authenticated, service_role;
grant select on public.creator_plan_versions, public.creator_subscription_terms to service_role;
