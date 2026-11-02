-- Creator recurring billing is separate from legacy subscriptions and one-time payments.
-- Cloud application is a separate operator step; this file does not open sales.
create table creator_subscriptions (
  id uuid primary key,
  user_id uuid not null references profiles(id),
  environment text not null check (environment in ('test','live')),
  plan_id text not null check (plan_id in ('creator','premium')),
  plan_version text not null,
  amount_krw integer not null check (amount_krw > 0),
  monthly_units integer not null check (monthly_units > 0),
  -- Accepted contract quota; later deployment configuration cannot change paid access.
  premium_edit_limit integer check (premium_edit_limit between 1 and 1000),
  check (plan_id = 'premium' or premium_edit_limit is null),
  consent_version text not null,
  consent_at timestamptz not null,
  locale text not null check (locale in ('ko','en')),
  customer_key text not null unique,
  billing_key_ciphertext text,
  auth_fingerprint text,
  auth_lease_until timestamptz,
  status text not null default 'awaiting_auth' check (status in ('awaiting_auth','authorizing','active','past_due','refund_pending','refunded','ended')),
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  anchor_at timestamptz,
  current_period_index integer not null default -1 check (current_period_index >= -1),
  next_billing_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index creator_subscriptions_one_open_per_user on creator_subscriptions(user_id,environment)
  where status not in ('ended','refunded');
create index creator_subscriptions_due on creator_subscriptions(environment,next_billing_at) where status='active';

-- One immutable provider order per billing period; no payment network calls inside a DB transaction.
create table creator_subscription_periods (
  id uuid primary key,
  subscription_id uuid not null references creator_subscriptions(id),
  period_index integer not null check (period_index >= 0),
  environment text not null check (environment in ('test','live')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  amount_krw integer not null check (amount_krw > 0),
  monthly_units integer not null check (monthly_units > 0),
  reserved_units integer not null default 0 check (reserved_units >= 0),
  consumed_units integer not null default 0 check (consumed_units >= 0),
  status text not null default 'pending' check (status in ('pending','charging','paid','failed','refund_pending','refunded')),
  payment_key text unique,
  lease_until timestamptz,
  charge_started_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  failure_code text,
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique(subscription_id,period_index),
  check (reserved_units + consumed_units <= monthly_units)
);
create index creator_subscription_periods_recovery on creator_subscription_periods(environment,status,lease_until);

create table creator_subscription_usage (
  render_ref uuid primary key,
  subscription_id uuid not null references creator_subscriptions(id),
  period_id uuid not null references creator_subscription_periods(id),
  user_id uuid not null references profiles(id),
  environment text not null check (environment in ('test','live')),
  units integer not null check (units > 0),
  state text not null default 'reserved' check (state in ('reserved','consumed','released')),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index creator_subscription_usage_period on creator_subscription_usage(period_id,state);

-- Compensating cleanup for a key issued after cancellation or before a storage failure.
-- Only ciphertext and its one-way identity are retained; browser roles cannot read this audit.
create table creator_subscription_key_cleanup (
  id uuid primary key,
  subscription_id uuid not null references creator_subscriptions(id),
  environment text not null check (environment in ('test','live')),
  key_fingerprint text not null,
  encrypted_key text,
  status text not null default 'pending' check (status in ('pending','revoked')),
  lease_until timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(environment,key_fingerprint)
);
create index creator_subscription_key_cleanup_due on creator_subscription_key_cleanup(environment,status,lease_until);

-- Protect the interval before glue migration application too.
alter table creator_subscriptions enable row level security;
alter table creator_subscriptions force row level security;
alter table creator_subscription_periods enable row level security;
alter table creator_subscription_periods force row level security;
alter table creator_subscription_usage enable row level security;
alter table creator_subscription_usage force row level security;
alter table creator_subscription_key_cleanup enable row level security;
alter table creator_subscription_key_cleanup force row level security;
