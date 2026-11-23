-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0186 — billing cycle anchored on the plan start day (docs/BRAND-RECURRING-BILLING.md §5.8, B1c)
--
-- Apply this file and 0187 back to back in one session. Code deployed before it keeps working (it never names the new
-- columns; its inserts leave them null). The new code checks for the columns first and keeps the calendar-month paths
-- until they exist. Safe to apply twice.
--
--   brand_invoices (~)          adds `cycle_start` / `cycle_end` (KST dates, end exclusive; both null on calendar-month
--                               rows). One non-void subscription invoice per (organization, cycle_start) for cycle rows;
--                               the (organization, period) rule now applies only to rows without a cycle.
--   brand_allowance_grants (~)  adds `valid_from` / `valid_until` (inclusive) for grants valid on a date range, and the
--                               kind 'carry'. Nothing writes them yet; the allowance already honours them.
--
-- Existing rows keep null in every new column and are otherwise untouched.

set lock_timeout = '3s';

do $$
declare
  has_kind boolean;
begin
  if to_regclass('public.brand_invoices') is not null then
    alter table brand_invoices
      add column if not exists cycle_start date,
      add column if not exists cycle_end date;

    if not exists (select 1 from pg_constraint where conname = 'brand_invoices_cycle' and conrelid = 'public.brand_invoices'::regclass) then
      alter table brand_invoices
        add constraint brand_invoices_cycle check (
          (cycle_start is null and cycle_end is null)
          or (cycle_start is not null and cycle_end is not null and cycle_start < cycle_end)
        );
    end if;

    has_kind := exists (
      select 1 from pg_attribute
       where attrelid = 'public.brand_invoices'::regclass and attname = 'kind' and not attisdropped
    );

    -- Replace the (organization, period) rule of 0176 / 0182 by one that applies to calendar-month rows only, and add the
    -- per-cycle rule. Two cycle invoices may then share a calendar month.
    drop index if exists brand_invoices_org_period_active;
    drop index if exists brand_invoices_org_period_subscription_active;
    if has_kind then
      create unique index if not exists brand_invoices_org_period_legacy_active
        on brand_invoices (organization_id, period)
        where status <> 'void' and kind = 'subscription' and cycle_start is null;
      create unique index if not exists brand_invoices_org_cycle_active
        on brand_invoices (organization_id, cycle_start)
        where status <> 'void' and kind = 'subscription' and cycle_start is not null;
    else
      create unique index if not exists brand_invoices_org_period_legacy_active
        on brand_invoices (organization_id, period)
        where status <> 'void' and cycle_start is null;
      create unique index if not exists brand_invoices_org_cycle_active
        on brand_invoices (organization_id, cycle_start)
        where status <> 'void' and cycle_start is not null;
    end if;
  end if;
end $$;

do $$
begin
  if to_regclass('public.brand_allowance_grants') is not null then
    alter table brand_allowance_grants
      add column if not exists valid_from date,
      add column if not exists valid_until date;

    if not exists (select 1 from pg_constraint where conname = 'brand_allowance_grants_valid_range' and conrelid = 'public.brand_allowance_grants'::regclass) then
      alter table brand_allowance_grants
        add constraint brand_allowance_grants_valid_range check (
          (valid_from is null and valid_until is null)
          or (valid_from is not null and valid_until is not null and valid_from <= valid_until)
        );
    end if;

    if exists (
      select 1 from pg_attribute
       where attrelid = 'public.brand_allowance_grants'::regclass and attname = 'kind' and not attisdropped
    ) then
      alter table brand_allowance_grants drop constraint if exists brand_allowance_grants_kind;
      alter table brand_allowance_grants
        add constraint brand_allowance_grants_kind check (kind in ('extra','trial','pack','carry'));
    end if;
  end if;
end $$;

reset lock_timeout;
