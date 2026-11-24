import type { Viewer } from '@/lib/auth/identity';
import { subscriptionAttentionCounts } from '@/lib/brands/subscriptions/notices';
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
import { hasColumn, hasTable, hasTables, loadSubscriptionSchemaReady } from '@/lib/brands/billing/schema-guard';
import { cycleContaining, cycleStartAt } from '@/lib/brands/billing/cycle';
import { monthRange } from '@/lib/brands/billing/cycle-invoices';
import { planCapKrwFromCredits, resolvePlanCapKrw } from '@/lib/brands/billing/plan-credits';
import type {
  BrandBillingProfile,
  BrandDiscountCode,
  BrandInvoice,
  BrandInvoiceStatus,
  BrandPlanAllowanceDefault,
} from '@/lib/brands/billing/types';
import { isInvoiceOverdueWithDueOn } from '@/lib/brands/subscriptions';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { BRAND_PLANS } from '@/lib/brands/plans';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { firstParam, isDbAdmin, iso } from './brand-ops-guard';
import { formatPlanUpgradeOutcomeDetail } from './plan-upgrade-detail';

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

/**
 * B1c: a cycle of a plan organization (from the plan start up to the current one, the latest 12) that no non-void
 * subscription invoice covers any day of (a cycle invoice covers its cycle, a calendar-month invoice its month).
 */
export interface UninvoicedCycle {
  organizationId: string;
  organizationName: string;
  planId: PaidBrandPlanId;
  startedOn: string;
  /** KST days, end exclusive (= the next billing day). */
  cycleStart: string;
  cycleEnd: string;
}

export interface PlanDefaultRowView {
  planId: PaidBrandPlanId;
  /** The stored default; null when unset. */
  monthlyCapKrw: number | null;
  /** R3 item 6: what applies — the stored default, else the plan's confirmed credits x 10 (`resolvePlanCapKrw`). */
  effectiveCapKrw: number;
  note: string;
  updatedAt: string | null;
  affectedOrgCount: number;
  followingOrgCount: number;
}

export interface PendingTaxInvoiceRow {
  invoiceId: string;
  organizationId: string;
  organizationName: string;
  period: string;
  status: 'issued' | 'paid';
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
  dueOn: string | null;
  billingProfile: Pick<
    BrandBillingProfile,
    'companyLegalName' | 'businessRegNo' | 'representativeName' | 'businessAddress' | 'taxInvoiceEmail'
  > | null;
}

export interface TaxInvoicePanelState {
  enabled: boolean;
  schemaReady: boolean;
  pending: PendingTaxInvoiceRow[];
  /** B1a-2, item 5: suspended subscriptions and pending ones waiting for a reissue (counts only). */
  attention?: { suspended: number; pendingReissue: number };
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
  taxInvoicePanel: TaxInvoicePanelState | null;
  /** B1c: current cycles without an invoice; empty until migration 0186 is applied. */
  uninvoicedCycles: UninvoicedCycle[];
  cyclesAvailable: boolean;
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
  const autoIssueEnabled = brandBillingAutoIssueOpen();

