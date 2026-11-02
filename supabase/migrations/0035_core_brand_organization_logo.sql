-- 클라우드 적용 필요 (then 0121_glue_brand_organization_logo.sql). A brand's own logo, independent of any campaign.
-- The organization UUID stays the brand's only identity; no second number is introduced.
-- Bytes live in the PRIVATE staging bucket at brands/{organization_id}/logos/{id}. There is no public
-- bucket copy and no remote URL column: a logo is only ever bytes the server inspected itself.
create table brand_organization_logos (
  id uuid primary key,
  organization_id uuid not null references brand_organizations(id),
  storage_key text not null unique,
  mime text not null check(mime in ('image/png','image/jpeg','image/webp')),
  size_bytes integer not null check(size_bytes between 1 and 2097152),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references profiles(id),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique(organization_id,id),
  unique(organization_id,created_by,request_id),
  check(storage_key = 'brands/' || organization_id::text || '/logos/' || id::text)
);
-- Uploaded logos are history: replacing or removing the current logo only moves the pointer below.
create trigger immutable_history before update or delete on brand_organization_logos
  for each row execute function brand_workspace_immutable();

-- The current logo. The composite key makes another organization's logo unreachable; NULL = default avatar.
-- `logo_revision` is the optimistic-concurrency token for set/remove, separate from profile edits.
alter table brand_organizations add column logo_id uuid;
alter table brand_organizations add column logo_revision integer not null default 0 check(logo_revision >= 0);
alter table brand_organizations add constraint brand_organizations_logo_same_org
  foreign key(id,logo_id) references brand_organization_logos(organization_id,id);

alter table public.brand_organization_logos enable row level security;
alter table public.brand_organization_logos force row level security;
revoke all on public.brand_organization_logos from public;
