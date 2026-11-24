/**
 * Subscription invoices never overlap in time (B1c fix round, docs/BRAND-RECURRING-BILLING.md §5.8). A cycle invoice
 * covers `[cycle_start, cycle_end)`; a calendar-month invoice (no cycle) covers its month. Only `kind = 'subscription'`
 * rows count (a credit pack or an adjustment covers no days). Schema-guarded: before 0182 there is no `kind` (every
 * row is a monthly subscription invoice), before 0186 no cycle columns.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { cycleStartAt } from './cycle';
import { hasColumn, hasTable } from './schema-guard';

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

/**
 * True when a non-void subscription invoice of the organization covers any day of `[start, end)` (KST dates).
 * `excludeInvoiceId` leaves one row out (the invoice whose own cycle is being placed).
 */
export async function subscriptionInvoiceOverlaps(
  sql: SqlRunner,
  organizationId: string,
  range: { start: string; end: string },
  excludeInvoiceId?: string,
): Promise<boolean> {
  const c = await coverageSql(sql);
  const row = (
    await sql.query(
      `select 1 from brand_invoices
        where organization_id = $1 and status <> 'void'${c.kindFilter}
          and ${c.startExpr} < $3::date and ${c.endExpr} > $2::date${excludeInvoiceId ? ' and id <> $4' : ''}
        limit 1`,
      excludeInvoiceId ? [organizationId, range.start, range.end, excludeInvoiceId] : [organizationId, range.start, range.end],
    )
  ).rows[0];
  return Boolean(row);
}

export const PAID_AT_BEFORE_START = 'paid_at_before_start' as const;
export const PAID_AT_OVERLAPS_CYCLE = 'paid_at_overlaps_cycle' as const;
/** R3 item 3, the manual path: a paid day before the invoice's issue day / after today (`<code>:<issue day>~<today>`). */
export const PAID_AT_BEFORE_ISSUE = 'paid_at_before_issue' as const;
export const PAID_AT_IN_FUTURE = 'paid_at_in_future' as const;

/**
 * B1c-2 fix round 1, B1: a subscription's first invoice (no cycle yet) starts cycle 0 on its paid day. That day may not be
 * before the day the current epoch's subscription started, and `[paid day, one cycle later)` may not overlap any other
 * non-void subscription invoice of the organization (any epoch; cycle rows by date range, calendar-month rows by month).
 * Returns the refusal code, or null when the paid day is fine. Used by `markPaid` and by the job before it writes cycle 0.
 */
