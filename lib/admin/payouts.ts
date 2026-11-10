import type { SqlRunner } from "@/lib/db/sql-runner";
import { shortId } from "./format";

/**
 * `/admin/payouts` read model & CSV exporter (docs/ADMIN.md §7.4 & §10-3, PLATFORM-2.0 §19.3).
 *
 * Tax classification for 세무법인 이움 (founder decision 2026-11-04):
 * - `company`: Studio-owned profile (`0 KRW` creator share, `0 KRW` net payout).
 * - `individual_3_3`: Individual AI creative (`3.3%` withholding tax deducted from `creatorShareKrw`).
 * - `business_vat`: Business AI creative (`10%` VAT added on top of `creatorShareKrw` for tax invoice).
 *
 * Zero bank account numbers, resident registration numbers, legal names, or e-mail addresses are
 * ever queried or exported here.
 */

export const PAYOUT_TAX_TYPES = ["individual_3_3", "business_vat", "company"] as const;
export type PayoutTaxType = (typeof PAYOUT_TAX_TYPES)[number];

export interface PayoutFilter {
  /** `YYYY-MM` or `""` for all months. */
  month: string;
  taxType: PayoutTaxType | null;
}

export interface TaxPayoutBreakdown {
  taxType: PayoutTaxType;
  creatorShareKrw: number;
  /** 3.3% withholding tax (income tax 3.0% + local income tax 0.3%), floored to KRW integer. */
  withholdingTaxKrw: number;
  /** 10% VAT for business tax-invoice issuers, floored to KRW integer. */
  vatInvoiceKrw: number;
  /** Final transfer amount (`creatorShareKrw - withholdingTaxKrw + vatInvoiceKrw`). */
  netPayoutKrw: number;
}

export interface AdminPayoutRow {
  month: string;
  creatorId: string;
  creatorShortId: string;
  handle: string | null;
  taxType: PayoutTaxType;
  salesCount: number;
  grossKrw: number;
  vatKrw: number;
  pgFeeKrw: number;
  providerCostKrw: number;
  netProfitKrw: number;
  creatorShareKrw: number;
  withholdingTaxKrw: number;
  vatInvoiceKrw: number;
  netPayoutKrw: number;
  platformMarginKrw: number;
  unpricedCount: number;
}

export interface AdminPayoutSummary {
  payableCreators: number;
  salesCount: number;
  grossKrw: number;
  creatorShareKrw: number;
  withholdingTaxKrw: number;
  vatInvoiceKrw: number;
  netPayoutKrw: number;
}

