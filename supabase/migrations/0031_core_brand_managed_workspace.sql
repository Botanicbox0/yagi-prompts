-- Cloud application required. Studio-managed onboarding and private campaign contracts.
alter table brand_organizations add column studio_managed boolean not null default false;
alter table brand_projects add column client_visible boolean not null default true;
alter table brand_invites add column issued_by_studio boolean not null default false;
alter table brand_invites add column project_id uuid;
alter table brand_invites drop constraint brand_invites_role_check;
alter table brand_invites add constraint brand_invites_role_check check(role in ('owner','editor','viewer'));
alter table brand_invites add constraint brand_invites_scope_check check(
 (role <> 'owner' or issued_by_studio) and (project_id is null or (issued_by_studio and role='viewer')));
alter table brand_invites add foreign key(organization_id,project_id) references brand_projects(organization_id,id);
create table brand_project_members (
 organization_id uuid not null, project_id uuid not null, user_id uuid not null references profiles(id),
 status text not null default 'active' check(status in ('active','revoked')), created_at timestamptz not null default now(),
 primary key(project_id,user_id), foreign key(organization_id,project_id) references brand_projects(organization_id,id)
);
create index brand_project_members_user on brand_project_members(user_id,status);
alter table brand_attachments add column access_scope text not null default 'workspace' check(access_scope in ('workspace','contract'));
alter table brand_attachments add constraint contract_pdf_only check(access_scope<>'contract' or mime='application/pdf');
create table brand_contract_documents (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
 document_key text not null check(document_key ~ '^[a-zA-Z0-9_-]{1,60}$'), title text not null check(length(btrim(title)) between 1 and 160),
 version integer not null check(version>0), attachment_id uuid not null unique,
 shared boolean not null default false, revision integer not null default 0 check(revision>=0),
 created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
 foreign key(organization_id,project_id) references brand_projects(organization_id,id),
 foreign key(project_id,attachment_id) references brand_attachments(project_id,id),
 unique(project_id,document_key,version), unique(project_id,created_by,request_id)
);
create table brand_contract_sharing_events (
 id uuid primary key default gen_random_uuid(), contract_id uuid not null references brand_contract_documents(id),
 shared boolean not null, revision integer not null, created_by uuid not null references profiles(id),
 created_at timestamptz not null default now(), unique(contract_id,revision)
);
create function brand_contract_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-'shared'-'revision') is distinct from (to_jsonb(old)-'shared'-'revision') then
  raise exception 'brand contract version is immutable' using errcode='23514';
 end if;
 if new.revision<>old.revision+1 then raise exception 'invalid contract revision' using errcode='23514'; end if;
 return new;
end $$;
create trigger contract_guard before update or delete on brand_contract_documents for each row execute function brand_contract_guard();
create trigger immutable_history before update or delete on brand_contract_sharing_events for each row execute function brand_workspace_immutable();
do $$ declare t text; begin
 foreach t in array array['brand_project_members','brand_contract_documents','brand_contract_sharing_events'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('revoke all on %I from public',t);
 end loop;
end $$;
revoke all on function brand_contract_guard() from public;
