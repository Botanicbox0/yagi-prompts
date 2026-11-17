-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0094 — project room notices (docs/BRAND-ROOMS-FEEDBACK.md §2)
--
-- Apply this file (and 0167) BEFORE turning on BRAND_ROOM_NOTIFY=on. With the flag off nothing writes or
-- reads these tables, so the code can ship first.
--
--   brand_room_notice_prefs  one person's mail switch for one organization's project rooms. No row means
--                            mail is on. The signed unsubscribe link (lib/notify/unsubscribe.ts, scope
--                            'brand_room_email') can only set it to false.
--   brand_room_notices       one notice for one person: what happened (kind), which room line it is about
--                            (message_id; null only for the intake receipt), when its mail is due (timing,
--                            due_at), and where the mail and the push stand (state, push_state). A person
--                            gets one row per line and kind, and one intake receipt per project.
--                            project_id null = the organization's general channel ("일반 문의"), where only
--                            chat lines happen (team_message, mention); the project key is checked for every
--                            other row (a composite foreign key with a null column is not checked).
--
-- Mail rows move pending -> sending (claimed with a lease; one attempt spent) -> sent | skipped | failed;
-- a retryable failure goes back to pending with the same batch_id, so the provider's idempotency key is
-- the same on every try. Push is at most once: claimed rows are marked first, then corrected.
-- Vocabulary mirrors lib/brand-rooms/notices.ts.

create table if not exists brand_room_notice_prefs (
  user_id uuid not null references profiles(id) on delete cascade,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create table if not exists brand_room_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  project_id uuid,
  recipient_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  message_id uuid references brand_room_messages(id) on delete cascade,
  timing text not null,
  due_at timestamptz not null,
  state text not null default 'pending',
  skip_reason text,
  batch_id uuid,
  attempts integer not null default 0,
  lease_until timestamptz,
  sent_at timestamptz,
  push_state text not null default 'none',
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint brand_room_notices_project_fk foreign key (organization_id, project_id)
    references brand_projects (organization_id, id) on delete cascade,
  constraint brand_room_notices_kind check (
    kind in ('new_version', 'storyboard', 'team_message', 'team_reply', 'mention', 'intake_received')
  ),
  constraint brand_room_notices_message check ((kind = 'intake_received') = (message_id is null)),
  -- The general channel has no drafts, storyboards or requests: only chat lines notify there.
  constraint brand_room_notices_general check (project_id is not null or kind in ('team_message', 'mention')),
  constraint brand_room_notices_timing check (timing in ('now', 'bundle', 'none')),
  constraint brand_room_notices_state check (state in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  constraint brand_room_notices_skip_reason check (
    (state = 'skipped') = (skip_reason is not null)
    and (skip_reason is null or skip_reason in ('read', 'muted', 'no_mailer', 'no_access', 'no_email', 'deleted', 'rule'))
  ),
  constraint brand_room_notices_lease check ((state = 'sending') = (lease_until is not null)),
  constraint brand_room_notices_attempts check (attempts between 0 and 10),
  constraint brand_room_notices_push_state check (push_state in ('none', 'pending', 'sent', 'skipped', 'failed')),
  constraint brand_room_notices_once unique (recipient_id, message_id, kind)
);

-- The intake receipt has no line: one per person, project and kind (a retried request does not mail twice).
-- Its project is never null (the check above), so the index needs no null handling.
create unique index if not exists brand_room_notices_intake_once
  on brand_room_notices (recipient_id, project_id, kind) where message_id is null;
-- The pass's two claims and the 30-minute bundle cap (read only for mails sent inside the window).
create index if not exists brand_room_notices_due on brand_room_notices (due_at) where state = 'pending';
create index if not exists brand_room_notices_push_due on brand_room_notices (created_at) where push_state = 'pending';
create index if not exists brand_room_notices_sending on brand_room_notices (lease_until) where state = 'sending';
create index if not exists brand_room_notices_bundle_cap
  on brand_room_notices (recipient_id, sent_at) where state = 'sent' and timing = 'bundle';
create index if not exists brand_room_notices_message on brand_room_notices (message_id);
