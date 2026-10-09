-- Server-owned subscription render requests and bounded edit preparation. Cloud application is
-- a separate operator step. No browser role gets the recipe, request text or private image keys.
alter table render_jobs add column provider_completion_tokens bigint check (provider_completion_tokens is null or provider_completion_tokens >= 0);
alter table render_jobs add column cost_source text check (cost_source is null or cost_source in ('provider_usage','estimate'));
create table creator_subscription_renders (
  render_ref uuid primary key references render_jobs(id),
  user_id uuid not null references profiles(id),
  environment text not null check (environment in ('test','live')),
  request_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  base_prompt text not null check (length(base_prompt) between 1 and 30000),
  runtime_seconds integer not null check (runtime_seconds between 4 and 30),
  edit_text text check (edit_text is null or length(edit_text) between 1 and 800),
  allowed_scopes text[] not null default '{}',
  reference_keys jsonb not null default '[]'::jsonb
    check (jsonb_typeof(reference_keys)='array' and jsonb_array_length(reference_keys)<=3),
  guide_version text not null,
  edit_status text not null default 'not_requested' check (edit_status in ('not_requested','pending','preparing','prepared','failed')),
  prepared_plan jsonb,
  prepare_token uuid,
  prepare_started_at timestamptz,
  edit_request_started_at timestamptz,
  dispatch_attempt integer not null default 0 check (dispatch_attempt >= 0),
  dispatch_started_at timestamptz,
  failure_code text,
  model text,
  input_tokens integer not null default 0 check (input_tokens>=0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens>=0),
  output_tokens integer not null default 0 check (output_tokens>=0),
  references_expire_at timestamptz not null,
  references_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  prepared_at timestamptz,
  unique(user_id,environment,request_id),
  check ((edit_status='not_requested' and edit_text is null) or (edit_status<>'not_requested' and edit_text is not null)),
  check (edit_status<>'prepared' or prepared_plan is not null)
);
create index creator_subscription_renders_references_expiry on creator_subscription_renders(references_expire_at)
  where references_deleted_at is null;
alter table creator_subscription_renders enable row level security;
alter table creator_subscription_renders force row level security;
-- deny-all: all projections are explicitly selected by the authenticated server service.
