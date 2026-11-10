-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0082 — project room conversations (docs/BRAND-ROOMS.md §4, §8)
--
-- Apply this file (and 0156) BEFORE turning on BRAND_ROOMS=on. With the flag off nothing reads these
-- tables, so the code can ship first.
--
--   brand_room_messages   one line in a channel: a commissioned project's channel (project_id set,
--                         channel = that id) or the organization's general channel (project_id null,
--                         channel 'general'). Replies are one level deep (the service enforces the
--                         depth; the keys below keep a reply in its parent's channel and organization).
--                         kind 'event' rows are the one-line system notes other slices post through
--                         lib/brand-rooms/events.ts. `ref` points at a storyboard cut or a review item;
--                         `ref_key` is its flat form ('storyboard:<id>[:<frame>]', 'review:<id>[:<comment>]')
--                         so a cut's thread is one index range. Soft delete; edits and pins are stamped.
--   brand_room_reactions  one person's reaction on one message (six names, lib/brand-rooms/message-contracts.ts).
--   brand_room_reads      where one person stopped reading one channel (unread counts, the team's too).
--
-- Who wrote what is the audit: author_id/author_role ('brand' | 'studio' | 'system'), pinned_by,
-- deleted_by. Vocabulary mirrors lib/brand-rooms/message-contracts.ts.

create table if not exists brand_room_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  project_id uuid,
  channel text not null,
  parent_id uuid,
  author_id uuid references profiles(id) on delete set null,
  author_role text not null,
  kind text not null default 'text',
  body text not null default '',
  event text,
  detail jsonb,
  ref jsonb,
  ref_key text,
  attachments jsonb not null default '[]'::jsonb,
  mentions uuid[] not null default '{}',
  mentions_team boolean not null default false,
  request_id uuid,
  pinned_at timestamptz,
  pinned_by uuid references profiles(id) on delete set null,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_room_messages_project_fk foreign key (organization_id, project_id)
    references brand_projects (organization_id, id) on delete cascade,
  constraint brand_room_messages_channel check (
    (project_id is null and channel = 'general') or (project_id is not null and channel = project_id::text)
  ),
  constraint brand_room_messages_org_key unique (id, organization_id),
  constraint brand_room_messages_channel_key unique (id, organization_id, channel),
  -- A reply stays in its parent's channel and organization: the channel column is never null, so this
  -- key is checked for the general channel too.
  constraint brand_room_messages_parent_fk foreign key (parent_id, organization_id, channel)
    references brand_room_messages (id, organization_id, channel) on delete cascade,
  constraint brand_room_messages_parent check (parent_id is null or parent_id <> id),
  constraint brand_room_messages_role check (author_role in ('brand','studio','system')),
  constraint brand_room_messages_kind check (kind in ('text','event')),
  constraint brand_room_messages_body check (char_length(body) <= 4000),
  constraint brand_room_messages_text check (
    kind <> 'text' or (author_role <> 'system' and (char_length(btrim(body)) > 0 or jsonb_array_length(attachments) > 0))
  ),
  constraint brand_room_messages_event check (
    (kind = 'event') = (event is not null)
    and (kind <> 'event' or (author_role = 'system' and project_id is not null and parent_id is null and ref is not null))
  ),
  constraint brand_room_messages_event_name check (event is null or event ~ '^[a-z_]{1,40}$'),
  constraint brand_room_messages_detail check (detail is null or jsonb_typeof(detail) = 'object'),
  constraint brand_room_messages_ref check (ref is null or jsonb_typeof(ref) = 'object'),
  constraint brand_room_messages_ref_key check (
    (ref is null) = (ref_key is null)
    and (ref_key is null or ref_key ~ '^(storyboard|review):[0-9a-f-]{36}(:[0-9a-f-]{36})?$')
  ),
  constraint brand_room_messages_ref_project check (ref is null or project_id is not null),
  constraint brand_room_messages_attachments check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  constraint brand_room_messages_mentions check (cardinality(mentions) <= 50),
  constraint brand_room_messages_pinned check (pinned_by is null or pinned_at is not null),
  constraint brand_room_messages_deleted check (deleted_by is null or deleted_at is not null)
);
-- One send per (author, request id): a retried optimistic send returns the first row.
create unique index if not exists brand_room_messages_request_key on brand_room_messages (organization_id, author_id, request_id)
  where request_id is not null;
-- A channel's stream by time (top-level lines; replies live in their thread).
create index if not exists idx_brand_room_messages_stream on brand_room_messages (organization_id, channel, created_at, id)
  where parent_id is null;
-- What changed since a poll's cursor (new lines, edits, deletions, reactions, pins, reply counts).
create index if not exists idx_brand_room_messages_changes on brand_room_messages (organization_id, channel, updated_at);
-- A thread.
create index if not exists idx_brand_room_messages_thread on brand_room_messages (parent_id, created_at)
  where parent_id is not null;
-- Messages about one storyboard cut or review item (exact key, or a key and everything under it).
create index if not exists idx_brand_room_messages_ref on brand_room_messages (organization_id, ref_key text_pattern_ops, created_at)
  where ref_key is not null;
-- Unread counts: live lines of a channel after a read mark.
create index if not exists idx_brand_room_messages_unread on brand_room_messages (organization_id, channel, created_at)
  where deleted_at is null;
-- The per-member rate limit.
create index if not exists idx_brand_room_messages_author on brand_room_messages (author_id, created_at desc);

create table if not exists brand_room_reactions (
  message_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji),
  constraint brand_room_reactions_message_fk foreign key (message_id, organization_id)
    references brand_room_messages (id, organization_id) on delete cascade,
  constraint brand_room_reactions_emoji check (emoji in ('thumbs_up','heart','clap','eyes','check','smile'))
);
create index if not exists idx_brand_room_reactions_message on brand_room_reactions (message_id);

create table if not exists brand_room_reads (
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  channel text not null,
  user_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (organization_id, channel, user_id),
  constraint brand_room_reads_channel check (
    channel = 'general' or channel ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);
create index if not exists idx_brand_room_reads_user on brand_room_reads (user_id);
