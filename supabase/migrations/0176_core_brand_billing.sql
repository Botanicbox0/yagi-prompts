-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0176 — B2B billing core (docs/BRAND-PRODUCT.md §6.4)
--
-- Apply this file (and 0177) alongside the B2B billing core deployment. All readers and writers
-- tolerate unmigrated tables/columns (falling back to pre-0176 behavior) so code can ship safely
-- before cloud migration application.
--
--   brand_studio_allowances (~)           adds `is_override` (default true so all existing rows stay explicit overrides).
--   brand_plan_allowance_defaults         paid-plan default monthly allowance KRW (`b2b_29`|`b2b_49`|`b2b_69`, nullable = unset).
--   brand_plan_allowance_default_events   append-only audit log of plan default updates and affected organization counts.
--   brand_discount_codes                  admin-issued promo/discount codes redeemable by organization owners/admins.
--   brand_discounts                       per-organization count-based discounts (at most one active per organization).
--   brand_discount_redemptions            one redemption per (code, organization).
--   brand_discount_code_attempts          DB-backed redemption attempt ledger (5/10m per org + 10/1h per user, pruned >1d).
--   brand_billing_profiles                per-organization tax-invoice / billing contact details.
--   brand_invoices                        monthly B2B invoice ledger (draft -> issued -> paid | void).
--   brand_invoice_events                  append-only audit log of invoice drafting, edits, issuance, payment, and voiding.
--   brand_allowance_grants                one-off extra credit grants (strictly one KST calendar month via `valid_month`).

set lock_timeout = '3s';
alter table brand_studio_allowances
  add column if not exists is_override boolean not null default true;
reset lock_timeout;

create table if not exists brand_plan_allowance_defaults (
  plan_id text primary key,
  monthly_cap_krw integer,
  affected_org_count integer not null default 0,
  note text not null default '',
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_plan_allowance_defaults_plan check (plan_id in ('b2b_29','b2b_49','b2b_69')),
  constraint brand_plan_allowance_defaults_cap check (monthly_cap_krw is null or monthly_cap_krw between 0 and 100000000),
  constraint brand_plan_allowance_defaults_affected check (affected_org_count >= 0),
  constraint brand_plan_allowance_defaults_note check (char_length(note) <= 500)
);

create table if not exists brand_plan_allowance_default_events (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null,
  previous_cap_krw integer,
  monthly_cap_krw integer,
  affected_org_count integer not null default 0,
  note text not null default '',
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_plan_allowance_default_events_plan check (plan_id in ('b2b_29','b2b_49','b2b_69')),
  constraint brand_plan_allowance_default_events_prev check (previous_cap_krw is null or previous_cap_krw between 0 and 100000000),
  constraint brand_plan_allowance_default_events_cap check (monthly_cap_krw is null or monthly_cap_krw between 0 and 100000000),
  constraint brand_plan_allowance_default_events_affected check (affected_org_count >= 0),
  constraint brand_plan_allowance_default_events_note check (char_length(note) <= 500)
);
create index if not exists idx_brand_plan_allowance_default_events_plan
  on brand_plan_allowance_default_events (plan_id, created_at desc);

create table if not exists brand_discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  percent integer not null,
  invoices_total integer,
  max_redemptions integer default 1,
  redeemed_count integer not null default 0,
  valid_until timestamptz,
  organization_id uuid references brand_organizations(id) on delete cascade,
  memo text not null default '',
  disabled boolean not null default false,
  disabled_by uuid references profiles(id) on delete set null,
  disabled_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_discount_codes_format check (code ~ '^[A-Z0-9-]{10,24}$'),
  constraint brand_discount_codes_percent check (percent between 1 and 100),
  constraint brand_discount_codes_invoices_total check (invoices_total is null or invoices_total between 1 and 36),
  constraint brand_discount_codes_max_redemptions check (max_redemptions is null or max_redemptions between 1 and 100000),
  constraint brand_discount_codes_redeemed_count check (redeemed_count >= 0 and (max_redemptions is null or redeemed_count <= max_redemptions)),
  constraint brand_discount_codes_memo check (char_length(memo) <= 500),
  constraint brand_discount_codes_disabled_at check (not disabled or disabled_at is not null)
);
create index if not exists idx_brand_discount_codes_org
  on brand_discount_codes (organization_id)
  where organization_id is not null;

