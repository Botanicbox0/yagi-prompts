-- PLAYBOOK · core migration 0019 — the real-person identity (docs/TEMPLATES-IA.md §8.2, 2026-09-10)
--
-- ModelArk refuses a reference image that "may contain a real person" (production, 2026-09-09:
-- "The request failed because the input image 'content[1]' may contain real person"). BytePlus's
-- one sanctioned door for a person's own face is the real-human asset library: the person passes
-- a liveness check on BytePlus's H5 page once (→ an asset GROUP, one per person), each photo they
-- want to render is registered as an ASSET in that group (the bank compares it with the verified
-- face), and the film task references `asset://{id}` instead of bytes.
--
-- These two tables are OUR ledger of that: which of our users holds which group, which photo
-- (by content hash) became which asset, and when each was last used — the disuse signal the slot
-- reclaim (lib/ark/reclaim.ts) plans from, since the bank's own last-inference time is unreliable.

create table if not exists identity_groups (
  user_id uuid primary key references profiles on delete cascade,
  -- The bank's LivenessFace group id; null until the liveness result has been read.
  group_id text unique,
  status text not null default 'pending'
    check (status in ('pending','active','failed','revoked')),
  -- The open liveness session: the token the callback carries, the H5 page to reopen, where to
  -- send the person afterwards. Cleared once the session is consumed.
  byted_token text unique,
  h5_link text,
  next_path text,
  session_started_at timestamptz,
  verified_at timestamptz,
  last_render_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_groups_active_complete
    check (status <> 'active' or (group_id is not null and verified_at is not null)),
  constraint identity_groups_next_path_relative
    check (next_path is null or next_path like '/%')
);

drop trigger if exists trg_identity_groups_updated_at on identity_groups;
create trigger trg_identity_groups_updated_at before update on identity_groups
  for each row execute function set_updated_at();

create table if not exists identity_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  group_id text not null,
  -- The bank's asset id, referenced as `asset://{asset_id}` in a render request.
  asset_id text unique not null,
  -- sha256 of the photo bytes: the same photo is registered once, not once per render.
  photo_sha256 text not null,
  status text not null default 'Processing'
    check (status in ('Processing','Active','Failed')),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, photo_sha256)
);

create index if not exists identity_assets_user_idx on identity_assets (user_id, created_at desc);
create index if not exists identity_assets_status_idx on identity_assets (status);

drop trigger if exists trg_identity_assets_updated_at on identity_assets;
create trigger trg_identity_assets_updated_at before update on identity_assets
  for each row execute function set_updated_at();
