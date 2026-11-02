-- PLAYBOOK · core migration 0013 — campaigns (docs/CAMPAIGNS.md, 2026-09-03)
--
-- Founder direction: "정해진 영상 포맷을 우리가 만들어놓으면 크리에이터들이 지원하고, 포스팅하고
-- 링크를 올리면 수익을 가져간다. 수익은 7일 후." A campaign is the PAID cousin of a contest: a fixed
-- number of selected creators each make the same format (a studio style), post it, submit the
-- link, and are paid after a hold. The vocabulary that is the same (host kinds, localized {en,ko},
-- poster media, slugs) is spelled the same; everything about money, slots and the hold is new.
--
-- Money is INTEGER minor units (원). The payout rule and the requirements are jsonb because their
-- shape is zod's job at the boundary (lib/campaigns/schemas.ts); what SQL owns is the part a bad
-- write could make unrenderable or unfair — statuses, dates in order, one application per creator,
-- and that nobody is marked paid without an amount.

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  status text not null default 'draft'
    check (status in ('draft','recruiting','selecting','running','closed','archived')),
  -- §3.9 localized content: `{en, ko}`, gated when the campaign starts recruiting.
  title jsonb not null,
  summary jsonb not null,
  brief jsonb,                       -- markdown {en,ko}; optional
  host_name text not null,
  host_kind text not null default 'brand'
    check (host_kind in ('brand','platform','studio','creator','community')),
  host_url text,
  media jsonb,                       -- { poster?: AssetRef } — same copier as contests
  -- The FORMAT: the studio style (a published prompt's slug) the creators reproduce. Nullable so a
  -- brief-only campaign is possible; when set, the detail page shows that style's example film.
  style_slug text,
  platforms text[] not null default '{}',
  deliverable text not null default 'reel'
    check (deliverable in ('reel','feed','story','short','video')),
  slots int not null default 10 check (slots between 1 and 500),
  applications_close_at timestamptz,
  post_deadline_at timestamptz,
  -- docs/CAMPAIGNS.md §4: { model, flatCents, perThousandViewsCents, minCents, maxCents, currency, holdDays }
  payout jsonb,
  -- { hashtags[], mentions[], disclosure } — 표시·광고법: a paid post says so.
  requirements jsonb not null default '{"hashtags":[],"mentions":[],"disclosure":true}'::jsonb,
  -- The client's budget, internal only (never rendered publicly).
  budget_cents bigint check (budget_cents is null or budget_cents >= 0),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  -- A recruiting campaign is a public commitment with two clocks and a price.
  constraint campaigns_public_requires_dates
    check (status in ('draft','archived')
           or (applications_close_at is not null and post_deadline_at is not null)),
  constraint campaigns_public_requires_payout
    check (status in ('draft','archived') or jsonb_typeof(payout) = 'object'),
  constraint campaigns_public_requires_localized
    check (
      status in ('draft','archived')
      or (
        is_localized_complete(title)
        and is_localized_complete(summary)
        and (brief is null or is_localized_complete(brief))
      )
    ),
  constraint campaigns_public_requires_poster
    check (
      status in ('draft','archived')
      or coalesce(
           jsonb_typeof(media -> 'poster') = 'object'
           and coalesce(btrim(media -> 'poster' ->> 'published_key'), '') <> ''
           and media -> 'poster' ->> 'bucket' = 'public-content',
           false
         )
    ),
  constraint campaigns_post_after_applications
    check (applications_close_at is null or post_deadline_at is null
           or post_deadline_at > applications_close_at),
  constraint campaigns_published_at_present
    check (status in ('draft','archived') or published_at is not null),
  constraint campaigns_host_name_present
    check (btrim(host_name) <> ''),
  constraint campaigns_host_url_http
    check (host_url is null or host_url ~ '^https?://'),
  constraint campaigns_platforms_known
    check (platforms <@ array['instagram','tiktok','youtube']::text[])
);

create index if not exists idx_campaigns_listing on campaigns (status, applications_close_at);
create index if not exists idx_campaigns_published on campaigns (status, published_at desc);

drop trigger if exists trg_campaigns_updated_at on campaigns;
create trigger trg_campaigns_updated_at before update on campaigns
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- applications — one per creator per campaign, walked through the state machine
-- ---------------------------------------------------------------------------

create table if not exists campaign_applications (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns on delete cascade,
  creator_id uuid not null references profiles on delete cascade,
  status text not null default 'applied'
    check (status in ('applied','selected','declined','withdrawn','posted','verified','rejected','paid','expired')),
  pitch text not null,
  sns_url text not null,
  follower_count int not null default 0 check (follower_count >= 0),
  selected_at timestamptz,
  -- The post. Links, not uploads (the same v1 rule as contest entries).
  post_url text,
  post_platform text check (post_platform is null or post_platform in ('instagram','tiktok','youtube')),
  posted_at timestamptz,
  -- Review and the hold.
  verified_at timestamptz,
  hold_until timestamptz,
  -- The seven-day snapshot that prices a view-based payout. v1: self-reported, admin-confirmed.
  views_snapshot bigint check (views_snapshot is null or views_snapshot >= 0),
  metrics_source text check (metrics_source is null or metrics_source in ('self','admin','api')),
  -- The settlement.
  payout_cents bigint check (payout_cents is null or payout_cents >= 0),
  paid_at timestamptz,
  payout_ref text,
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, creator_id),
  constraint campaign_applications_pitch_len
    check (char_length(btrim(pitch)) between 1 and 400),
  constraint campaign_applications_sns_url_http
    check (sns_url ~ '^https?://'),
  constraint campaign_applications_post_url_http
    check (post_url is null or post_url ~ '^https?://'),
  -- A posted, verified or paid row carries its link; a paid row carries an amount and a time.
  constraint campaign_applications_post_present
    check (status not in ('posted','verified','paid') or post_url is not null),
  constraint campaign_applications_verified_has_hold
    check (status not in ('verified','paid') or (verified_at is not null and hold_until is not null)),
  constraint campaign_applications_paid_complete
    check (status <> 'paid' or (paid_at is not null and payout_cents is not null)),
  -- A rejection the creator cannot read is a disappearance (same rule as prompts and entries).
  constraint campaign_applications_reject_reason_present
    check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> '')
);

create index if not exists idx_campaign_applications_campaign
  on campaign_applications (campaign_id, status, created_at desc);
create index if not exists idx_campaign_applications_creator
  on campaign_applications (creator_id, created_at desc);
-- The payout queue: verified rows whose hold has ended, oldest first.
create index if not exists idx_campaign_applications_hold
  on campaign_applications (hold_until) where status = 'verified';

drop trigger if exists trg_campaign_applications_updated_at on campaign_applications;
create trigger trg_campaign_applications_updated_at before update on campaign_applications
  for each row execute function set_updated_at();

-- Abuse ledger for the apply/post forms — the same shape as contest_entry_writes.
create table if not exists campaign_application_writes (
  id bigint generated always as identity primary key,
  creator_id uuid not null references profiles on delete cascade,
  campaign_id uuid not null references campaigns on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_campaign_application_writes_creator
  on campaign_application_writes (creator_id, created_at desc);