create table if not exists brand_discounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  percent integer not null,
  invoices_total integer,
  invoices_used integer not null default 0,
  status text not null default 'active',
  memo text not null default '',
  source text not null default 'admin',
  code_id uuid references brand_discount_codes(id) on delete restrict,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references profiles(id) on delete set null,
  end_reason text not null default '',
  constraint brand_discounts_percent check (percent between 1 and 100),
  constraint brand_discounts_invoices_total check (invoices_total is null or invoices_total between 1 and 36),
  constraint brand_discounts_invoices_used check (invoices_used >= 0 and (invoices_total is null or invoices_used <= invoices_total)),
  constraint brand_discounts_status check (status in ('active','ended')),
  constraint brand_discounts_memo check (char_length(memo) <= 500),
  constraint brand_discounts_source check (source in ('admin','code')),
  constraint brand_discounts_source_code check ((source = 'code') = (code_id is not null)),
  constraint brand_discounts_ended_check check ((status = 'ended') = (ended_at is not null)),
  constraint brand_discounts_end_reason check (char_length(end_reason) <= 500)
);
create unique index if not exists brand_discounts_one_active_per_org
  on brand_discounts (organization_id)
  where status = 'active';
create index if not exists idx_brand_discounts_org
  on brand_discounts (organization_id, created_at desc);

create table if not exists brand_discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references brand_discount_codes(id) on delete restrict,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  discount_id uuid not null references brand_discounts(id) on delete restrict,
  redeemed_by uuid references profiles(id) on delete set null,
  redeemed_at timestamptz not null default now(),
  constraint brand_discount_redemptions_once unique (code_id, organization_id)
);
create index if not exists idx_brand_discount_redemptions_org
  on brand_discount_redemptions (organization_id, redeemed_at desc);

create table if not exists brand_discount_code_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_brand_discount_code_attempts_org_time
  on brand_discount_code_attempts (organization_id, created_at desc);
create index if not exists idx_brand_discount_code_attempts_actor_time
  on brand_discount_code_attempts (actor_id, created_at desc)
  where actor_id is not null;
create index if not exists idx_brand_discount_code_attempts_created
  on brand_discount_code_attempts (created_at asc);

create table if not exists brand_billing_profiles (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  company_legal_name text not null default '',
  business_reg_no text not null default '',
  representative_name text not null default '',
  business_address text not null default '',
  tax_invoice_email text not null default '',
  contact_name text not null default '',
  contact_phone text not null default '',
  memo text not null default '',
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_billing_profiles_legal_name check (char_length(company_legal_name) <= 120),
  constraint brand_billing_profiles_reg_no check (business_reg_no = '' or business_reg_no ~ '^[0-9]{10}$'),
  constraint brand_billing_profiles_rep check (char_length(representative_name) <= 80),
  constraint brand_billing_profiles_address check (char_length(business_address) <= 300),
  constraint brand_billing_profiles_email check (char_length(tax_invoice_email) <= 254),
  constraint brand_billing_profiles_contact_name check (char_length(contact_name) <= 80),
  constraint brand_billing_profiles_contact_phone check (char_length(contact_phone) <= 40),
  constraint brand_billing_profiles_memo check (char_length(memo) <= 500)
);

