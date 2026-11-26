-- 클라우드 적용 필요 — TWINGS · core migration 0198 — 보내기: the members channel, file threads, per-thread reads
-- (docs/BRAND-PROJECT-SPINE.md §8.2, §8.3, §8.4, §8.6; slice 4a).
--
-- A workspace member sends a studio file to colleagues with `@` and a message. That conversation must never reach the
-- YAGI team or a project guest, so it is not the project's team channel: it is a second kind of channel in the same
-- table, the MEMBERS channel. `'members:' || project_id` for a file filed in a project, `'members'` for an unfiled one.
-- The team channels keep exactly their values (`'general'`, `project_id::text`). A send is a ROOT line on a members
-- channel that points at the file (`ref = {kind:'output', outputId}` or `{kind:'asset', assetId}`, `ref_key =
-- 'output:<uuid>'` / `'asset:<uuid>'`); its replies copy the root's ref and stay in its channel (the parent key of 0082).
--
-- What this file changes, each a SUPERSET of the rule it replaces (every row that exists today passes):
--   brand_room_messages_channel     + `'members'` (no project) and `'members:' || project_id`
--   brand_room_messages_ref_key     + `output:<uuid>` and `asset:<uuid>` (no sub-key)
--   brand_room_messages_ref_project + an unfiled file's thread: a ref without a project on `'members'`
--   brand_room_reads_channel        + the two members forms (nothing writes them in slice 4a; §8.6)
--   brand_room_notices_kind         + `member_reply`
--   brand_room_notices_general      + `member_reply` without a project (an unfiled file's thread)
-- and adds, each refusing only shapes no row has today:
--   brand_room_messages_members_ref  file refs live on members channels only, and members lines carry only file refs
--   brand_room_messages_members_line a members line is a brand member's text line with a file ref, no files attached
--                                    and no call to the team
--   brand_room_notices.channel       the channel a notice is about (null on every older row), consistent with its
--                                    project, required for `member_reply`
--   brand_room_thread_reads          where one person stopped reading one thread (per-thread unread, §8.4)
--
-- Safe while the old code serves: no existing value is refused; the old code never writes a members channel, an
-- output or asset ref, `member_reply` or the new column; the new table is closed to every browser key from the moment
-- it exists (row level security on and forced, no policy, PUBLIC revoked; glue 0199 revokes the browser roles' table
-- grants and grants the server role). But once a members line EXISTS, pre-4a code must not serve against this
-- database: its admin rooms overview and organization list would show the line. Safe to deploy the code first: the
-- server keeps 보내기 closed until `brand_room_thread_reads` and `brand_room_notices.channel` exist (a remembered probe,
-- lib/brand-rooms/members-channel.ts `brandSendTablesReady`), so the table is created LAST in this file.
--
-- Rollback (docs/BRAND-PROJECT-SPINE.md §8.6): turn BRAND_SEND off first, then delete the members lines and the notices
-- about them, BEFORE any pre-4a code serves against this database; only then can the old checks come back (the slice 4a
-- report has the statements). A project deleted by hand takes its members threads with it (0082's project key cascades).
--
-- Pairs with glue 0199. Re-runnable: every statement is guarded or idempotent.

-- ------------------------------------------------------------------ brand_room_messages

alter table brand_room_messages drop constraint if exists brand_room_messages_channel;
alter table brand_room_messages add constraint brand_room_messages_channel check (
  (project_id is null and channel in ('general', 'members'))
  or (project_id is not null and channel in (project_id::text, 'members:' || project_id::text))
);

alter table brand_room_messages drop constraint if exists brand_room_messages_ref_key;
alter table brand_room_messages add constraint brand_room_messages_ref_key check (
  (ref is null) = (ref_key is null)
  and (
    ref_key is null
    or ref_key ~ '^(storyboard|review):[0-9a-f-]{36}(:[0-9a-f-]{36})?$'
    or ref_key ~ '^(output|asset):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);

alter table brand_room_messages drop constraint if exists brand_room_messages_ref_project;
alter table brand_room_messages add constraint brand_room_messages_ref_project check (
  ref is null or project_id is not null or channel = 'members'
);

do $$ begin
  -- A studio file is talked about only among members, and the members channel talks only about studio files: the team
  -- channels keep storyboard and review refs, the members channels take output and asset refs. No row has either today.
  if not exists (select 1 from pg_constraint where conname = 'brand_room_messages_members_ref' and conrelid = 'brand_room_messages'::regclass) then
    alter table brand_room_messages add constraint brand_room_messages_members_ref check (
      ref_key is null or ((ref_key ~ '^(output|asset):') = (channel = 'members' or channel like 'members:%'))
    );
  end if;
  -- A members line is a brand member's own text line about a file: never a system event, never the team's line, never a
  -- call to the team, never an attached file (slice 4a refuses attachments there), always with its file ref.
  if not exists (select 1 from pg_constraint where conname = 'brand_room_messages_members_line' and conrelid = 'brand_room_messages'::regclass) then
    alter table brand_room_messages add constraint brand_room_messages_members_line check (
      not (channel = 'members' or channel like 'members:%')
      or (kind = 'text' and author_role = 'brand' and mentions_team = false and ref_key is not null and jsonb_array_length(attachments) = 0)
    );
  end if;
end $$;

-- "My threads" (the inbox, §8.4): the lines that name me, on members channels only.
create index if not exists idx_brand_room_messages_members_mentions on brand_room_messages using gin (mentions)
  where channel like 'members%';
-- "My threads": the lines I wrote, on members channels only.
create index if not exists idx_brand_room_messages_members_author on brand_room_messages (organization_id, author_id)
  where channel like 'members%';

-- ------------------------------------------------------------------ brand_room_reads

alter table brand_room_reads drop constraint if exists brand_room_reads_channel;
alter table brand_room_reads add constraint brand_room_reads_channel check (
  channel = 'general'
  or channel ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or channel = 'members'
  or channel ~ '^members:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
);

-- ------------------------------------------------------------------ brand_room_notices

alter table brand_room_notices drop constraint if exists brand_room_notices_kind;
alter table brand_room_notices add constraint brand_room_notices_kind check (
  kind in ('new_version', 'storyboard', 'team_message', 'team_reply', 'mention', 'intake_received', 'member_reply')
);

alter table brand_room_notices drop constraint if exists brand_room_notices_general;
alter table brand_room_notices add constraint brand_room_notices_general check (
  project_id is not null or kind in ('team_message', 'mention', 'member_reply')
);

alter table brand_room_notices add column if not exists channel text;

do $$ begin
  -- The channel a notice is about, the same pair rule as the line's own channel. Null on every row written before
  -- slice 4a (those are team-channel notices; their channel is their project or 'general').
  if not exists (select 1 from pg_constraint where conname = 'brand_room_notices_channel' and conrelid = 'brand_room_notices'::regclass) then
    alter table brand_room_notices add constraint brand_room_notices_channel check (
      channel is null
      or (project_id is null and channel in ('general', 'members'))
      or (project_id is not null and channel in (project_id::text, 'members:' || project_id::text))
    );
  end if;
  -- A new reply in a members thread is the only member_reply, and it always says which members channel.
  if not exists (select 1 from pg_constraint where conname = 'brand_room_notices_member_reply' and conrelid = 'brand_room_notices'::regclass) then
    alter table brand_room_notices add constraint brand_room_notices_member_reply check (
      kind <> 'member_reply' or (channel is not null and (channel = 'members' or channel like 'members:%'))
    );
  end if;
end $$;

-- ------------------------------------------------------------------ brand_room_thread_reads (last: the readiness probe)

-- Where one person stopped reading one members thread. Opening a thread moves only that person's row (it never moves
-- backwards); "모두 읽음" writes the rows of that person's inbox. The thread and its organization are one key, so a row
-- can only name a line of its own organization; it goes with the line, the person or the organization.
create table if not exists brand_room_thread_reads (
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  root_message_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (root_message_id, user_id),
  constraint brand_room_thread_reads_root_fk foreign key (root_message_id, organization_id)
    references brand_room_messages (id, organization_id) on delete cascade
);
create index if not exists idx_brand_room_thread_reads_user on brand_room_thread_reads (user_id);

-- Closed from the moment it exists (0156's posture; glue 0199 re-asserts it and grants the server role).
alter table brand_room_thread_reads enable row level security;
alter table brand_room_thread_reads force row level security;
revoke all on brand_room_thread_reads from public;
