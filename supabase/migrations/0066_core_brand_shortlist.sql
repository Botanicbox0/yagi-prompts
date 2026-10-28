-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0066 — campaign creator shortlist (docs/BRAND-SHORTLIST.md)
--
-- Apply this file (and 0146) before relying on the shortlist. Without it the campaign page simply has
-- no shortlist tab (the loader treats the missing table as an empty list); nothing else changes.
--
--   brand_shortlist_candidates   creators the studio proposes for one brand campaign, with the public
--                                profile figures the brand compares them by. Rows arrive through the
--                                studio's import (admin file or the import worker) and stay hidden
--                                until the studio shares them (`shared_at`). The brand may mark a
--                                shared candidate as preferred (`picked_at`); booking stays a TWINGS
--                                decision.
--
-- What a row can hold is deliberately narrow: identity (handle, display name, category, avatar) and
-- the figures in `metrics`. The key check below makes it impossible to store anything else in that
-- object — no fee, rate card, internal note, penalty or source reference has a column or a key.

create table if not exists brand_shortlist_candidates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references brand_projects(id) on delete cascade,
  platform text not null default 'instagram',
  handle text not null,
  display_name text,
  category text,
  metrics jsonb not null default '{}'::jsonb,
  measured_on date,
  avatar_key text,
  avatar_mime text,
  avatar_size integer,
  avatar_sha256 text,
  shared_at timestamptz,
  picked_at timestamptz,
  picked_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_shortlist_platform check (platform in ('instagram')),
  constraint brand_shortlist_handle check (handle ~ '^[a-z0-9._]{1,30}$'),
  constraint brand_shortlist_display_name check (display_name is null or char_length(display_name) between 1 and 60),
  constraint brand_shortlist_category check (category is null or char_length(category) between 1 and 40),
  constraint brand_shortlist_metrics_keys check (
    jsonb_typeof(metrics) = 'object'
    and (metrics - array[
      'followers','following','posts',
      'feedPosts30d','feedEngagement','feedEngagementRate','feedLikes','feedComments',
      'adPosts30d','adShare','adEngagement','adEngagementRate','adLikes','adComments',
      'reelsPosts30d','reelsEngagement','reelsEngagementRate','reelsLikes','reelsComments',
      'viewsMedian90d','viewsMax90d'
    ]) = '{}'::jsonb
  ),
  constraint brand_shortlist_avatar_shape check (
    (avatar_key is null and avatar_mime is null and avatar_size is null and avatar_sha256 is null)
    or (avatar_key is not null and avatar_mime = 'image/webp' and avatar_size > 0 and avatar_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint brand_shortlist_pick_shape check (picked_at is not null or picked_by is null),
  unique (project_id, platform, handle)
);
create index if not exists idx_brand_shortlist_project on brand_shortlist_candidates (project_id, shared_at);
