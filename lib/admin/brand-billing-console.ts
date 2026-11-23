import type { Viewer } from '@/lib/auth/identity';
import { studioEnv, type StudioEnv } from '@/lib/brand-studio/env';
import { listBrandDiscountCodes, listBrandInvoices, loadPlanAllowanceDefaults } from '@/lib/brands/billing';
import {
  BRAND_INVOICE_OVERDUE_DAYS,
  BRAND_PLAN_GRACE_DAYS_DEFAULT,
  daysInYearMonth,
  isValidYearMonth,
  kstDayOf,
  kstMonthOf,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
  type PaidBrandPlanId,
} from '@/lib/brands/billing/math';
import { hasTable, hasTables } from '@/lib/brands/billing/schema-guard';
import type {
  BrandDiscountCode,
  BrandInvoice,
  BrandInvoiceStatus,
  BrandPlanAllowanceDefault,
} from '@/lib/brands/billing/types';
import { BRAND_PLANS } from '@/lib/brands/plans';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { firstParam, isDbAdmin, iso } from './brand-ops-guard';

export interface BillingStatusTotals {
  count: number;
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
}

export interface AdminBillingInvoiceRow extends BrandInvoice {
  organizationName: string;
  daysSinceIssued: number | null;
}

export interface UninvoicedActiveOrg {
  organizationId: string;
  organizationName: string;
  planId: PaidBrandPlanId;
  billingMode: string;
  startedOn: string;
  endsOn: string | null;
  inGrace: boolean;
  activeDiscountPercent: number | null;
  monthlyListKrw: number;
}

export interface PlanDefaultRowView {
  planId: PaidBrandPlanId;
  monthlyCapKrw: number | null;
  note: string;
  updatedAt: string | null;
  affectedOrgCount: number;
  followingOrgCount: number;
}

export interface BrandBillingOverviewData {
  available: boolean;
  defaultsAvailable: boolean;
  period: string;
  envDefaultMonthlyKrw: number;
  byStatus: Record<BrandInvoiceStatus, BillingStatusTotals>;
  activeTotals: BillingStatusTotals;
  periodInvoices: AdminBillingInvoiceRow[];
  overdueInvoices: AdminBillingInvoiceRow[];
  uninvoicedActiveOrgs: UninvoicedActiveOrg[];
  planDefaults: PlanDefaultRowView[];
}

export interface DiscountCodeRedemptionDetail {
  id: string;
  organizationId: string;
  organizationName: string;
  redeemedBy: string | null;
  redeemerName: string | null;
  redeemedAt: string;
}

export interface AdminDiscountCodeRow extends BrandDiscountCode {
  boundOrganizationName: string | null;
  redemptions: DiscountCodeRedemptionDetail[];
}

export interface BrandDiscountCodesConsoleData {
  available: boolean;
  codes: AdminDiscountCodeRow[];
  organizations: Array<{ id: string; name: string }>;
}

const emptyStatusTotals = (): BillingStatusTotals => ({ count: 0, supplyKrw: 0, vatKrw: 0, totalKrw: 0 });

export function billingPeriodParam(
  params: Record<string, string | string[] | undefined>,
  now: Date = new Date(),
): string {
  const raw = firstParam(params.period).trim();
  return isValidYearMonth(raw) ? raw : kstMonthOf(now);
}

/**
 * Loads `/admin/brand-billing`: current-month invoice totals by status, overdue list, active paid-plan
 * organizations without a period invoice (one-click draft), and paid-plan default allowances.
 */
