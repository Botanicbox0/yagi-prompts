-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0182 — B2B brand subscriptions core (docs/BRAND-RECURRING-BILLING.md §9, §14 B1a)
--
-- Apply this file (and 0183) BEFORE enabling `BRAND_BILLING_AUTO_ISSUE=on`. All new readers and
-- writers check readiness through `loadSubscriptionSchemaReady()` first and skip/degrade cleanly on
-- unmigrated DBs; when `BRAND_BILLING_AUTO_ISSUE` is off, zero queries touch these tables/columns.
--
--   brand_subscriptions           one row per subscribed organization (status, plan, pending downgrade, epoch, cancel flag, revision, last_reconciled_at,
--                                 reconcile_failures / last_reconcile_error: consecutive failed runs and the last short error code).
--   brand_subscription_events     append-only audit log of subscription lifecycle and admin/system actions.
--   brand_invoices (~)            adds `kind`, `covers_months`, `due_on`, `collection_method`, `tax_invoice_issued_on`,
--                                 `tax_invoice_ref`, `created_via`, `issued_via`, `subscription_epoch`; scopes active (org, period) uniqueness to `kind = 'subscription'`.
--   brand_invoice_events (~)      adds `actor_kind` ('admin'|'system') and the `'tax_invoice_recorded'` and `'adopted'` actions.
--   brand_plan_events (~)         adds `actor_kind` ('admin'|'system').
--
-- `brand_plan_assignments` is not changed: the engine always writes `ends_on > started_on` (0074's check).

create table if not exists brand_subscriptions (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  status text not null,
  plan_id text not null,
  pending_plan_id text,
  pending_plan_effective_period text,
  collection_method text not null default 'transfer',
  started_on date not null,
  prepaid_through date,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_at timestamptz,
  activated_before_payment boolean not null default false,
  epoch integer not null default 1,
  last_reconciled_at timestamptz,
  reconcile_failures integer not null default 0,
  last_reconcile_error text,
  revision integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brand_subscriptions_status check (status in ('pending','active','past_due','suspended','ended')),
  constraint brand_subscriptions_plan check (plan_id in ('b2b_29','b2b_49','b2b_69')),
  constraint brand_subscriptions_pending_plan check (pending_plan_id is null or pending_plan_id in ('b2b_29','b2b_49','b2b_69')),
  constraint brand_subscriptions_pending_period check (pending_plan_effective_period is null or pending_plan_effective_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint brand_subscriptions_pending_diff check (pending_plan_id is null or pending_plan_id <> plan_id),
  constraint brand_subscriptions_collection_method check (collection_method in ('transfer','card')),
  constraint brand_subscriptions_ended_check check ((status = 'ended') = (ended_at is not null)),
  constraint brand_subscriptions_canceled_check check (not cancel_at_period_end or canceled_at is not null),
  constraint brand_subscriptions_epoch check (epoch >= 1),
  constraint brand_subscriptions_reconcile_failures check (reconcile_failures >= 0),
  constraint brand_subscriptions_last_reconcile_error check (last_reconcile_error is null or char_length(last_reconcile_error) <= 120),
  constraint brand_subscriptions_revision check (revision >= 1)
);
do $$
begin
  if to_regclass('public.brand_subscriptions') is not null then
    alter table brand_subscriptions
      add column if not exists pending_plan_effective_period text,
      add column if not exists epoch integer not null default 1,
      add column if not exists last_reconciled_at timestamptz,
      add column if not exists reconcile_failures integer not null default 0,
      add column if not exists last_reconcile_error text;
    if not exists (select 1 from pg_constraint where conname = 'brand_subscriptions_pending_period' and conrelid = 'public.brand_subscriptions'::regclass) then
      alter table brand_subscriptions
        add constraint brand_subscriptions_pending_period check (pending_plan_effective_period is null or pending_plan_effective_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
    end if;
    if not exists (select 1 from pg_constraint where conname = 'brand_subscriptions_epoch' and conrelid = 'public.brand_subscriptions'::regclass) then
      alter table brand_subscriptions
        add constraint brand_subscriptions_epoch check (epoch >= 1);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'brand_subscriptions_reconcile_failures' and conrelid = 'public.brand_subscriptions'::regclass) then
      alter table brand_subscriptions
        add constraint brand_subscriptions_reconcile_failures check (reconcile_failures >= 0);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'brand_subscriptions_last_reconcile_error' and conrelid = 'public.brand_subscriptions'::regclass) then
      alter table brand_subscriptions
        add constraint brand_subscriptions_last_reconcile_error check (last_reconcile_error is null or char_length(last_reconcile_error) <= 120);
    end if;
  end if;
end $$;
drop index if exists idx_brand_subscriptions_tick;
create index if not exists idx_brand_subscriptions_tick
  on brand_subscriptions (last_reconciled_at asc nulls first, organization_id asc)
  where status <> 'ended';

create table if not exists brand_subscription_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  action text not null,
  actor uuid references profiles(id) on delete set null,
  actor_kind text not null default 'admin',
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint brand_subscription_events_action check (
    action in (
      'started',
      'status_changed',
      'plan_changed',
      'downgrade_scheduled',
      'downgrade_cleared',
      'cancel_scheduled',
      'cancel_undone',
      'ended',
      'reconciled'
    )
  ),
  constraint brand_subscription_events_actor_kind check (actor_kind in ('admin','system')),
  constraint brand_subscription_events_actor_check check (actor_kind <> 'system' or actor is null)
);
create index if not exists idx_brand_subscription_events_org
  on brand_subscription_events (organization_id, created_at desc);

