import type { Viewer } from '@/lib/auth/identity';
import { creditsLeft, creditsOf } from '@/lib/brand-studio/credits';
import type { StudioEnv } from '@/lib/brand-studio/env';
import { loadAllowanceRefill } from '@/lib/brand-studio/allowance-refill';
import { allowanceWindowView } from '@/lib/brand-studio/allowance-window';
import { grantEffectiveStartSql, loadAllowance } from '@/lib/brand-studio/usage';
import {
  listExtraAllowanceGrants,
  loadActiveBrandDiscount,
  loadBrandBillingProfile,
  loadCustomerBrandBilling,
  requireDbAdmin,
} from '@/lib/brands/billing';
import { listBrandInvoices } from '@/lib/brands/billing/invoices';
import {
  addCalendarDays,
  BRAND_PLAN_GRACE_DAYS_DEFAULT,
  kstDayOf,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
} from '@/lib/brands/billing/math';
import { hasColumn, hasTable, hasTables } from '@/lib/brands/billing/schema-guard';
import { loadTrialUsability } from '@/lib/brands/billing/workspace-approval';
import { loadWorkspaceApprovalSchemaReady } from '@/lib/brands/billing/workspace-approval-schema';
import { brandWorkspaceApprovalOpen } from '@/lib/flags';
import { BrandBillingDenied } from '@/lib/brands/billing/access';
import { isSandboxedClientOrganization } from '@/lib/brands/features';
import { BRAND_PLANS, loadPlanAssignment } from '@/lib/brands/plans';
import type { BrandWorkspaceChoice } from '@/lib/brands/workspace/selection';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  billingProfileCompleteness,
  BILLING_PROFILE_FIELDS,
  grantExpiryDay,
  type BillingPlanCatalogueItem,
  type CustomerBillingProfileValues,
  type CustomerBrandBillingPayload,
  type CustomerExtraGrantView,
} from './billing-ui';

/** Derive customer plan catalogue rows strictly from `BRAND_PLANS` (single pricing source of truth). */
export function billingPlanCatalogue(): BillingPlanCatalogueItem[] {
  return PAID_BRAND_PLAN_IDS.map((id) => ({
    id,
    monthlyKrw: BRAND_PLANS[id].monthlyKrw,
    rank: BRAND_PLANS[id].rank as 1 | 2 | 3,
  }));
}

const REQUIRED_BILLING_TABLES = [
  'brand_plan_allowance_defaults',
  'brand_discount_codes',
  'brand_discounts',
  'brand_billing_profiles',
  'brand_invoices',
  'brand_allowance_grants',
] as const;

export async function hasBillingSchemaReady(sql: SqlRunner): Promise<boolean> {
  return hasTables(sql, REQUIRED_BILLING_TABLES);
}

export async function loadCustomerExtraGrants(
  sql: SqlRunner,
  organizationId: string,
  now = new Date(),
  options: {
    /** The trial's last day when the caller already read it (`StudioAllowanceView.refill.trialThrough`): no second read. */
    trialThrough?: string | null;
  } = {},
): Promise<CustomerExtraGrantView[]> {
  if (!(await hasTable(sql, 'brand_allowance_grants'))) return [];
  const grants = (await listExtraAllowanceGrants(sql, organizationId, now)).filter((grant) => grant.activeNow && !grant.revokedAt);
  // R4: a trial grant (its `kind` is read only with BRAND_WORKSPACE_APPROVAL on and 0184 applied) is listed as the trial,
  // until the last day the trial can be used — the admin panel's rule, read once and only when a trial row counts now.
  const trialThrough = grants.some((grant) => grant.kind === 'trial')
    ? (options.trialThrough ?? (await loadTrialUsability(sql, organizationId, { now }))?.usableThrough ?? null)
    : null;
  return grants
    .map((grant) =>
      grant.kind === 'trial' && trialThrough
        ? { id: grant.id, credits: creditsOf(grant.amountKrw), validMonth: grant.validMonth, expiresOn: trialThrough, kind: 'trial' as const }
        : {
            id: grant.id,
            credits: creditsOf(grant.amountKrw),
            validMonth: grant.validMonth,
            expiresOn: grantExpiryDay(grant.validMonth),
          },
    )
    .filter((grant) => grant.credits > 0);
}

/**
 * R1: a plan organization's extra credits as its allowance counts them (B1c, `planCycleTotals` in
 * lib/brand-studio/usage.ts): the unrevoked grants whose effective start day falls inside the current billing cycle,
 * each lasting until the cycle's last day. Organizations on the calendar month keep `loadCustomerExtraGrants`.
 *
 * R4: a trial grant is listed as the trial. Its last day is still the cycle's last day, not the trial rule's end of the
 * next month: the allowance attaches it to this one cycle and the month-end carry skips plan organizations, so the
 * cycle's last day is the day the allowance stops counting it. The grant kind is read only with
 * BRAND_WORKSPACE_APPROVAL on and 0184 applied; off, the statement is as before.
 */
