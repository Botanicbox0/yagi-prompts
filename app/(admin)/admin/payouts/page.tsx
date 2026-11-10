import { requireAdmin } from "@/lib/auth/viewer";
import { getSqlRunner } from "@/lib/db/connect";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { getLocaleFromHeaders } from "@/lib/i18n/server";
import { AdminShell } from "@/components/admin/chrome";
import {
  AdminPageHeader,
  AdminTable,
  FilterPills,
  MetricStrip,
  StatusPill,
  type AdminTone,
} from "@/components/admin/patterns";
import {
  PAYOUT_TAX_TYPES,
  loadAdminPayouts,
  payoutCsvHref,
  payoutFilter,
  payoutHref,
  type PayoutTaxType,
} from "@/lib/admin/payouts";
import { formatCount, formatKrw } from "@/lib/admin/format";

/**
 * `/admin/payouts` — monthly AI creative settlement & tax classification table (docs/ADMIN.md §7.4
 * & §10-3, founder decision 2026-11-04).
 *
 * Classifies each creative into:
 * - `individual_3_3`: 3.3% withholding tax deducted (`netPayoutKrw = creatorShareKrw - withholdingTaxKrw`)
 * - `business_vat`: 10% VAT tax invoice added (`netPayoutKrw = creatorShareKrw + vatInvoiceKrw`)
 * - `company`: Studio-owned profile (`0 KRW` payout)
 */
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function taxTone(taxType: PayoutTaxType): AdminTone {
  switch (taxType) {
    case "individual_3_3":
      return "action";
    case "business_vat":
      return "progress";
    case "company":
      return "hold";
  }
}

