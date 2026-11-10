-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0084 — project room deliverables and share links (docs/BRAND-ROOMS.md §6, §8)
--
-- Apply this file (and 0158) before turning on BRAND_ROOMS=on. Everything here is additive and safe on the
-- live review tables (0080): new nullable columns or columns with a constant default (no table rewrite),
-- new constraints that every existing row already satisfies, and two new tables. The studio review screen
-- keeps working on a database without this file: the service probes for these columns first.
--
--   brand_studio_reviews (+)          project_id  the room the deliverable belongs to (null = a studio review)
--                                     stack_id    versions of one deliverable share it (null = its own stack)
--                                     version     1, 2, 3 … inside the stack
--                                     source      'studio' (put up from the studio) | 'delivery' (the YAGI team)
--   brand_studio_review_comments (+)  end_ms       a range: at_ms .. end_ms
--                                     strokes      a drawing on the frame: polylines in 0..1 coordinates
--                                     guest_name   a comment left through a share link (author_id null)
--                                     share_id     which link it came through (rate limit and audit)
--                                     carried_from an open note of an earlier version shown on a newer one
--   brand_studio_assets (~)           source also takes 'delivery' (a file the YAGI team delivered)
--   brand_room_shares                 a link that shows one review item or one storyboard to someone outside
--                                     the workspace. Only the SHA-256 of the token is stored, never the token.
--   brand_room_share_visits           at most one counted view per visitor per hour (a hash, never an address)
--
-- Vocabulary mirrors lib/brand-studio/review-contracts.ts and lib/brand-rooms/share-contracts.ts.

/* ------------------------------------------------------------------ shares */

create table if not exists brand_room_shares (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  project_id uuid,
  kind text not null,
  target_id uuid not null,
  allow_comments boolean not null default false,
  allow_download boolean not null default false,
  passphrase_hash text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  views integer not null default 0,
  last_viewed_at timestamptz,
  -- Wrong passphrases inside the current ten-minute window (the service locks the link after a few).
  unlock_failures integer not null default 0,
  unlock_window_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_role text not null,
  created_at timestamptz not null default now(),
  constraint brand_room_shares_project_fk foreign key (organization_id, project_id)
    references brand_projects (organization_id, id),
  constraint brand_room_shares_token check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint brand_room_shares_kind check (kind in ('review','storyboard')),
  constraint brand_room_shares_role check (created_role in ('brand','studio')),
  constraint brand_room_shares_passphrase check (passphrase_hash is null or passphrase_hash ~ '^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$'),
  constraint brand_room_shares_expiry check (expires_at > created_at and expires_at <= created_at + interval '90 days 1 hour'),
  constraint brand_room_shares_views check (views >= 0 and unlock_failures >= 0),
  constraint brand_room_shares_revoked check (revoked_by is null or revoked_at is not null)
);
create unique index if not exists brand_room_shares_token_key on brand_room_shares (token_hash);
create index if not exists idx_brand_room_shares_target on brand_room_shares (organization_id, kind, target_id, created_at desc);

create table if not exists brand_room_share_visits (
  share_id uuid not null references brand_room_shares(id) on delete cascade,
  visitor_hash text not null,
  hour timestamptz not null,
  primary key (share_id, visitor_hash, hour),
  constraint brand_room_share_visits_hash check (visitor_hash ~ '^[0-9a-f]{64}$')
);

/* ----------------------------------------------------------- review items */

alter table brand_studio_reviews add column if not exists project_id uuid;
alter table brand_studio_reviews add column if not exists stack_id uuid;
alter table brand_studio_reviews add column if not exists version integer not null default 1;
alter table brand_studio_reviews add column if not exists source text not null default 'studio';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_reviews_project_fk') then
    alter table brand_studio_reviews add constraint brand_studio_reviews_project_fk
      foreign key (organization_id, project_id) references brand_projects (organization_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_reviews_stack_fk') then
    -- A stack is named by its first version; that row never leaves (reviews are soft-deleted).
    alter table brand_studio_reviews add constraint brand_studio_reviews_stack_fk
      foreign key (stack_id, organization_id) references brand_studio_reviews (id, organization_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_reviews_version') then
    alter table brand_studio_reviews add constraint brand_studio_reviews_version check (version between 1 and 999);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_reviews_source') then
    alter table brand_studio_reviews add constraint brand_studio_reviews_source check (source in ('studio','delivery'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_reviews_stack_version') then
    -- v1 is its own stack (stack_id null or itself); a later version always names its stack.
    alter table brand_studio_reviews add constraint brand_studio_reviews_stack_version check (version = 1 or stack_id is not null);
  end if;
end $$;
create unique index if not exists brand_studio_reviews_stack_version_key on brand_studio_reviews (coalesce(stack_id, id), version)
  where deleted_at is null;
create index if not exists idx_brand_studio_reviews_project on brand_studio_reviews (project_id, updated_at desc)
  where deleted_at is null and project_id is not null;
create index if not exists idx_brand_studio_reviews_stack on brand_studio_reviews (stack_id) where stack_id is not null;

/* ---------------------------------------------------------------- comments */

alter table brand_studio_review_comments add column if not exists end_ms integer;
alter table brand_studio_review_comments add column if not exists strokes jsonb;
alter table brand_studio_review_comments add column if not exists guest_name text;
alter table brand_studio_review_comments add column if not exists share_id uuid;
alter table brand_studio_review_comments add column if not exists carried_from uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_range') then
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_range
      check (end_ms is null or (at_ms is not null and end_ms > at_ms and end_ms <= 86400000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_strokes') then
    -- At most 24 lines and 32 KB; the service checks each point is inside the frame.
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_strokes
      check (strokes is null or (jsonb_typeof(strokes) = 'array' and jsonb_array_length(strokes) between 1 and 24 and octet_length(strokes::text) <= 32768));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_guest') then
    -- A guest has a name and no account; a member has an account (or had one) and no guest name.
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_guest
      check (guest_name is null or (author_id is null and char_length(guest_name) between 1 and 40));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_share_fk') then
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_share_fk
      foreign key (share_id) references brand_room_shares (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_carried_fk') then
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_carried_fk
      foreign key (carried_from) references brand_studio_review_comments (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'brand_studio_review_comments_carried') then
    -- A carried note heads its own thread and is never a copy of itself.
    alter table brand_studio_review_comments add constraint brand_studio_review_comments_carried
      check (carried_from is null or (parent_id is null and carried_from <> id));
  end if;
end $$;
create unique index if not exists brand_studio_review_comments_carried_key on brand_studio_review_comments (review_id, carried_from)
  where carried_from is not null;
create index if not exists idx_brand_studio_review_comments_share on brand_studio_review_comments (share_id, created_at desc)
  where share_id is not null;

/* ---------------------------------------------------- delivered files */

-- Widening a check: drop and re-add with one more value. NOT VALID first so the add takes no long lock;
-- every existing row is 'upload' or 'generation', so the validation cannot fail.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'brand_studio_assets_source' and pg_get_constraintdef(oid) like '%delivery%'
  ) then
    alter table brand_studio_assets drop constraint if exists brand_studio_assets_source;
    alter table brand_studio_assets add constraint brand_studio_assets_source check (source in ('upload','generation','delivery')) not valid;
    alter table brand_studio_assets validate constraint brand_studio_assets_source;
  end if;
end $$;
