-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0064 — account deletion requests (docs/APP-STORE-LAUNCH.md §3.2, 2026-10-27)
--
-- Apply this file and 0144_glue_account_deletion_requests.sql BEFORE deploying the code that reads
-- them. Without the table, `/account` keeps the old mail link and the admin queue says it is not
-- ready; nothing else depends on it.
--
-- Apple 5.1.1(v) and Google Play's account-deletion policy want the request to start inside the
-- app. Deletion itself stays a manual runbook (docs/RUNBOOK-deletion.md); this table is the intake
-- and the record that the 7-day promise in the privacy policy was kept.
--
--   status     requested → processing → completed, or requested → cancelled (the member changed
--              their mind before an operator started). One open request per member.
--   email      the address to send the confirmation to once the account is gone. Kept only while
--              the request is open: completing or cancelling clears it, so a finished request holds
--              no personal data — an id, three timestamps and who closed it.
--   user_id    `on delete set null`: deleting the auth user (runbook §2) empties it, and
--              `completed` is only reachable after that has happened.
--   due_at     requested_at + 7 days, written once. The queue sorts and warns by it.

create table if not exists account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  email text check (email is null or length(email) between 3 and 320),
  status text not null default 'requested' check (status in ('requested','processing','completed','cancelled')),
  requested_at timestamptz not null default now(),
  due_at timestamptz not null,
  started_at timestamptz,
  started_by uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  -- The operator who completed or cancelled it; a member's own withdrawal leaves it empty.
  closed_by uuid references profiles(id) on delete set null,
  note text check (note is null or length(note) <= 500),
  updated_at timestamptz not null default now(),
  check (due_at > requested_at),
  check (status <> 'processing' or started_at is not null),
  -- A completed request is a request whose account no longer exists.
  check (status <> 'completed' or (completed_at is not null and user_id is null)),
  check (status <> 'cancelled' or cancelled_at is not null),
  -- Closed rows keep no address.
  check (status in ('requested','processing') or email is null)
);

-- One open request per member: a second press answers with the first.
create unique index if not exists account_deletion_requests_open_by_user
  on account_deletion_requests (user_id) where status in ('requested','processing');
-- The admin queue and its dashboard count: what is open, oldest deadline first.
create index if not exists account_deletion_requests_open
  on account_deletion_requests (due_at) where status in ('requested','processing');
