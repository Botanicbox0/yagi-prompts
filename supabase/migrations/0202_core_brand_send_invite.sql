-- 클라우드 적용 필요 — TWINGS · core migration 0202 — 초대하고 보내기: a members line waiting for someone who is not a
-- member yet (docs/BRAND-PROJECT-SPINE.md §8.5; slice 4c).
--
-- In 보내기's send field an owner or editor may name the e-mail address of someone who is not a workspace member. The
-- line is posted at once, the EXISTING workspace invitation goes out for that address (a `brand_invites` row written
-- by `storeInvitation`, role viewer, 7 days), and this table remembers which line waits for which invitation. When the
-- invitation is accepted (`acceptBrandInvitation`), the new member is added to the line's mentions and told as any
-- mentioned member is, and the row is deleted. Expiry and revocation delete nothing: a read shows the state from the
-- invitation row.
--
-- One new table and its guard; no existing table, column or check changes.
--   brand_room_pending_mentions  (message_id, invite_id, organization_id, created_invite): one row per line and
--                                invitation. The line and its organization are one key (the line's own organization
--                                only). The guard trigger: the invitation must be an organization-wide VIEWER invitation of
--                                the SAME organization that the YAGI team did not issue (a line never waits for, and so
--                                never exposes, an owner's higher-role or the team's invitation), and the line a members
--                                line. `created_invite` is true only on the row of the line whose send CREATED the
--                                invitation (never on a line that reused one); the guard holds it to the invitation's own
--                                inviter being the line's writer. Acceptance honours an editor's invitation only through
--                                such a row. It goes with the line, the invitation or the organization.
--
-- Safe while the old code serves: the old code never reads or writes this table, and it is closed to every browser key
-- from the moment it exists (row level security on and forced, no policy, PUBLIC revoked; glue 0203 revokes the
-- browser roles and grants the server role). Safe to deploy the code first: the server keeps 초대하고 보내기 closed
-- until this table exists (a remembered probe, lib/brand-rooms/members-schema.ts `brandSendInviteTableReady`) and
-- `BRAND_SEND_INVITE=on`.
--
-- Rollback: turn BRAND_SEND_INVITE off first and keep it off (the send operations then answer exactly as before this
-- slice, and an invitation an editor issued through 보내기 is honoured no more). A running server remembers that this
-- table exists once it has seen it (the probe never forgets a hit), so dropping the table while the switch is on would
-- make its reads fail until a restart. Then drop the table and its function (the slice 4c report has the statements).
-- The invitations themselves stay: they are ordinary workspace invitations.
--
-- Pairs with glue 0203. Re-runnable: every statement is guarded or idempotent.

create table if not exists brand_room_pending_mentions (
  message_id uuid not null,
  invite_id uuid not null references brand_invites(id) on delete cascade,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  created_invite boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (message_id, invite_id),
  constraint brand_room_pending_mentions_message_fk foreign key (message_id, organization_id)
    references brand_room_messages (id, organization_id) on delete cascade
);
-- A copy of this table made from an earlier text of this file (a local database) gets the column too.
alter table brand_room_pending_mentions add column if not exists created_invite boolean not null default false;
-- Acceptance reads one invitation's rows; the invitation's cascade finds them here too.
create index if not exists idx_brand_room_pending_mentions_invite on brand_room_pending_mentions (invite_id);
-- A member's leftover check on each inbox and bell read starts from the organization.
create index if not exists idx_brand_room_pending_mentions_org on brand_room_pending_mentions (organization_id, invite_id);

-- What a foreign key cannot say. Checked on every insert and update.
create or replace function brand_room_pending_mentions_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- An organization-wide viewer invitation of this organization that the team did not issue: a project invitation makes
  -- a guest, never a member; an owner's editor or owner invitation and the team's (a handover) are theirs, not 보내기's.
  if not exists (
    select 1 from brand_invites i
     where i.id = new.invite_id and i.organization_id = new.organization_id and i.project_id is null
       and i.role = 'viewer' and not i.issued_by_studio
  ) then
    raise exception 'brand_room_pending_mentions: the invitation is not an organization viewer invitation of this organization'
      using errcode = '23514';
  end if;
  -- A members line: a team channel's line never waits for anyone.
  if not exists (
    select 1 from brand_room_messages m
     where m.id = new.message_id and m.organization_id = new.organization_id and m.channel like 'members%'
  ) then
    raise exception 'brand_room_pending_mentions: the line is not a members line of this organization'
      using errcode = '23514';
  end if;
  -- Only the line whose send created the invitation says so, and that line's writer is the invitation's inviter.
  if new.created_invite and not exists (
    select 1 from brand_invites i join brand_room_messages m on m.id = new.message_id
     where i.id = new.invite_id and i.created_by = m.author_id
  ) then
    raise exception 'brand_room_pending_mentions: only the line whose writer issued the invitation created it'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists brand_room_pending_mentions_guard on brand_room_pending_mentions;
create trigger brand_room_pending_mentions_guard
  before insert or update on brand_room_pending_mentions
  for each row execute function brand_room_pending_mentions_guard();

-- Closed from the moment it exists (0156's posture; glue 0203 re-asserts it and grants the server role).
alter table brand_room_pending_mentions enable row level security;
alter table brand_room_pending_mentions force row level security;
revoke all on brand_room_pending_mentions from public;
