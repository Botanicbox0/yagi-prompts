-- 클라우드 적용 필요. Campaign sponsorship reuses the brand contract's existing capacity ledger.
create table campaign_productions (
 campaign_id uuid primary key references campaigns(id),
 contract_id uuid not null references brand_production_contracts(id),
 template_id uuid not null,
 reference_attachment_ids uuid[] not null default '{}' check(cardinality(reference_attachment_ids)<=3),
 enabled boolean not null default false,
 revision integer not null default 0,
 updated_by uuid not null references profiles(id),
 updated_at timestamptz not null default now(),
 foreign key(template_id,contract_id) references brand_production_templates(id,contract_id),
 unique(campaign_id,contract_id,template_id)
);
create index campaign_productions_contract on campaign_productions(contract_id);
alter table campaign_applications add unique(id,campaign_id,creator_id);
alter table brand_production_reservations add unique(render_id,contract_id,template_id,user_id);
create table campaign_render_jobs (
 render_id uuid primary key,
 application_id uuid not null,
 campaign_id uuid not null,
 contract_id uuid not null,
 template_id uuid not null,
 creator_id uuid not null references profiles(id),
 reference_keys jsonb not null default '[]' check(jsonb_typeof(reference_keys)='array' and jsonb_array_length(reference_keys)<=3),
 retry_approved_by uuid references profiles(id),
 retry_approved_at timestamptz,
 dispatch_attempt integer not null default 0 check(dispatch_attempt>=0),
 dispatch_started_at timestamptz,
 dispatch_task_id text unique,
 dispatch_resolved_by uuid references profiles(id),
 dispatch_resolved_at timestamptz,
 created_at timestamptz not null default now(),
 foreign key(application_id,campaign_id,creator_id) references campaign_applications(id,campaign_id,creator_id),
 foreign key(campaign_id,contract_id,template_id) references campaign_productions(campaign_id,contract_id,template_id),
 foreign key(render_id,contract_id,template_id,creator_id) references brand_production_reservations(render_id,contract_id,template_id,user_id),
 check((retry_approved_by is null)=(retry_approved_at is null)),
 check((dispatch_resolved_by is null)=(dispatch_resolved_at is null))
);
create index campaign_render_jobs_application on campaign_render_jobs(application_id,created_at desc);
create index campaign_render_jobs_campaign on campaign_render_jobs(campaign_id);
create function guard_campaign_render_lineage() returns trigger language plpgsql as $$ begin
 if (old.render_id,old.application_id,old.campaign_id,old.contract_id,old.template_id,old.creator_id,old.reference_keys,old.created_at)
   is distinct from (new.render_id,new.application_id,new.campaign_id,new.contract_id,new.template_id,new.creator_id,new.reference_keys,new.created_at)
   or (old.retry_approved_at is not null and (new.retry_approved_at,new.retry_approved_by) is distinct from (old.retry_approved_at,old.retry_approved_by))
   or (old.dispatch_resolved_at is not null and (new.dispatch_resolved_at,new.dispatch_resolved_by) is distinct from (old.dispatch_resolved_at,old.dispatch_resolved_by)) then
  raise exception 'campaign render lineage and retry approval are immutable';
 end if;
 if old.dispatch_task_id is not null and old.dispatch_task_id is distinct from new.dispatch_task_id then
  raise exception 'campaign provider task is immutable';
 end if;
 return new;
end $$;
create trigger guard_campaign_render_lineage before update on campaign_render_jobs for each row execute function guard_campaign_render_lineage();
do $$ declare t text; begin
 foreach t in array array['campaign_productions','campaign_render_jobs'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('revoke all on %I from public',t);
 end loop;
end $$;
