-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0064 — account deletion requests (docs/RUNBOOK-deletion.md, 2026-11-11)
--
-- Apply this file and 0144_glue_account_deletion_requests.sql BEFORE deploying the code that reads
-- them. Without the table, `/account` keeps the mail request and the daily pass skips deletion;
-- nothing else depends on it. (0064 / 0144 were reserved for this in supabase/README.md.)
--
-- Apple 5.1.1(v) and Google Play's account-deletion policy want deletion to start inside the app.
-- A member asks on `/account/delete`; after a short grace period the daily pass deletes the account
-- (lib/account/deletion.ts). This table is the request, the queue an operator sees, and the record
-- that the privacy policy's "탈퇴 요청을 받으면 7일 이내에 삭제" was kept.
--
--   status        requested  → the member can still cancel; the pass acts once `scheduled_for` has
--                              passed and nothing holds the account (`hold`).
--                 processing → the account's rows are gone (one transaction). What lives outside the
--                              database is listed in `cleanup` and removed item by item; a failed
--                              item stays listed and the next pass tries again.
--                 completed  → nothing is left to remove. cancelled → withdrawn, account untouched.
--   scheduled_for requested_at + the grace period. due_at = requested_at + 7 days, the promise.
--   hold          why the pass did not act when it last looked (a render still running, a payment
--                 in flight, a brand membership …). Codes only, never a sentence.
--   cleanup       {"authUserId": uuid, "folders": [..], "providerGroups": [..]} — the sign-in
--                 account, the private storage folders and the engine provider's asset groups that
--                 belonged to the account. Written in the same transaction that deletes the rows,
--                 because after it nothing else remembers them. Emptied as each item goes.
--   removed       counts for the audit trail: {"selfies":2,"renders":5,"folders":8,"paymentsKept":3}.
--   email         where to answer the member. Kept only while the request is open: completing or
--                 cancelling clears it, so a closed request holds no personal data.
--   user_id       `on delete set null`: deleting the profile empties it, and a request past
--                 `requested` is by definition one whose account no longer exists.

create table if not exists account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  email text check (email is null or length(email) between 3 and 320),
  status text not null default 'requested' check (status in ('requested','processing','completed','cancelled')),
  requested_at timestamptz not null default now(),
  scheduled_for timestamptz not null,
  due_at timestamptz not null,
  hold text[] not null default '{}',
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  last_error text check (last_error is null or length(last_error) <= 300),
  started_at timestamptz,
  -- The operator who pressed "delete now"; empty when the daily pass did it.
  started_by uuid references profiles(id) on delete set null,
  cleanup jsonb check (cleanup is null or jsonb_typeof(cleanup) = 'object'),
  removed jsonb check (removed is null or jsonb_typeof(removed) = 'object'),
  completed_at timestamptz,
  cancelled_at timestamptz,
  -- The operator who completed or cancelled it by hand; a member's own withdrawal leaves it empty.
  closed_by uuid references profiles(id) on delete set null,
  note text check (note is null or length(note) <= 500),
  updated_at timestamptz not null default now(),
  check (scheduled_for >= requested_at),
  check (due_at > requested_at),
  -- Past `requested`, the account is gone.
  check (status not in ('processing','completed') or user_id is null),
  check (status <> 'processing' or (started_at is not null and cleanup is not null)),
  check (status <> 'completed' or completed_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null),
  -- Closed rows keep no address and nothing left to clean.
  check (status in ('requested','processing') or (email is null and cleanup is null))
);

-- One open request per member: a second press answers with the first.
create unique index if not exists account_deletion_requests_open_by_user
  on account_deletion_requests (user_id) where status = 'requested';
-- The admin queue, its dashboard count and the daily pass: what is open, oldest deadline first.
create index if not exists account_deletion_requests_open
  on account_deletion_requests (due_at) where status in ('requested','processing');