set lock_timeout = '3s';

do $$
begin
  if to_regclass('public.brand_invoices') is not null then
    alter table brand_invoices
      add column if not exists kind text not null default 'subscription',
      add column if not exists covers_months integer not null default 1,
      add column if not exists due_on date,
      add column if not exists collection_method text,
      add column if not exists tax_invoice_issued_on date,
      add column if not exists tax_invoice_ref text,
      add column if not exists created_via text,
      add column if not exists issued_via text,
      add column if not exists subscription_epoch integer;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_kind' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_kind check (kind in ('subscription','adjustment','prepay','credit_pack'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_covers_months' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_covers_months check (covers_months between 1 and 12);
    end if;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_collection_method' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_collection_method check (collection_method is null or collection_method in ('transfer','card'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_tax_invoice_ref' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_tax_invoice_ref check (tax_invoice_ref is null or char_length(tax_invoice_ref) <= 120);
    end if;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_created_via' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_created_via check (created_via is null or created_via in ('admin','system'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_issued_via' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_issued_via check (issued_via is null or issued_via in ('admin','system'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_subscription_epoch' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_subscription_epoch check (subscription_epoch is null or subscription_epoch >= 1);
    end if;

    drop index if exists brand_invoices_org_period_active;
    create unique index if not exists brand_invoices_org_period_subscription_active
      on brand_invoices (organization_id, period)
      where status <> 'void' and kind = 'subscription';

    create index if not exists idx_brand_invoices_org_epoch
      on brand_invoices (organization_id, subscription_epoch, period)
      where subscription_epoch is not null;

    create index if not exists idx_brand_invoices_due_on
      on brand_invoices (due_on)
      where status = 'issued' and due_on is not null;

    create index if not exists idx_brand_invoices_tax_pending
      on brand_invoices (period, organization_id)
      where status in ('issued','paid') and tax_invoice_issued_on is null;
  end if;
end $$;

do $$
declare
  c record;
begin
  if to_regclass('public.brand_invoice_events') is not null then
    alter table brand_invoice_events
      add column if not exists actor_kind text not null default 'admin';

    if not exists (select 1 from pg_constraint where conname = 'brand_invoice_events_actor_kind' and conrelid = 'public.brand_invoice_events'::regclass) then
      alter table brand_invoice_events
        add constraint brand_invoice_events_actor_kind check (actor_kind in ('admin','system'));
    end if;

    for c in
      select con.conname
        from pg_constraint con
       where con.conrelid = 'public.brand_invoice_events'::regclass
         and con.contype = 'c'
         and exists (
           select 1
             from pg_attribute a
            where a.attrelid = con.conrelid
              and a.attnum = any (con.conkey)
              and a.attname = 'action'
         )
    loop
      execute format('alter table public.brand_invoice_events drop constraint %I', c.conname);
    end loop;

    alter table brand_invoice_events
      add constraint brand_invoice_events_action check (
        action in ('drafted','edited','issued','paid','voided','tax_invoice_recorded','adopted')
      );
  end if;
end $$;

do $$
begin
  if to_regclass('public.brand_plan_events') is not null then
    alter table brand_plan_events
      add column if not exists actor_kind text not null default 'admin';

    if not exists (select 1 from pg_constraint where conname = 'brand_plan_events_actor_kind' and conrelid = 'public.brand_plan_events'::regclass) then
      alter table brand_plan_events
        add constraint brand_plan_events_actor_kind check (actor_kind in ('admin','system'));
    end if;
  end if;
end $$;

reset lock_timeout;
