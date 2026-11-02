-- CLOUD APPLICATION REQUIRED. Founder 2026-09-22: first creation included, two successes lifetime.
create table identity_portrait_attempts (
  id uuid primary key,
  user_id uuid not null references profiles on delete cascade,
  request_id uuid not null,
  slot smallint not null check (slot between 1 and 2),
  status text not null check (status in ('queued','running','uncertain','succeeded','failed')),
  model text not null check (model='gpt-image-2.5-sunburst'),
  prompt_version text not null,
  input_key text not null,
  result_key text,
  failure_code text,
  consent_at timestamptz not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, request_id),
  unique(user_id, id),
  check (status<>'succeeded' or (result_key is not null and completed_at is not null))
);
-- Successes occupy their slot forever. Failed attempts release it; uncertain outcomes do not.
create unique index identity_portrait_slot on identity_portrait_attempts(user_id,slot) where status<>'failed';
create unique index identity_portrait_inflight on identity_portrait_attempts(user_id) where status in ('queued','running','uncertain');
create index identity_portrait_queue on identity_portrait_attempts(created_at) where status='queued';
create table identity_portrait_selections (
  user_id uuid primary key references profiles on delete cascade,
  attempt_id uuid not null,
  updated_at timestamptz not null default now(),
  foreign key(user_id,attempt_id) references identity_portrait_attempts(user_id,id) on delete cascade
);
alter table billing_payments add column identity_portrait_id uuid references identity_portrait_attempts(id) on delete set null;
alter table render_jobs add column identity_portrait_id uuid references identity_portrait_attempts(id) on delete set null;
