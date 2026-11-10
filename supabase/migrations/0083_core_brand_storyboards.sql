-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0083 — project room storyboards (docs/BRAND-ROOMS.md §5, §8)
--
-- Apply this file (and 0157) BEFORE turning on BRAND_ROOMS=on. With the flag off nothing reads these
-- tables, so the code can ship first.
--
--   brand_storyboards        one version of a project's storyboard. Versions of the same storyboard
--                            share `lineage_id` and count up from 1 (a deleted version keeps its number).
--                            A draft the team made is hidden from the brand until it is shared.
--   brand_storyboard_frames  the cuts of one version, in `idx` order: a picture (a studio media-store
--                            key, `st/<64 hex>.<ext>`) with a scene/shot label, a description and
--                            optional camera, sound and length in seconds. A cut whose picture is still
--                            uploading is `pending` (a staging key and the reserved type and size, no
--                            media key) and is never shown or counted as a cut.
--
-- Who did what is the audit: created_by/created_role ('brand' | 'studio'), source ('manual' | 'cli'),
-- shared_by, status_changed_by. Limits the code keeps (lib/brand-rooms/storyboard-contracts.ts): 200
-- cuts per board, 50 boards per project. Vocabulary mirrors that file.

create table if not exists brand_storyboards (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  project_id uuid not null,
  lineage_id uuid not null,
  version integer not null default 1,
  title text not null,
  status text not null default 'draft',
  created_by uuid references profiles(id) on delete set null,
  created_role text not null,
  source text not null default 'manual',
  shared_at timestamptz,
  shared_by uuid references profiles(id) on delete set null,
  status_changed_by uuid references profiles(id) on delete set null,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint brand_storyboards_project_fk foreign key (organization_id, project_id)
    references brand_projects (organization_id, id) on delete cascade,
  constraint brand_storyboards_title check (char_length(title) between 1 and 120),
  constraint brand_storyboards_version check (version between 1 and 999),
  constraint brand_storyboards_status check (status in ('draft','shared','changes_requested','approved')),
  constraint brand_storyboards_role check (created_role in ('brand','studio')),
  constraint brand_storyboards_source check (source in ('manual','cli')),
  constraint brand_storyboards_shared check (status = 'draft' or shared_at is not null),
  constraint brand_storyboards_org_key unique (id, organization_id),
  constraint brand_storyboards_lineage_version unique (lineage_id, version)
);
create index if not exists idx_brand_storyboards_project on brand_storyboards (organization_id, project_id, updated_at desc) where deleted_at is null;
create index if not exists idx_brand_storyboards_recent on brand_storyboards (updated_at desc) where deleted_at is null;

create table if not exists brand_storyboard_frames (
  id uuid primary key default gen_random_uuid(),
  storyboard_id uuid not null,
  organization_id uuid not null,
  idx integer not null,
  status text not null default 'ready',
  scene text,
  shot text,
  description text not null default '',
  camera text,
  audio text,
  seconds numeric(4,1),
  -- The picture once `ready`; null while `pending`.
  storage_key text,
  thumb_key text,
  -- While `pending`: where the upload lands and what was reserved.
  staging_key text,
  mime text,
  size_bytes bigint,
  sha256 text,
  width integer,
  height integer,
  source text not null default 'upload',
  source_asset_id uuid references brand_studio_assets(id) on delete set null,
  source_output_id uuid references brand_studio_outputs(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_storyboard_frames_board_fk foreign key (storyboard_id, organization_id)
    references brand_storyboards (id, organization_id) on delete cascade,
  -- Deferred so a reorder may pass through a moment where two cuts share a place.
  constraint brand_storyboard_frames_order unique (storyboard_id, idx) deferrable initially deferred,
  constraint brand_storyboard_frames_idx check (idx between 0 and 999),
  constraint brand_storyboard_frames_status check (status in ('pending','ready')),
  constraint brand_storyboard_frames_picture check ((status = 'ready') = (storage_key is not null)),
  constraint brand_storyboard_frames_upload check (status = 'ready' or (staging_key is not null and mime is not null and size_bytes is not null)),
  constraint brand_storyboard_frames_scene check (scene is null or char_length(scene) between 1 and 20),
  constraint brand_storyboard_frames_shot check (shot is null or char_length(shot) between 1 and 20),
  constraint brand_storyboard_frames_description check (char_length(description) <= 2000),
  constraint brand_storyboard_frames_camera check (camera is null or char_length(camera) between 1 and 300),
  constraint brand_storyboard_frames_audio check (audio is null or char_length(audio) between 1 and 300),
  constraint brand_storyboard_frames_seconds check (seconds is null or (seconds >= 0 and seconds <= 600)),
  constraint brand_storyboard_frames_mime check (mime is null or mime in ('image/png','image/jpeg','image/webp')),
  constraint brand_storyboard_frames_size check (size_bytes is null or (size_bytes > 0 and size_bytes <= 26214400)),
  constraint brand_storyboard_frames_sha check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint brand_storyboard_frames_dims check ((width is null or width > 0) and (height is null or height > 0)),
  constraint brand_storyboard_frames_source check (source in ('upload','asset','output'))
);
create index if not exists idx_brand_storyboard_frames_key on brand_storyboard_frames (storage_key) where storage_key is not null;
create index if not exists idx_brand_storyboard_frames_pending on brand_storyboard_frames (storyboard_id) where status = 'pending';
