-- CLOUD APPLICATION REQUIRED — TWINGS · core migration 0184 — workspace approval record and trial credits (docs/BRAND-RECURRING-BILLING.md §6.5)
--
-- Apply this file (and 0185) BEFORE enabling `BRAND_WORKSPACE_APPROVAL=on`. Every reader and writer checks readiness
-- first (lib/brands/billing/workspace-approval-schema.ts) and degrades cleanly on an unmigrated database; with the flag
-- off no query names these tables or columns.
--
--   brand_workspace_approvals (new)  one row per organization an admin approved: who, when, the trial grant, a note.
--   brand_allowance_grants (~)       adds `kind` ('extra' by default | 'trial' | 'pack'), `carried_from` (the grant a
--                                    carried grant continues; deleted with it) and `trial_carry_checked_at` (when the
--                                    monthly carry evaluated this original trial: each is evaluated exactly once). One
--                                    ORIGINAL trial grant per organization, revoked or not; a grant is carried at most once.
--
-- Existing grant rows become `kind = 'extra'`, `carried_from = null`, `trial_carry_checked_at = null`; nothing else about
-- them changes. Code deployed before this file keeps working: it never names the new columns and its inserts take the
-- defaults. Safe to apply twice. Apply 0185 right after it in the same session (the new table needs its RLS at once).

set lock_timeout = '3s';

do $$
begin
  if to_regclass('public.brand_allowance_grants') is not null then
    alter table brand_allowance_grants
      add column if not exists kind text not null default 'extra',
      add column if not exists carried_from uuid references brand_allowance_grants(id) on delete cascade,
      add column if not exists trial_carry_checked_at timestamptz;

    if not exists (select 1 from pg_constraint where conname = 'brand_allowance_grants_kind' and conrelid = 'public.brand_allowance_grants'::regclass) then
      alter table brand_allowance_grants
        add constraint brand_allowance_grants_kind check (kind in ('extra','trial','pack'));
    end if;

    if not exists (select 1 from pg_constraint where conname = 'brand_allowance_grants_carried_self' and conrelid = 'public.brand_allowance_grants'::regclass) then
      alter table brand_allowance_grants
        add constraint brand_allowance_grants_carried_self check (carried_from is null or carried_from <> id);
    end if;

    -- One original trial grant per organization, whether or not it was revoked (docs/BRAND-RECURRING-BILLING.md §6.5).
    create unique index if not exists brand_allowance_grants_one_trial
      on brand_allowance_grants (organization_id)
      where kind = 'trial' and carried_from is null;

    -- A grant is carried into the next month at most once.
    create unique index if not exists brand_allowance_grants_carried_once
      on brand_allowance_grants (carried_from)
      where carried_from is not null;
  end if;
end $$;

reset lock_timeout;

create table if not exists brand_workspace_approvals (
  organization_id uuid primary key references brand_organizations(id) on delete cascade,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz not null default now(),
  trial_grant_id uuid,
  note text not null default '',
  constraint brand_workspace_approvals_note check (char_length(note) <= 500)
);

-- The link to the trial grant, added only where the grants table (0176) exists, so this file never fails on its own.
do $$
begin
  if to_regclass('public.brand_allowance_grants') is not null
     and not exists (select 1 from pg_constraint where conname = 'brand_workspace_approvals_trial_grant' and conrelid = 'public.brand_workspace_approvals'::regclass) then
    alter table brand_workspace_approvals
      add constraint brand_workspace_approvals_trial_grant foreign key (trial_grant_id) references brand_allowance_grants(id) on delete set null;
  end if;
end $$;
