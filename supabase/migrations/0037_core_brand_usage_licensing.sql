-- 클라우드 적용 필요 (then 0123_glue_brand_usage_licensing.sql). docs/SECONDARY-USAGE.md.
-- Brand secondary usage ("2차 활용"): an inquiry on content a brand can already see, the studio's
-- structured scope, the creator's consent recorded by the studio, a final brand quote, acceptance,
-- a one-time payment kept apart from render billing, and usage grants.
--
-- Money isolation: `brand_usage_compensations` and `brand_usage_consents` are studio-only. No brand
-- loader selects them, and no brand-visible table carries a creator amount, payout or margin.
-- Nothing here grants use except a `brand_usage_grants` row, written only by the activation guard.

create table brand_usage_cases (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
  status text not null default 'inquiry' check(status in ('inquiry','scoping','scope_defined','quoted','accepted','paid','fulfilled','blocked_after_payment','withdrawn','closed')),
  revision integer not null default 0 check(revision>=0),
  -- The brand's words, kept as submitted. Every hint is optional; absent is unknown, never "all" or "perpetual".
  intent text not null check(intent in ('know_cost','recommend_terms','question')),
  question text not null default '' check(length(question)<=2000),
  hints text[] check(hints is null or (cardinality(hints) between 1 and 6 and hints <@ array['organic_repost','paid_ads','owned_media','creator_partnership_ads','offline','undecided']::text[])),
  duration_hint text check(duration_hint in ('1m','3m','6m','12m','custom','undecided')),
  timing_text text check(length(timing_text)<=500),
  budget_krw bigint check(budget_krw between 0 and 1000000000000),
  close_reason text check(close_reason in ('answered_only','creator_declined','no_response','refunded','other')),
  blocked_reason text check(length(blocked_reason)<=80),
  created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(intent<>'question' or length(btrim(question))>0),
  check((status='closed')=(close_reason is not null)),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  unique(project_id,id), unique(project_id,created_by,request_id)
);
create index brand_usage_cases_project on brand_usage_cases(project_id,created_at desc);
create index brand_usage_cases_open on brand_usage_cases(status,updated_at);

-- What the brand pointed at. A post may be an `external_import` (no content version); that makes it
-- eligible to ASK about, never cleared. The studio pins the exact subject in the scope revision.
create table brand_usage_case_items (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  organization_id uuid not null, project_id uuid not null, position integer not null check(position between 1 and 10),
  subject_kind text not null check(subject_kind in ('content_version','post')),
  content_version_id uuid, post_id uuid, created_at timestamptz not null default now(),
  check((subject_kind='content_version' and content_version_id is not null and post_id is null)
    or (subject_kind='post' and post_id is not null and content_version_id is null)),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  foreign key(project_id,content_version_id) references brand_content_versions(project_id,id),
  foreign key(project_id,post_id) references brand_posts(project_id,id),
  unique(case_id,position)
);

-- Commercial talk stays out of the campaign conversation.
create table brand_usage_messages (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  organization_id uuid not null, project_id uuid not null,
  body text not null check(length(btrim(body)) between 1 and 4000), author_role text not null check(author_role in ('brand','studio')),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id), unique(case_id,created_by,request_id)
);

