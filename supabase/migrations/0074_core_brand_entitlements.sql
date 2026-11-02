-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0074 — brand feature policies and plan assignments (docs/BRAND-PRODUCT.md)
--
-- Apply this file (and 0150) BEFORE deploying the brand entitlement code: the workspace loaders
-- tolerate a missing table (every brand keeps every feature, no plan is shown), but the brand render
-- reservation does not, so a brand render would fail with "unavailable" until the tables exist.
--
--   brand_feature_policies       one row per organization that is an EXCEPTION. No row = every
--                                feature open (founder, 2026-11-03: open to all by default, exceptions
--                                are a deny-list). `denied_features` names product capability groups
--                                (lib/brands/features.ts), never engines or routes, so a new screen in
--                                a group is covered the day it ships.
--   brand_feature_policy_events  append-only history of every policy save (who, what, when).
--   brand_plan_assignments       the organization's B2B plan (390,000 / 690,000 / 990,000 KRW per
--                                month, founder 2026-11-03), invoiced or card-billed. A record, not a
--                                payment: the studio sells and invoices the plan; the row makes it
--                                visible to the product and the admin console.
--   brand_plan_events            append-only history of plan changes.

create table if not exists brand_feature_policies (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  denied_features text[] not null default '{}'::text[],
  note text not null default '',
  revision integer not null default 1,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_feature_policies_known check (
    denied_features <@ array['generative_media','sound','color_grading','brand_learning','campaigns','creator_pool','agent_access']::text[]
  ),
  constraint brand_feature_policies_note check (char_length(note) <= 500),
  constraint brand_feature_policies_revision check (revision >= 1)
);

create table if not exists brand_feature_policy_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  denied_features text[] not null,
  note text not null default '',
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_brand_feature_policy_events_org on brand_feature_policy_events (organization_id, created_at);

create table if not exists brand_plan_assignments (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  plan_id text not null,
  billing_mode text not null default 'invoice',
  started_on date not null,
  ends_on date,
  seats integer,
  note text not null default '',
  revision integer not null default 1,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_plan_assignments_plan check (plan_id in ('b2b_39','b2b_69','b2b_99')),
  constraint brand_plan_assignments_billing check (billing_mode in ('invoice','card')),
  constraint brand_plan_assignments_period check (ends_on is null or ends_on > started_on),
  constraint brand_plan_assignments_seats check (seats is null or seats between 1 and 1000),
  constraint brand_plan_assignments_note check (char_length(note) <= 500),
  constraint brand_plan_assignments_revision check (revision >= 1)
);

create table if not exists brand_plan_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  plan_id text not null,
  billing_mode text not null,
  started_on date not null,
  ends_on date,
  seats integer,
  note text not null default '',
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_brand_plan_events_org on brand_plan_events (organization_id, created_at);