export async function loadCustomerCycleExtraGrants(
  sql: SqlRunner,
  organizationId: string,
  cycle: { start: string; end: string },
): Promise<CustomerExtraGrantView[]> {
  if (!(await hasTable(sql, 'brand_allowance_grants'))) return [];
  const effectiveStart = grantEffectiveStartSql(await hasColumn(sql, 'brand_allowance_grants', 'valid_from'));
  const withKind = brandWorkspaceApprovalOpen() && (await loadWorkspaceApprovalSchemaReady(sql));
  const { rows } = await sql.query<{ id: string; amount_krw: string | number; valid_month: string; kind?: string }>(
    `select id::text as id, amount_krw, valid_month${withKind ? ', kind' : ''} from brand_allowance_grants
      where organization_id = $1 and revoked_at is null and ${effectiveStart} >= $2::date and ${effectiveStart} < $3::date
      order by created_at desc, id desc`,
    [organizationId, cycle.start, cycle.end],
  );
  const lastDay = addCalendarDays(cycle.end, -1);
  return rows
    .map((row) => ({
      id: String(row.id),
      credits: creditsOf(Number(row.amount_krw)),
      validMonth: String(row.valid_month),
      expiresOn: lastDay,
      ...(row.kind === 'trial' ? { kind: 'trial' as const } : {}),
    }))
    .filter((grant) => grant.credits > 0);
}

export async function loadBillingProfileCompletenessForOrg(
  sql: SqlRunner,
  organizationId: string,
): Promise<{
  filled: number;
  total: number;
  complete: boolean;
  missingFields: (keyof CustomerBillingProfileValues)[];
}> {
  if (!(await hasTable(sql, 'brand_billing_profiles'))) {
    return {
      filled: 0,
      total: BILLING_PROFILE_FIELDS.length,
      complete: false,
      missingFields: [...BILLING_PROFILE_FIELDS],
    };
  }
  const profile = await loadBrandBillingProfile(sql, organizationId);
  return billingProfileCompleteness(profile);
}

export type BrandBillingPageState =
  | {
      kind: 'ready';
      staffReadOnly: boolean;
      todayKst: string;
      graceDays: number;
      billing: CustomerBrandBillingPayload;
    }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'unavailable' }
  | { kind: 'sign_in' };

