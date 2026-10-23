-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0059 — maker recipe v2 (docs/PLATFORM-2.0.md §7.3, §18 R1, 2026-10-23)
--
-- A maker's template is a recipe of steps and slots instead of one prompt string:
--
--   prompt_items.recipe        jsonb, server only. NULL for every studio original — those keep the
--                              single `prompt_text` path unchanged. Never selected by the public
--                              catalogue (lib/prompts/repo.ts COLUMNS is an explicit list).
--   prompt_items.disclosure    what the maker chose to show on the template page:
--                              {"prompts":bool,"assets":bool}, both false by default.
--   prompt_items.presentation  'make-first' (example → make → how) or 'story-first'.
--
--   platform_formats           + 'draft' status (the editor saves before it uploads or test-renders),
--                              recipe_v2 (the structured recipe; the older `recipe` text column stays
--                              for v1 submissions), title_ko, disclosure, presentation, the maker's
--                              requested royalty (500~5,000원) and the test renders spent (max 3).
--   platform_format_assets     the maker's private reference files (and an uploaded example), in
--                              the private renders bucket. Keyed `ast_<32 hex>`, the recipe's handle.
--   render_job_recipes         the recipe a job actually ran (snapshot) and its step state, so a
--                              retry resumes after the finished steps and a studio edit never
--                              changes a render in flight. Also marks test and review renders.
--   render_job_outputs         every result of a recipe job (a carousel has up to six); the first
--                              stays in render_jobs.result_key so the one-result pages keep working.
--
-- Readers probe for these columns and tables, so code deployed before this file still answers
-- exactly as before (no recipe = the old path).

alter table prompt_items
  add column if not exists recipe jsonb check (recipe is null or (jsonb_typeof(recipe) = 'object' and recipe->>'version' = '2')),
  add column if not exists disclosure jsonb not null default '{"prompts":false,"assets":false}'::jsonb
    check (jsonb_typeof(disclosure) = 'object' and jsonb_typeof(disclosure->'prompts') = 'boolean' and jsonb_typeof(disclosure->'assets') = 'boolean'),
  add column if not exists presentation text not null default 'make-first' check (presentation in ('make-first','story-first'));

alter table platform_formats drop constraint if exists platform_formats_status_check;
alter table platform_formats add constraint platform_formats_status_check check (status in ('draft','submitted','accepted','rejected'));
alter table platform_formats alter column example_url drop not null;
alter table platform_formats
  add column if not exists recipe_v2 jsonb check (recipe_v2 is null or (jsonb_typeof(recipe_v2) = 'object' and recipe_v2->>'version' = '2')),
  add column if not exists title_ko text check (title_ko is null or length(title_ko) between 1 and 120),
  add column if not exists disclosure jsonb not null default '{"prompts":false,"assets":false}'::jsonb
    check (jsonb_typeof(disclosure) = 'object' and jsonb_typeof(disclosure->'prompts') = 'boolean' and jsonb_typeof(disclosure->'assets') = 'boolean'),
  add column if not exists presentation text not null default 'make-first' check (presentation in ('make-first','story-first')),
  add column if not exists royalty_krw integer check (royalty_krw is null or royalty_krw between 500 and 5000),
  add column if not exists test_renders_used integer not null default 0 check (test_renders_used between 0 and 3),
  add column if not exists updated_at timestamptz not null default now();
-- Anything past a draft names how it is shown: a link to the maker's post or an uploaded example (checked in code).
alter table platform_formats add constraint platform_formats_v2_complete
  check (status = 'draft' or recipe_v2 is null or royalty_krw is not null);

create table if not exists platform_format_assets (
  id text primary key check (id ~ '^ast_[0-9a-f]{32}$'),
  format_id uuid not null references platform_formats on delete cascade,
  user_id uuid not null references profiles on delete cascade,
  role text not null default 'reference' check (role in ('reference','example')),
  kind text not null check (kind in ('image','video')),
  storage_key text not null unique,
  mime text not null check (mime in ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime')),
  bytes integer not null check (bytes > 0 and bytes <= 4194304),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check ((kind = 'image') = (mime like 'image/%')),
  unique (format_id, role, sha256)
);
create index if not exists platform_format_assets_format on platform_format_assets (format_id, created_at);

create table if not exists render_job_recipes (
  render_id uuid primary key references render_jobs on delete cascade,
  purpose text not null default 'customer' check (purpose in ('customer','maker_test','studio_review')),
  format_id uuid references platform_formats on delete cascade,
  recipe jsonb not null check (jsonb_typeof(recipe) = 'object' and recipe->>'version' = '2'),
  -- {"steps":{"<id>":{"key":…,"mime":…,"usd":…}}}; server-written only.
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  check ((purpose = 'customer') = (format_id is null))
);
create index if not exists render_job_recipes_format on render_job_recipes (format_id) where format_id is not null;

create table if not exists render_job_outputs (
  render_id uuid not null references render_jobs on delete cascade,
  position integer not null check (position between 0 and 5),
  step_id text not null check (step_id ~ '^[a-z][a-z0-9_]{0,23}$'),
  storage_key text not null,
  mime text not null,
  bytes integer not null check (bytes > 0),
  created_at timestamptz not null default now(),
  primary key (render_id, position)
);

-- The legacy prompt editor must never make an accepted supplier recipe public or reassign it (0046),
-- and now must not swap, clear or disclose the maker's recipe either: the maker chose what is shown.
create or replace function platform_private_format() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
 if exists(select 1 from platform_formats f where f.template_id=new.id and
   (new.text_visibility::text<>'hidden' or new.source::text<>'yagi' or new.author_id is distinct from f.user_id
    or new.recipe is distinct from old.recipe or new.disclosure is distinct from old.disclosure)) then
  raise exception 'platform private format contract';
 end if;
 return new;
end $$;
