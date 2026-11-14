-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0087 — studio pro suite v5:
--   1. brand_studio_assets shot-sheet cache lifecycle (14-day sliding TTL + project completion purge)
--   2. brand_studio_video_projects (server-persisted sequence timeline, take stacks, lazy create)
--   3. brand_studio_workflows & brand_studio_playbooks (org custom workflows, character sheet, team knowledge)
--   4. brand_studio_mcp_tokens (SHA-256 hashed member tokens for Claude / Claude Code / ChatGPT / Gemini / Cursor / Codex MCP)

alter table brand_studio_assets
  add column if not exists film_sheets_updated_at timestamptz,
  add column if not exists film_sheets_expires_at timestamptz;

create index if not exists idx_brand_studio_assets_film_sheets_exp
  on brand_studio_assets (film_sheets_expires_at)
  where film_sheets is not null;

create table if not exists brand_studio_video_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  title text not null,
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  aspect text not null default '9:16' check (aspect in ('9:16', '4:5', '1:1', '16:9')),
  timeline jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references profiles(id) on delete set null,
  request_id text not null,
  completed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_studio_video_projects_title check (char_length(title) between 1 and 120 and btrim(title) = title),
  constraint brand_studio_video_projects_req_key unique (organization_id, request_id)
);

create index if not exists idx_brand_studio_video_projects_org
  on brand_studio_video_projects (organization_id, updated_at desc)
  where deleted_at is null;

create table if not exists brand_studio_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  slug text not null,
  title text not null,
  summary text not null default '',
  category text not null default 'custom' check (category in ('character', 'product', 'video', 'campaign', 'custom')),
  recipe jsonb not null default '{}'::jsonb,
  source text not null default 'web' check (source in ('starter', 'saved_run', 'ai_builder', 'mcp', 'web')),
  revision integer not null default 1 check (revision >= 1),
  created_by uuid references profiles(id) on delete set null,
  request_id text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_studio_workflows_title check (char_length(title) between 1 and 120 and btrim(title) = title),
  constraint brand_studio_workflows_req_key unique (organization_id, request_id)
);

create index if not exists idx_brand_studio_workflows_org
  on brand_studio_workflows (organization_id, updated_at desc)
  where deleted_at is null;

create table if not exists brand_studio_playbooks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  title text not null,
  body_md text not null default '',
  tags text[] not null default '{}'::text[],
  inject_director boolean not null default false,
  status text not null default 'published' check (status in ('draft', 'published')),
  created_by uuid references profiles(id) on delete set null,
  request_id text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_studio_playbooks_title check (char_length(title) between 1 and 120 and btrim(title) = title),
  constraint brand_studio_playbooks_req_key unique (organization_id, request_id)
);

create index if not exists idx_brand_studio_playbooks_org
  on brand_studio_playbooks (organization_id, updated_at desc)
  where deleted_at is null;

create table if not exists brand_studio_mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  client_id text not null default 'claude' check (char_length(client_id) between 1 and 40),
  label text not null,
  token_prefix text not null,
  token_hash text not null unique,
  oauth_code_jti text unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint brand_studio_mcp_tokens_label check (char_length(label) between 1 and 80 and btrim(label) = label)
);

create index if not exists idx_brand_studio_mcp_tokens_org_user
  on brand_studio_mcp_tokens (organization_id, user_id, created_at desc)
  where revoked_at is null;
