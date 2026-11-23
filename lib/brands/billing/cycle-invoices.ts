/**
 * Subscription invoices never overlap in time (B1c fix round, docs/BRAND-RECURRING-BILLING.md §5.8). A cycle invoice
 * covers `[cycle_start, cycle_end)`; a calendar-month invoice (no cycle) covers its month. Only `kind = 'subscription'`
 * rows count (a credit pack or an adjustment covers no days). Schema-guarded: before 0182 there is no `kind` (every
 * row is a monthly subscription invoice), before 0186 no cycle columns.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { hasColumn } from './schema-guard';

async function coverageSql(sql: SqlRunner): Promise<{ kindFilter: string; startExpr: string; endExpr: string }> {
  const withKind = await hasColumn(sql, 'brand_invoices', 'kind');
  const withCycle = await hasColumn(sql, 'brand_invoices', 'cycle_start');
  const monthStart = "(period || '-01')::date";
  const monthEnd = "((period || '-01')::date + interval '1 month')::date";
  return {
    kindFilter: withKind ? " and kind = 'subscription'" : '',
    startExpr: withCycle ? `coalesce(cycle_start, ${monthStart})` : monthStart,
    endExpr: withCycle ? `coalesce(cycle_end, ${monthEnd})` : monthEnd,
  };
}

/** True when a non-void subscription invoice of the organization covers any day of `[start, end)` (KST dates). */
export async function subscriptionInvoiceOverlaps(
  sql: SqlRunner,
  organizationId: string,
  range: { start: string; end: string },
): Promise<boolean> {
  const c = await coverageSql(sql);
  const row = (
    await sql.query(
      `select 1 from brand_invoices
        where organization_id = $1 and status <> 'void'${c.kindFilter}
          and ${c.startExpr} < $3::date and ${c.endExpr} > $2::date
        limit 1`,
      [organizationId, range.start, range.end],
    )
  ).rows[0];
  return Boolean(row);
}

/** The calendar month `YYYY-MM` as `[1st, next 1st)`. */
export function monthRange(period: string): { start: string; end: string } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { start: `${period}-01`, end: `${next}-01` };
}

/**
 * Moving a plan's start day moves its billing cycle. Refused while a non-void subscription invoice covers today or a
 * later day (the admin voids it first; a mid-cycle restart with a new charge is the upgrade operation of a later
 * slice). Reads the stored start day only when an assignment exists.
 */
export async function startDayMoveBlocked(sql: SqlRunner, organizationId: string, newStartedOn: string, todayKst: string): Promise<boolean> {
  const current = (
    await sql.query<{ started_on: string }>('select started_on::text as started_on from brand_plan_assignments where organization_id = $1', [organizationId])
  ).rows[0];
  if (!current || current.started_on === newStartedOn) return false;
  const c = await coverageSql(sql);
  const row = (
    await sql.query(
      `select 1 from brand_invoices
        where organization_id = $1 and status <> 'void'${c.kindFilter} and ${c.endExpr} > $2::date
        limit 1`,
      [organizationId, todayKst],
    )
  ).rows[0];
  return Boolean(row);
}

export const CYCLE_ALREADY_INVOICED = 'cycle_already_invoiced' as const;
