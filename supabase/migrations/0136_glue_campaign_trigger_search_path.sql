-- Cloud application required. Pin relation lookup for the eight campaign trigger functions.
-- They remain SECURITY INVOKER; this changes neither function ACLs nor table privileges.
-- public precedes pg_temp so temporary/caller schemas cannot shadow the application tables.
alter function public.guard_campaign_render_lineage() set search_path=public,pg_temp;
alter function public.lock_campaign_application_terms() set search_path=public,pg_temp;
alter function public.guard_campaign_accepted_payout() set search_path=public,pg_temp;
alter function public.guard_campaign_collaboration_binding() set search_path=public,pg_temp;
alter function public.guard_campaign_collaboration_immutable() set search_path=public,pg_temp;
alter function public.guard_campaign_risk_audit_immutable() set search_path=public,pg_temp;
alter function public.guard_campaign_funding_immutable() set search_path=public,pg_temp;
alter function public.guard_campaign_funding_scope() set search_path=public,pg_temp;
