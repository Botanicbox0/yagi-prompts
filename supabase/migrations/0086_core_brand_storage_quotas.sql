-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0086 — per-organization storage quotas and audit events (docs/BRAND-STORAGE-QUOTAS-F.md)
--
-- Apply this file (and 0161) alongside the Bundle F deployment. Every workspace and studio reader/writer
-- checks `to_regclass('public.brand_storage_quotas')` / `isMissingTable` so an environment where 0086 has
-- not been applied yet falls back cleanly to live byte aggregation + plan defaults without failing requests.
--
--   brand_storage_quotas        one row per organization: optional admin override `quota_bytes` (`null` =
--                               plan default), cached deduplicated `used_bytes`, category `breakdown`,
--                               optional post-delivery `retention_days` override, optimistic `revision`.
--   brand_storage_quota_events  append-only audit log of admin quota / retention overrides and reconciles.

create table if not exists brand_storage_quotas (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  quota_bytes bigint,
  used_bytes bigint not null default 0,
  breakdown jsonb not null default '{}'::jsonb,
  retention_days integer,
  reconciled_at timestamptz,
  note text not null default '',
  revision integer not null default 1,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_storage_quotas_quota_nonneg check (quota_bytes is null or quota_bytes >= 0),
  constraint brand_storage_quotas_used_nonneg check (used_bytes >= 0),
  constraint brand_storage_quotas_retention_range check (retention_days is null or retention_days between 1 and 3650),
  constraint brand_storage_quotas_note_len check (char_length(note) <= 500),
  constraint brand_storage_quotas_revision_pos check (revision >= 1)
);

create table if not exists brand_storage_quota_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  revision integer not null,
  previous_quota_bytes bigint,
  next_quota_bytes bigint,
  previous_retention_days integer,
  next_retention_days integer,
  used_bytes_snapshot bigint not null default 0,
  note text not null default '',
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_brand_storage_quota_events_org
  on brand_storage_quota_events (organization_id, created_at desc);
