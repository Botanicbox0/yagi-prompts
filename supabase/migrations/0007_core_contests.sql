-- PLAYBOOK · M9 · core migration 0007
-- PLAN §14.1 — `contests`, `contest_entries`, `contest_entry_writes`, `profiles.sns_url`.
--
-- Like `prompt_items` (0005) and unlike playbooks, a contest is an ATOMIC row with a status flip.
-- It carries no revisions, no manifest and no constraint triggers: a contest is edited by the
-- founder until it is published, and publishing is a single deliberate act rather than a pipeline.
-- What IS shared with the rest of the schema is everything that keeps the site honest — the
-- `is_localized_complete()` publish gate (§3.9), the `set_updated_at()` trigger, the staging →
-- content-addressed public copy for media, and deny-all RLS (0104_glue_contests_rls.sql).
--
-- Phase (upcoming / open / closed) is DERIVED, never stored: §14.1 says "phase is derived
-- server-side", and a stored phase would need a cron to stay true. `lib/contests/phase.ts` owns the
-- derivation, which is why this file adds no new SQL function at all (and therefore no new
-- `search_path` pin or anon/authenticated EXECUTE surface — the 0103 hardening lesson applies by
-- having nothing to harden).

-- ---------------------------------------------------------------------------
-- profiles.sns_url (§14.1) — "Google login stays extra-info-free until the first submission asks"
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists sns_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_sns_url_http') then
    alter table profiles
      add constraint profiles_sns_url_http
      check (sns_url is null or sns_url ~ '^https?://');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- contests
-- ---------------------------------------------------------------------------
create table if not exists contests (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  status text not null default 'draft' check (status in ('draft','published','archived')),

  -- §3.9 localized content: `{en, ko}`, gated at publish by is_localized_complete().
  title jsonb not null,
  summary jsonb not null,
  prize jsonb not null,            -- the money shot of the detail page (§14.2)
  rules jsonb,                     -- markdown {en,ko}; optional (a contest may be all prize)

  brand_name text not null,
  brand_url text,
  media jsonb,                     -- { poster?: AssetRef, video?: AssetRef } — zod at the boundary

  starts_at timestamptz,
  deadline_at timestamptz,

  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now(),

  -- A published contest is a public commitment with a clock on it. Without both instants the
  -- derived phase is undefined and the D-day chip has nothing to count to.
  constraint contests_published_requires_dates
    check (status <> 'published' or (starts_at is not null and deadline_at is not null)),

  -- §3.9 publish gate, reusing the SAME helper the playbook publish RPC uses. Rules are optional,
  -- but a rules block that exists in one language only is worse than none.
  constraint contests_published_requires_localized
    check (
      status <> 'published'
      or (
        is_localized_complete(title)
        and is_localized_complete(summary)
        and is_localized_complete(prize)
        and (rules is null or is_localized_complete(rules))
      )
    ),

  -- §14.2 — the card is poster-led. A published contest with no poster has no card.
  constraint contests_published_requires_poster
    check (status <> 'published' or coalesce(media ? 'poster', false)),

  -- Ordering, not just sanity: `deadline > starts` is what makes "open" a non-empty interval.
  constraint contests_deadline_after_start
    check (starts_at is null or deadline_at is null or deadline_at > starts_at),

  constraint contests_published_at_present
    check (status <> 'published' or published_at is not null),

  constraint contests_brand_name_present
    check (btrim(brand_name) <> ''),

  constraint contests_brand_url_http
    check (brand_url is null or brand_url ~ '^https?://')
);

-- The listing's one query: published rows, split by phase, soonest deadline first (§14.2).
create index if not exists idx_contests_listing on contests (status, deadline_at);
-- The admin list and the "just published" ordering.
create index if not exists idx_contests_published on contests (status, published_at desc);

drop trigger if exists trg_contests_updated_at on contests;
create trigger trg_contests_updated_at before update on contests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- contest_entries
-- ---------------------------------------------------------------------------
create table if not exists contest_entries (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references contests on delete cascade,
  author_id uuid not null references profiles on delete cascade,

  title text not null,
  -- §14.1: "film files are links, not uploads, in v1". No bytes, no transcode, no abuse surface.
  video_url text not null,
  note text,
  -- The whole point of the milestone: an entry is credited to a human with a public presence.
  sns_url text not null,

  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  placement int,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- §14.1: "unique (contest_id, author_id) — one entry per user; resubmit while open replaces".
  -- The uniqueness is what makes the submit path an UPSERT rather than an append.
  unique (contest_id, author_id),

  constraint contest_entries_title_len
    check (char_length(btrim(title)) between 1 and 200),
  constraint contest_entries_note_len
    check (note is null or char_length(note) <= 300),

  -- Format only. The DB cannot know whether a URL resolves; it can refuse `javascript:` forever.
  constraint contest_entries_video_url_http
    check (video_url ~ '^https?://'),
  constraint contest_entries_sns_url_http
    check (sns_url ~ '^https?://'),

  -- Same rule as prompt rejections: a rejection the entrant cannot read is a disappearance.
  constraint contest_entries_reject_reason_present
    check (status <> 'rejected' or coalesce(btrim(reject_reason), '') <> ''),

  constraint contest_entries_placement_range
    check (placement is null or placement in (1,2,3)),
  -- A placement is a public statement; only an approved entry can carry one.
  constraint contest_entries_placement_approved
    check (placement is null or status = 'approved')
);

-- One first place, one second, one third — per contest.
create unique index if not exists uq_contest_entries_placement
  on contest_entries (contest_id, placement) where placement is not null;

-- The public rail (approved, newest first) and the moderation queue read this.
create index if not exists idx_contest_entries_contest
  on contest_entries (contest_id, status, created_at desc);

-- "Your entries" on /account, and the author lookup the submit path makes before every write.
create index if not exists idx_contest_entries_author
  on contest_entries (author_id, created_at desc);

drop trigger if exists trg_contest_entries_updated_at on contest_entries;
create trigger trg_contest_entries_updated_at before update on contest_entries
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- contest_entry_writes — the §14.1 rate limit, spelled as what it actually is
-- ---------------------------------------------------------------------------
--
-- "Rate limit: ≤10 entry writes/day/user." A WRITE is the thing being limited, and an entry row
-- cannot count writes: the submit path is an upsert, so ten resubmits leave one row with one
-- `created_at`. Counting rows would silently turn the rule into "≤10 contests entered per day",
-- which is not the abuse vector (hammering the same form is).
--
-- So the ledger is append-only and one row per accepted write — the same shape as `stripe_events`,
-- and like `events` it ships with no GC in v1 (a row is ~60 bytes and the write path is rate
-- limited by construction).
create table if not exists contest_entry_writes (
  id bigint generated always as identity primary key,
  author_id uuid not null references profiles on delete cascade,
  contest_id uuid not null references contests on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_contest_entry_writes_author
  on contest_entry_writes (author_id, created_at desc);
