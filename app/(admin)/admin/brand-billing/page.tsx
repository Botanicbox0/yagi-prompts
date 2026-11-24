import { requireAdmin } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { studioEnv } from '@/lib/brand-studio/env';
import { BRAND_PLANS, type BrandBillingMode } from '@/lib/brands/plans';
import type { BrandInvoiceStatus } from '@/lib/brands/billing/types';
import {
  billingPeriodParam,
  formatBillingOutcomeDetail,
  loadBrandBillingOverview,
} from '@/lib/admin/brand-billing-console';
import { formatAdminTime, formatCount, formatKrw } from '@/lib/admin/format';
import { parsePlanDefaultPreviewDetail } from '@/lib/admin/billing-preview-detail';
import { creditEquivalentHint } from '@/lib/admin/credit-hint';
import { creditsOf, formatCredits } from '@/lib/brand-studio/credits';
import { interpolate } from '@/lib/i18n/format';
import { addCalendarDays, kstDayOf } from '@/lib/brands/billing/math';
import {
  AdminShell,
  BUTTON,
  BUTTON_PRIMARY,
  INPUT,
  OpForm,
  OutcomeBanner,
  Panel,
} from '@/components/admin/chrome';
import {
  AdminPageHeader,
  AdminTable,
  MetricStrip,
  StatusPill,
} from '@/components/admin/patterns';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return typeof value === 'string' ? value : undefined;
};

const INVOICE_STATUS_ORDER: readonly BrandInvoiceStatus[] = ['draft', 'issued', 'paid', 'void'];

function invoiceTone(status: BrandInvoiceStatus, overdue: boolean): 'done' | 'action' | 'progress' | 'hold' | 'fail' {
  if (overdue) return 'fail';
  if (status === 'paid') return 'done';
  if (status === 'issued') return 'action';
  if (status === 'draft') return 'progress';
  return 'hold';
}

/** "11월 17일" / "Nov 17" for a KST `YYYY-MM-DD`, formatted as a UTC calendar day so nothing shifts a day. */
function dayLabel(day: string, locale: string, withYear = false): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ko-KR', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
  }).format(Date.UTC(y, m - 1, d));
}

/**
 * A billing cycle `[start, end)` as its first and last day (B1c). The year shows only for a cycle that starts in
 * another year than today, and on the last day only when it falls in a different year from the start.
 */
function cycleLabels(start: string, end: string, locale: string, todayKst: string): { start: string; last: string } {
  const last = addCalendarDays(end, -1);
  const startYear = start.slice(0, 4) !== todayKst.slice(0, 4);
  return {
    start: dayLabel(start, locale, startYear),
    last: dayLabel(last, locale, startYear && last.slice(0, 4) !== start.slice(0, 4)),
  };
}

