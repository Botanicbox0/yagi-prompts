-- Toss one-time payments. CLOUD APPLICATION REQUIRED.
-- Payment records are independent of the funding method: a later billing-key charge can
-- reuse the settlement/refund ledger without adding subscription behavior in this migration.
create table billing_payments (
  id uuid primary key,
  user_id uuid references profiles on delete set null,
  provider text not null default 'toss' check (provider = 'toss'),
  environment text not null check (environment in ('test','live','fake')),
  payment_type text not null default 'NORMAL' check (payment_type in ('NORMAL','BILLING')),
  amount_krw integer not null check (amount_krw > 0),
  currency text not null default 'KRW' check (currency = 'KRW'),
  status text not null default 'pending' check (status in ('pending','confirming','paid','refund_pending','refunded','failed')),
  payment_key text unique,
  template_id uuid references prompt_items on delete restrict,
  template_slug text,
  order_name text not null,
  aspect text,
  locale text not null check (locale in ('ko','en')),
  -- Reserve the final storage namespace before approval; no render exists yet.
  render_ref uuid unique,
  input_key text,
  input_mime text,
  render_id uuid unique references render_jobs on delete set null,
  fulfilled_at timestamptz,
  consent_at timestamptz,
  consent_version text,
  approved_at timestamptz,
  refunded_at timestamptz,
  lease_until timestamptz,
  failure_code text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Future billing-key charges need no template/photo. No BILLING writer is shipped here.
  constraint billing_normal_render_input check (payment_type <> 'NORMAL' or
    (template_id is not null and template_slug is not null and aspect is not null and
     render_ref is not null and input_key is not null and input_mime is not null)),
  constraint billing_paid_proof check (status not in ('paid','refund_pending','refunded') or
    (payment_key is not null and approved_at is not null and consent_at is not null)),
  constraint billing_refund_proof check (status <> 'refunded' or refunded_at is not null)
);
create index billing_payments_owner on billing_payments (user_id, created_at desc);
create index billing_payments_pending on billing_payments (status, lease_until)
  where status in ('confirming','paid','refund_pending');
create trigger trg_billing_payments_updated_at before update on billing_payments
  for each row execute function set_updated_at();