-- Studio-authored, complete, structured scope. Brand-visible only through a quote bound to it.
create table brand_usage_scope_revisions (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  revision integer not null check(revision>0), scope jsonb not null check(jsonb_typeof(scope)='object'),
  scope_sha256 text not null check(scope_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  unique(case_id,revision), unique(case_id,created_by,request_id), unique(case_id,id)
);

-- STUDIO ONLY. The amount agreed with the creator for one scope revision. Distinct from any brand price.
create table brand_usage_compensations (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  scope_revision_id uuid not null, revision integer not null check(revision>0),
  amount_krw bigint not null check(amount_krw between 0 and 1000000000000),
  tax_basis text not null check(tax_basis in ('included','excluded')),
  note text not null default '' check(length(note)<=2000),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  foreign key(case_id,scope_revision_id) references brand_usage_scope_revisions(case_id,id),
  unique(case_id,revision), unique(case_id,created_by,request_id), unique(case_id,id)
);

-- STUDIO ONLY. The creator's approval, recorded by an administrator after contact outside the system.
-- Bound to the exact scope hash and compensation revision. A metric verification is never consent.
create table brand_usage_consents (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  item_id uuid not null references brand_usage_case_items(id), scope_revision_id uuid not null,
  scope_sha256 text not null check(scope_sha256 ~ '^[a-f0-9]{64}$'), compensation_id uuid not null,
  approver_kind text not null check(approver_kind in ('creator','agency','rights_holder')),
  approved_at timestamptz not null,
  -- Where the proof lives (e.g. the mail thread). Internal text only; never a brand-visible file.
  evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 500),
  rights_checks text[] not null check(rights_checks @> array['ownership','music','people','marks']::text[]),
  recorded_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  withdrawn_at timestamptz, withdrawn_by uuid references profiles(id),
  check((withdrawn_at is null)=(withdrawn_by is null)),
  foreign key(case_id,scope_revision_id) references brand_usage_scope_revisions(case_id,id),
  foreign key(case_id,compensation_id) references brand_usage_compensations(case_id,id),
  unique(case_id,recorded_by,request_id)
);
create unique index brand_usage_consents_live on brand_usage_consents(item_id,scope_revision_id) where withdrawn_at is null;

-- The brand's final price for one scope revision. Immutable except its status and acceptance stamp.
create table brand_usage_quotes (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  organization_id uuid not null, project_id uuid not null, revision integer not null check(revision>0),
  scope_revision_id uuid not null, scope_sha256 text not null check(scope_sha256 ~ '^[a-f0-9]{64}$'),
  -- Internal snapshot of the consents this price relies on; never projected to the brand.
  consent_ids uuid[] not null check(cardinality(consent_ids) between 1 and 10),
  total_krw bigint not null check(total_krw between 1 and 1000000000000),
  tax_basis text not null check(tax_basis in ('included','excluded')), currency text not null default 'KRW' check(currency='KRW'),
  valid_until timestamptz not null,
  terms_contract_id uuid not null references brand_contract_documents(id),
  terms_sha256 text not null check(terms_sha256 ~ '^[a-f0-9]{64}$'),
  note text not null default '' check(length(note)<=2000),
  status text not null default 'open' check(status in ('open','superseded','accepted','declined')),
  accepted_by uuid references profiles(id), accepted_at timestamptz, acceptance_request_id uuid,
  acceptance_statement text check(acceptance_statement ~ '^[a-z0-9.-]{1,80}$'),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  check(status<>'accepted' or (accepted_by is not null and accepted_at is not null and acceptance_request_id is not null and acceptance_statement is not null)),
  check((accepted_by is null)=(accepted_at is null)),
  check(valid_until>created_at),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  foreign key(case_id,scope_revision_id) references brand_usage_scope_revisions(case_id,id),
  unique(case_id,revision), unique(case_id,created_by,request_id)
);
create unique index brand_usage_quotes_one_live on brand_usage_quotes(case_id) where status in ('open','accepted');

-- Explicit, studio-recorded authority for a non-owner to accept and pay quotes. Default: owners only.
-- Revoked by the studio, or automatically (brand_usage_buyer_membership_guard below) the moment the
-- membership stops being an active editor seat. A later rejoin never revives it: a new row is required.
create table brand_usage_buyers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references brand_organizations(id),
  user_id uuid not null references profiles(id), reason text not null check(length(btrim(reason)) between 1 and 500),
  granted_by uuid not null references profiles(id), created_at timestamptz not null default now(),
  revoked_at timestamptz, revoked_by uuid references profiles(id),
  revoke_reason text check(revoke_reason in ('studio','membership_ended','role_changed')),
  check((revoked_at is null)=(revoke_reason is null)), check(revoke_reason is distinct from 'studio' or revoked_by is not null)
);
create unique index brand_usage_buyers_live on brand_usage_buyers(organization_id,user_id) where revoked_at is null;

