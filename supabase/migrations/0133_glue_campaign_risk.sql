-- Cloud application required. Risk metadata is never accessible through user/brand Data API.
do $$ declare t text; begin
 foreach t in array array['campaign_risk_jobs','campaign_risk_flags','campaign_risk_reviews','campaign_risk_workers','campaign_risk_slack_outbox','campaign_risk_access'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 execute format('grant select,insert on public.%I to service_role',t);
 end loop;
end $$;
-- Source identity and audit history have no UPDATE or DELETE grant.
grant update(state,attempts,available_at,lease_token,lease_until,error_code) on public.campaign_risk_jobs to service_role;
grant update(state,reviewed_by,review_reason,reviewed_at) on public.campaign_risk_flags to service_role;
grant update(version,model_id,last_seen_at) on public.campaign_risk_workers to service_role;
grant update(state,attempts,available_at,lease_token,lease_until,error_code,sent_at) on public.campaign_risk_slack_outbox to service_role;
revoke all on function public.guard_campaign_risk_audit_immutable() from public,anon,authenticated,service_role;
