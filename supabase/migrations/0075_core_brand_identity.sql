-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0075 — brand identity layer, memory events, and looks (docs/BRAND-PRODUCT.md §5)
--
-- Apply this file (and 0151) BEFORE deploying the brand identity layer code.
--
--   brand_identities         one row per organization: the fixed brand identity JSONB (colour, type,
--                            world, modelRoles, rules, references, productChecklist, voice). Only a row
--                            with `status = 'confirmed'` may be read by the generation/finishing engines.
--   brand_identity_events    append-only history of every identity draft save or confirmation.
--   brand_memory_events      append-only operational memory (approved_cut, fix, banned_phrase,
--                            saved_look, note) accumulated across work without polluting the prompt.
--   brand_looks              deterministic colour-grade looks (LUT key + YRGB/HSL measurements,
--                            intensity 0..1, skin protection flag) for the brand.

create table if not exists brand_identities (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  version text not null default '2026-11-03',
  identity jsonb not null,
  status text not null default 'draft',
  revision integer not null default 1,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_identities_version check (char_length(btrim(version)) between 1 and 40),
  constraint brand_identities_status check (status in ('draft','confirmed')),
  constraint brand_identities_revision check (revision >= 1),
  constraint brand_identities_object check (jsonb_typeof(identity) = 'object')
);

create table if not exists brand_identity_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  status text not null,
  revision integer not null,
  identity jsonb not null,
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_identity_events_status check (status in ('draft','confirmed')),
  constraint brand_identity_events_revision check (revision >= 1),
  constraint brand_identity_events_object check (jsonb_typeof(identity) = 'object')
);
create index if not exists idx_brand_identity_events_org on brand_identity_events (organization_id, created_at);

create table if not exists brand_memory_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_memory_events_kind check (
    kind in ('approved_cut','fix','banned_phrase','saved_look','note')
  ),
  constraint brand_memory_events_payload check (jsonb_typeof(payload) = 'object')
);
create index if not exists idx_brand_memory_events_org on brand_memory_events (organization_id, created_at);

create table if not exists brand_looks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  title text not null,
  lut_key text,
  measurements jsonb not null default '{}'::jsonb,
  intensity numeric(4,3) not null default 1.000,
  skin_protect boolean not null default true,
  source text not null default 'preset',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_looks_title check (char_length(btrim(title)) between 1 and 120),
  constraint brand_looks_intensity check (intensity between 0 and 1),
  constraint brand_looks_source check (source in ('preset','reference_match')),
  constraint brand_looks_measurements check (jsonb_typeof(measurements) = 'object')
);
create index if not exists idx_brand_looks_org on brand_looks (organization_id, created_at);