export async function loadBrandBillingPageState(
  deps: {
    sql: SqlRunner;
    env: Pick<StudioEnv, 'defaultMonthlyKrw' | 'planGraceDays'>;
    now?: () => Date;
    locale?: 'ko' | 'en';
  },
  viewer: Viewer,
  choice: Pick<BrandWorkspaceChoice, 'id' | 'name' | 'role'> | null,
): Promise<BrandBillingPageState> {
  if (!choice) return { kind: 'unavailable' };
  if (isSandboxedClientOrganization(choice)) return { kind: 'not_found' };
  if (!(await hasBillingSchemaReady(deps.sql))) return { kind: 'unavailable' };

  if (choice.role === 'studio') {
    try {
      await requireDbAdmin(deps.sql, viewer);
    } catch (error) {
      if (error instanceof BrandBillingDenied) {
        return error.code === 'sign_in_required' ? { kind: 'sign_in' } : { kind: 'forbidden' };
      }
      return { kind: 'unavailable' };
    }

    const orgRow = (
      await deps.sql.query<{ id: string; name: string }>(
        'select id, name from brand_organizations where id = $1',
        [choice.id],
      )
    ).rows[0];
    if (
      !orgRow ||
      isSandboxedClientOrganization({ id: String(orgRow.id), name: String(orgRow.name ?? '') })
    ) {
      return { kind: 'not_found' };
    }

    const now = deps.now ? deps.now() : new Date();
    const dict = getDictionary(deps.locale === 'en' ? 'en' : 'ko');
    const [assignment, allowance, activeDiscount, allInvoices, profile, extraGrants] =
      await Promise.all([
        loadPlanAssignment(deps.sql, choice.id),
        loadAllowance(deps.sql, choice.id, deps.env, now),
        loadActiveBrandDiscount(deps.sql, choice.id),
        listBrandInvoices(deps.sql, { organizationId: choice.id, now }),
        loadBrandBillingProfile(deps.sql, choice.id),
        loadCustomerExtraGrants(deps.sql, choice.id, now),
      ]);

    const today = kstDayOf(now);
    const graceDays = deps.env.planGraceDays ?? BRAND_PLAN_GRACE_DAYS_DEFAULT;
    const planStatus = planActiveWithGrace(assignment, today, graceDays);
    // R1: a plan organization lists the grants its cycle counts; the calendar month keeps the list loaded above.
    const shownGrants = allowance.cycle ? await loadCustomerCycleExtraGrants(deps.sql, choice.id, allowance.cycle) : extraGrants;
    // R4: the same refill fact the owner's page gets (no statement unless the base cap is 0 and the cap above 0).
    const refill = await loadAllowanceRefill(deps.sql, choice.id, allowance, { now });

    return {
      kind: 'ready',
      staffReadOnly: true,
      todayKst: today,
      graceDays,
      billing: {
        organizationId: choice.id,
        plan: assignment
          ? {
              id: assignment.planId,
              name: dict.brandWorkspace.planNames[assignment.planId],
              monthlyListKrw: BRAND_PLANS[assignment.planId].monthlyKrw,
              billingMode: assignment.billingMode,
              startedOn: assignment.startedOn,
              endsOn: assignment.endsOn,
              active: planStatus.active,
              inGrace: planStatus.inGrace,
              seats: assignment.seats,
            }
          : null,
        allowance: {
          capKrw: allowance.capKrw,
          baseCapKrw: allowance.baseCapKrw,
          extraKrw: allowance.extraKrw,
          usedKrw: allowance.usedKrw,
          capCredits: creditsOf(allowance.capKrw),
          baseCapCredits: creditsOf(allowance.baseCapKrw),
          extraCredits: creditsOf(allowance.extraKrw),
          usedCredits: creditsOf(allowance.usedKrw),
          remainingCredits: creditsLeft(allowance.capKrw, allowance.usedKrw),
          source: allowance.source,
          resetsOn: kstDayOf(new Date(allowance.resetsAt)),
          resetsAt: allowance.resetsAt,
          window: allowanceWindowView(allowance),
          ...(refill ? { refill } : {}),
        },
        activeDiscount: activeDiscount
          ? {
              id: activeDiscount.id,
              percent: activeDiscount.percent,
              invoicesTotal: activeDiscount.invoicesTotal,
              invoicesUsed: activeDiscount.invoicesUsed,
              invoicesRemaining: activeDiscount.invoicesRemaining,
              openEnded: activeDiscount.invoicesTotal === null,
              source: activeDiscount.source,
            }
          : null,
        invoices: allInvoices
          .filter((inv) => inv.status !== 'draft')
          .map((inv) => ({
            id: inv.id,
            period: inv.period,
            planId: inv.planId,
            planName: dict.brandWorkspace.planNames[inv.planId],
            baseListKrw: inv.baseListKrw,
            listKrw: inv.listKrw,
            proratedDays: inv.proratedDays,
            periodDays: inv.periodDays,
            discountPercent: inv.discountPercent,
            discountKrw: inv.discountKrw,
            supplyKrw: inv.supplyKrw,
            vatKrw: inv.vatKrw,
            totalKrw: inv.totalKrw,
            status: inv.status as 'issued' | 'paid' | 'void',
            overdue: inv.overdue,
            issuedAt: inv.issuedAt,
            paidAt: inv.paidAt,
            voidedAt: inv.voidedAt,
          })),
        billingProfile: profile
          ? {
              organizationId: profile.organizationId,
              companyLegalName: profile.companyLegalName,
              businessRegNo: profile.businessRegNo,
              representativeName: profile.representativeName,
              businessAddress: profile.businessAddress,
              taxInvoiceEmail: profile.taxInvoiceEmail,
              contactName: profile.contactName,
              contactPhone: profile.contactPhone,
              updatedAt: profile.updatedAt,
            }
          : null,
        extraGrants: shownGrants,
      },
    };
  }

  const normalizedRole = choice.role as string;
  if (normalizedRole !== 'owner' && normalizedRole !== 'admin') {
    return { kind: 'forbidden' };
  }

  const res = await loadCustomerBrandBilling(
    { sql: deps.sql, env: deps.env, now: deps.now },
    viewer,
    choice.id,
  );
  if (!res.ok) {
    if (res.code === 'not_found') return { kind: 'not_found' };
    if (res.code === 'forbidden') return { kind: 'forbidden' };
    if (res.code === 'sign_in_required') return { kind: 'sign_in' };
    return { kind: 'unavailable' };
  }

  const now = deps.now ? deps.now() : new Date();
  // R1: a plan organization lists the grants its cycle counts (the window `loadCustomerBrandBilling` loaded).
  const window = res.billing.allowance.window;
  const extraGrants =
    window?.kind === 'cycle'
      ? await loadCustomerCycleExtraGrants(deps.sql, choice.id, window)
      : await loadCustomerExtraGrants(
          deps.sql,
          choice.id,
          now,
          // R4: a trial-only organization's trial day was read with the allowance; the list does not read it again.
          { trialThrough: res.billing.allowance.refill?.trialThrough ?? null },
        );
  return {
    kind: 'ready',
    staffReadOnly: false,
    todayKst: kstDayOf(now),
    graceDays: deps.env.planGraceDays ?? BRAND_PLAN_GRACE_DAYS_DEFAULT,
    billing: {
      ...res.billing,
      extraGrants,
    },
  };
}
