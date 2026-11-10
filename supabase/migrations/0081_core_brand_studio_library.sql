-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0081 — brand studio library rail (docs/BRAND-STUDIO-V3.md §4)
--
-- Apply this file (and 0154) before the v3 studio screen ships with BRAND_STUDIO_V2=on. With the flag off
-- nothing reads these tables, so the code can ship first.
--
--   brand_studio_folders       folders the whole organization shares (who made one is kept). Soft delete.
--                              A live name is unique per organization, ignoring case.
--   brand_studio_folder_items  what a folder holds: exactly one library asset or one result. A thing sits
--                              in a folder once. Rows of a deleted folder stay until the folder row goes.
--   brand_studio_likes         a member's own likes: exactly one asset or one result, once per member.
--
-- Limits live in code (lib/brand-studio/library-contracts.ts): 100 live folders per organization,
-- 500 items per folder. Every read and write is scoped to an organization the service already seated.

create table if not exists brand_studio_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  name text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint brand_studio_folders_name check (char_length(name) between 1 and 60 and btrim(name) = name),
  -- Lets an item name its folder and organization together (the item cannot point across organizations).
  constraint brand_studio_folders_org_key unique (id, organization_id)
);
create unique index if not exists brand_studio_folders_name_key on brand_studio_folders (organization_id, lower(name)) where deleted_at is null;
create index if not exists idx_brand_studio_folders_org on brand_studio_folders (organization_id, updated_at desc) where deleted_at is null;

create table if not exists brand_studio_folder_items (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  asset_id uuid references brand_studio_assets(id) on delete cascade,
  output_id uuid references brand_studio_outputs(id) on delete cascade,
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_studio_folder_items_folder_fk foreign key (folder_id, organization_id)
    references brand_studio_folders(id, organization_id) on delete cascade,
  constraint brand_studio_folder_items_one_ref check (num_nonnulls(asset_id, output_id) = 1)
);
create unique index if not exists brand_studio_folder_items_asset_key on brand_studio_folder_items (folder_id, asset_id) where asset_id is not null;
create unique index if not exists brand_studio_folder_items_output_key on brand_studio_folder_items (folder_id, output_id) where output_id is not null;
create index if not exists idx_brand_studio_folder_items_folder on brand_studio_folder_items (folder_id, created_at desc);
create index if not exists idx_brand_studio_folder_items_asset on brand_studio_folder_items (asset_id) where asset_id is not null;
create index if not exists idx_brand_studio_folder_items_output on brand_studio_folder_items (output_id) where output_id is not null;

create table if not exists brand_studio_likes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  asset_id uuid references brand_studio_assets(id) on delete cascade,
  output_id uuid references brand_studio_outputs(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint brand_studio_likes_one_ref check (num_nonnulls(asset_id, output_id) = 1)
);
create unique index if not exists brand_studio_likes_asset_key on brand_studio_likes (organization_id, user_id, asset_id) where asset_id is not null;
create unique index if not exists brand_studio_likes_output_key on brand_studio_likes (organization_id, user_id, output_id) where output_id is not null;
create index if not exists idx_brand_studio_likes_member on brand_studio_likes (organization_id, user_id, created_at desc);
create index if not exists idx_brand_studio_likes_asset on brand_studio_likes (asset_id) where asset_id is not null;
create index if not exists idx_brand_studio_likes_output on brand_studio_likes (output_id) where output_id is not null;
