-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0053 — web push (docs/PLATFORM-2.0.md §5.3, 2026-10-22)
--
-- Apply this file and 0139_glue_push_subscriptions.sql BEFORE deploying the code that reads them.
-- The app degrades without them (push stays off, email still goes), but the auth callback stores a
-- NULL email for Kakao accounts without one, which needs the NOT NULL dropped below first.
--
-- Founder direction (2026-10-22): long renders end in a completion notice. The installed app (PWA)
-- is the app, so the notice is a Web Push to the devices that said yes on "완성되면 알려드릴까요?".
--
--   push_subscriptions  one row per device (browser profile) that subscribed. `endpoint` is the
--                       push service's capability URL and is unique: the same device subscribing
--                       again (or under another account, on a shared browser) updates the row.
--                       Turning push off, or the push service answering 404/410, sets
--                       `revoked_at` — the row stays as the record that the device once said yes.
--   render_jobs         `notify_channel` may now record `push`: the channel that reached the reader
--                       (email still always goes; push is in addition — lib/renders/notify.ts).
--   profiles.email      NULL when the Auth user has none (a Kakao account that did not share an
--                       email). The callback used to store '' (empty string); those rows become NULL.

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles on delete cascade,
  endpoint text not null unique
    check (length(endpoint) between 9 and 2048 and endpoint like 'https://%'),
  -- The browser's P-256 key and auth secret (base64url) that encrypt every payload.
  p256dh text not null check (length(p256dh) between 1 and 256),
  auth text not null check (length(auth) between 1 and 64),
  user_agent text check (user_agent is null or length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  -- Refreshed whenever the device re-confirms its subscription from the app.
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- The send path asks one question: this user's live devices.
create index if not exists push_subscriptions_live_by_user
  on push_subscriptions (user_id) where revoked_at is null;

alter table render_jobs drop constraint if exists render_jobs_notify_channel_check;
alter table render_jobs add constraint render_jobs_notify_channel_check
  check (notify_channel in ('email','kakao','whatsapp','sms','push'));

alter table profiles alter column email drop not null;
update profiles set email = null where btrim(email) = '';
