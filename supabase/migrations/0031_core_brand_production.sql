-- 클라우드 적용 필요. Brand templates are new private rows, never converted public assets.
alter table prompt_items add column audience text not null default 'public' check(audience in ('public','brand'));
create function guard_brand_prompt() returns trigger language plpgsql as $$ begin
 if old.audience <> new.audience or old.audience='brand' then
   raise exception 'template audience and brand template versions are immutable';
 end if;
 return new;
end $$;
create trigger guard_brand_prompt before update on prompt_items for each row execute function guard_brand_prompt();

create table brand_production_contracts (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references brand_organizations(id),
 project_id uuid not null references brand_projects(id),
 document_id uuid references brand_contract_documents(id),
 title text not null, starts_at timestamptz not null, ends_at timestamptz not null,
 generation_limit integer not null check(generation_limit > 0),
 enabled boolean not null default true, revision integer not null default 0,
 created_by uuid not null references profiles(id), request_id uuid not null,
 created_at timestamptz not null default now(),
 check(ends_at > starts_at), unique(created_by,request_id),
 foreign key(organization_id,project_id) references brand_projects(organization_id,id)
);
create table brand_production_templates (
 id uuid primary key references prompt_items(id),
 contract_id uuid not null references brand_production_contracts(id),
 preview_attachment_id uuid references brand_attachments(id),
 created_by uuid not null references profiles(id), request_id uuid not null,
 created_at timestamptz not null default now(), unique(created_by,request_id), unique(id,contract_id)
);
create table brand_production_reservations (
 render_id uuid primary key references render_jobs(id),
 contract_id uuid not null references brand_production_contracts(id),
 template_id uuid not null,
 user_id uuid not null references profiles(id), request_id uuid not null, fingerprint text not null,
 released_at timestamptz, created_at timestamptz not null default now(),
 unique(user_id,request_id), foreign key(template_id,contract_id) references brand_production_templates(id,contract_id)
);
create index brand_production_usage on brand_production_reservations(contract_id) where released_at is null;

-- Restore precisely once in the same transaction that commits terminal render failure.
create function release_brand_production_failure() returns trigger language plpgsql as $$ begin
 if new.status='failed' then
  update brand_production_reservations set released_at=coalesce(new.finished_at,now()) where render_id=new.id and released_at is null;
 end if;
 return new;
end $$;
create trigger release_brand_production_failure after update of status on render_jobs
 for each row execute function release_brand_production_failure();

do $$ declare t text; begin
 foreach t in array array['brand_production_contracts','brand_production_templates','brand_production_reservations'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('revoke all on %I from public',t);
 end loop;
end $$;