export default async function AdminPayoutsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The layout's check is not enough on its own: a client navigation request can ask for this page
  // segment alone, and then the layout does not run. Every admin page verifies the admin itself.
  await requireAdmin();
  const [locale, params, sql] = await Promise.all([
    getLocaleFromHeaders(),
    searchParams,
    getSqlRunner(),
  ]);
  const dict = getDictionary(locale);
  const a = dict.admin;
  const c = dict.adminConsole;
  const p = c.payouts;
  const filter = payoutFilter(params);
  const report = sql === null ? null : await loadAdminPayouts(sql, filter);

  return (
    <AdminShell dict={a} locale={locale} active="payouts">
      <AdminPageHeader
        title={p.title}
        {...(report
          ? {
              count: formatCount(report.rows.length, locale),
            }
          : {})}
        lede={p.lede}
        actions={
          report ? (
            <div className="admin-action-row" data-admin-payout-actions>
              <a
                href={payoutCsvHref(filter)}
                className="admin-btn admin-btn-primary"
                data-payout-csv-link
              >
                {p.downloadCsv}
              </a>
            </div>
          ) : undefined
        }
      />

      {report === null ? (
        <p role="status" className="admin-notice">
          {dict.adminWorkflow.unavailable}
        </p>
      ) : (
        <section className="admin-section" data-admin-payouts aria-label={p.title}>
          <MetricStrip
            label={p.title}
            items={[
              {
                key: "creators",
                label: p.summary.creators,
                value: formatCount(report.summary.payableCreators, locale),
                tone: report.summary.payableCreators > 0 ? "action" : "done",
              },
              {
                key: "sales",
                label: p.summary.sales,
                value: formatCount(report.summary.salesCount, locale),
              },
              {
                key: "gross",
                label: p.summary.gross,
                value: formatKrw(report.summary.grossKrw, locale),
              },
              {
                key: "creatorShare",
                label: p.summary.creatorShare,
                value: formatKrw(report.summary.creatorShareKrw, locale),
              },
              {
                key: "withholding",
                label: p.summary.withholding,
                value: formatKrw(report.summary.withholdingTaxKrw, locale),
              },
              {
                key: "netPayout",
                label: p.summary.netPayout,
                value: formatKrw(report.summary.netPayoutKrw, locale),
                tone: report.summary.netPayoutKrw > 0 ? "action" : "done",
              },
            ]}
          />

          <div className="admin-toolbar mt-4">
            <FilterPills
              label={p.taxFilter}
              pills={[
                {
                  key: "all",
                  label: c.list.all,
                  href: payoutHref(filter, { taxType: null }),
                  current: filter.taxType === null,
                },
                ...PAYOUT_TAX_TYPES.map((taxType) => ({
                  key: taxType,
                  label: p.taxTypes[taxType],
                  href: payoutHref(filter, { taxType }),
                  current: filter.taxType === taxType,
                })),
              ]}
            />
            {report.months.length > 0 ? (
              <FilterPills
                label={p.monthFilter}
                pills={[
                  {
                    key: "all-months",
                    label: c.list.all,
                    href: payoutHref(filter, { month: "" }),
                    current: filter.month === "",
                  },
                  ...report.months.slice(0, 6).map((m) => ({
                    key: m,
                    label: m,
                    href: payoutHref(filter, { month: m }),
                    current: filter.month === m,
                  })),
                ]}
              />
            ) : null}
          </div>

          <AdminTable
            caption={p.title}
            empty={p.empty}
            columns={[
              { key: "month", label: p.columns.month },
              { key: "creator", label: p.columns.creator },
              { key: "taxType", label: p.columns.taxType },
              { key: "sales", label: p.columns.sales, numeric: true },
              { key: "gross", label: p.columns.gross, numeric: true },
              { key: "deductions", label: p.columns.deductions, numeric: true },
              { key: "netProfit", label: p.columns.netProfit, numeric: true },
              { key: "creatorShare", label: p.columns.creatorShare, numeric: true },
              { key: "taxAdjustment", label: p.columns.taxAdjustment, numeric: true },
              { key: "netPayout", label: p.columns.netPayout, numeric: true },
              { key: "unpriced", label: p.columns.unpriced, numeric: true },
            ]}
            rows={report.rows.map((row) => ({
              key: `${row.month}-${row.creatorId}`,
              data: {
                "data-payout-row": `${row.month}:${row.creatorShortId}`,
                "data-tax-type": row.taxType,
              },
              cells: {
                month: <span className="admin-nowrap font-mono">{row.month}</span>,
                creator: (
                  <div>
                    <a
                      href={`/admin/users?q=${row.creatorShortId}`}
                      className="admin-row-link"
                      title={row.creatorId}
                    >
                      <code>{row.creatorShortId}</code>
                    </a>
                    {row.handle ? <span className="admin-cell-sub">@{row.handle}</span> : null}
                  </div>
                ),
                taxType: (
                  <StatusPill tone={taxTone(row.taxType)}>{p.taxTypes[row.taxType]}</StatusPill>
                ),
                sales: formatCount(row.salesCount, locale),
                gross: formatKrw(row.grossKrw, locale),
                deductions: (
                  <span className="admin-cell-sub">
                    {formatKrw(row.vatKrw + row.pgFeeKrw + row.providerCostKrw, locale)}
                  </span>
                ),
                netProfit: formatKrw(row.netProfitKrw, locale),
                creatorShare: formatKrw(row.creatorShareKrw, locale),
                taxAdjustment:
                  row.taxType === "individual_3_3" && row.withholdingTaxKrw > 0
                    ? `-${formatKrw(row.withholdingTaxKrw, locale)}`
                    : row.taxType === "business_vat" && row.vatInvoiceKrw > 0
                      ? `+${formatKrw(row.vatInvoiceKrw, locale)}`
                      : formatKrw(0, locale),
                netPayout: (
                  <strong className="font-semibold" data-payout-net>
                    {formatKrw(row.netPayoutKrw, locale)}
                  </strong>
                ),
                unpriced: formatCount(row.unpricedCount, locale),
              },
            }))}
          />
        </section>
      )}
    </AdminShell>
  );
}
