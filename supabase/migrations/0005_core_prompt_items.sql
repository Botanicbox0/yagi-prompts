-- PLAYBOOK · M6 · core migration 0005
-- PLAN §13.1 — `prompt_items`, the v1.5 surface.
--
-- Deliberately NOT the revision machinery. Playbooks are living documents whose history is the
-- product, so they carry immutable revisions, a publish RPC and constraint triggers. A prompt is a
-- single field with a moderation workflow: edit-in-place with status flips is the honest model for
-- it, and pretending otherwise would buy nothing and cost a whole second publish pipeline.
--
-- What IS shared: the `visibility` enum (so `text_visibility` is gated by the same resolver and the
-- same tier comparison as blocks), the storage lifecycle (staging → content-addressed public copy)
-- and the deny-all RLS posture (0102_glue_prompts_rls.sql).

create table if not exists prompt_items (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  source text not null check (source in ('yagi','community')),
  author_id uuid references profiles,        -- community: submitter; yagi: null
  author_handle text,                        -- display credit (@handle)
  status text not null default 'pending' check (status in ('pending','published','rejected','archived')),
  model text not null default 'seedance-2.5',
  title text not null,                       -- EN or the submitter's language
  title_ko text,                             -- YAGI items: required at publish; community: optional
  prompt_text text not null,
  text_visibility visibility not null,       -- yagi default 'pro'; community always 'public'
  media jsonb,                               -- { video?: AssetRef, poster?: AssetRef } — zod at the boundary
  use_case text[] not null default '{}',
  featured boolean not null default false,
  reject_reason text,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),

  -- §13.3-1: "Community prompt text is always public (no paywalling other people's prompts)."
  -- A locked default in the DB rather than a rule in TypeScript: the moderation form cannot
  -- accidentally paywall a submission, whatever an admin posts.
  constraint prompt_items_community_text_public
    check (source <> 'community' or text_visibility = 'public'),

  -- A published row without a publication instant would break the NEW badge window, the gallery
  -- ordering and the sitemap's lastModified all at once.
  constraint prompt_items_published_at_present
    check (status <> 'published' or published_at is not null),

  -- §13.1 moderation: "admin ... rejects with reason". A rejection the submitter cannot read is
  -- not a rejection, it is a disappearance.
  constraint prompt_items_reject_reason_present
    check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> '')
);

-- ---------------------------------------------------------------------------
-- read-path indexes
-- ---------------------------------------------------------------------------

-- The gallery's one query: published rows, split by rail, newest first (§13.2).
create index if not exists idx_prompt_items_public
  on prompt_items (status, source, published_at desc);

-- "featured-first" inside the YAGI rail — a partial index, because `featured` is a handful of rows.
create index if not exists idx_prompt_items_featured
  on prompt_items (published_at desc) where featured;

-- The submission rate limit (§13.1: 3/day/user) and `/account`'s "your submissions" list.
create index if not exists idx_prompt_items_author
  on prompt_items (author_id, created_at desc);

-- The moderation queue.
create index if not exists idx_prompt_items_status
  on prompt_items (status, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at — the shared trigger from 0001, reused verbatim
-- ---------------------------------------------------------------------------
drop trigger if exists trg_prompt_items_updated_at on prompt_items;
create trigger trg_prompt_items_updated_at before update on prompt_items
  for each row execute function set_updated_at();
