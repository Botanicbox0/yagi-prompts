-- Evidence is reviewed, versioned and server-owned. Never synthesize approval from a live key.
create table public.creator_subscription_launch_evidence (
  environment text not null check (environment in ('test','live')),
  step text not null check (step in ('contract','costs','terms','registration','approval','renewal','cancellation','refund','render','worker','premium_editing')),
  plan_version text not null,
  release_version text not null,
  terms_version text not null,
  passed boolean not null default false,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  implementation_sha text not null check (implementation_sha ~ '^[0-9a-f]{40}$'),
  configuration_digest text not null check (configuration_digest ~ '^[0-9a-f]{64}$'),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz not null default now(),
  primary key (environment,plan_version,release_version,step)
);
alter table public.creator_subscription_launch_evidence enable row level security;
alter table public.creator_subscription_launch_evidence force row level security;
revoke all on public.creator_subscription_launch_evidence from public;