export async function firstPaymentCycleRefusal(
  sql: SqlRunner,
  input: { organizationId: string; invoiceId: string; subscriptionStartedOn: string; paidDay: string },
): Promise<typeof PAID_AT_BEFORE_START | typeof PAID_AT_OVERLAPS_CYCLE | null> {
  if (input.paidDay < input.subscriptionStartedOn) return PAID_AT_BEFORE_START;
  const range = { start: input.paidDay, end: cycleStartAt(input.paidDay, 1) };
  if (await subscriptionInvoiceOverlaps(sql, input.organizationId, range, input.invoiceId)) return PAID_AT_OVERLAPS_CYCLE;
  return null;
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

/** B1c-3 fix round 1: refusal marker when a plan form raises the plan id mid-cycle (use "플랜 올림"). */
export const PLAN_UPGRADE_REQUIRED = 'plan_upgrade_required' as const;

const PLAN_RANK: Readonly<Record<string, number>> = { project_only: 0, b2b_29: 1, b2b_49: 2, b2b_69: 3 };

/**
 * B1c-3 fix round 1: an admin plan form may not raise the plan id while a non-void subscription invoice covers today —
 * that would open the higher plan's credits mid-cycle with no charge. The way to do it is the upgrade operation (new
 * cycle, full price, carry). A lower or equal plan, and an organization with no invoice covering today, are not
 * affected. Called only when an assignment already exists (the caller passes its plan id).
 */
export async function higherPlanNeedsUpgrade(
  sql: SqlRunner,
  organizationId: string,
  currentPlanId: string,
  newPlanId: string,
  todayKst: string,
): Promise<boolean> {
  if ((PLAN_RANK[newPlanId] ?? 0) <= (PLAN_RANK[currentPlanId] ?? 0)) return false;
  return subscriptionInvoiceOverlaps(sql, organizationId, { start: todayKst, end: nextDay(todayKst) });
}

/**
 * B1c-3: the reason stamped on the invoice event a plan upgrade writes (`snapshot.reason`, with `snapshot.upgradedOn` =
 * the day of the upgrade = the new plan start day). The source of truth for "this cycle began with an upgrade".
 */
export const PLAN_UPGRADE_REASON = 'plan_upgrade' as const;

/**
 * R3 item 7 + fix round 1 (M1, M3): why a plan form may not lower the plan today. The detail is a KST day:
 * - `plan_downgrade_next_cycle`        — mid-cycle; change it on the day named (the next cycle's start);
 * - `plan_downgrade_next_issued`       — the next cycle's invoice is already issued; void it, then change it on the day named;
 * - `plan_downgrade_next_paid`         — the next cycle is already paid and keeps its plan; the day named starts the cycle after it;
 * - `plan_downgrade_cycle_issued_today`— today starts a cycle whose invoice is issued (unpaid); void it, change, issue again;
 * - `plan_downgrade_upgraded_cycle`    — this cycle began with "플랜 올림"; the day named is the next cycle's start.
 */
export const PLAN_DOWNGRADE_NEXT_CYCLE = 'plan_downgrade_next_cycle' as const;
export const PLAN_DOWNGRADE_NEXT_ISSUED = 'plan_downgrade_next_issued' as const;
export const PLAN_DOWNGRADE_NEXT_PAID = 'plan_downgrade_next_paid' as const;
export const PLAN_DOWNGRADE_CYCLE_ISSUED_TODAY = 'plan_downgrade_cycle_issued_today' as const;
export const PLAN_DOWNGRADE_UPGRADED_CYCLE = 'plan_downgrade_upgraded_cycle' as const;
export const PLAN_DOWNGRADE_CODES = [
  PLAN_DOWNGRADE_NEXT_CYCLE,
  PLAN_DOWNGRADE_NEXT_ISSUED,
  PLAN_DOWNGRADE_NEXT_PAID,
  PLAN_DOWNGRADE_CYCLE_ISSUED_TODAY,
  PLAN_DOWNGRADE_UPGRADED_CYCLE,
] as const;
export type PlanDowngradeRefusal = { code: (typeof PLAN_DOWNGRADE_CODES)[number]; day: string };

/**
 * R3 item 7 (founder rule, confirmed 2026-11-24: a downgrade takes effect from the next cycle's start day). An admin plan
 * form may not move a paid plan to a LOWER plan — fix round 1 (M2): `project_only` counts as lower than every paid plan —
 * when the customer has been billed for the higher one:
 * 1. (M3) the current cycle began with a plan upgrade (the upgrade event's `upgradedOn` = the plan's start day, and today is
 *    inside that first cycle) — whatever its invoice's status, even a voided draft: the carry was given for the higher plan;
 * 2. an ISSUED or PAID non-void subscription invoice covers today (a draft alone does not block: on the boundary day the
 *    admin changes the plan before issuing the new cycle's invoice). Then (M1) the refusal names what is true: today is the
 *    first day of an issued, unpaid cycle; or the next cycle's invoice is already issued (void it first) or paid (it keeps
 *    the plan); else mid-cycle with the covering invoice's end (a calendar-month row: the next month's 1st).
 * Null when the change is allowed. Same or higher plans run no query.
 */
export async function lowerPlanWaitsForNextCycle(
  sql: SqlRunner,
  organizationId: string,
  currentPlanId: string,
  newPlanId: string,
  todayKst: string,
): Promise<PlanDowngradeRefusal | null> {
  const current = PLAN_RANK[currentPlanId] ?? 0;
  const next = PLAN_RANK[newPlanId] ?? 0;
  if (current === 0 || next >= current) return null;

  if (await hasTable(sql, 'brand_invoice_events')) {
    const upgraded = (
      await sql.query<{ started_on: string }>(
        `select a.started_on::text as started_on
           from brand_plan_assignments a
          where a.organization_id = $1
            and exists (select 1 from brand_invoice_events e
                         where e.organization_id = a.organization_id and e.action = 'edited'
                           and e.snapshot->>'reason' = $2 and e.snapshot->>'upgradedOn' = a.started_on::text)`,
        [organizationId, PLAN_UPGRADE_REASON],
      )
    ).rows[0];
    if (upgraded) {
      const start = String(upgraded.started_on).slice(0, 10);
      const end = cycleStartAt(start, 1);
      if (start <= todayKst && todayKst < end) return { code: PLAN_DOWNGRADE_UPGRADED_CYCLE, day: end };
    }
  }

  const c = await coverageSql(sql);
  const rows = (
    await sql.query<{ status: string; start: string; end: string }>(
      `select status, (${c.startExpr})::text as start, (${c.endExpr})::text as end from brand_invoices
        where organization_id = $1 and status in ('issued', 'paid')${c.kindFilter} and ${c.endExpr} > $2::date
        order by ${c.startExpr}, created_at`,
      [organizationId, todayKst],
    )
  ).rows.map((r) => ({ status: String(r.status), start: String(r.start).slice(0, 10), end: String(r.end).slice(0, 10) }));
  const cover = rows.find((r) => r.start <= todayKst && todayKst < r.end);
  if (!cover) return null;
  if (cover.start === todayKst && cover.status === 'issued') return { code: PLAN_DOWNGRADE_CYCLE_ISSUED_TODAY, day: todayKst };
  // The issued or paid invoices that follow the covering one without a gap.
  let cursor = cover.end;
  for (const r of rows) {
    if (r.start !== cursor) continue;
    if (r.status !== 'paid') return { code: PLAN_DOWNGRADE_NEXT_ISSUED, day: r.start };
    cursor = r.end;
  }
  return cursor === cover.end ? { code: PLAN_DOWNGRADE_NEXT_CYCLE, day: cover.end } : { code: PLAN_DOWNGRADE_NEXT_PAID, day: cursor };
}

function nextDay(day: string): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
