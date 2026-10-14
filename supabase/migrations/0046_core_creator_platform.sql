-- CLOUD APPLICATION REQUIRED. Closed-by-default feature flags; no prices, grants or creators seeded.
-- Shared accounting fields can ship before the separately gated 0042-0045 subscription release.
alter table render_jobs add column if not exists provider_completion_tokens bigint check (provider_completion_tokens is null or provider_completion_tokens >= 0);
alter table render_jobs add column if not exists cost_source text check (cost_source is null or cost_source in ('provider_usage','estimate'));
create table platform_creators (
 user_id uuid primary key references profiles on delete cascade,
 active boolean not null default false,
 approved_by uuid references profiles on delete set null,
 contract_version text not null check(length(contract_version) between 1 and 120),
 created_at timestamptz not null default now()
);
create table platform_rate_limits (
 user_id uuid not null references profiles on delete cascade, window_start timestamptz not null,
 hits integer not null check(hits>0), primary key(user_id,window_start)
);
create table platform_threads (
 id uuid primary key, user_id uuid not null references profiles on delete cascade,
 reference_url text, status text not null default 'open' check(status in ('open','closed')),
 created_at timestamptz not null default now()
);
create index platform_threads_owner on platform_threads(user_id,created_at desc);
create table platform_messages (
 id uuid primary key, thread_id uuid not null references platform_threads on delete cascade,
 actor_id uuid references profiles on delete set null, from_studio boolean not null default false,
 body text not null check(length(body) between 1 and 2000), created_at timestamptz not null default now()
);
create index platform_messages_thread on platform_messages(thread_id,created_at);
create table platform_formats (
 id uuid primary key, user_id uuid not null references profiles on delete restrict,
 title text not null, recipe text not null, example_url text not null,
 medium text not null check(medium in ('image','video')),
 status text not null default 'submitted' check(status in ('submitted','accepted','rejected')),
 template_id uuid unique references prompt_items on delete restrict,
 rights_at timestamptz not null default now(), created_at timestamptz not null default now(),
 check ((status='accepted')=(template_id is not null))
);
create index platform_formats_owner on platform_formats(user_id,created_at desc);
create table platform_ratings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete cascade,
 template_id uuid not null references prompt_items on delete cascade,
 render_id uuid not null references render_jobs on delete cascade,
 stars integer not null check(stars between 1 and 5), message text not null default '' check(length(message)<=1000),
 excluded boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(user_id,template_id)
);
create index platform_ratings_template on platform_ratings(template_id,excluded);
create table platform_quality (
 template_id uuid primary key references prompt_items on delete cascade,
 score numeric(2,1) not null check(score between 1 and 5), updated_at timestamptz not null default now()
);
create table platform_audit (
 -- Historical actor identifier is deliberately not a cascading profile FK.
 id uuid primary key default gen_random_uuid(), actor_id uuid,
 entity_id uuid not null, action text not null, reason text not null check(length(reason) between 3 and 2000),
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
-- One-time paid order accounting. Actual cost and evidence required; no estimated zero cost.
create table platform_settlements (
 render_id uuid primary key references render_jobs on delete restrict,
 payment_id uuid unique not null references billing_payments on delete restrict,
 creator_id uuid references profiles on delete restrict,
 currency text not null check(currency='KRW'), revenue integer not null check(revenue>0),
 tax integer not null check(tax>=0), fees integer not null check(fees>=0),
 provider_cost integer not null check(provider_cost>=0), fx numeric not null check(fx>0),
 margin integer not null check(margin>=0), creator_due integer not null check(creator_due>=0),
 platform_margin integer not null check(platform_margin>=0), evidence text not null,
 created_at timestamptz not null default now(), check(creator_due+platform_margin=margin)
);
-- Immutable denomination. Commercial settings supplied only after owner approval.
create table platform_reward_policy (
 id integer primary key check(id=1), version text not null, cost_per_credit integer not null check(cost_per_credit>0),
 award_cap integer not null check(award_cap>0), terms_version text not null,
 created_at timestamptz not null default now()
);
create table platform_claims (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete restrict,
 render_id uuid unique not null references render_jobs on delete restrict, post_key text unique not null,
 post_url text not null, status text not null default 'submitted' check(status in ('submitted','approved','rejected','revoked')),
 credits integer not null default 0 check(credits>=0), policy_version text,
 created_at timestamptz not null default now()
);
create index platform_claims_owner on platform_claims(user_id,created_at desc);
create table platform_image_offers (
 id uuid primary key default gen_random_uuid(), template_id uuid not null references prompt_items on delete restrict,
 credits integer not null check(credits>0), max_cost integer not null check(max_cost>0), active boolean not null default false,
 template_fingerprint text not null,
 created_at timestamptz not null default now()
);
create table platform_credit_ledger (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles on delete restrict,
 delta integer not null check(delta<>0), kind text not null check(kind in ('grant','reserve','release','revoke')),
 claim_id uuid references platform_claims on delete restrict, render_id uuid references render_jobs on delete restrict,
 event_key text unique not null, created_at timestamptz not null default now()
);
create index platform_ledger_owner on platform_credit_ledger(user_id);
create table platform_redemptions (
 request_id uuid primary key, user_id uuid not null references profiles on delete restrict,
 offer_id uuid not null references platform_image_offers on delete restrict,
 portrait_id uuid not null, render_id uuid unique not null references render_jobs on delete restrict,
 credits integer not null check(credits>0), state text not null default 'reserved' check(state in ('reserved','completed','released')),
 created_at timestamptz not null default now()
);
create function platform_immutable() returns trigger language plpgsql as $$
begin raise exception 'platform immutable record'; end $$;
create trigger platform_ledger_immutable before update or delete on platform_credit_ledger for each row execute function platform_immutable();
create trigger platform_settlement_immutable before update or delete on platform_settlements for each row execute function platform_immutable();
create trigger platform_policy_immutable before update or delete on platform_reward_policy for each row execute function platform_immutable();
create trigger platform_audit_immutable before update or delete on platform_audit for each row execute function platform_immutable();

-- The legacy prompt editor must never make an accepted supplier recipe public or reassign it.
create function platform_private_format() returns trigger language plpgsql as $$
begin
 if exists(select 1 from platform_formats f where f.template_id=new.id and
   (new.text_visibility::text<>'hidden' or new.source::text<>'yagi' or new.author_id is distinct from f.user_id)) then
  raise exception 'platform private format contract';
 end if;
 return new;
end $$;
create trigger platform_private_format_guard before update on prompt_items for each row execute function platform_private_format();
