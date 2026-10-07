-- Inquiry intent and a durable, single-destination Slack outbox.
-- No contact details or webhook credentials are copied into delivery records.
alter table brand_inquiries
  add column if not exists inquiry_type text not null default 'campaign'
    check (inquiry_type in ('campaign', 'production', 'filter', 'undecided')),
  add column if not exists use_case text not null default 'undecided'
    check (use_case in ('launch', 'beauty_fashion', 'app_platform', 'local', 'seasonal', 'undecided')),
  add column if not exists request_id uuid,
  add column if not exists receipt_sent_at timestamptz;

create unique index if not exists brand_inquiries_request_id_idx on brand_inquiries (request_id);

create table if not exists brand_inquiry_deliveries (
  inquiry_id uuid primary key references brand_inquiries(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'uncertain', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz,
  claimed_at timestamptz,
  claim_token uuid,
  sent_at timestamptz,
  -- Only our bounded error codes, never HTTP response bodies or transport exceptions.
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 64),
  check (status <> 'sending' or (claimed_at is not null and claim_token is not null)),
  check (status <> 'sent' or sent_at is not null)
);

create index if not exists brand_inquiry_deliveries_pending_idx
  on brand_inquiry_deliveries (next_attempt_at, created_at) where status = 'pending';
create index if not exists brand_inquiry_deliveries_sending_idx
  on brand_inquiry_deliveries (claimed_at) where status = 'sending';

-- Deny browser access immediately, including the interval before the glue migration runs.
alter table brand_inquiry_deliveries enable row level security;
alter table brand_inquiry_deliveries force row level security;

-- Deliberately no historical backfill: enabling Slack does not send old inquiry content.
