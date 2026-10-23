-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0057 — influencer SNS accounts (docs/PLATFORM-2.0.md §17.1, 2026-10-23)
--
-- Apply this file and 0141_glue_social_accounts.sql BEFORE switching TWINGS_INFLUENCERS on. With the
-- flag off nothing reads them; the code that does (the /identity/social page, the admin queue, the
-- worker routes and the campaign visibility rule) answers "unavailable" when the tables are missing.
-- Needs 0056 (campaigns.audience, campaign_targets) for the visibility rule.
--
-- Founder decision (2026-10-23, §13-4·5): influencer status starts MANUAL. A member links a profile
-- and uploads one screenshot of the follower count; the workstation's local vision model may
-- SUGGEST the number (ai_*); an administrator types the number that counts. One account of
-- 3,000+ followers is enough (not a sum).
--
--   social_accounts          one row per member and platform. `follower_count`/`measured_at` are
--                            what an administrator confirmed; `claimed_count` is what the member
--                            typed; `ai_*` is the model's suggestion and never decides anything.
--                            `status`: submitted → verified | rejected. `expired` is reserved for a
--                            later re-measurement job; a verified row older than 90 days is SHOWN as
--                            expired (re-submit, please) but keeps counting. A verified member who
--                            re-submits keeps `verified` and gets `recheck_at` until it is looked at.
--                            The ai_state/lease columns are the local worker's queue (the
--                            campaign-risk shape, without a separate jobs table).
--   social_account_writes    one row per submission: the five-a-day limit survives an unlink.
--   social_verify_workers    the local worker's heartbeat (which model, last seen).
--   profiles.influencer_since the first time any of the member's accounts was verified at 3,000+.

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','youtube')),
  handle text not null check (length(handle) between 1 and 60),
  profile_url text not null check (length(profile_url) between 12 and 300 and profile_url like 'https://%'),
  claimed_count integer check (claimed_count is null or claimed_count between 0 and 1000000000),
  follower_count integer check (follower_count is null or follower_count between 0 and 1000000000),
  evidence_key text check (evidence_key is null or length(evidence_key) <= 200),
  status text not null default 'submitted' check (status in ('submitted','verified','rejected','expired')),
  source text not null default 'manual' check (source in ('manual','api')),
  ai_count integer check (ai_count is null or ai_count between 0 and 1000000000),
  ai_confidence numeric(4,3) check (ai_confidence is null or ai_confidence between 0 and 1),
  ai_model text check (ai_model is null or length(ai_model) <= 120),
  ai_note text check (ai_note is null or length(ai_note) <= 200),
  ai_state text not null default 'queued' check (ai_state in ('queued','leased','done','failed')),
  ai_attempts integer not null default 0 check (ai_attempts between 0 and 20),
  ai_available_at timestamptz not null default now(),
  ai_lease_token uuid,
  ai_lease_until timestamptz,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  measured_at timestamptz,
  recheck_at timestamptz,
  note text check (note is null or length(note) <= 500),
  pool_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform),
  -- A verified row always carries the number an administrator confirmed and when.
  check (status <> 'verified' or (follower_count is not null and measured_at is not null)),
  -- A rejection always carries the reason the member is shown.
  check (status <> 'rejected' or note is not null)
);

-- The admin queue and the worker both ask "what is waiting", oldest first.
create index if not exists social_accounts_waiting
  on social_accounts (created_at) where status = 'submitted' or recheck_at is not null;
-- isInfluencer(): the member's verified accounts.
create index if not exists social_accounts_verified_by_user
  on social_accounts (user_id) where status = 'verified';

create table if not exists social_account_writes (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('instagram','tiktok','youtube')),
  created_at timestamptz not null default now()
);
create index if not exists social_account_writes_by_user on social_account_writes (user_id, created_at);

create table if not exists social_verify_workers (
  id text primary key check (id ~ '^[A-Za-z0-9_.-]{1,80}$'),
  model_id text not null check (length(model_id) between 1 and 120),
  last_seen_at timestamptz not null default now()
);

alter table profiles add column if not exists influencer_since timestamptz;