create table if not exists brand_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  period text not null,
  plan_id text not null,
  base_list_krw integer not null,
  list_krw integer not null,
  prorated_days integer,
  period_days integer,
  discount_id uuid references brand_discounts(id) on delete set null,
  discount_percent integer not null default 0,
  discount_krw integer not null default 0,
  supply_krw integer not null,
  vat_krw integer not null,
  total_krw integer not null,
  manual_amounts boolean not null default false,
  manual_reason text not null default '',
  status text not null default 'draft',
  issued_at timestamptz,
  issued_by uuid references profiles(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references profiles(id) on delete set null,
  paid_method text not null default '',
  voided_at timestamptz,
  voided_by uuid references profiles(id) on delete set null,
  void_reason text not null default '',
  memo text not null default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint brand_invoices_period check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint brand_invoices_plan check (plan_id in ('b2b_29','b2b_49','b2b_69','project_only')),
  constraint brand_invoices_manual_reason check (
    (not manual_amounts and manual_reason = '')
    or (manual_amounts and char_length(btrim(manual_reason)) > 0 and char_length(manual_reason) <= 500)
  ),
  constraint brand_invoices_amounts check (
    base_list_krw between 0 and 1000000000
    and list_krw between 0 and 1000000000
    and discount_percent between 0 and 100
    and discount_krw between 0 and list_krw
    and supply_krw between 0 and 1000000000
    and vat_krw between 0 and 1000000000
    and total_krw = supply_krw + vat_krw
  ),
  -- Matches BRAND_PLAN_PRICES_VAT_EXCLUSIVE = true and BRAND_INVOICE_VAT_PERCENT = 10 in math.ts
  constraint brand_invoices_derived_amounts check (
    manual_amounts or (
      list_krw = case
        when prorated_days is null then base_list_krw
        else ((base_list_krw::bigint * prorated_days) / period_days)::integer
      end
      and discount_krw = ((list_krw::bigint * discount_percent) / 100)::integer
      and supply_krw = list_krw - discount_krw
      and vat_krw = ((supply_krw::bigint * 10) / 100)::integer
      and total_krw = supply_krw + vat_krw
    )
  ),
  constraint brand_invoices_prorate check (
    (prorated_days is null and period_days is null)
    or (period_days between 28 and 31 and prorated_days between 1 and period_days)
  ),
  constraint brand_invoices_status check (status in ('draft','issued','paid','void')),
  constraint brand_invoices_issued_check check (status not in ('issued','paid') or issued_at is not null),
  constraint brand_invoices_paid_check check ((status = 'paid') = (paid_at is not null)),
  constraint brand_invoices_void_check check ((status = 'void') = (voided_at is not null)),
  constraint brand_invoices_paid_method check (char_length(paid_method) <= 200),
  constraint brand_invoices_void_reason check (char_length(void_reason) <= 500),
  constraint brand_invoices_memo check (char_length(memo) <= 500)
);
create unique index if not exists brand_invoices_org_period_active
  on brand_invoices (organization_id, period)
  where status <> 'void';
create index if not exists idx_brand_invoices_org_period
  on brand_invoices (organization_id, period desc, created_at desc);
create index if not exists idx_brand_invoices_overdue
  on brand_invoices (status, issued_at)
  where status = 'issued';

create table if not exists brand_invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references brand_invoices(id) on delete cascade,
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  action text not null,
  from_status text,
  to_status text not null,
  snapshot jsonb not null default '{}'::jsonb,
  note text not null default '',
  actor_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint brand_invoice_events_action check (action in ('drafted','edited','issued','paid','voided')),
  constraint brand_invoice_events_from check (from_status is null or from_status in ('draft','issued','paid','void')),
  constraint brand_invoice_events_to check (to_status in ('draft','issued','paid','void')),
  constraint brand_invoice_events_note check (char_length(note) <= 500)
);
create index if not exists idx_brand_invoice_events_invoice
  on brand_invoice_events (invoice_id, created_at asc);
create index if not exists idx_brand_invoice_events_org
  on brand_invoice_events (organization_id, created_at desc);

create table if not exists brand_allowance_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references brand_organizations(id) on delete cascade,
  amount_krw integer not null,
  valid_month text not null,
  reason text not null default '',
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references profiles(id) on delete set null,
  constraint brand_allowance_grants_amount check (amount_krw between 1 and 100000000),
  constraint brand_allowance_grants_valid_month check (valid_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint brand_allowance_grants_reason check (char_length(reason) <= 500),
  constraint brand_allowance_grants_revoked check (revoked_by is null or revoked_at is not null)
);
create index if not exists idx_brand_allowance_grants_org
  on brand_allowance_grants (organization_id, valid_month, created_at desc);