export interface AdminPayoutReport {
  rows: AdminPayoutRow[];
  months: string[];
  summary: AdminPayoutSummary;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function payoutFilter(params: Record<string, string | string[] | undefined>): PayoutFilter {
  const rawMonth = first(params.month).trim();
  const month = MONTH_RE.test(rawMonth) ? rawMonth : "";
  const rawTax = first(params.taxType).trim();
  const taxType = (PAYOUT_TAX_TYPES as readonly string[]).includes(rawTax)
    ? (rawTax as PayoutTaxType)
    : null;
  return { month, taxType };
}

export function payoutHref(
  filter: PayoutFilter,
  patch: Partial<{ month: string; taxType: PayoutTaxType | null }> = {},
): string {
  const next: PayoutFilter = {
    month: "month" in patch ? (patch.month ?? "") : filter.month,
    taxType: "taxType" in patch ? (patch.taxType ?? null) : filter.taxType,
  };
  const sp = new URLSearchParams();
  if (next.month) sp.set("month", next.month);
  if (next.taxType) sp.set("taxType", next.taxType);
  const qs = sp.toString();
  return qs ? `/admin/payouts?${qs}` : "/admin/payouts";
}

export function payoutCsvHref(filter: PayoutFilter): string {
  const sp = new URLSearchParams();
  if (filter.month) sp.set("month", filter.month);
  if (filter.taxType) sp.set("taxType", filter.taxType);
  const qs = sp.toString();
  return qs ? `/admin/payouts/csv?${qs}` : "/admin/payouts/csv";
}

export function resolvePayoutTaxType(
  payoutColumn: string | null | undefined,
  contractVersion: string | null | undefined,
): PayoutTaxType {
  const p = (payoutColumn ?? "").trim().toLowerCase();
  if (p === "company") return "company";
  if (p === "business_vat" || p === "business") return "business_vat";
  const c = (contractVersion ?? "").trim().toLowerCase();
  if (c.includes("biz") || c.includes("vat") || c.includes("business") || c.includes("corp")) {
    return "business_vat";
  }
  return "individual_3_3";
}

export function computeTaxPayout(
  rawCreatorShareKrw: number,
  taxType: PayoutTaxType,
): TaxPayoutBreakdown {
  const share = Math.max(0, Math.floor(Number(rawCreatorShareKrw) || 0));
  if (taxType === "company" || share === 0) {
    return {
      taxType,
      creatorShareKrw: 0,
      withholdingTaxKrw: 0,
      vatInvoiceKrw: 0,
      netPayoutKrw: 0,
    };
  }
  if (taxType === "business_vat") {
    const vatInvoiceKrw = Math.floor((share * 10) / 100);
    return {
      taxType,
      creatorShareKrw: share,
      withholdingTaxKrw: 0,
      vatInvoiceKrw,
      netPayoutKrw: share + vatInvoiceKrw,
    };
  }
  // individual_3_3: 3% income tax + 0.3% local income tax = 3.3% withholding
  const withholdingTaxKrw = Math.floor((share * 33) / 1000);
  return {
    taxType: "individual_3_3",
    creatorShareKrw: share,
    withholdingTaxKrw,
    vatInvoiceKrw: 0,
    netPayoutKrw: share - withholdingTaxKrw,
  };
}

async function presentTables(sql: SqlRunner, names: readonly string[]): Promise<Set<string>> {
  const { rows } = await sql.query<{ name: string }>(
    "select name from unnest($1::text[]) as name where to_regclass('public.' || name) is not null",
    [names],
  );
  return new Set(rows.map((r) => r.name));
}

type RawSettlementAggregate = {
  month: string;
  creator_id: string;
  handle: string | null;
  payout: string | null;
  contract_version: string | null;
  sales_count: number | string;
  gross_krw: number | string;
  vat_krw: number | string;
  pg_fee_krw: number | string;
  provider_cost_krw: number | string;
  net_profit_krw: number | string;
  creator_share_krw: number | string;
  platform_margin_krw: number | string;
};

export async function loadAdminPayouts(
  sql: SqlRunner,
  filter: PayoutFilter,
): Promise<AdminPayoutReport> {
  const present = await presentTables(sql, [
    "platform_settlements",
    "platform_creators",
    "platform_formats",
    "billing_payments",
    "render_jobs",
  ]);

  if (!present.has("platform_settlements") || !present.has("billing_payments")) {
    return {
      rows: [],
      months: [],
      summary: {
        payableCreators: 0,
        salesCount: 0,
        grossKrw: 0,
        creatorShareKrw: 0,
        withholdingTaxKrw: 0,
        vatInvoiceKrw: 0,
        netPayoutKrw: 0,
      },
    };
  }

  const creatorJoin = present.has("platform_creators")
    ? "left join platform_creators pc on pc.user_id = s.creator_id"
    : "";
  const handleSelect = present.has("platform_creators")
    ? "max(to_jsonb(pc) ->> 'handle') as handle, max(to_jsonb(pc) ->> 'payout') as payout, max(pc.contract_version) as contract_version"
    : "null::text as handle, null::text as payout, null::text as contract_version";

  const params: unknown[] = [];
  const whereParts = ["p.status = 'paid'", "s.creator_id is not null"];
  if (filter.month) {
    params.push(filter.month);
    whereParts.push(`to_char(s.created_at at time zone 'Asia/Seoul', 'YYYY-MM') = $${params.length}`);
  }

  const [aggRes, monthsRes, unpricedRes] = await Promise.all([
    sql.query<RawSettlementAggregate>(
      `select
         to_char(s.created_at at time zone 'Asia/Seoul', 'YYYY-MM') as month,
         s.creator_id::text as creator_id,
         ${handleSelect},
         count(*)::int as sales_count,
         coalesce(sum(s.revenue), 0)::bigint as gross_krw,
         coalesce(sum(s.tax), 0)::bigint as vat_krw,
         coalesce(sum(s.fees), 0)::bigint as pg_fee_krw,
         coalesce(sum(s.provider_cost), 0)::bigint as provider_cost_krw,
         coalesce(sum(s.margin), 0)::bigint as net_profit_krw,
         coalesce(sum(s.creator_due), 0)::bigint as creator_share_krw,
         coalesce(sum(s.platform_margin), 0)::bigint as platform_margin_krw
       from platform_settlements s
       join billing_payments p on p.id = s.payment_id
       ${creatorJoin}
       where ${whereParts.join(" and ")}
       group by 1, 2
       order by 1 desc, coalesce(sum(s.creator_due), 0) desc, 2 asc`,
      params,
    ),
    sql.query<{ month: string }>(
      `select distinct to_char(s.created_at at time zone 'Asia/Seoul', 'YYYY-MM') as month
       from platform_settlements s
       join billing_payments p on p.id = s.payment_id
       where p.status = 'paid' and s.creator_id is not null
       order by 1 desc
       limit 24`,
    ),
    present.has("render_jobs") && present.has("platform_formats")
      ? sql.query<{ month: string; creator_id: string; unpriced: number | string }>(
          `select
             to_char(j.finished_at at time zone 'Asia/Seoul', 'YYYY-MM') as month,
             f.user_id::text as creator_id,
             count(*)::int as unpriced
           from render_jobs j
           join billing_payments p on p.render_id = j.id
           join platform_formats f on f.template_id = j.template_id and f.status = 'accepted'
           where j.status = 'succeeded'
             and p.status = 'paid'
             and j.finished_at is not null
             and j.finished_at <= now() - interval '7 days'
             and not exists (select 1 from platform_settlements s where s.render_id = j.id)
           group by 1, 2`,
        )
      : Promise.resolve({ rows: [] as { month: string; creator_id: string; unpriced: number | string }[] }),
  ]);

  const unpricedMap = new Map<string, number>();
  for (const u of unpricedRes.rows) {
    unpricedMap.set(`${u.month}:${u.creator_id}`, Number(u.unpriced ?? 0));
  }

  const allRows: AdminPayoutRow[] = aggRes.rows.map((raw) => {
    const creatorId = String(raw.creator_id);
    const taxType = resolvePayoutTaxType(raw.payout, raw.contract_version);
    const rawCreatorShare = Number(raw.creator_share_krw ?? 0);
    const tax = computeTaxPayout(rawCreatorShare, taxType);

    return {
      month: String(raw.month),
      creatorId,
      creatorShortId: shortId(creatorId),
      handle: raw.handle ? String(raw.handle) : null,
      taxType,
      salesCount: Number(raw.sales_count ?? 0),
      grossKrw: Number(raw.gross_krw ?? 0),
      vatKrw: Number(raw.vat_krw ?? 0),
      pgFeeKrw: Number(raw.pg_fee_krw ?? 0),
      providerCostKrw: Number(raw.provider_cost_krw ?? 0),
      netProfitKrw: Number(raw.net_profit_krw ?? 0),
      creatorShareKrw: tax.creatorShareKrw,
      withholdingTaxKrw: tax.withholdingTaxKrw,
      vatInvoiceKrw: tax.vatInvoiceKrw,
      netPayoutKrw: tax.netPayoutKrw,
      platformMarginKrw: Number(raw.platform_margin_krw ?? 0),
      unpricedCount: unpricedMap.get(`${raw.month}:${creatorId}`) ?? 0,
    };
  });

  const rows = filter.taxType ? allRows.filter((r) => r.taxType === filter.taxType) : allRows;

  const payableCreatorSet = new Set<string>();
  let salesCount = 0;
  let grossKrw = 0;
  let creatorShareKrw = 0;
  let withholdingTaxKrw = 0;
  let vatInvoiceKrw = 0;
  let netPayoutKrw = 0;

  for (const r of rows) {
    if (r.netPayoutKrw > 0) payableCreatorSet.add(r.creatorId);
    salesCount += r.salesCount;
    grossKrw += r.grossKrw;
    creatorShareKrw += r.creatorShareKrw;
    withholdingTaxKrw += r.withholdingTaxKrw;
    vatInvoiceKrw += r.vatInvoiceKrw;
    netPayoutKrw += r.netPayoutKrw;
  }

  return {
    rows,
    months: monthsRes.rows.map((r) => String(r.month)),
    summary: {
      payableCreators: payableCreatorSet.size,
      salesCount,
      grossKrw,
      creatorShareKrw,
      withholdingTaxKrw,
      vatInvoiceKrw,
      netPayoutKrw,
    },
  };
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/^[=+\-@]/.test(str)) {
    return `"'${str.replace(/"/g, '""')}"`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const PAYOUT_CSV_HEADERS = [
  "month",
  "creator_short_id",
  "handle",
  "tax_type",
  "sales_count",
  "gross_krw",
  "vat_krw",
  "pg_fee_krw",
  "provider_cost_krw",
  "net_profit_krw",
  "creator_share_krw",
  "withholding_tax_3_3_krw",
  "vat_invoice_10_krw",
  "net_payout_krw",
  "platform_margin_krw",
  "unpriced_count",
] as const;

export function formatPayoutsCsv(rows: readonly AdminPayoutRow[]): string {
  const lines = [
    PAYOUT_CSV_HEADERS.join(","),
    ...rows.map((r) =>
      [
        csvCell(r.month),
        csvCell(r.creatorShortId),
        csvCell(r.handle ? `@${r.handle}` : ""),
        csvCell(r.taxType),
        csvCell(r.salesCount),
        csvCell(r.grossKrw),
        csvCell(r.vatKrw),
        csvCell(r.pgFeeKrw),
        csvCell(r.providerCostKrw),
        csvCell(r.netProfitKrw),
        csvCell(r.creatorShareKrw),
        csvCell(r.withholdingTaxKrw),
        csvCell(r.vatInvoiceKrw),
        csvCell(r.netPayoutKrw),
        csvCell(r.platformMarginKrw),
        csvCell(r.unpricedCount),
      ].join(","),
    ),
  ];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
