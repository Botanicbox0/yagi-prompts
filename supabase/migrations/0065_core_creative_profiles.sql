-- CLOUD APPLICATION REQUIRED (with 0145) — TWINGS · core migration 0065 — AI creative profiles
-- (docs/PLATFORM-2.0.md §20, founder request 2026-10-28)
--
-- 0060 gave a template supplier a handle, a 200-character bio and an opt-in. A creative who sells
-- here needs to say who they are, where they work and how to reach them, and to show the work that
-- earns them a commission. Everything below is PUBLIC ONLY while `public_profile` is on (0060), and
-- each field is the creative's own choice — nothing is filled in for them.
--
--   platform_creators   + display_name, headline, country (ISO 3166-1 alpha-2), city, links (up to
--                       eight {kind,url} https links), public_email (null = not shown), tools (what
--                       they make with), open_to_brands (takes brand work), avatar_key (private
--                       renders bucket; served by /api/makers/media/…).
--   maker_works         the creative's representative works: up to twelve images or short films,
--                       each with an optional title, caption and link. Private bucket, served only
--                       while the profile is public.
--   recipe_unlocks      one row per (template, member) who opened a template's full recipe — the
--                       creative's "who opened my recipe" count, and the reason a recipe needs a
--                       signed-in reader at all.
--   maker_tokens        personal access tokens for the creative's own agent (TWINGS MCP,
--                       /api/mcp). Only a SHA-256 of the token is kept; the token is shown once.
--
-- Readers probe for these columns and tables (lib/makers/profile.ts), so code deployed before this
-- file keeps answering exactly as before.

alter table platform_creators
  add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  add column if not exists headline text check (headline is null or char_length(headline) between 1 and 80),
  add column if not exists country text check (country is null or country ~ '^[A-Z]{2}$'),
  add column if not exists city text check (city is null or char_length(city) between 1 and 40),
  add column if not exists links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 8),
  add column if not exists public_email text check (public_email is null or (char_length(public_email) <= 254 and public_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  add column if not exists tools text[] not null default '{}'::text[] check (cardinality(tools) <= 8),
  add column if not exists open_to_brands boolean not null default false,
  add column if not exists avatar_key text check (avatar_key is null or char_length(avatar_key) <= 120),
  add column if not exists profile_updated_at timestamptz;

create table if not exists maker_works (
  id text primary key check (id ~ '^wrk_[0-9a-f]{32}$'),
  user_id uuid not null references profiles on delete cascade,
  position integer not null default 0 check (position between 0 and 11),
  kind text not null check (kind in ('image','video')),
  storage_key text not null unique,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime')),
  bytes integer not null check (bytes > 0 and bytes <= 4194304),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  title text check (title is null or char_length(title) between 1 and 80),
  caption text check (caption is null or char_length(caption) between 1 and 280),
  link_url text check (link_url is null or (char_length(link_url) <= 500 and link_url ~ '^https://')),
  created_at timestamptz not null default now(),
  check ((kind = 'image') = (mime like 'image/%')),
  unique (user_id, sha256)
);
create index if not exists maker_works_user on maker_works (user_id, position, created_at);

create table if not exists recipe_unlocks (
  template_id uuid not null references prompt_items on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  opens integer not null default 1 check (opens > 0),
  primary key (template_id, user_id)
);
create index if not exists recipe_unlocks_template on recipe_unlocks (template_id, first_at);

create table if not exists maker_tokens (
  id uuid primary key,
  user_id uuid not null references profiles on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix text not null check (prefix ~ '^twk_[0-9a-z]{6}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists maker_tokens_user on maker_tokens (user_id, created_at);
