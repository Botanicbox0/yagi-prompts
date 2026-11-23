-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0178 — durable team notice delivery outbox
-- and consumer concierge escalations (S1 launch readiness).
--
--   team_notice_deliveries     durable outbox for all internal team notices (support messages, consumer
--                              escalations, project requests, room messages, storyboard approvals,
--                              review comments, share guest notes, org creations, allowance/plan
--                              requests). Supports dual transport ('bot' | 'webhook') and per-thread
--                              reply sync cursor/round-robin tracking.
--   consumer_support_messages  durable conversation thread for consumer AI concierge escalations and
--                              studio replies (mirrors brand_support_messages posture).
--   support_synced_replies     ledger of Slack-synced replies so they remain idempotent independently
--                              of staff profile selection and exempt from personal 30/hr rate limits.
--
-- Safe deploy order: existing code checks table existence (`to_regclass`) before reading/writing so
-- code and migrations can deploy in either order without breaking existing writes. Pairs with 0179.

create table if not exists team_notice_deliveries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'support_message',
    'concierge_escalation',
    'project_request',
    'room_message',
    'storyboard_approval',
    'review_comment',
    'share_guest_note',
    'org_created',
    'allowance_request',
    'plan_request'
  )),
  organization_id uuid references brand_organizations(id) on delete cascade,
  source_table text not null check (char_length(source_table) between 1 and 80),
  source_id uuid not null,
  surface text not null default '' check (char_length(surface) <= 120),
  actor_user_id uuid references profiles(id) on delete set null,
  actor_label text not null default '' check (char_length(actor_label) <= 120),
  preview text not null default '' check (char_length(preview) <= 1500),
  admin_path text not null default '/admin/inquiries' check (char_length(admin_path) <= 500),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  transport text check (transport is null or transport in ('bot', 'webhook')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  slack_channel text check (slack_channel is null or char_length(slack_channel) <= 64),
  slack_ts text check (slack_ts is null or char_length(slack_ts) <= 64),
  reply_sync_cursor text check (reply_sync_cursor is null or char_length(reply_sync_cursor) <= 64),
  reply_synced_at timestamptz,
  -- Only our bounded error codes, never HTTP response bodies, webhook URLs or transport exceptions.
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 64),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, source_id),
  check (status <> 'sending' or (claimed_at is not null and claim_token is not null)),
  check (status <> 'sent' or (sent_at is not null and transport is not null))
);

create index if not exists team_notice_deliveries_pending_idx
  on team_notice_deliveries (next_attempt_at, created_at) where status = 'pending';
create index if not exists team_notice_deliveries_sending_idx
  on team_notice_deliveries (claimed_at) where status = 'sending';
create index if not exists team_notice_deliveries_slack_thread_idx
  on team_notice_deliveries (slack_channel, slack_ts) where slack_ts is not null and status = 'sent';
create index if not exists team_notice_deliveries_reply_sync_idx
  on team_notice_deliveries (reply_synced_at asc nulls first, sent_at desc)
  where status = 'sent' and transport = 'bot' and slack_ts is not null;
create index if not exists team_notice_deliveries_org_created_idx
  on team_notice_deliveries (organization_id, created_at desc);
create index if not exists team_notice_deliveries_status_created_idx
  on team_notice_deliveries (status, created_at desc);

alter table team_notice_deliveries enable row level security;
alter table team_notice_deliveries force row level security;
revoke all on team_notice_deliveries from public;

create table if not exists consumer_support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  author_role text not null check (author_role in ('customer', 'studio')),
  created_by uuid references profiles(id) on delete set null,
  request_id uuid not null,
  reason text check (reason is null or reason in ('user_requested_human', 'account_or_billing_check', 'ai_unanswered')),
  page_path text not null default '' check (char_length(page_path) <= 200),
  body text not null check (length(btrim(body)) between 1 and 4000),
  transcript jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, created_by, request_id)
);

create index if not exists consumer_support_messages_user_idx
  on consumer_support_messages (user_id, created_at, id);
create index if not exists consumer_support_messages_created_idx
  on consumer_support_messages (created_at desc);

alter table consumer_support_messages enable row level security;
alter table consumer_support_messages force row level security;
revoke all on consumer_support_messages from public;

create table if not exists support_synced_replies (
  message_id uuid primary key,
  delivery_id uuid references team_notice_deliveries(id) on delete set null,
  slack_channel text not null check (char_length(slack_channel) <= 64),
  slack_ts text not null check (char_length(slack_ts) <= 64),
  created_at timestamptz not null default now()
);

create index if not exists support_synced_replies_delivery_idx
  on support_synced_replies (delivery_id);

alter table support_synced_replies enable row level security;
alter table support_synced_replies force row level security;
revoke all on support_synced_replies from public;
