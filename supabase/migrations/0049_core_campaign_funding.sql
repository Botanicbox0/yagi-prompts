-- Cloud application required. A receipt only: no render, license, creator payout or publication trigger.
create table campaign_funding_cases (
 id uuid primary key, campaign_id uuid not null unique references campaign_collaboration_links(campaign_id),
 project_id uuid not null references brand_projects(id), organization_id uuid not null references brand_organizations(id),
 status text not null default 'quoted' check(status in ('quoted','accepted','paid','review','refund_pending','refunded')),
 created_at timestamptz not null default now()
);
create table campaign_funding_quotes (
 id uuid primary key, case_id uuid not null references campaign_funding_cases(id), revision integer not null check(revision>0),
 total_krw integer not null check(total_krw>0), tax_basis text not null check(length(tax_basis) between 1 and 1000),
 terms_summary text not null check(length(terms_summary) between 1 and 4000), terms_ref text not null check(length(terms_ref) between 1 and 200),
 valid_until timestamptz not null, status text not null default 'proposed' check(status in ('proposed','accepted','superseded','voided')),
 accepted_by uuid references profiles(id), accepted_at timestamptz, created_by uuid not null references profiles(id), request_id uuid not null,
 created_at timestamptz not null default now(), unique(case_id,revision), unique(created_by,request_id),
 check((accepted_by is null)=(accepted_at is null)), check(status<>'accepted' or accepted_at is not null), check(status not in ('proposed','superseded') or accepted_at is null)
);
create unique index campaign_funding_current_quote on campaign_funding_quotes(case_id) where status in ('proposed','accepted');
create table campaign_funding_payments (
 id uuid primary key, case_id uuid not null references campaign_funding_cases(id), quote_id uuid not null references campaign_funding_quotes(id),
 environment text not null check(environment in ('fake','test','live')), amount_krw integer not null check(amount_krw>0), order_name text not null,
 status text not null default 'pending' check(status in ('pending','confirming','awaiting_deposit','paid','failed','expired','review','refund_pending','refunded')),
 payment_key text unique, expires_at timestamptz not null, lease_token uuid, lease_until timestamptz,
 created_by uuid not null references profiles(id), request_id uuid not null, failure_code text,
 refund_reason text, refund_started_at timestamptz, refund_requested_by uuid references profiles(id),
 approved_at timestamptz, refunded_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(created_by,request_id)
);
create unique index campaign_funding_one_order on campaign_funding_payments(case_id) where status in ('pending','confirming','awaiting_deposit','paid','review','refund_pending','refunded');
create index campaign_funding_reconcile on campaign_funding_payments(status,lease_until);
create table campaign_funding_events (
 id uuid primary key, case_id uuid not null references campaign_funding_cases(id), quote_id uuid references campaign_funding_quotes(id),
 kind text not null, actor_id uuid references profiles(id), reason text, created_at timestamptz not null default now()
);
-- Nonbinding brand input; independent of the TWINGS service quote and creator payout rule.
create table campaign_funding_reward_proposals (
 id uuid primary key, campaign_id uuid not null references campaign_collaboration_links(campaign_id), project_id uuid not null references brand_projects(id),
 organization_id uuid not null references brand_organizations(id), amount_krw integer not null check(amount_krw>0), conditions text not null check(length(conditions) between 1 and 4000),
 created_by uuid not null references profiles(id), request_id uuid not null, state text not null default 'proposed' check(state in ('proposed','reviewed','declined')),
 review_note text, reviewed_by uuid references profiles(id), reviewed_at timestamptz, created_at timestamptz not null default now(), unique(created_by,request_id),
 check((state='proposed')=(reviewed_at is null)), check((reviewed_at is null)=(reviewed_by is null))
);
create function guard_campaign_funding_immutable() returns trigger language plpgsql as $$ begin
 if tg_op='DELETE' then raise exception 'campaign funding record immutable';end if;
 if tg_table_name='campaign_funding_reward_proposals' then
  if (to_jsonb(old)-array['state','review_note','reviewed_by','reviewed_at']) is distinct from (to_jsonb(new)-array['state','review_note','reviewed_by','reviewed_at']) or old.state<>'proposed' then raise exception 'campaign reward proposal immutable';end if;
 elsif tg_table_name='campaign_funding_quotes' then
  if (to_jsonb(old)-array['status','accepted_by','accepted_at']) is distinct from (to_jsonb(new)-array['status','accepted_by','accepted_at'])
    or old.status in ('voided','superseded') or old.status='accepted' and (new.status<>'voided' or old.accepted_by is distinct from new.accepted_by or old.accepted_at is distinct from new.accepted_at) then raise exception 'campaign funding quote immutable';end if;
 elsif tg_table_name in ('campaign_funding_cases','campaign_funding_reward_proposals') then
  if (to_jsonb(old)-'status') is distinct from (to_jsonb(new)-'status') then raise exception 'campaign funding case immutable';end if;
 elsif tg_table_name='campaign_funding_payments' then
  if (old.id,old.case_id,old.quote_id,old.environment,old.amount_krw,old.order_name,old.expires_at,old.created_by,old.request_id,old.created_at)
    is distinct from (new.id,new.case_id,new.quote_id,new.environment,new.amount_krw,new.order_name,new.expires_at,new.created_by,new.request_id,new.created_at)
    or old.payment_key is not null and old.payment_key is distinct from new.payment_key
    or old.refund_started_at is not null and old.refund_started_at is distinct from new.refund_started_at
    then raise exception 'campaign funding payment immutable';end if;
 else raise exception 'campaign funding event immutable';end if;
 return new;
end $$;
create function guard_campaign_funding_scope() returns trigger language plpgsql as $$ begin
 if tg_table_name in ('campaign_funding_cases','campaign_funding_reward_proposals') then
  if not exists(select 1 from campaign_collaboration_links l join brand_projects p on p.id=l.project_id
    where l.campaign_id=new.campaign_id and l.project_id=new.project_id and p.organization_id=new.organization_id)
    then raise exception 'campaign funding scope mismatch';end if;
 elsif tg_table_name='campaign_funding_payments' then
  if not exists(select 1 from campaign_funding_quotes q where q.id=new.quote_id and q.case_id=new.case_id and q.total_krw=new.amount_krw)
    then raise exception 'campaign funding amount mismatch';end if;
 end if;return new;
end $$;
create trigger campaign_funding_reward_scope before insert on campaign_funding_reward_proposals for each row execute function guard_campaign_funding_scope();
create trigger campaign_funding_case_scope before insert on campaign_funding_cases for each row execute function guard_campaign_funding_scope();
create trigger campaign_funding_payment_scope before insert on campaign_funding_payments for each row execute function guard_campaign_funding_scope();
do $$ declare t text; begin
 foreach t in array array['campaign_funding_cases','campaign_funding_quotes','campaign_funding_payments','campaign_funding_events','campaign_funding_reward_proposals'] loop
 execute format('create trigger %I before update or delete on %I for each row execute function guard_campaign_funding_immutable()',t||'_immutable',t);
 execute format('alter table %I enable row level security',t);
 execute format('alter table %I force row level security',t);
 execute format('revoke all on %I from public',t);
 end loop;
end $$;
