-- TWINGS brand workspace. Cloud application required; no billing/payment dependencies.
-- Requested budget is nonbinding. These tables contain NO creator costs, payouts or margin.
create table brand_organizations (
  id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 2 and 100),
  created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), unique(created_by, request_id)
);
create table brand_memberships (
  id uuid not null unique default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id), user_id uuid not null references profiles(id),
  role text not null check(role in ('owner','editor','viewer')), status text not null default 'active' check(status in ('active','revoked')),
  created_at timestamptz not null default now(), primary key(organization_id,user_id)
);
create index brand_memberships_user on brand_memberships(user_id,status);
create table brand_invites (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references brand_organizations(id),
  email text not null check(email=lower(email) and length(email)<=254), role text not null check(role in ('editor','viewer')),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null,
  accepted_at timestamptz, revoked_at timestamptz, accepted_by uuid references profiles(id),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  check(expires_at>created_at and expires_at<=created_at+interval '7 days'), unique(organization_id,created_by,request_id)
);
create table brand_projects (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references brand_organizations(id),
  title text not null check(length(btrim(title)) between 3 and 120), objective text not null check(length(btrim(objective)) between 3 and 2000),
  audience text not null default '' check(length(audience)<=1000), budget_krw bigint check(budget_krw between 0 and 1000000000000),
  budget_tax_basis text not null default 'unspecified' check(budget_tax_basis in ('unspecified','included','excluded')),
  criteria jsonb not null default '{"platforms":[],"minFollowers":null,"maxFollowers":null,"primaryMetric":"views","targetValue":null}' check(jsonb_typeof(criteria)='object'),
  starts_on date, ends_on date, production_mode text not null check(production_mode in ('creator','studio')),
  reference_links jsonb not null default '[]' check(jsonb_typeof(reference_links)='array' and jsonb_array_length(reference_links)<=10),
  status text not null default 'requested' check(status in ('requested','active','completed','cancelled')),
  revision integer not null default 0 check(revision>=0), created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(ends_on is null or starts_on is null or ends_on>=starts_on), unique(organization_id,id), unique(organization_id,created_by,request_id)
);
create index brand_projects_org on brand_projects(organization_id,created_at desc);
create table brand_content_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
  slot_key text not null check(slot_key ~ '^[a-zA-Z0-9_-]{1,60}$'), version integer not null check(version>0),
  title text not null check(length(title) between 1 and 120), attachment_id uuid not null,
  asset_sha256 text not null check(asset_sha256 ~ '^[a-f0-9]{64}$'),
  caption text not null default '' check(length(caption)<=4000), usage_rights text not null check(length(usage_rights) between 1 and 2000),
  creator_consent_confirmed boolean not null default false, review_revision integer not null default 0 check(review_revision>=0),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  unique(project_id,id), unique(project_id,slot_key,version), unique(project_id,created_by,request_id)
);
create table brand_content_decisions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null, content_version_id uuid not null,
  decision text not null check(decision in ('approved','changes_requested')), comment text not null default '' check(length(comment)<=2000),
  revision integer not null check(revision>0), created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), check(decision<>'changes_requested' or length(btrim(comment))>0),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  foreign key(project_id,content_version_id) references brand_content_versions(project_id,id),
  unique(content_version_id,revision), unique(project_id,created_by,request_id)
);
create table brand_messages (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
  body text not null check(length(btrim(body)) between 1 and 4000), author_role text not null check(author_role in ('brand','studio')),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id), unique(project_id,created_by,request_id)
);
create index brand_messages_project on brand_messages(project_id,created_at);
create table brand_attachments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
  name text not null check(length(name) between 1 and 160), mime text not null check(mime in ('image/jpeg','image/png','image/webp','video/mp4','video/webm','application/pdf')),
  size_bytes bigint not null check(size_bytes>0 and size_bytes<=50000000), storage_key text not null unique,
  status text not null default 'pending' check(status in ('pending','ready')), sha256 text,
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id), unique(project_id,created_by,request_id),
  unique(project_id,id),
  check(status<>'ready' or sha256 ~ '^[a-f0-9]{64}$')
);
alter table brand_content_versions add constraint brand_content_attachment_same_project
  foreign key(project_id,attachment_id) references brand_attachments(project_id,id);
