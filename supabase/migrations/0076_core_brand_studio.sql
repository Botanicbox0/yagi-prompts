-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0076 — brand studio v2 (docs/BRAND-STUDIO-V2.md §6)
--
-- Apply this file (and 0152) BEFORE turning on BRAND_STUDIO_V2=on. With the flag off nothing reads
-- these tables, so the code can ship first.
--
--   brand_studio_assets      the company library: uploads and saved results. Same bytes in the same
--                            organization fold into one row (live rows only). Soft delete.
--   brand_studio_jobs        one request ("make 4 images", "finish this draft at 1080p").
--                            (organization_id, created_by, request_id) is the idempotency key.
--   brand_studio_outputs     one result slot of a job (pending -> ready | failed).
--   brand_studio_allowances  the monthly usage allowance per organization, in KRW (a limit, not a
--                            payment). No row = BRAND_STUDIO_DEFAULT_MONTHLY_KRW (default 0 = closed).
--   brand_studio_lanes       liveness of the execution lanes (the account-lane worker's heartbeat).
--
-- Vocabulary mirrors lib/brand-studio/contracts.ts and lib/brand-studio/models.ts.

create table if not exists brand_studio_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  kind text not null,
  role text,
  name text not null,
  tags text[] not null default '{}'::text[],
  mime text not null,
  size_bytes bigint not null,
  width integer,
  height integer,
  duration_ms integer,
  -- A staging key while `pending`, the media-store key (`st/<hex>.<ext>`) once `ready`.
  storage_key text not null,
  thumb_key text,
  sha256 text,
  source text not null default 'upload',
  source_output_id uuid,
  status text not null default 'pending',
  -- Set when an upload turned out to be bytes the library already had: the row is closed and points here.
  duplicate_of uuid references brand_studio_assets(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  request_id text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint brand_studio_assets_kind check (kind in ('image','video','audio')),
  constraint brand_studio_assets_role check (role is null or role in ('product','person','logo','style','place','other')),
  constraint brand_studio_assets_name check (char_length(name) between 1 and 80),
  constraint brand_studio_assets_tags check (cardinality(tags) <= 8),
  constraint brand_studio_assets_size check (size_bytes > 0),
  constraint brand_studio_assets_dims check ((width is null or width > 0) and (height is null or height > 0) and (duration_ms is null or duration_ms >= 0)),
  constraint brand_studio_assets_source check (source in ('upload','generation')),
  constraint brand_studio_assets_status check (status in ('pending','ready')),
  constraint brand_studio_assets_sha check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint brand_studio_assets_request check (request_id is null or request_id ~ '^[A-Za-z0-9_-]{8,80}$')
);
create unique index if not exists brand_studio_assets_request_key on brand_studio_assets (organization_id, created_by, request_id);
create unique index if not exists brand_studio_assets_storage_key on brand_studio_assets (storage_key) where deleted_at is null;
create unique index if not exists brand_studio_assets_sha_key on brand_studio_assets (organization_id, sha256) where deleted_at is null and sha256 is not null;
create index if not exists idx_brand_studio_assets_org on brand_studio_assets (organization_id, created_at desc) where deleted_at is null;

create table if not exists brand_studio_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  created_by uuid references profiles(id) on delete set null,
  request_id text not null,
  kind text not null,
  status text not null default 'held',
  lane text,
  model text not null,
  prompt text not null default '',
  final_prompt text,
  enhance boolean not null default true,
  params jsonb not null default '{}'::jsonb,
  refs jsonb not null default '[]'::jsonb,
  parent_output_id uuid,
  estimate_usd numeric(12,4) not null default 0,
  cost_usd numeric(12,4),
  estimate_krw integer not null default 0,
  -- The settled usage once the job is done (replaces the estimate in the monthly sum).
  usage_krw integer,
  error_code text,
  -- Internal only (provider messages). Never sent to a customer.
  error_detail text,
  work jsonb not null default '{}'::jsonb,
  -- Lease: an advancer owns the job while this is recent (lib/brand-studio/engine.ts).
  claimed_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint brand_studio_jobs_kind check (kind in ('image','region_edit','video','video_remix','video_final')),
  constraint brand_studio_jobs_status check (status in ('held','queued','running','finishing','succeeded','failed','canceled')),
  constraint brand_studio_jobs_lane check (lane is null or lane in ('sunra_api','sunra_mcp')),
  constraint brand_studio_jobs_request check (request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  constraint brand_studio_jobs_prompt check (char_length(prompt) <= 4000),
  constraint brand_studio_jobs_money check (estimate_usd >= 0 and estimate_krw >= 0 and (cost_usd is null or cost_usd >= 0) and (usage_krw is null or usage_krw >= 0)),
  constraint brand_studio_jobs_error check (error_code is null or error_code in (
    'sign_in_required','forbidden','not_found','feature_unavailable','studio_closed','invalid','conflict',
    'allowance_closed','allowance_exhausted','too_many_running','asset_limit','unsupported_file','file_too_large',
    'reference_missing','provider_rejected','provider_unavailable','failed')),
  constraint brand_studio_jobs_finished check ((status in ('succeeded','failed','canceled')) = (finished_at is not null))
);
create unique index if not exists brand_studio_jobs_request_key on brand_studio_jobs (organization_id, created_by, request_id);
create index if not exists idx_brand_studio_jobs_org on brand_studio_jobs (organization_id, created_at desc);
create index if not exists idx_brand_studio_jobs_open on brand_studio_jobs (status, created_at) where status in ('held','queued','running','finishing');
create index if not exists idx_brand_studio_jobs_lane on brand_studio_jobs (lane, status) where status in ('queued','running','finishing');

create table if not exists brand_studio_outputs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references brand_studio_jobs(id) on delete cascade,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  idx integer not null,
  kind text not null,
  status text not null default 'pending',
  provider_task_id text,
  draft_task_id text,
  storage_key text,
  thumb_key text,
  mime text,
  bytes bigint,
  width integer,
  height integer,
  duration_ms integer,
  sha256 text,
  is_draft boolean not null default false,
  saved_asset_id uuid references brand_studio_assets(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint brand_studio_outputs_idx check (idx between 0 and 15),
  constraint brand_studio_outputs_kind check (kind in ('image','video')),
  constraint brand_studio_outputs_status check (status in ('pending','ready','failed')),
  constraint brand_studio_outputs_ready check (status <> 'ready' or storage_key is not null),
  constraint brand_studio_outputs_sha check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  constraint brand_studio_outputs_slot unique (job_id, idx)
);
create unique index if not exists brand_studio_outputs_storage_key on brand_studio_outputs (storage_key) where storage_key is not null;
create index if not exists idx_brand_studio_outputs_task on brand_studio_outputs (provider_task_id) where provider_task_id is not null;
create index if not exists idx_brand_studio_outputs_org on brand_studio_outputs (organization_id, created_at desc);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_jobs_parent_output_fk') then
    alter table brand_studio_jobs add constraint brand_studio_jobs_parent_output_fk
      foreign key (parent_output_id) references brand_studio_outputs(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_assets_source_output_fk') then
    alter table brand_studio_assets add constraint brand_studio_assets_source_output_fk
      foreign key (source_output_id) references brand_studio_outputs(id) on delete set null;
  end if;
end $$;

create table if not exists brand_studio_allowances (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  monthly_cap_krw integer not null default 0,
  preferred_lane text,
  note text not null default '',
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_studio_allowances_cap check (monthly_cap_krw between 0 and 100000000),
  constraint brand_studio_allowances_lane check (preferred_lane is null or preferred_lane in ('sunra_api','sunra_mcp')),
  constraint brand_studio_allowances_note check (char_length(note) <= 500)
);

create table if not exists brand_studio_lanes (
  lane text primary key,
  seen_at timestamptz,
  info jsonb not null default '{}'::jsonb,
  constraint brand_studio_lanes_lane check (lane in ('sunra_api','sunra_mcp'))
);
