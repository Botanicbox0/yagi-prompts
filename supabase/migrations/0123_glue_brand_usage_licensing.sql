-- 클라우드 적용 필요 (after 0037_core_brand_usage_licensing.sql). docs/SECONDARY-USAGE.md.
-- Browser roles receive no table access. The server role gets select/insert plus exactly the column
-- updates below; the 0037 guards bound what those updates may change. Service code still checks
-- organization membership, role and buyer authority on every read and write.
do $$ declare t text; begin
  foreach t in array array['brand_usage_cases','brand_usage_case_items','brand_usage_messages','brand_usage_scope_revisions','brand_usage_compensations','brand_usage_consents',
    'brand_usage_quotes','brand_usage_buyers','brand_usage_payments','brand_usage_grants','brand_usage_grant_events','brand_usage_events','brand_usage_outcomes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role',t);
    execute format('grant select, insert on public.%I to service_role',t);
  end loop;
end $$;
grant update(status,revision,updated_at,close_reason,blocked_reason) on brand_usage_cases to service_role;
grant update(withdrawn_at,withdrawn_by) on brand_usage_consents to service_role;
grant update(status,accepted_by,accepted_at,acceptance_request_id,acceptance_statement) on brand_usage_quotes to service_role;
grant update(revoked_at,revoked_by,revoke_reason) on brand_usage_buyers to service_role;
grant update(status,payment_key,lease_until,consent_version,consent_at,approved_at,refunded_at,failure_code,updated_at) on brand_usage_payments to service_role;
grant update(starts_at,ends_at) on brand_usage_grants to service_role;
grant update(outcome) on brand_usage_outcomes to service_role;
revoke all on function brand_usage_quote_guard() from public,anon,authenticated,service_role;
revoke all on function brand_usage_consent_guard() from public,anon,authenticated,service_role;
revoke all on function brand_usage_grant_guard() from public,anon,authenticated,service_role;
revoke all on function brand_usage_buyer_guard() from public,anon,authenticated,service_role;
revoke all on function brand_usage_buyer_membership_guard() from public,anon,authenticated,service_role;
revoke all on function brand_usage_outcome_guard() from public,anon,authenticated,service_role;
