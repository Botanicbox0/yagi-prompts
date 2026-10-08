-- Pricing preparation only. No live subscriptions, charges or credits are created.
create table creator_plan_versions (
  version_id text primary key,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  recorded_at timestamptz not null default now(),
  check (snapshot->>'id' = version_id),
  check ((snapshot->>'priceKrw')::integer > 0),
  check ((snapshot->>'monthlyCredits')::integer > 0)
);

insert into creator_plan_versions (version_id, snapshot)
select id, jsonb_build_object(
  'id',id, 'tier',tier, 'priceKrw',price, 'monthlyCredits',credits,
  'currency','KRW', 'interval','month', 'vatIncluded',true,
  'deductionVersion','seedance25-2026-10-07-v1', 'costVersion','byteplus-2026-10-07-v1', 'rollover',false
) from (values
  ('creator-2026-10-07-v1','creator',19000,400),
  ('creator-2026-10-08-v2','creator',29000,620),
  ('advanced-2026-10-08-v1','advanced',49000,1060)
) as versions(id,tier,price,credits);

-- Future live subscriptions and billing attempts must reference this agreement ID.
-- An agreement is evidence of terms only, NEVER a payment/entitlement/credit grant.
-- This migration deliberately inserts no agreements and grants no runtime writer.
create table creator_subscription_terms (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete restrict,
  plan_version_id text not null references creator_plan_versions(version_id) on delete restrict,
  legal_version text not null check (length(trim(legal_version)) > 0),
  consent_reference text not null unique check (length(trim(consent_reference)) > 0),
  agreed_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index creator_subscription_terms_user_idx on creator_subscription_terms(user_id);

create function reject_creator_terms_mutation() returns trigger
language plpgsql security invoker set search_path = pg_catalog as $$
begin
  raise exception 'Creator pricing history is immutable; insert a new version or agreement';
end;
$$;
revoke all on function reject_creator_terms_mutation() from public;
create trigger creator_plan_versions_immutable before update or delete on creator_plan_versions
for each row execute function reject_creator_terms_mutation();
create trigger creator_subscription_terms_immutable before update or delete on creator_subscription_terms
for each row execute function reject_creator_terms_mutation();

alter table creator_plan_versions enable row level security;
alter table creator_plan_versions force row level security;
alter table creator_subscription_terms enable row level security;
alter table creator_subscription_terms force row level security;