  const [hasInvoices, hasDefaults, hasPlans, hasDiscounts, hasAllowances, subSchemaReady] = await Promise.all([
    hasTable(sql, 'brand_invoices'),
    hasTable(sql, 'brand_plan_allowance_defaults'),
    hasTable(sql, 'brand_plan_assignments'),
    hasTable(sql, 'brand_discounts'),
    hasTable(sql, 'brand_studio_allowances'),
    autoIssueEnabled ? loadSubscriptionSchemaReady(sql).catch(() => false) : Promise.resolve(false),
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
        effectiveCapKrw: planCapKrwFromCredits(planId),
        note: '',
        updatedAt: null,
        affectedOrgCount: 0,
        followingOrgCount: 0,
      })),
      taxInvoicePanel: autoIssueEnabled ? { enabled: true, schemaReady: subSchemaReady, pending: [] } : null,
      uninvoicedCycles: [],
      cyclesAvailable: false,
    };
  }

  const [allInvoices, orgNamesRes, defaultsList, planRowsRes, extendedRowsRes, pendingTaxRes] = await Promise.all([
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
    autoIssueEnabled && subSchemaReady && hasInvoices
      ? sql.query<{ id: string; due_on: string | null }>(
          "select id::text as id, due_on::text as due_on from brand_invoices where status = 'issued'",
        )
      : Promise.resolve({ rows: [] as Array<{ id: string; due_on: string | null }> }),
    autoIssueEnabled && subSchemaReady && hasInvoices
      ? sql.query<{
          id: string;
          organization_id: string;
          organization_name: string;
          period: string;
          status: 'issued' | 'paid';
          supply_krw: number;
          vat_krw: number;
          total_krw: number;
          due_on: string | null;
          company_legal_name: string | null;
          business_reg_no: string | null;
          representative_name: string | null;
          business_address: string | null;
          tax_invoice_email: string | null;
        }>(
          `select i.id::text as id, i.organization_id::text as organization_id, o.name as organization_name,
                  i.period, i.status, i.supply_krw, i.vat_krw, i.total_krw, i.due_on::text as due_on,
                  p.company_legal_name, p.business_reg_no, p.representative_name,
                  p.business_address, p.tax_invoice_email
             from brand_invoices i
             join brand_organizations o on o.id = i.organization_id
             left join brand_billing_profiles p on p.organization_id = i.organization_id
            where i.status in ('issued', 'paid')
              and (i.collection_method is null or i.collection_method = 'transfer')
              and i.tax_invoice_issued_on is null
            order by i.issued_at asc nulls last, i.created_at asc, i.id asc`,
        )
      : Promise.resolve({ rows: [] }),
  ]);

  const dueOnById = new Map<string, string | null>();
  for (const r of extendedRowsRes.rows) {
    dueOnById.set(String(r.id), r.due_on == null ? null : String(r.due_on));
  }
  const effectiveInvoices =
    autoIssueEnabled && subSchemaReady
      ? allInvoices.map((inv) => {
          if (inv.status !== 'issued') return inv;
          const dueOn = dueOnById.get(inv.id) ?? null;
          return {
            ...inv,
            overdue: isInvoiceOverdueWithDueOn(
              { status: inv.status, issuedAt: inv.issuedAt, dueOn },
              todayKst,
              now,
            ),
          };
        })
      : allInvoices;

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

  for (const inv of effectiveInvoices) {
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
  const uninvoicedCycles: UninvoicedCycle[] = [];
  const cyclesAvailable = hasInvoices && (await hasColumn(sql, 'brand_invoices', 'cycle_start'));
  // Days each organization's non-void subscription invoices cover: a cycle row its cycle, a calendar-month row its month.
  // Non-subscription invoices (credit packs, adjustments: `kind` set) cover no days.
  const coveredByOrg = new Map<string, Array<{ start: string; end: string }>>();
  for (const inv of effectiveInvoices) {
    if (inv.status === 'void' || inv.kind) continue;
    const range = inv.cycleStart && inv.cycleEnd ? { start: inv.cycleStart, end: inv.cycleEnd } : monthRange(inv.period);
    const list = coveredByOrg.get(inv.organizationId) ?? [];
    list.push(range);
    coveredByOrg.set(inv.organizationId, list);
  }
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
    if (cyclesAvailable && status.active) {
      // Every cycle from the plan start to the current one (the latest 12) that no subscription invoice covers any day of.
      const current = cycleContaining(startedOn, todayKst);
      const covered = coveredByOrg.get(String(row.organization_id)) ?? [];
      for (let index = Math.max(0, (current?.index ?? -1) - 11); current && index <= current.index; index++) {
        const cycle = { start: cycleStartAt(startedOn, index), end: cycleStartAt(startedOn, index + 1) };
        if (endsOn && cycle.start >= endsOn) break;
        if (covered.some((r) => r.start < cycle.end && cycle.start < r.end)) continue;
        uninvoicedCycles.push({
          organizationId: String(row.organization_id),
          organizationName: String(row.name),
          planId,
          startedOn,
          cycleStart: cycle.start,
          cycleEnd: cycle.end,
        });
      }
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
      effectiveCapKrw: resolvePlanCapKrw(planId, existing?.monthlyCapKrw) ?? planCapKrwFromCredits(planId),
      note: existing?.note ?? '',
      updatedAt: existing?.updatedAt ?? null,
      affectedOrgCount: existing?.affectedOrgCount ?? 0,
      followingOrgCount: followingCounts[planId],
    };
  });

  const attention = autoIssueEnabled && subSchemaReady ? await subscriptionAttentionCounts(sql) : undefined;
  const taxInvoicePanel: TaxInvoicePanelState | null = autoIssueEnabled
    ? {
        enabled: true,
        schemaReady: subSchemaReady,
        ...(attention ? { attention } : {}),
        pending: pendingTaxRes.rows.map((r) => ({
          invoiceId: String(r.id),
          organizationId: String(r.organization_id),
          organizationName: String(r.organization_name),
          period: String(r.period),
          status: r.status,
          supplyKrw: Number(r.supply_krw),
          vatKrw: Number(r.vat_krw),
          totalKrw: Number(r.total_krw),
          dueOn: r.due_on == null ? null : String(r.due_on),
          billingProfile:
            r.company_legal_name !== null || r.business_reg_no !== null || r.tax_invoice_email !== null
              ? {
                  companyLegalName: String(r.company_legal_name ?? ''),
                  businessRegNo: String(r.business_reg_no ?? ''),
                  representativeName: String(r.representative_name ?? ''),
                  businessAddress: String(r.business_address ?? ''),
                  taxInvoiceEmail: String(r.tax_invoice_email ?? ''),
                }
              : null,
        })),
      }
    : null;

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
    taxInvoicePanel,
    uninvoicedCycles,
    cyclesAvailable,
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