-- One-time brand payment. NOT billing_payments: no render input, no render hook, no public-render gate.
create table brand_usage_payments (
  id uuid primary key default gen_random_uuid(), order_kind text not null default 'brand_usage_license' check(order_kind='brand_usage_license'),
  organization_id uuid not null, project_id uuid not null, case_id uuid not null references brand_usage_cases(id),
  quote_id uuid not null references brand_usage_quotes(id),
  environment text not null check(environment in ('test','live','fake')),
  amount_krw bigint not null check(amount_krw>0), order_name text not null check(length(order_name) between 1 and 100),
  -- `review`: the provider reports a state that is neither a clean approval nor proof of non-payment
  -- (partial cancel, deposit wait, snapshot mismatch). Never granted; blocks new orders; studio decides.
  status text not null default 'pending' check(status in ('pending','confirming','paid','refund_pending','refunded','failed','expired','review')),
  payment_key text unique check(length(payment_key)<=200), lease_until timestamptz, expires_at timestamptz not null,
  consent_version text, consent_at timestamptz, approved_at timestamptz, refunded_at timestamptz,
  failure_code text check(length(failure_code)<=40),
  created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  unique(case_id,created_by,request_id)
);
create unique index brand_usage_payments_one_live on brand_usage_payments(quote_id) where status in ('pending','confirming','paid','refund_pending','refunded','review');

-- The only thing that grants use. Written by the activation guard; interval only from the accepted quote.
create table brand_usage_grants (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  item_id uuid not null references brand_usage_case_items(id), quote_id uuid not null references brand_usage_quotes(id),
  payment_id uuid not null references brand_usage_payments(id), organization_id uuid not null, project_id uuid not null,
  scope_revision_id uuid not null, scope_sha256 text not null, terms_contract_id uuid not null, terms_sha256 text not null,
  consent_id uuid not null references brand_usage_consents(id), subject jsonb not null check(jsonb_typeof(subject)='object'),
  -- Null start: a "from first use" grant whose start the studio has not recorded yet. End is exclusive.
  starts_at timestamptz, ends_at timestamptz, duration_days integer check(duration_days between 1 and 3650),
  created_at timestamptz not null default now(),
  check((starts_at is null)=(ends_at is null)), check(ends_at is null or ends_at>starts_at),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  unique(quote_id,item_id)
);
create table brand_usage_grant_events (
  id uuid primary key default gen_random_uuid(), grant_id uuid not null references brand_usage_grants(id),
  kind text not null check(kind in ('suspended','resumed','terminated','started')),
  reason text not null check(length(btrim(reason)) between 1 and 500),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  unique(grant_id,created_by,request_id)
);

-- Case history: offered, accepted and paid are distinct events. No payload, no amounts.
create table brand_usage_events (
  id uuid primary key default gen_random_uuid(), case_id uuid not null references brand_usage_cases(id),
  kind text not null check(kind in ('inquired','triaged','scope_defined','compensation_recorded','consent_recorded','consent_withdrawn',
    'quoted','reopened','accepted','withdrawn','closed','order_created','paid','payment_failed','activated','blocked','reverified','refunded','buyer_changed')),
  quote_id uuid references brand_usage_quotes(id), actor text not null check(actor in ('brand','studio','system')),
  created_by uuid references profiles(id), created_at timestamptz not null default now()
);
create index brand_usage_events_case on brand_usage_events(case_id,created_at);

-- Phase 0 history for future estimates: ONE final comparable outcome per case, from its final quote only.
-- Superseded negotiation revisions are never counted. Brand price only; creator amounts live elsewhere.
create table brand_usage_outcomes (
  case_id uuid primary key references brand_usage_cases(id), quote_id uuid not null references brand_usage_quotes(id),
  scope_revision_id uuid not null, outcome text not null check(outcome in ('paid','declined','expired','closed','refunded')),
  total_krw bigint not null, tax_basis text not null check(tax_basis in ('included','excluded')),
  features jsonb not null check(jsonb_typeof(features)='object'), recorded_at timestamptz not null default now()
);