export async function loadBrandBillingOverview(
  sql: SqlRunner,
  viewer: Viewer,
  options: {
    period?: string;
    env?: Pick<StudioEnv, 'defaultMonthlyKrw' | 'planGraceDays'>;
    now?: Date;
  } = {},
): Promise<BrandBillingOverviewData | null> {
  if (!(await isDbAdmin(sql, viewer))) return null;

  const now = options.now ?? new Date();
  const period = options.period && isValidYearMonth(options.period) ? options.period : kstMonthOf(now);
  const env = options.env ?? studioEnv();
  const todayKst = kstDayOf(now);
  const graceDays = env.planGraceDays ?? BRAND_PLAN_GRACE_DAYS_DEFAULT;

  const [hasInvoices, hasDefaults, hasPlans, hasDiscounts, hasAllowances] = await Promise.all([
    hasTable(sql, 'brand_invoices'),
    hasTable(sql, 'brand_plan_allowance_defaults'),
    hasTable(sql, 'brand_plan_assignments'),
    hasTable(sql, 'brand_discounts'),
    hasTable(sql, 'brand_studio_allowances'),
  ]);

  const byStatus: Record<BrandInvoiceStatus, BillingStatusTotals> = {
    draft: emptyStatusTotals(),
    issued: emptyStatusTotals(),
    paid: emptyStatusTotals(),
    void: emptyStatusTotals(),
  };

  if (!hasInvoices && !hasDefaults) {
    return {
      available: false,
      defaultsAvailable: false,
      period,
      envDefaultMonthlyKrw: env.defaultMonthlyKrw,
      byStatus,
      activeTotals: emptyStatusTotals(),
      periodInvoices: [],
      overdueInvoices: [],
      uninvoicedActiveOrgs: [],
      planDefaults: PAID_BRAND_PLAN_IDS.map((planId) => ({
        planId,
        monthlyCapKrw: null,
        note: '',
        updatedAt: null,
        affectedOrgCount: 0,
        followingOrgCount: 0,
      })),
    };
  }

  const [allInvoices, orgNamesRes, defaultsList, planRowsRes] = await Promise.all([
    hasInvoices ? listBrandInvoices(sql, { now }) : Promise.resolve([]),
    sql.query<{ id: string; name: string }>('select id::text as id, name from brand_organizations'),
    hasDefaults ? loadPlanAllowanceDefaults(sql) : Promise.resolve([] as BrandPlanAllowanceDefault[]),
    hasPlans
      ? sql.query<{
          organization_id: string;
          name: string;
          plan_id: string;
          billing_mode: string;
          started_on: string;
          ends_on: string | null;
          is_override: boolean | null;
          discount_percent: number | null;
        }>(
          `select p.organization_id::text as organization_id, o.name, p.plan_id, p.billing_mode,
                  p.started_on::text as started_on, p.ends_on::text as ends_on,
                  ${hasAllowances ? 'a.is_override' : 'null::boolean as is_override'},
                  ${hasDiscounts ? 'd.percent as discount_percent' : 'null::int as discount_percent'}
             from brand_plan_assignments p
             join brand_organizations o on o.id = p.organization_id
             ${hasAllowances ? 'left join brand_studio_allowances a on a.organization_id = p.organization_id' : ''}
             ${hasDiscounts ? "left join brand_discounts d on d.organization_id = p.organization_id and d.status = 'active'" : ''}
            order by o.name asc`,
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const orgNameMap = new Map<string, string>();
  for (const r of orgNamesRes.rows) {
    orgNameMap.set(String(r.id), String(r.name));
  }

  const withOrgName = (inv: BrandInvoice): AdminBillingInvoiceRow => {
    const issuedMs = inv.issuedAt ? Date.parse(inv.issuedAt) : NaN;
    const daysSinceIssued = Number.isFinite(issuedMs)
      ? Math.max(0, Math.floor((now.getTime() - issuedMs) / 86_400_000))
      : null;
    return {
      ...inv,
      organizationName: orgNameMap.get(inv.organizationId) ?? inv.organizationId.slice(0, 8),
      daysSinceIssued,
    };
  };

  const periodInvoices: AdminBillingInvoiceRow[] = [];
  const overdueInvoices: AdminBillingInvoiceRow[] = [];
  const invoicedPeriodOrgIds = new Set<string>();

  for (const inv of allInvoices) {
    if (inv.period === period) {
      const row = withOrgName(inv);
      periodInvoices.push(row);
      const bucket = byStatus[inv.status];
      bucket.count += 1;
      bucket.supplyKrw += inv.supplyKrw;
      bucket.vatKrw += inv.vatKrw;
      bucket.totalKrw += inv.totalKrw;
      if (inv.status !== 'void') {
        invoicedPeriodOrgIds.add(inv.organizationId);
      }
    }
    if (inv.status === 'issued' && inv.overdue) {
      overdueInvoices.push(withOrgName(inv));
    }
  }

  overdueInvoices.sort((a, b) => (b.daysSinceIssued ?? 0) - (a.daysSinceIssued ?? 0));

  const activeTotals: BillingStatusTotals = {
    count: byStatus.draft.count + byStatus.issued.count + byStatus.paid.count,
    supplyKrw: byStatus.draft.supplyKrw + byStatus.issued.supplyKrw + byStatus.paid.supplyKrw,
    vatKrw: byStatus.draft.vatKrw + byStatus.issued.vatKrw + byStatus.paid.vatKrw,
    totalKrw: byStatus.draft.totalKrw + byStatus.issued.totalKrw + byStatus.paid.totalKrw,
  };

  const uninvoicedActiveOrgs: UninvoicedActiveOrg[] = [];
  const followingCounts: Record<PaidBrandPlanId, number> = {
    b2b_29: 0,
    b2b_49: 0,
    b2b_69: 0,
  };

  const periodStart = `${period}-01`;
  const periodLastDay = `${period}-${String(daysInYearMonth(period)).padStart(2, '0')}`;
  const currentKstMonth = kstMonthOf(now);

  for (const row of planRowsRes.rows) {
    if (!(PAID_BRAND_PLAN_IDS as readonly string[]).includes(row.plan_id)) continue;
    const planId = row.plan_id as PaidBrandPlanId;
    const startedOn = String(row.started_on);
    const endsOn = row.ends_on == null ? null : String(row.ends_on);
    const status = planActiveWithGrace({ startedOn, endsOn }, todayKst, graceDays);
    if (status.active && row.is_override !== true) {
      followingCounts[planId] += 1;
    }
    const coveredInPeriod = startedOn <= periodLastDay && (endsOn === null || endsOn > periodStart);
    const orgId = String(row.organization_id);
    if (coveredInPeriod && hasInvoices && !invoicedPeriodOrgIds.has(orgId)) {
      uninvoicedActiveOrgs.push({
        organizationId: orgId,
        organizationName: String(row.name),
        planId,
        billingMode: String(row.billing_mode),
        startedOn,
        endsOn,
        inGrace: period === currentKstMonth ? status.inGrace : false,
        activeDiscountPercent:
          row.discount_percent === null || row.discount_percent === undefined ? null : Number(row.discount_percent),
        monthlyListKrw: BRAND_PLANS[planId].monthlyKrw,
      });
    }
  }

  const defaultsMap = new Map(defaultsList.map((d) => [d.planId, d]));
  const planDefaults: PlanDefaultRowView[] = PAID_BRAND_PLAN_IDS.map((planId) => {
    const existing = defaultsMap.get(planId);
    return {
      planId,
      monthlyCapKrw: existing?.monthlyCapKrw ?? null,
      note: existing?.note ?? '',
      updatedAt: existing?.updatedAt ?? null,
      affectedOrgCount: existing?.affectedOrgCount ?? 0,
      followingOrgCount: followingCounts[planId],
    };
  });

  return {
    available: hasInvoices,
    defaultsAvailable: hasDefaults,
    period,
    envDefaultMonthlyKrw: env.defaultMonthlyKrw,
    byStatus,
    activeTotals,
    periodInvoices,
    overdueInvoices,
    uninvoicedActiveOrgs,
    planDefaults,
  };
}

/**
 * Loads discount codes with their redemption counts and redeemer organization/actor details
 * for `/admin/brand-billing/codes`. Tolerates missing 0176 tables.
 */
export async function loadBrandDiscountCodesConsole(
  sql: SqlRunner,
  viewer: Viewer,
): Promise<BrandDiscountCodesConsoleData | null> {
  if (!(await isDbAdmin(sql, viewer))) return null;

  const ready = await hasTables(sql, ['brand_discount_codes', 'brand_discount_redemptions']);
  if (!ready) {
    return { available: false, codes: [], organizations: [] };
  }

  const [codes, orgRes, redemptionsRes] = await Promise.all([
    listBrandDiscountCodes(sql),
    sql.query<{ id: string; name: string }>('select id::text as id, name from brand_organizations order by name asc'),
    sql.query<{
      id: string;
      code_id: string;
      organization_id: string;
      organization_name: string;
      redeemed_by: string | null;
      redeemer_name: string | null;
      redeemed_at: unknown;
    }>(
      `select r.id::text as id, r.code_id::text as code_id, r.organization_id::text as organization_id,
              o.name as organization_name, r.redeemed_by::text as redeemed_by,
              p.display_name as redeemer_name, r.redeemed_at
         from brand_discount_redemptions r
         join brand_organizations o on o.id = r.organization_id
         left join profiles p on p.id = r.redeemed_by
        order by r.redeemed_at desc`,
    ),
  ]);

  const orgNameMap = new Map<string, string>();
  const organizations = orgRes.rows.map((r) => {
    const id = String(r.id);
    const name = String(r.name);
    orgNameMap.set(id, name);
    return { id, name };
  });

  const redemptionsByCode = new Map<string, DiscountCodeRedemptionDetail[]>();
  for (const r of redemptionsRes.rows) {
    const codeId = String(r.code_id);
    const list = redemptionsByCode.get(codeId) ?? [];
    list.push({
      id: String(r.id),
      organizationId: String(r.organization_id),
      organizationName: String(r.organization_name),
      redeemedBy: r.redeemed_by ? String(r.redeemed_by) : null,
      redeemerName: r.redeemer_name ? String(r.redeemer_name) : null,
      redeemedAt: iso(r.redeemed_at) ?? '',
    });
    redemptionsByCode.set(codeId, list);
  }

  return {
    available: true,
    codes: codes.map((c) => ({
      ...c,
      boundOrganizationName: c.organizationId ? (orgNameMap.get(c.organizationId) ?? c.organizationId.slice(0, 8)) : null,
      redemptions: redemptionsByCode.get(c.id) ?? [],
    })),
    organizations,
  };
}

/**
 * Formats an operation `detail` code/field into plain Korean or English operator text
 * while keeping the original identifier visible.
 */
export function formatBillingOutcomeDetail(detail: string | undefined, locale: 'ko' | 'en'): string | undefined {
  if (!detail) return undefined;
  const labels =
    locale === 'ko'
      ? {
          businessRegNo: '사업자등록번호(10자리 국세청 체크섬)를 확인하세요',
          taxInvoiceEmail: '세금계산서 수신 이메일 형식을 확인하세요',
          endsOn: '종료일은 시작일 이후 날짜여야 합니다',
          startedOn: '시작일(YYYY-MM-DD)을 확인하세요',
          monthlyCapKrw: '월 한도(원) 값을 확인하세요',
          validMonth: '유효 월은 이번 달 또는 다음 달(YYYY-MM)만 허용됩니다',
          manualReason: '수기 금액을 입력할 때는 사유가 필수입니다',
          manualAmounts: '수기 금액을 수정하려면 직접 입력 항목을 켜야 합니다',
          code: '할인 코드는 영문 대문자·숫자·하이픈 10~24자여야 하며 중복될 수 없습니다',
          validUntil: '만료 일시 형식을 확인하세요',
          conflict: '동일 기간 청구서가 이미 있거나 동시 수정 충돌이 발생했습니다',
          discount_unavailable: '연결된 할인이 종료되었거나 잔여 횟수가 없어 발행할 수 없습니다',
          inconsistent_amounts: '청구서 금액 합계가 일치하지 않아 발행할 수 없습니다',
          no_change: '변경된 항목이 없어 저장하지 않았습니다',
          confirmReplace: '기존 활성 할인을 즉시 종료하고 교체하려면 확인 체크를 선택하세요',
          'billing tables not migrated': '과금 데이터베이스 마이그레이션(0176/0177)이 아직 적용되지 않았습니다',
        }
      : {
          businessRegNo: 'Check the 10-digit Korean business registration number checksum',
          taxInvoiceEmail: 'Check the tax-invoice email address format',
          endsOn: 'End date must be after the start date',
          startedOn: 'Check the start date (YYYY-MM-DD)',
          monthlyCapKrw: 'Check the monthly allowance cap (KRW)',
          validMonth: 'Extra grants only allow the current or next KST month (YYYY-MM)',
          manualReason: 'A reason is required when overriding invoice amounts manually',
          manualAmounts: 'Enable manual amounts before passing explicit supply/VAT/total values',
          code: 'Discount code must be 10–24 chars (A-Z, 0-9, -) and unique',
          validUntil: 'Check the expiration timestamp format',
          conflict: 'An active invoice already exists for this period or revision conflicted',
          discount_unavailable: 'Attached discount is no longer active or has no remaining uses',
          inconsistent_amounts: 'Invoice amounts failed consistency validation',
          no_change: 'No changes detected',
          confirmReplace: 'Confirm replacing the currently active discount before saving',
          'billing tables not migrated': 'Billing migrations (0176/0177) are not applied yet',
        };

  for (const [token, message] of Object.entries(labels)) {
    if (detail === token || detail.startsWith(`${token}:`) || detail.endsWith(`:${token}`)) {
      return `${message} (${detail})`;
    }
  }
  return detail;
}

export const OVERDUE_DAYS_LABEL = BRAND_INVOICE_OVERDUE_DAYS;