/** "12월 17일" / "Dec 17" for a KST `YYYY-MM-DD`, formatted as a UTC calendar day so nothing shifts a day. */
function calendarDayLabel(day: string, locale: 'ko' | 'en'): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ko-KR', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(
    Date.UTC(y, m - 1, d),
  );
}

/**
 * Formats an operation `detail` code/field into plain Korean or English operator text
 * while keeping the original identifier visible.
 */
export function formatBillingOutcomeDetail(detail: string | undefined, locale: 'ko' | 'en'): string | undefined {
  if (!detail) return undefined;
  // B1c-3: plan-upgrade refusals have their own lines (lib/admin/plan-upgrade-detail.ts).
  const upgrade = formatPlanUpgradeOutcomeDetail(detail, locale);
  if (upgrade) return upgrade;
  // R3 item 7: a lower plan through the plan forms waits for the next cycle; the line names its start day.
  const downgrade = /(?:^|:)plan_downgrade_next_cycle:(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (downgrade) {
    const day = calendarDayLabel(downgrade[1]!, locale);
    return locale === 'ko'
      ? `주기 중간에는 낮은 플랜으로 바꿀 수 없습니다. 다음 주기 시작일(${day})에 바꾸세요. (${detail})`
      : `A lower plan cannot start in the middle of a cycle. Change it on the next cycle's start day (${day}). (${detail})`;
  }
  // R3 item 3: the manual paid day runs from the invoice's issue day through today; the line names that range.
  const paidRange = /(?:^|:)(paid_at_before_issue|paid_at_in_future):(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/.exec(detail);
  if (paidRange) {
    const [, , issue, today] = paidRange;
    return locale === 'ko'
      ? `입금일은 청구서 발행일(${issue})부터 오늘(${today})까지의 날짜만 넣을 수 있습니다(한국 시간). (${detail})`
      : `The paid date must be from the invoice's issue day (${issue}) through today (${today}), KST. (${detail})`;
  }
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
          'subscription tables not migrated': '정기구독 데이터베이스 마이그레이션(0182/0183)이 아직 적용되지 않았습니다',
          billing_profile_required: '계좌이체 정기구독은 세금계산서 정보(상호·사업자등록번호·대표자·주소·수신 이메일)가 모두 필요합니다',
          sandboxed_org: '샌드박스 조직에는 정기구독을 시작할 수 없습니다',
          project_only_not_subscribable: '프로젝트 전용 플랜은 정기구독을 만들 수 없습니다',
          card_not_available_yet: '카드 자동결제는 다음 단계(B3)에서 열립니다. 현재 계좌이체만 지원됩니다',
          upgrade_use_upgrade_operation: '더 높은 플랜은 "플랜 올림"으로 올립니다(오늘 새 주기가 시작됩니다)',
          plan_upgrade_required:
            '이번 주기 청구서가 있는 동안 플랜 폼으로는 더 높은 플랜으로 바꿀 수 없습니다. "플랜 올림"을 쓰세요(오늘 새 주기와 새 플랜 청구서가 만들어집니다)',
          subscription_exists: '이미 종료되지 않은 정기구독이 있습니다',
          period_already_invoiced: '시작 월 또는 그 이후 달에 취소되지 않은 정기 청구서가 이미 있어 구독을 시작할 수 없습니다. 그 청구서를 먼저 정리하세요',
          manual_plan_active: '유효한 수동 플랜(유예 기간 포함)이 있어 구독을 시작할 수 없습니다. 기존 플랜 설정에서 수동 플랜을 먼저 끝내세요',
          preview_mismatch: '미리보기한 값(플랜·시작일·우선 개방)과 확정 제출 값이 일치하지 않습니다. 다시 미리보기 후 제출하세요',
          subscription_reconcile_deferred:
            '입금(또는 취소) 기록은 저장했습니다. 구독 상태는 반영하지 못했습니다. "재계산"을 누르거나 다음 정산 배치를 기다려 주세요',
          subscription_void_not_updated:
            '취소 기록은 저장했습니다. 구독 상태는 반영하지 못했습니다. "재계산"을 누르거나 다음 정산 배치를 기다려 주세요',
          subscription_access_not_updated:
            '입금 기록은 저장했습니다. 구독 상태와 이용 기간은 반영하지 못해 고객이 지금 이용하지 못할 수 있습니다. "재계산"을 누르거나 다음 정산 배치를 기다려 주세요',
          reissue_current_period_only: '취소된 청구서 재발행은 이번 주기(KST)만 허용됩니다',
          period_not_admin_voided: '해당 기간은 관리자가 취소한 청구서 재발행 대상이 아닙니다',
          subscription_not_reissuable: '종료되었거나 해지 예약된 구독은 청구서를 재발행할 수 없습니다',
          started_on_must_be_current_month: '구독 시작일은 이번 달(KST) 내 날짜여야 합니다',
          started_on_in_future: '구독 시작일은 오늘(KST) 또는 그 이전이어야 합니다',
          preview_required: '미리보기를 확인한 뒤 다시 실행하세요.',
          confirmCheck: '구독을 시작하면 첫 청구서가 발행됩니다. 발행 확인 체크를 선택하세요',
          preview_stale: '미리보기 이후 금액이나 조건이 바뀌었습니다. 다시 미리보기한 뒤 확정하세요',
          subscription_managed: '구독 중인 조직의 플랜은 구독 화면에서 바꿉니다',
          subscription_owns_period:
            '구독 중인 조직의 정기 청구서는 구독이 직접 만들고 발행합니다. 금액을 바꾸려면 발행 전에 할인을 주거나 끝내세요(퍼센트·적용 건수, 발행일에 반영). 발행 후라면 청구서를 취소하고 같은 달 안에 "다시 발행"을 쓰세요(그때의 할인이 반영된 기본 금액)',
          subscription_draft_locked:
            '정기 청구서 초안은 메모만 고칠 수 있습니다. 금액을 바꾸려면 발행 전에 할인을 주거나 끝내세요(퍼센트·적용 건수, 발행일에 반영). 발행 후라면 청구서를 취소하고 같은 주기 안에 "다시 발행"을 쓰세요(그때의 할인이 반영된 기본 금액)',
          subscription_job_issues:
            '구독 중인 조직의 정기 청구서는 구독이 직접 발행합니다. 지금 발행하려면 "재계산"을 누르세요. 이번 주기 청구서를 취소했다면 "다시 발행"을 쓰세요. 금액을 바꾸려면 발행 전에 할인을 주거나 끝내세요(발행일에 반영)',
          paid_at_in_future: '입금일은 오늘(KST)보다 늦을 수 없습니다',
          paid_at_before_start: '첫 청구서의 입금일은 구독을 시작한 날보다 앞설 수 없습니다. 입금일을 확인하세요',
          paid_at_overlaps_cycle: '이 입금일로 시작하는 결제 주기가 다른 청구서의 기간과 겹칩니다. 입금일이나 겹치는 청구서를 확인하세요',
          started_on_must_be_today: '구독은 오늘(KST) 시작합니다',
          period_ended: '이미 지난 달의 정기 청구서 초안은 발행할 수 없습니다',
          reconcile_failed: '다시 정산했지만 일부 단계가 실패했습니다. 상태와 이용 기간은 반영했고, 오류 코드는 구독 카드에 있습니다',
          issuedOn: '세금계산서 작성일(YYYY-MM-DD)을 확인하세요',
          ref: '홈택스 승인번호를 입력하세요',
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
          'subscription tables not migrated': 'Subscription migrations (0182/0183) are not applied yet',
          billing_profile_required: 'Complete tax-invoice profile (legal name, 10-digit reg no, rep, address, email) is required for transfer subscriptions',
          sandboxed_org: 'Sandboxed organizations cannot have a subscription',
          project_only_not_subscribable: 'project_only plans cannot have a subscription',
          card_not_available_yet: 'Card billing opens in a later slice (B3); only transfer is available now',
          upgrade_use_upgrade_operation: 'A higher plan is an upgrade (a new cycle starts today); use the upgrade',
          plan_upgrade_required:
            "While an invoice covers this cycle the plan form cannot raise the plan; use the plan upgrade (a new cycle and the new plan's invoice start today)",
          subscription_exists: 'An active or non-ended subscription already exists',
          period_already_invoiced: 'A non-void subscription invoice already exists for the start period or a later one; settle it first',
          manual_plan_active: 'A manual plan is still active (grace included); end it in the plan settings before starting a subscription',
          preview_mismatch: 'Submitted values differ from the previewed values; run preview again before confirming',
          subscription_reconcile_deferred:
            'The payment (or void) is recorded. The subscription state could not be updated; press "Reconcile now" or wait for the next scheduled run',
          subscription_void_not_updated:
            'The cancellation is recorded. The subscription state could not be updated; press "Reconcile now" or wait for the next scheduled run',
          subscription_access_not_updated:
            'The payment is recorded. The subscription state and access period could not be updated, so the customer may have no access now; press "Reconcile now" or wait for the next scheduled run',
          reissue_current_period_only: 'Only the current billing cycle (KST) can be reissued',
          period_not_admin_voided: 'Selected period is not awaiting reissue from an admin void',
          subscription_not_reissuable: 'Ended or cancel-scheduled subscriptions cannot reissue invoices',
          started_on_must_be_current_month: 'Subscription start date must fall within the current KST month',
          started_on_in_future: 'Subscription start date must be today (KST) or earlier',
          preview_required: 'Check the preview, then run it again.',
          confirmCheck: 'Starting a subscription issues the first invoice; tick the issue confirmation',
          preview_stale: 'Values changed since the preview; preview again before confirming',
          subscription_managed: "This organization's plan is managed by its subscription; change it on the subscription panel",
          subscription_owns_period:
            "A subscribed organization's subscription invoices are created and issued by the subscription. To change the amount, grant or end a discount before the invoice is issued (percent, number of invoices; applied on issue day). After issue, void the invoice and use \"Reissue\" within the same cycle (standard amount with the discount then in force)",
          subscription_draft_locked:
            'Only the memo of a subscription draft can be changed. To change the amount, grant or end a discount before the invoice is issued (percent, number of invoices; applied on issue day). After issue, void the invoice and use "Reissue" within the same cycle (standard amount with the discount then in force)',
          subscription_job_issues:
            'The subscription issues its own invoices. To issue now, use "Reconcile now"; for a voided current cycle use "Reissue". To change the amount, grant or end a discount before issue (applied on issue day)',
          paid_at_in_future: 'The paid date cannot be later than today (KST)',
          paid_at_before_start: "The first invoice's paid date cannot be before the day the subscription started. Check the paid date",
          paid_at_overlaps_cycle: 'The billing cycle starting on this paid date would overlap another invoice. Check the paid date or the overlapping invoice',
          started_on_must_be_today: 'A subscription starts today (KST)',
          period_ended: 'A subscription draft of a month that has already ended cannot be issued',
          reconcile_failed:
            'The reconcile ran but some steps failed. Status and access end were written; the error code is on the subscription card',
          issuedOn: 'Check the tax-invoice issued date (YYYY-MM-DD)',
          ref: 'Enter the Hometax approval reference',
        };

  // Subscription details arrive as `<code>:<reason>` (for example `conflict:manual_plan_active`). The reason is
  // the specific message, so it wins over the generic code/field label; pre-existing details are unaffected.
  for (const token of SUBSCRIPTION_DETAIL_TOKENS) {
    const message = (labels as Record<string, string>)[token];
    if (message && (detail === token || detail.endsWith(`:${token}`) || detail.includes(`:${token}:`) || detail.startsWith(`${token}:`))) {
      return `${message} (${detail})`;
    }
  }
  for (const [token, message] of Object.entries(labels)) {
    if (detail === token || detail.startsWith(`${token}:`) || detail.endsWith(`:${token}`)) {
      return `${message} (${detail})`;
    }
  }
  return detail;
}

const SUBSCRIPTION_DETAIL_TOKENS = [
  'billing_profile_required',
  'sandboxed_org',
  'project_only_not_subscribable',
  'card_not_available_yet',
  'upgrade_use_upgrade_operation',
  'plan_upgrade_required',
  'subscription_exists',
  'period_already_invoiced',
  'manual_plan_active',
  'preview_mismatch',
  'preview_required',
  'confirmCheck',
  'subscription_reconcile_deferred',
  'subscription_access_not_updated',
  'subscription_void_not_updated',
  'reissue_current_period_only',
  'period_not_admin_voided',
  'subscription_not_reissuable',
  'started_on_must_be_current_month',
  'started_on_in_future',
  'preview_stale',
  'subscription_managed',
  'subscription_owns_period',
  'subscription_draft_locked',
  'period_ended',
  'reconcile_failed',
  'subscription_job_issues',
  'paid_at_in_future',
  'paid_at_before_start',
  'paid_at_overlaps_cycle',
  'started_on_must_be_today',
] as const;

export const OVERDUE_DAYS_LABEL = BRAND_INVOICE_OVERDUE_DAYS;
