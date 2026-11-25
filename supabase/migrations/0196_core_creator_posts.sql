-- 클라우드 적용 필요 — TWINGS · core migration 0196 — AI creative blog posts
--
-- Additive schema for maker blog posts and the post↔template reverse index used to surface
-- "이 템플릿 이야기" on template pages. Safe to run multiple times (`if not exists`); alters no
-- existing table and defines no SQL function or policy.

create table if not exists creator_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references platform_creators(user_id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 80),
  title text not null check (char_length(title) between 3 and 120),
  summary text check (summary is null or char_length(summary) <= 200),
  cover_work_id text references maker_works(id) on delete set null,
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 60),
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 2000),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index if not exists idx_creator_posts_user_updated on creator_posts (user_id, updated_at desc);
create index if not exists idx_creator_posts_status_published on creator_posts (status, published_at desc, updated_at desc);

create table if not exists creator_post_templates (
  post_id uuid not null references creator_posts(id) on delete cascade,
  template_id uuid not null references prompt_items(id) on delete cascade,
  primary key (post_id, template_id)
);

create index if not exists idx_creator_post_templates_template on creator_post_templates (template_id, post_id);