export default async function BrandBillingOverviewPage(props?: { searchParams?: Promise<SearchParams> }) {
  const [viewer, sql, locale, params] = await Promise.all([
    requireAdmin(),
    getSqlRunner(),
    getLocaleFromHeaders(),
    props?.searchParams ?? Promise.resolve({} as SearchParams),
  ]);

  const dict = getDictionary(locale);
  const c = dict.adminConsole;
  const bb = c.brandBilling;
  const od = c.brandOrgDetail;
  const ol = c.brandOrgList;
  const b = dict.brandWorkspace;

  const period = billingPeriodParam(params);
  const env = studioEnv();
  const now = new Date();
  const todayKst = kstDayOf(now);
  const data = sql ? await loadBrandBillingOverview(sql, viewer, { period, env, now }) : null;
  const backUrl = `/admin/brand-billing?period=${encodeURIComponent(period)}`;
  const cycleText = (start: string, end: string) => cycleLabels(start, end, locale, todayKst);
  // B1c: a cycle invoice shows its cycle (start ~ last day); a month invoice keeps its `period`.
  const invoicePeriod = (inv: { period: string; cycleStart?: string; cycleEnd?: string }) =>
    inv.cycleStart && inv.cycleEnd ? (
      <span
        className="admin-nowrap"
        data-invoice-cycle={inv.cycleStart}
        title={`${inv.cycleStart} ~ ${addCalendarDays(inv.cycleEnd, -1)}`}
      >
        {interpolate(od.billing.cycleRange, cycleText(inv.cycleStart, inv.cycleEnd))}
      </span>
    ) : (
      inv.period
    );

  const okCode = one(params, 'ok');
  const rawDetail = one(params, 'detail');
  // R3 item 1: the plan-default preview is read by the parser its formatter pairs with (lib/admin/billing-preview-detail.ts).
  const preparedPlanDefault = okCode === 'prepared' ? parsePlanDefaultPreviewDetail(rawDetail) : null;
  const preparedPlanId = preparedPlanDefault?.planId;
  const preparedCapValue = preparedPlanDefault ? (preparedPlanDefault.capKrw === null ? 'unset' : String(preparedPlanDefault.capKrw)) : undefined;
  // Review round 2, item 9: the clear confirm sends back the digest of the previewed affected organizations.
  const preparedClearDigest = preparedCapValue === 'unset' ? (preparedPlanDefault?.digest ?? undefined) : undefined;

  return (
    <AdminShell dict={dict.admin} locale={locale} active="brandBilling">
      <div data-brand-billing-overview>
        <OutcomeBanner
          dict={{ ...dict.admin, okPrepared: bb.planDefaultPreviewedBanner }}
          ok={okCode}
          err={one(params, 'err')}
          detail={formatBillingOutcomeDetail(rawDetail, locale)}
          showDetailForOk
        />

        <AdminPageHeader
          title={bb.title}
          {...(data?.available ? { count: formatCount(data.periodInvoices.length, locale) } : {})}
          lede={bb.lede}
          actions={
            <>
              <a className="admin-btn" href="/admin/brand-billing/codes" data-billing-codes-link>
                {bb.codesLink} →
              </a>
              <a className="admin-btn" href="/admin/brand-workspace" data-billing-orgs-link>
                {c.nav.brandWorkspace} →
              </a>
            </>
          }
        />

        <div className="admin-toolbar" style={{ marginBottom: 16 }}>
          <form method="get" action="/admin/brand-billing" className="admin-search" role="search">
            <label className="flex items-center gap-2 text-xs">
              <span className="font-semibold">{bb.periodLabel}</span>
              <input
                name="period"
                defaultValue={period}
                pattern="\d{4}-(0[1-9]|1[0-2])"
                required
                className="admin-input"
                style={{ minHeight: 36, width: 130 }}
              />
            </label>
            <button type="submit" className="admin-btn">
              {bb.applyPeriod}
            </button>
          </form>
        </div>

        {!data?.available ? (
          <p className="admin-notice">{bb.unavailable}</p>
        ) : (
          <>
            <section className="admin-section" data-billing-period-summary>
              <h2>{interpolate(bb.summaryHeading, { period: data.period })}</h2>
              <p className="admin-field-hint mb-3" data-period-cycle-note>
                {bb.summaryCycleNote}
              </p>
              <MetricStrip
                label={interpolate(bb.summaryHeading, { period: data.period })}
                items={[
                  {
                    key: 'active-total',
                    label: bb.totalCardLabel,
                    value: formatKrw(data.activeTotals.totalKrw, locale),
                    sub: `${interpolate(bb.countUnit, { count: formatCount(data.activeTotals.count, locale) })} · ${interpolate(
                      bb.supplyVatLine,
                      {
                        supply: formatKrw(data.activeTotals.supplyKrw, locale),
                        vat: formatKrw(data.activeTotals.vatKrw, locale),
                      },
                    )}`,
                  },
                  ...INVOICE_STATUS_ORDER.map((status) => {
                    const totals = data.byStatus[status];
                    return {
                      key: status,
                      label: od.billing.invoiceStatuses[status],
                      value: formatKrw(totals.totalKrw, locale),
                      sub: `${interpolate(bb.countUnit, { count: formatCount(totals.count, locale) })} · ${interpolate(
                        bb.supplyVatLine,
                        {
                          supply: formatKrw(totals.supplyKrw, locale),
                          vat: formatKrw(totals.vatKrw, locale),
                        },
                      )}`,
                      tone: invoiceTone(status, false),
                    };
                  }),
                ]}
              />
            </section>

            <Panel title={interpolate(bb.periodListHeading, { period: data.period })} id="period-invoices">
              <AdminTable
                caption={interpolate(bb.periodListHeading, { period: data.period })}
                columns={[
                  { key: 'org', label: ol.columns.org },
                  { key: 'period', label: od.billing.invoiceCols.period },
                  { key: 'plan', label: od.billing.invoiceCols.plan },
                  { key: 'list', label: od.billing.invoiceCols.list, numeric: true },
                  { key: 'discount', label: od.billing.invoiceCols.discount, numeric: true },
                  { key: 'supply', label: od.billing.invoiceCols.supply, numeric: true },
                  { key: 'vat', label: od.billing.invoiceCols.vat, numeric: true },
                  { key: 'total', label: od.billing.invoiceCols.total, numeric: true },
                  { key: 'status', label: od.billing.invoiceCols.status },
                ]}
                rows={data.periodInvoices.map((inv) => ({
                  key: inv.id,
                  data: { 'data-billing-invoice-row': inv.id, 'data-invoice-status': inv.status },
                  cells: {
                    org: (
                      <a
                        className="font-semibold text-accent hover:underline"
                        href={`/admin/brand-workspace/organizations/${inv.organizationId}#billing-invoices`}
                      >
                        {inv.organizationName}
                      </a>
                    ),
                    period: invoicePeriod(inv),
                    plan: (
                      <span className="admin-nowrap">
                        {b.planNames[inv.planId]}
                        {inv.proratedDays != null && inv.periodDays != null && (
                          <span className="admin-cell-sub">{`${inv.proratedDays}/${inv.periodDays}d`}</span>
                        )}
                      </span>
                    ),
                    list: formatKrw(inv.listKrw, locale),
                    discount: (
                      <span className="admin-nowrap">
                        {inv.discountKrw > 0 ? `-${formatKrw(inv.discountKrw, locale)}` : '0'}
                        {inv.discountPercent > 0 && <span className="admin-cell-sub">{inv.discountPercent}%</span>}
                      </span>
                    ),
                    supply: formatKrw(inv.supplyKrw, locale),
                    vat: formatKrw(inv.vatKrw, locale),
                    total: <strong>{formatKrw(inv.totalKrw, locale)}</strong>,
                    status: (
                      <StatusPill tone={invoiceTone(inv.status, inv.overdue)}>
                        {od.billing.invoiceStatuses[inv.status]}
                        {inv.overdue ? ` · ${od.billing.overdueBadge}` : ''}
                      </StatusPill>
                    ),
                  },
                }))}
                empty={od.billing.noInvoices}
              />
            </Panel>

            <Panel
              title={bb.overdueHeading}
              id="overdue"
              action={<span className="text-xs font-mono opacity-75">{formatCount(data.overdueInvoices.length, locale)}</span>}
            >
              <AdminTable
                caption={bb.overdueHeading}
                columns={[
                  { key: 'org', label: ol.columns.org },
                  { key: 'period', label: od.billing.invoiceCols.period },
                  { key: 'plan', label: od.billing.invoiceCols.plan },
                  { key: 'total', label: od.billing.invoiceCols.total, numeric: true },
                  { key: 'age', label: od.billing.invoiceCols.status },
                  { key: 'action', label: od.billing.invoiceCols.actions },
                ]}
                rows={data.overdueInvoices.map((inv) => ({
                  key: inv.id,
                  data: { 'data-overdue-invoice-row': inv.id },
                  cells: {
                    org: (
                      <a
                        className="font-semibold text-accent hover:underline"
                        href={`/admin/brand-workspace/organizations/${inv.organizationId}#billing-invoices`}
                      >
                        {inv.organizationName}
                      </a>
                    ),
                    period: invoicePeriod(inv),
                    plan: b.planNames[inv.planId],
                    total: <strong>{formatKrw(inv.totalKrw, locale)}</strong>,
                    age: (
                      <StatusPill tone="fail">
                        {interpolate(bb.overdueDays, { days: String(inv.daysSinceIssued ?? 0) })}
                      </StatusPill>
                    ),
                    action: (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium text-accent">{od.billing.markPaidToggle}</summary>
                        <OpForm
                          op="brandBilling.invoice.markPaid"
                          back={`${backUrl}#overdue`}
                          className="mt-2 grid gap-1.5 min-w-[220px]"
                        >
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input
                            name="paidMethod"
                            placeholder={od.billing.paidMethodLabel}
                            required
                            className={INPUT}
                          />
                          <input name="paidAt" type="date" title={od.billing.paidAtLabel} className={INPUT} />
                          <input name="memo" defaultValue={inv.memo} placeholder={od.billing.draftMemo} className={INPUT} />
                          <button type="submit" className={BUTTON_PRIMARY}>
                            {od.billing.markPaidSubmit}
                          </button>
                        </OpForm>
                      </details>
                    ),
                  },
                }))}
                empty={bb.overdueEmpty}
              />
            </Panel>

            <Panel
              title={bb.uninvoicedCyclesHeading}
              id="uninvoiced-cycles"
              action={
                data.cyclesAvailable ? (
                  <span className="text-xs font-mono opacity-75">{formatCount(data.uninvoicedCycles.length, locale)}</span>
                ) : undefined
              }
            >
              <div data-uninvoiced-cycles>
                {!data.cyclesAvailable ? (
                  <p className="admin-notice" data-uninvoiced-cycles-unmigrated>
                    {bb.cyclesUnmigrated}
                  </p>
                ) : (
                  <>
                    <p className="admin-field-hint mb-3">{bb.uninvoicedCyclesHint}</p>
                    <AdminTable
                      caption={bb.uninvoicedCyclesHeading}
                      columns={[
                        { key: 'org', label: ol.columns.org },
                        { key: 'plan', label: od.billing.invoiceCols.plan },
                        { key: 'cycle', label: bb.cycleCol },
                        { key: 'next', label: bb.nextBillingCol },
                      ]}
                      rows={data.uninvoicedCycles.map((row) => ({
                        key: `${row.organizationId}|${row.cycleStart}`,
                        data: { 'data-uninvoiced-cycle-row': row.organizationId, 'data-cycle-start': row.cycleStart },
                        cells: {
                          org: (
                            <a
                              className="font-semibold text-accent hover:underline"
                              href={`/admin/brand-workspace/organizations/${row.organizationId}#billing-invoices`}
                            >
                              {row.organizationName}
                            </a>
                          ),
                          plan: (
                            <span className="admin-nowrap">
                              {b.planNames[row.planId]}
                              <span className="admin-cell-sub">{`${od.billing.startedOn} ${row.startedOn}`}</span>
                            </span>
                          ),
                          cycle: (
                            <span className="admin-nowrap">
                              {interpolate(od.billing.cycleRange, cycleText(row.cycleStart, row.cycleEnd))}
                            </span>
                          ),
                          next: <span className="admin-nowrap">{dayLabel(row.cycleEnd, locale)}</span>,
                        },
                      }))}
                      empty={bb.uninvoicedCyclesEmpty}
                    />
                  </>
                )}
              </div>
            </Panel>

            <Panel
              title={interpolate(bb.uninvoicedHeading, { period: data.period })}
              id="uninvoiced"
              action={<span className="text-xs font-mono opacity-75">{formatCount(data.uninvoicedActiveOrgs.length, locale)}</span>}
            >
              <p className="admin-field-hint mb-3">{bb.uninvoicedHint}</p>
              <AdminTable
                caption={interpolate(bb.uninvoicedHeading, { period: data.period })}
                columns={[
                  { key: 'org', label: ol.columns.org },
                  { key: 'plan', label: od.billing.draftPlan },
                  { key: 'mode', label: od.billing.billingMode },
                  { key: 'list', label: od.billing.invoiceCols.list, numeric: true },
                  { key: 'discount', label: od.overview.discountCard },
                  { key: 'action', label: od.billing.invoiceCols.actions },
                ]}
                rows={data.uninvoicedActiveOrgs.map((org) => ({
                  key: org.organizationId,
                  data: { 'data-uninvoiced-org-row': org.organizationId },
                  cells: {
                    org: (
                      <a
                        className="font-semibold text-accent hover:underline"
                        href={`/admin/brand-workspace/organizations/${org.organizationId}#billing`}
                      >
                        {org.organizationName}
                      </a>
                    ),
                    plan: (
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span>{b.planNames[org.planId]}</span>
                        {org.inGrace && <StatusPill tone="action">{ol.planStates.grace}</StatusPill>}
                      </span>
                    ),
                    mode: b.billingModes[org.billingMode as BrandBillingMode] ?? org.billingMode,
                    list: formatKrw(org.monthlyListKrw, locale),
                    discount: org.activeDiscountPercent != null ? `${org.activeDiscountPercent}%` : '—',
                    action: (
                      <OpForm op="brandBilling.invoice.draft" back={backUrl}>
                        <input type="hidden" name="organizationId" value={org.organizationId} />
                        <input type="hidden" name="period" value={data.period} />
                        <input type="hidden" name="planId" value={org.planId} />
                        <input type="hidden" name="applyActiveDiscount" value="1" />
                        <input type="hidden" name="prorate" value="1" />
                        <input type="hidden" name="stay" value="1" />
                        <button type="submit" className={BUTTON_PRIMARY}>
                          {bb.oneClickDraft}
                        </button>
                      </OpForm>
                    ),
                  },
                }))}
                empty={bb.uninvoicedEmpty}
              />
            </Panel>

            <Panel title={bb.planDefaultsHeading} id="plan-defaults">
              <p className="admin-notice mb-4">
                {interpolate(bb.planDefaultsDecisionNote, {
                  envDefault: formatKrw(data.envDefaultMonthlyKrw, locale),
                })}
              </p>
              {!data.defaultsAvailable ? (
                <p className="admin-notice">{bb.unavailable}</p>
              ) : (
                <div className="grid gap-3">
                  {data.planDefaults.map((row) => (
                    <div
                      key={row.planId}
                      data-plan-default-row={row.planId}
                      className="rounded border border-hairline p-4"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                        <div>
                          <strong className="text-sm">{b.planNames[row.planId]}</strong>{' '}
                          <span className="text-xs opacity-75">
                            · {formatKrw(BRAND_PLANS[row.planId].monthlyKrw, locale)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusPill tone={row.monthlyCapKrw != null ? 'done' : 'progress'}>
                            {row.monthlyCapKrw != null
                              ? formatKrw(row.monthlyCapKrw, locale)
                              : // R3 item 6: unset means the plan's confirmed credits apply, not the env default.
                                interpolate(bb.unsetConfirmedValue, {
                                  credits: formatCredits(creditsOf(row.effectiveCapKrw), locale === 'en' ? 'en' : 'ko'),
                                })}
                          </StatusPill>
                          <span className="opacity-80">
                            {interpolate(bb.followingOrgs, { count: formatCount(row.followingOrgCount, locale) })} /{' '}
                            {formatCount(row.affectedOrgCount, locale)}
                          </span>
                          {row.updatedAt && (
                            <span className="opacity-65">{formatAdminTime(row.updatedAt, locale)}</span>
                          )}
                        </div>
                      </div>

                      <OpForm
                        op="brandBilling.planDefault.set"
                        back={`${backUrl}#plan-defaults`}
                        className="grid gap-3 sm:grid-cols-12 sm:items-end"
                      >
                        <input type="hidden" name="planId" value={row.planId} />
                        <label className="text-xs sm:col-span-3">
                          <span className="font-semibold block mb-1">{bb.capInputLabel}</span>
                          <input
                            name="monthlyCapKrw"
                            type="number"
                            min={1000}
                            max={100_000_000}
                            step={1000}
                            required
                            defaultValue={
                              preparedPlanId === row.planId && preparedCapValue !== undefined && preparedCapValue !== 'unset'
                                ? preparedCapValue
                                : row.monthlyCapKrw !== null
                                  ? String(row.monthlyCapKrw)
                                  : ''
                            }
                            placeholder={row.monthlyCapKrw == null ? bb.unsetValue : undefined}
                            className={INPUT}
                          />
                          <span className="admin-field-hint mt-1 block" data-credit-hint="plan-default">
                            {creditEquivalentHint(
                              preparedPlanId === row.planId && preparedCapValue !== undefined && preparedCapValue !== 'unset'
                                ? Number(preparedCapValue)
                                : row.effectiveCapKrw,
                              locale,
                              od.billing,
                            )}
                          </span>
                        </label>
                        <label className="text-xs sm:col-span-4">
                          <span className="font-semibold block mb-1">{bb.noteInputLabel}</span>
                          <input name="note" defaultValue={row.note} maxLength={500} className={INPUT} />
                        </label>
                        <label className="text-xs flex items-center gap-1.5 sm:col-span-3 sm:pb-2">
                          <input type="checkbox" name="confirm" value="true" />
                          <span>{bb.confirmBoxLabel}</span>
                        </label>
                        <div className="sm:col-span-2">
                          <button type="submit" className={BUTTON_PRIMARY}>
                            {bb.previewOrSaveButton}
                          </button>
                        </div>
                      </OpForm>
                      <OpForm
                        op="brandBilling.planDefault.set"
                        back={`${backUrl}#plan-defaults`}
                        className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-2.5 text-xs"
                      >
                        <input type="hidden" name="planId" value={row.planId} />
                        <input type="hidden" name="clearDefault" value="1" />
                        {preparedPlanId === row.planId && preparedClearDigest && (
                          <input type="hidden" name="previewDigest" value={preparedClearDigest} />
                        )}
                        <input type="hidden" name="note" value={row.note} />
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" name="confirm" value="true" />
                          <span>{bb.clearConfirmLabel}</span>
                        </label>
                        <button type="submit" className={BUTTON}>
                          {bb.clearDefaultButton}
                        </button>
                      </OpForm>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            {data.taxInvoicePanel?.enabled && (
              <Panel
                title={bb.taxInvoicesHeading}
                id="tax-invoices"
                action={
                  data.taxInvoicePanel.schemaReady ? (
                    <span className="text-xs font-mono opacity-75">
                      {formatCount(data.taxInvoicePanel.pending.length, locale)}
                    </span>
                  ) : undefined
                }
              >
                {!data.taxInvoicePanel.schemaReady ? (
                  <p className="admin-notice" data-tax-invoices-unmigrated>
                    {od.billing.subscriptionUnconfigured}
                  </p>
                ) : (
                  <>
                    {data.taxInvoicePanel.attention && (
                      <p
                        className="admin-notice mb-3"
                        data-subscription-attention
                        data-suspended-count={data.taxInvoicePanel.attention.suspended}
                        data-reissue-count={data.taxInvoicePanel.attention.pendingReissue}
                      >
                        {interpolate(bb.subscriptionAttention, {
                          suspended: formatCount(data.taxInvoicePanel.attention.suspended, locale),
                          reissue: formatCount(data.taxInvoicePanel.attention.pendingReissue, locale),
                        })}
                      </p>
                    )}
                    <p className="admin-field-hint mb-3">{bb.taxInvoicesHint}</p>
                    <AdminTable
                      caption={bb.taxInvoicesHeading}
                      columns={[
                        { key: 'org', label: ol.columns.org },
                        { key: 'period', label: od.billing.invoiceCols.period },
                        { key: 'profile', label: od.billing.profileHeading },
                        { key: 'supply', label: od.billing.invoiceCols.supply, numeric: true },
                        { key: 'vat', label: od.billing.invoiceCols.vat, numeric: true },
                        { key: 'total', label: od.billing.invoiceCols.total, numeric: true },
                        { key: 'status', label: od.billing.invoiceCols.status },
                        { key: 'action', label: od.billing.invoiceCols.actions },
                      ]}
                      rows={data.taxInvoicePanel.pending.map((row) => ({
                        key: row.invoiceId,
                        data: { 'data-pending-tax-invoice-row': row.invoiceId },
                        cells: {
                          org: (
                            <a
                              className="font-semibold text-accent hover:underline"
                              href={`/admin/brand-workspace/organizations/${row.organizationId}#billing-invoices`}
                            >
                              {row.organizationName}
                            </a>
                          ),
                          period: row.period,
                          profile: row.billingProfile ? (
                            <div className="text-xs space-y-0.5">
                              <div className="font-medium">
                                {row.billingProfile.companyLegalName || '—'} ({row.billingProfile.businessRegNo || '—'})
                              </div>
                              <div className="opacity-75">
                                {row.billingProfile.representativeName || '—'} · {row.billingProfile.taxInvoiceEmail || '—'}
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs opacity-75">{bb.taxInvoiceOrgProfileMissing}</span>
                          ),
                          supply: formatKrw(row.supplyKrw, locale),
                          vat: formatKrw(row.vatKrw, locale),
                          total: <strong>{formatKrw(row.totalKrw, locale)}</strong>,
                          status: (
                            <StatusPill tone={row.status === 'paid' ? 'done' : 'action'}>
                              {od.billing.invoiceStatuses[row.status]}
                            </StatusPill>
                          ),
                          action: (
                            <OpForm
                              op="brandBilling.invoice.recordTaxInvoice"
                              back={`${backUrl}#tax-invoices`}
                              className="flex flex-wrap items-center gap-1.5"
                            >
                              <input type="hidden" name="invoiceId" value={row.invoiceId} />
                              <input type="hidden" name="stay" value="1" />
                              <input
                                name="issuedOn"
                                type="date"
                                defaultValue={todayKst}
                                required
                                title={od.billing.taxInvoiceIssuedOnLabel}
                                className={INPUT}
                                style={{ width: 140 }}
                              />
                              <input
                                name="ref"
                                placeholder={od.billing.taxInvoiceRefLabel}
                                required
                                maxLength={120}
                                className={INPUT}
                                style={{ width: 170 }}
                              />
                              <button type="submit" className={BUTTON_PRIMARY}>
                                {od.billing.taxInvoiceSubmit}
                              </button>
                            </OpForm>
                          ),
                        },
                      }))}
                      empty={bb.taxInvoicesEmpty}
                    />
                  </>
                )}
              </Panel>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