create table brand_posts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null, content_version_id uuid not null,
  url text not null check(url like 'https://%'), platform text not null check(platform in ('instagram','tiktok','x','youtube')),
  platform_post_id text not null, published_at timestamptz not null, metric_revision integer not null default 0 check(metric_revision>=0),
  verification text not null check(verification in ('unverified','manual')),
  metrics_source text not null check(metrics_source in ('unavailable','creator_evidence','studio_review')),
  measured_at timestamptz, views bigint check(views>=0), likes bigint check(likes>=0), comments bigint check(comments>=0), shares bigint check(shares>=0), saves bigint check(saves>=0),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  foreign key(project_id,content_version_id) references brand_content_versions(project_id,id),
  unique(project_id,id), unique(project_id,url), unique(project_id,platform,platform_post_id), unique(project_id,created_by,request_id),
  check((metrics_source='unavailable' and measured_at is null and views is null and likes is null and comments is null and shares is null and saves is null)
    or (metrics_source<>'unavailable' and measured_at is not null and (views is not null or likes is not null or comments is not null or shares is not null or saves is not null)))
);
create table brand_post_measurements (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null, post_id uuid not null,
  revision integer not null check(revision>0), verification text not null check(verification in ('unverified','manual')),
  metrics_source text not null check(metrics_source in ('unavailable','creator_evidence','studio_review')), measured_at timestamptz,
  views bigint check(views>=0), likes bigint check(likes>=0), comments bigint check(comments>=0), shares bigint check(shares>=0), saves bigint check(saves>=0),
  created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  foreign key(project_id,post_id) references brand_posts(project_id,id), unique(post_id,revision), unique(project_id,created_by,request_id),
  check((metrics_source='unavailable' and measured_at is null and views is null and likes is null and comments is null and shares is null and saves is null)
    or (metrics_source<>'unavailable' and measured_at is not null and (views is not null or likes is not null or comments is not null or shares is not null or saves is not null)))
);
create table brand_reports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null, version integer not null check(version>0),
  summary text not null check(length(btrim(summary)) between 1 and 4000), period_start date not null, period_end date not null check(period_end>=period_start),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object'), created_by uuid not null references profiles(id), request_id uuid not null,
  created_at timestamptz not null default now(), foreign key(organization_id,project_id) references brand_projects(organization_id,id),
  unique(project_id,version), unique(project_id,created_by,request_id)
);
-- Operational event ledger only. No Slack/email delivery is enabled by this migration.
create table brand_workspace_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, project_id uuid not null,
  kind text not null check(kind in ('project_requested','message_received','content_decided','report_published','project_status_changed')),
  subject_id uuid not null, created_at timestamptz not null default now(),
  foreign key(organization_id,project_id) references brand_projects(organization_id,id), unique(kind,subject_id)
);
create or replace function brand_workspace_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'brand workspace history is immutable' using errcode='23514'; end $$;
create or replace function brand_content_version_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'brand content version is immutable' using errcode='23514'; end if;
  if (to_jsonb(new)-'review_revision') is distinct from (to_jsonb(old)-'review_revision') or new.review_revision<>old.review_revision+1 then
    raise exception 'brand content version is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_content_version_guard before update or delete on brand_content_versions for each row execute function brand_content_version_guard();
create or replace function brand_attachment_guard() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' or old.status='ready' then raise exception 'brand attachment is immutable' using errcode='23514'; end if;
  if new.status<>'ready' or (to_jsonb(new)-'status'-'sha256') is distinct from (to_jsonb(old)-'status'-'sha256') then
    raise exception 'brand attachment metadata is immutable' using errcode='23514';
  end if;
  return new;
end $$;
create trigger brand_attachment_guard before update or delete on brand_attachments for each row execute function brand_attachment_guard();
do $$ declare t text; begin
  foreach t in array array['brand_content_decisions','brand_messages','brand_post_measurements','brand_reports','brand_workspace_events'] loop
    execute format('create trigger immutable_history before update or delete on %I for each row execute function brand_workspace_immutable()',t);
  end loop;
  foreach t in array array['brand_organizations','brand_memberships','brand_invites','brand_projects','brand_content_versions','brand_content_decisions','brand_messages','brand_attachments','brand_posts','brand_post_measurements','brand_reports','brand_workspace_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format('revoke all on public.%I from public',t);
  end loop;
end $$;
revoke all on function brand_workspace_immutable() from public;
revoke all on function brand_content_version_guard() from public;
revoke all on function brand_attachment_guard() from public;
