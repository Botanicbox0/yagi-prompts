-- 클라우드 적용 필요 — TWINGS · core migration 0196 — the home's news slot (docs/BRAND-PROJECT-SPINE.md §6, slice 3b)
--
-- One announcement at a time on the brand workspace's 직접 만들기 home, written by the founder from the admin console
-- (`brandNews.save` / `brandNews.publish` / `brandNews.end`, lib/admin/brand-news-operations.ts) and closed by each
-- person for themselves.
--
--   brand_announcements            one row per announcement: the words in both languages, one link, the shape
--                                  (a line, or a banner with one picture), the period, who may see it (`audience`)
--                                  and its state (draft -> live -> ended). At most one live row per slot.
--   brand_announcement_dismissals  one row per (announcement, person) who closed it. Closing is for good.
--
-- Every rule the design fixes is a table check here, so a row written by hand cannot break the home either. The
-- link rule and the audience keys are judged precisely by the server (lib/brand-news/contracts.ts); the checks below
-- are their backstop (no scheme but https://, no host outside twings.app, no space, control character or backslash).
--
-- Safe to deploy the code first: the server looks for both tables (lib/brand-news/service.ts, `brandNewsTablesReady`)
-- and answers "no announcement" until they exist, whatever `BRAND_NEWS` says. Nothing existing is altered.
-- Both tables are born with row level security on and forced (end of this file); apply glue 0197 right after it in the
-- same session (it revokes the browser roles and grants the server role exactly what the code does).
-- Re-runnable: every statement is guarded or idempotent.

create table if not exists brand_announcements (
  id uuid primary key default gen_random_uuid(),
  slot text not null default 'home',
  kicker_ko text not null default '',
  kicker_en text not null default '',
  title_ko text not null default '',
  title_en text not null default '',
  cta_label_ko text not null default '',
  cta_label_en text not null default '',
  cta_href text not null default '',
  shape text not null default 'line',
  image_key text,
  image_w integer,
  image_h integer,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  audience jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  ended_at timestamptz,
  constraint brand_announcements_slot check (slot in ('home')),
  constraint brand_announcements_shape check (shape in ('line', 'banner')),
  constraint brand_announcements_status check (status in ('draft', 'live', 'ended')),
  -- The words: trimmed, one line each (no control character, no Unicode line or paragraph separator), at most
  -- 12 / 60 / 12 characters per language. Empty means "not written": an empty kicker or button label is the screen's
  -- default, an empty title cannot go live (below).
  constraint brand_announcements_kicker check (
    kicker_ko = btrim(kicker_ko) and kicker_en = btrim(kicker_en)
    and char_length(kicker_ko) <= 12 and char_length(kicker_en) <= 12
    and kicker_ko !~ '[[:cntrl:]\u2028\u2029]' and kicker_en !~ '[[:cntrl:]\u2028\u2029]'
  ),
  constraint brand_announcements_title check (
    title_ko = btrim(title_ko) and title_en = btrim(title_en)
    and char_length(title_ko) <= 60 and char_length(title_en) <= 60
    and title_ko !~ '[[:cntrl:]\u2028\u2029]' and title_en !~ '[[:cntrl:]\u2028\u2029]'
  ),
  constraint brand_announcements_cta_label check (
    cta_label_ko = btrim(cta_label_ko) and cta_label_en = btrim(cta_label_en)
    and char_length(cta_label_ko) <= 12 and char_length(cta_label_en) <= 12
    and cta_label_ko !~ '[[:cntrl:]\u2028\u2029]' and cta_label_en !~ '[[:cntrl:]\u2028\u2029]'
  ),
  -- The link: printable ASCII only (no space, no control character), no backslash, at most 500 characters, and
  -- either an internal path under /brand/ without '//' or an https address on twings.app or one of its subdomains
  -- (lower case, no user, no port). Empty while a draft has none.
  constraint brand_announcements_cta_href check (
    char_length(cta_href) <= 500
    and cta_href ~ '^[!-~]*$'
    and position(chr(92) in cta_href) = 0
    and (
      cta_href = ''
      or (left(cta_href, 7) = '/brand/' and position('//' in cta_href) = 0)
      or cta_href ~ '^https://([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*twings\.app([/?#].*)?$'
    )
  ),
  -- A banner's picture: all three fields or none, only on a banner, and the design's size (1600×400). The object is
  -- content-addressed in the public bucket like landing media (0067): `public-content/{sha256}.webp`. Every field is
  -- tested for null explicitly: a check that evaluates to null passes, so "one field missing" must be false, not null.
  constraint brand_announcements_image check (
    (image_key is null and image_w is null and image_h is null)
    or (
      shape = 'banner' and image_key is not null and image_w is not null and image_h is not null
      and image_key ~ '^[0-9a-f]{64}\.webp$' and image_w = 1600 and image_h = 400
    )
  ),
  -- Both ends required (not null above), the start before the end, at most 60 days apart, counted in hours so the
  -- rule does not depend on the session's time zone (the server counts 60 × 24 hours too).
  constraint brand_announcements_period check (starts_at < ends_at and ends_at <= starts_at + interval '1440 hours'),
  constraint brand_announcements_audience check (jsonb_typeof(audience) = 'object'),
  -- The lifecycle's footprints: a draft was never published, a live row was published and not ended, an ended row
  -- was published and then ended. Ended is final (a new draft is the way back).
  constraint brand_announcements_lifecycle check (
    (status = 'draft' and published_at is null and ended_at is null)
    or (status = 'live' and published_at is not null and ended_at is null)
    or (status = 'ended' and published_at is not null and ended_at is not null)
  ),
  -- What publishing requires, as a rule of the table: both titles, a link, and a banner's picture.
  constraint brand_announcements_publishable check (
    status = 'draft'
    or (title_ko <> '' and title_en <> '' and cta_href <> '' and (shape = 'line' or image_key is not null))
  )
);

-- At most one live announcement per slot. `brandNews.publish` ends the previous one in the same transaction; this
-- index is the backstop when two publishes race (the loser is refused, never a second live row).
create unique index if not exists brand_announcements_one_live on brand_announcements (slot) where status = 'live';
-- The admin list, newest first.
create index if not exists idx_brand_announcements_created on brand_announcements (created_at desc);

create table if not exists brand_announcement_dismissals (
  announcement_id uuid not null references brand_announcements(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- A person's dismissals go with their profile (account deletion cascades through this index).
create index if not exists idx_brand_announcement_dismissals_user on brand_announcement_dismissals (user_id);

-- Closed from the moment they exist, before glue 0197 lands: no browser role may read or write either table even if
-- the glue is applied later in the session (0178's shape). 0197 then sets the server role's exact grants.
alter table brand_announcements enable row level security;
alter table brand_announcements force row level security;
revoke all on brand_announcements from public;
alter table brand_announcement_dismissals enable row level security;
alter table brand_announcement_dismissals force row level security;
revoke all on brand_announcement_dismissals from public;
