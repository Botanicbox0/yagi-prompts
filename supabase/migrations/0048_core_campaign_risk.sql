-- Review-only metadata; no message text or model prose is copied here. Cloud application required.
create table campaign_risk_jobs (
 id uuid primary key, message_id uuid not null unique references campaign_participant_messages(id), application_id uuid not null references campaign_applications(id),
 source_hash text not null, detector_version text not null, state text not null default 'queued' check(state in ('queued','leased','done','dead')),
 attempts integer not null default 0 check(attempts between 0 and 5), available_at timestamptz not null default now(),
 lease_token uuid, lease_until timestamptz, error_code text check(error_code in ('model_unavailable','invalid_result','source_changed','lease_expired')),
 created_at timestamptz not null default now()
);
create index campaign_risk_jobs_claim on campaign_risk_jobs(state,available_at);
create table campaign_risk_flags (
 id uuid primary key, message_id uuid not null references campaign_participant_messages(id), application_id uuid not null references campaign_applications(id), source_hash text not null,
 detector text not null check(detector in ('rules','local_model')), detector_version text not null, model_id text,
 category text not null check(category in ('transfer_solicitation','off_platform_solicitation')), confidence double precision not null check(confidence between 0 and 1),
 evidence jsonb not null, state text not null default 'open' check(state in ('open','reviewed','dismissed','escalated')),
 reviewed_by uuid references profiles(id), review_reason text, reviewed_at timestamptz,
 created_at timestamptz not null default now(), unique(message_id,source_hash,detector,detector_version,category)
);
create table campaign_risk_reviews (
 id uuid primary key, flag_id uuid not null references campaign_risk_flags(id), actor_id uuid not null references profiles(id),
 state text not null check(state in ('reviewed','dismissed','escalated')), reason text not null check(length(reason) between 1 and 1000), created_at timestamptz not null default now()
);
create table campaign_risk_workers (id text primary key check(length(id) between 1 and 80), version text not null check(length(version) between 1 and 80), model_id text not null check(length(model_id) between 1 and 120), last_seen_at timestamptz not null);
create table campaign_risk_slack_outbox (
 id uuid primary key, flag_id uuid not null unique references campaign_risk_flags(id), event_type text not null check(event_type='risk_review_required'),
 message_id uuid not null references campaign_participant_messages(id), source_hash text not null,
 state text not null default 'queued' check(state in ('queued','sending','sent','failed','uncertain')), attempts integer not null default 0,
 available_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz, error_code text,
 created_at timestamptz not null default now(), sent_at timestamptz,
 unique(message_id,source_hash,event_type)
);
create table campaign_risk_access (
 id uuid primary key, flag_id uuid not null references campaign_risk_flags(id), actor_id uuid not null references profiles(id), purpose text not null check(purpose='risk_review'), created_at timestamptz not null default now()
);
-- Review/access audit records remain append-only even for a role with BYPASSRLS.
create function guard_campaign_risk_audit_immutable() returns trigger language plpgsql as $$ begin
 raise exception 'campaign risk audit records are immutable';
end $$;
create trigger campaign_risk_reviews_immutable before update or delete on campaign_risk_reviews for each row execute function guard_campaign_risk_audit_immutable();
create trigger campaign_risk_access_immutable before update or delete on campaign_risk_access for each row execute function guard_campaign_risk_audit_immutable();
-- Also enforce privacy in local core-only databases.
do $$ declare t text; begin
 foreach t in array array['campaign_risk_jobs','campaign_risk_flags','campaign_risk_reviews','campaign_risk_workers','campaign_risk_slack_outbox','campaign_risk_access'] loop
 execute format('alter table %I enable row level security',t);
 execute format('alter table %I force row level security',t);
 execute format('revoke all on %I from public',t);
 end loop;
end $$;