create or replace function brand_usage_quote_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-'status'-'accepted_by'-'accepted_at'-'acceptance_request_id'-'acceptance_statement')
     is distinct from (to_jsonb(old)-'status'-'accepted_by'-'accepted_at'-'acceptance_request_id'-'acceptance_statement') then
    raise exception 'brand usage quote is immutable' using errcode='23514';
  end if;
  if old.status<>'open' and new.status is distinct from old.status and not (old.status='accepted' and new.status in ('superseded','declined')) then
    raise exception 'brand usage quote status is final' using errcode='23514';
  end if;
  if old.accepted_by is not null and new.accepted_by is distinct from old.accepted_by then
    raise exception 'brand usage acceptance is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_usage_quote_guard before update or delete on brand_usage_quotes for each row execute function brand_usage_quote_guard();

create or replace function brand_usage_consent_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or old.withdrawn_at is not null
     or (to_jsonb(new)-'withdrawn_at'-'withdrawn_by') is distinct from (to_jsonb(old)-'withdrawn_at'-'withdrawn_by') then
    raise exception 'brand usage consent is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_usage_consent_guard before update or delete on brand_usage_consents for each row execute function brand_usage_consent_guard();

create or replace function brand_usage_grant_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or old.starts_at is not null
     or (to_jsonb(new)-'starts_at'-'ends_at') is distinct from (to_jsonb(old)-'starts_at'-'ends_at') then
    raise exception 'brand usage grant is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_usage_grant_guard before update or delete on brand_usage_grants for each row execute function brand_usage_grant_guard();

create or replace function brand_usage_buyer_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or old.revoked_at is not null
     or (to_jsonb(new)-'revoked_at'-'revoked_by'-'revoke_reason') is distinct from (to_jsonb(old)-'revoked_at'-'revoked_by'-'revoke_reason') then
    raise exception 'brand usage buyer record is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_usage_buyer_guard before update or delete on brand_usage_buyers for each row execute function brand_usage_buyer_guard();

-- Purchasing authority belongs to one active editor seat. When that seat ends (revoked) or changes role,
-- every live buyer record for it is revoked in the same statement, whichever code path changed the seat.
create or replace function brand_usage_buyer_membership_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if old.status='active' and (new.status<>'active' or new.role<>old.role) then
    update brand_usage_buyers set revoked_at=now(),
      revoke_reason=case when new.status<>'active' then 'membership_ended' else 'role_changed' end
      where organization_id=old.organization_id and user_id=old.user_id and revoked_at is null;
  end if;
  return new;
end $$;
create trigger brand_usage_buyer_membership_guard after update on brand_memberships for each row execute function brand_usage_buyer_membership_guard();

create or replace function brand_usage_outcome_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or not (old.outcome='paid' and new.outcome='refunded')
     or (to_jsonb(new)-'outcome') is distinct from (to_jsonb(old)-'outcome') then
    raise exception 'brand usage outcome is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_usage_outcome_guard before update or delete on brand_usage_outcomes for each row execute function brand_usage_outcome_guard();

do $$ declare t text; begin
  foreach t in array array['brand_usage_case_items','brand_usage_messages','brand_usage_scope_revisions','brand_usage_compensations','brand_usage_grant_events','brand_usage_events'] loop
    execute format('create trigger immutable_history before update or delete on %I for each row execute function brand_workspace_immutable()',t);
  end loop;
  foreach t in array array['brand_usage_cases','brand_usage_case_items','brand_usage_messages','brand_usage_scope_revisions','brand_usage_compensations','brand_usage_consents',
    'brand_usage_quotes','brand_usage_buyers','brand_usage_payments','brand_usage_grants','brand_usage_grant_events','brand_usage_events','brand_usage_outcomes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public',t);
  end loop;
end $$;
revoke all on function brand_usage_quote_guard() from public;
revoke all on function brand_usage_consent_guard() from public;
revoke all on function brand_usage_grant_guard() from public;
revoke all on function brand_usage_buyer_guard() from public;
revoke all on function brand_usage_buyer_membership_guard() from public;
revoke all on function brand_usage_outcome_guard() from public;
