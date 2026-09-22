-- Cloud application required. General support is separate from campaign approval history.
alter table brand_organizations add column website text not null default '' check(length(website)<=2048);
alter table brand_organizations add column description text not null default '' check(length(description)<=2000);
alter table brand_organizations add column contact_email text not null default '' check(length(contact_email)<=254);
alter table brand_organizations add column profile_revision integer not null default 0;
create table brand_support_messages (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references brand_organizations(id),
 body text not null check(length(btrim(body)) between 1 and 4000), author_role text not null check(author_role in ('brand','studio')),
 created_by uuid not null references profiles(id), request_id uuid not null, created_at timestamptz not null default now(),
 unique(organization_id,created_by,request_id)
);
create index brand_support_messages_org on brand_support_messages(organization_id,created_at);
create trigger immutable_history before update or delete on brand_support_messages for each row execute function brand_workspace_immutable();
alter table brand_support_messages enable row level security;
alter table brand_support_messages force row level security;
revoke all on brand_support_messages from public;
