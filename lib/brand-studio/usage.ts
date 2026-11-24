/**
 * Monthly usage allowance (docs/BRAND-STUDIO-V2.md §9).
 *
 * Usage (KRW) = provider cost (USD) x the existing exchange rate x (1 + the existing brand margin).
 * The arithmetic lives in ./usage-rate.ts (client-safe, so the prompt dock shows the same figure the
 * server reserves) and is re-exported here. The number is a deduction from a monthly allowance the
 * studio sets per organization, not a charge.
 *
 * A job reserves its estimate when it is created (the organization row is locked, so two requests
 * cannot both spend the last of the month). A finished job takes exactly that reservation for the
 * results that came out (usage-rate.ts `settledUsageKrw`); the provider's real charge is kept in
 * `cost_usd` for our margin only. Failed and canceled jobs count for nothing.
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import { sqlCacheRoot, type SqlRunner } from '@/lib/db/sql-runner';
import {
  BRAND_PLAN_GRACE_DAYS_DEFAULT,
  kstDayOf,
  kstMonthOf,
  PAID_BRAND_PLAN_IDS,
  planActiveWithGrace,
} from '@/lib/brands/billing/math';
import { cycleContaining, cycleWindow, type BillingCycle } from '@/lib/brands/billing/cycle';
import { resolvePlanCapKrw } from '@/lib/brands/billing/plan-credits';
import { hasColumn, loadAllowanceSchemaState, loadSubscriptionSchemaReady } from '@/lib/brands/billing/schema-guard';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { allowanceWindowView } from './allowance-window';
import type { StudioAllowanceView } from './contracts';
import { STUDIO_CREDIT_KRW } from './credits';
import { planGraceDaysFromEnv } from './env';
import { STUDIO_LANES, type StudioLane } from './models';

export { usageKrw } from './usage-rate';

/**
 * One job's usage in KRW as SQL, counted in whole credits like the amount a screen shows for it. New rows
 * already are (usage-rate.ts `usageKrw`); a row settled before that rule can hold a fraction of a credit,
 * and rounding it here keeps "the amounts on the results" and "what the balance lost" the same number.
 */
export function jobUsageKrwSql(alias = ''): string {
  const t = alias ? `${alias}.` : '';
  return `ceil(coalesce(${t}usage_krw, ${t}estimate_krw) / ${STUDIO_CREDIT_KRW}.0) * ${STUDIO_CREDIT_KRW}`;
}

const KST_OFFSET_MS = 9 * 3_600_000;

/** The Asia/Seoul calendar month containing `now`, as UTC instants (Korea has no daylight saving). */
export function studioMonthWindow(now: Date): { start: Date; end: Date } {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth();
  return {
    start: new Date(Date.UTC(y, m, 1) - KST_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - KST_OFFSET_MS),
  };
}

export type AllowanceSource = 'override' | 'plan' | 'default';

export interface StudioAllowance {
  capKrw: number;
  baseCapKrw: number;
  extraKrw: number;
  source: AllowanceSource;
  usedKrw: number;
  resetsAt: string;
  preferredLane: StudioLane | null;
  /** False when no explicit override or plan default applies and the env default is used. */
  configured: boolean;
  /**
   * Present only when `source` is `plan` (B1c): the billing cycle the allowance runs on (one month from the plan
   * start day, lib/brands/billing/cycle.ts). `usedKrw` and `resetsAt` then belong to this cycle. KST dates, `end`
   * exclusive (= the next billing day); `startAt` / `endAt` are the UTC instants at KST midnight.
   */
  cycle?: { anchor: string; index: number; start: string; end: string; startAt: string; endAt: string };
  /**
   * B1c-2 (flag on only): present and true while an issued subscription invoice of the current epoch is past its due
   * date and unpaid; the plan part (`baseCapKrw`) is then half the plan cap, rounded down to 10 won. Grants (`extraKrw`)
   * are never halved.
   */
  planCapHalvedUnpaid?: true;
}

/**
 * The window an organization's allowance runs on: its plan cycle when the allowance comes from a plan, else the KST
 * calendar month (overrides, the env default, organizations without a plan). The ONE place every screen and job takes
 * "this period's usage" from, so the numbers agree with what `reserveAllowance` enforces.
 */
export function allowanceWindow(allowance: Pick<StudioAllowance, 'cycle'>, now: Date): { kind: 'cycle' | 'month'; start: Date; end: Date } {
  if (allowance.cycle) return { kind: 'cycle', start: new Date(allowance.cycle.startAt), end: new Date(allowance.cycle.endAt) };
  return { kind: 'month', ...studioMonthWindow(now) };
}

/** `loadAllowance` and its window in one call, for readers that only need the window. */
export async function loadAllowanceWindow(
  sql: SqlRunner,
  organizationId: string,
  env: { defaultMonthlyKrw: number; planGraceDays?: number },
  now: Date = new Date(),
): Promise<{ allowance: StudioAllowance; window: { kind: 'cycle' | 'month'; start: Date; end: Date } }> {
  const allowance = await loadAllowance(sql, organizationId, env, now);
  return { allowance, window: allowanceWindow(allowance, now) };
}

/**
 * Date-range grant columns (0186). A positive probe is cached for the database root's lifetime by `hasColumn`; a
 * negative one for 60 s here, so a plan organization's load does not probe on every call before 0186 is applied.
 */
const RANGE_COLUMNS_MISSING = new WeakMap<object, number>();
const RANGE_NEGATIVE_TTL_MS = 60_000;

async function rangeGrantColumnsReady(sql: SqlRunner): Promise<boolean> {
  const root = sqlCacheRoot(sql);
  const missingSince = RANGE_COLUMNS_MISSING.get(root);
  if (missingSince !== undefined && Date.now() - missingSince < RANGE_NEGATIVE_TTL_MS) return false;
  const ok = await hasColumn(sql, 'brand_allowance_grants', 'valid_from');
  if (ok) RANGE_COLUMNS_MISSING.delete(root);
  else RANGE_COLUMNS_MISSING.set(root, Date.now());
  return ok;
}

/** A grant's effective start day as SQL (KST date): `valid_from`, else the later of its creation day and its month's 1st. */
export function grantEffectiveStartSql(rangeColumns: boolean): string {
  const monthly = "greatest(((created_at at time zone 'UTC') + interval '9 hours')::date, (valid_month || '-01')::date)";
  return rangeColumns ? `coalesce(valid_from, ${monthly})` : monthly;
}

/**
 * B1c-2, the unpaid 50% cap: whether the plan organization's statement also asks for the current cycle's invoice. Only
 * with `BRAND_BILLING_AUTO_ISSUE` on and the subscription schema (0182 + the 0186 cycle columns) present; the positive
 * probe is cached for the database root's lifetime by the schema guard, a negative one for 60 s here.
 */
const SUBSCRIPTION_SCHEMA_MISSING = new WeakMap<object, number>();

async function unpaidCycleCheckReady(sql: SqlRunner): Promise<boolean> {
  if (!brandBillingAutoIssueOpen()) return false;
  const root = sqlCacheRoot(sql);
  const missingSince = SUBSCRIPTION_SCHEMA_MISSING.get(root);
  if (missingSince !== undefined && Date.now() - missingSince < RANGE_NEGATIVE_TTL_MS) return false;
  const ok = await loadSubscriptionSchemaReady(sql);
  if (ok) SUBSCRIPTION_SCHEMA_MISSING.delete(root);
  else SUBSCRIPTION_SCHEMA_MISSING.set(root, Date.now());
  return ok;
}

/** Down to a multiple of 10 won (credits are 10 won). */
const floor10 = (krw: number): number => Math.floor(krw / 10) * 10;

/**
 * A plan organization's one window (B1c): its usage inside the current cycle and the grants ATTACHED to that cycle — a
 * grant belongs to the one cycle that contains its effective start day (`grantEffectiveStartSql`), so nothing is
 * counted in two cycles and a cycle always starts from the full plan cap. A grant whose start day is before the plan
 * start belongs to no cycle (the range runs from the cycle start, which is never before the anchor). One statement.
 *
 * B1c-2 (`withUnpaidCheck`, flag on only): the same statement also says whether the current epoch of a non-ended
 * subscription has an issued invoice whose due date has passed (`today > due_on`, KST; founder decision 2026-11-24 —
 * ANY overdue invoice of the epoch, so paying only a newer one does not lift the cap) — no extra statement.
 */
async function planCycleTotals(
  sql: SqlRunner,
  organizationId: string,
  input: { cycle: BillingCycle; withGrants: boolean; rangeColumns: boolean; withUnpaidCheck: boolean; todayKst: string },
): Promise<{ usedKrw: number; grantsKrw: number; overdueUnpaid: boolean }> {
  const { start, end } = cycleWindow(input.cycle);
  const eff = grantEffectiveStartSql(input.rangeColumns);
  const params: unknown[] = [organizationId, start.toISOString(), end.toISOString()];
  const grants = input.withGrants
    ? `,
              (select coalesce(sum(amount_krw), 0)::bigint from brand_allowance_grants
                where organization_id = $1 and revoked_at is null and ${eff} >= $4::date and ${eff} < $5::date) as attached`
    : '';
  if (input.withGrants) params.push(input.cycle.start, input.cycle.end);
  let unpaid = '';
  if (input.withUnpaidCheck) {
    params.push(input.todayKst);
    const today = `$${params.length}::date`;
    unpaid = `,
              exists (select 1 from brand_subscriptions s
                        join brand_invoices i on i.organization_id = s.organization_id and i.subscription_epoch = s.epoch
                       where s.organization_id = $1 and s.status <> 'ended'
                         and i.kind = 'subscription' and i.status = 'issued'
                         and coalesce(i.due_on, ((i.issued_at at time zone 'UTC') + interval '9 hours')::date + 14) < ${today}) as overdue_unpaid`;
  }
  const row = (
    await sql.query<{ used: string | number; attached?: string | number; overdue_unpaid?: boolean }>(
      `select (select coalesce(sum(${jobUsageKrwSql()}), 0)::bigint from brand_studio_jobs
                where organization_id = $1 and status not in ('failed','canceled') and created_at >= $2 and created_at < $3) as used${grants}${unpaid}`,
      params,
    )
  ).rows[0];
  return {
    usedKrw: Number(row?.used ?? 0),
    grantsKrw: Math.max(0, Number(row?.attached ?? 0)),
    overdueUnpaid: row?.overdue_unpaid === true,
  };
}

export async function usedKrwIn(sql: SqlRunner, organizationId: string, window: { start: Date; end: Date }): Promise<number> {
  const row = (
    await sql.query<{ used: string | number }>(
      `select coalesce(sum(${jobUsageKrwSql()}), 0)::bigint as used from brand_studio_jobs
        where organization_id = $1 and status not in ('failed','canceled') and created_at >= $2 and created_at < $3`,
      [organizationId, window.start.toISOString(), window.end.toISOString()],
    )
  ).rows[0];
  return Number(row?.used ?? 0);
}

/**
 * Resolve an organization's monthly studio allowance in KRW.
 *
 * Precedence for `baseCapKrw`:
 *   1. An explicit override row in `brand_studio_allowances` (`is_override = true`; pre-0176 rows
 *      all default to `true`) -> `source: 'override'`.
 *   2. An active paid plan assignment in `brand_plan_assignments` (within `BRAND_PLAN_GRACE_DAYS`: code default 7, production sets 14 since 2026-11-24): its
 *      cap in `brand_plan_allowance_defaults`, or with none stored its confirmed credits x 10 (R3 item 6,
 *      `resolvePlanCapKrw`) -> `source: 'plan'`.
 *   3. Otherwise `env.defaultMonthlyKrw` -> `source: 'default'`.
 *
 * Unexpired, unrevoked one-off `brand_allowance_grants` for the current KST month / date are then
 * added as `extraKrw` (`capKrw = baseCapKrw + extraKrw`). Safe to call inside or outside a transaction
 * even before migration 0176 is applied.
 */
export async function loadAllowance(
  sql: SqlRunner,
  organizationId: string,
  env: { defaultMonthlyKrw: number; planGraceDays?: number },
  now: Date = new Date(),
): Promise<StudioAllowance> {
  const schema = await loadAllowanceSchemaState(sql);
  const window = studioMonthWindow(now);
  const today = kstDayOf(now);
  const month = kstMonthOf(now);
  const graceDaysRaw = env.planGraceDays ?? planGraceDaysFromEnv();
  const graceDays = Number.isFinite(graceDaysRaw) ? graceDaysRaw : BRAND_PLAN_GRACE_DAYS_DEFAULT;

  let rowCap: number | null = null;
  let lane: string | null = null;
  let isOverride = false;
  let planId: string | null = null;
  let planStartedOn: string | null = null;
  let planEndsOn: string | null = null;
  let planDefaultCap: number | null = null;
  let extraKrw = 0;

  if (
    schema.hasAllowancesTable &&
    schema.hasOverrideCol &&
    schema.hasPlanAssignments &&
    schema.hasPlanDefaults &&
    schema.hasGrants
  ) {
    // Fold allowance row, active plan, paid-plan default, and one-month extra grants into ONE query (S4).
    const folded = (
      await sql.query<{
        allow_cap_krw: number | null;
        allow_preferred_lane: string | null;
        allow_is_override: boolean | null;
        plan_id: string | null;
        plan_started_on: string | null;
        plan_ends_on: string | null;
        plan_default_cap_krw: number | null;
        extra_krw: string | number;
      }>(
        `select
           a.monthly_cap_krw as allow_cap_krw,
           a.preferred_lane as allow_preferred_lane,
           a.is_override as allow_is_override,
           p.plan_id as plan_id,
           p.started_on::text as plan_started_on,
           p.ends_on::text as plan_ends_on,
           d.monthly_cap_krw as plan_default_cap_krw,
           coalesce((
             select sum(g.amount_krw)
               from brand_allowance_grants g
              where g.organization_id = org.organization_id
                and g.revoked_at is null
                and g.valid_month = $2
           ), 0)::bigint as extra_krw
         from (select cast($1 as uuid) as organization_id) org
         left join brand_studio_allowances a on a.organization_id = org.organization_id
         left join brand_plan_assignments p on p.organization_id = org.organization_id
         left join brand_plan_allowance_defaults d on d.plan_id = p.plan_id`,
        [organizationId, month],
      )
    ).rows[0];

    if (folded) {
      rowCap = folded.allow_cap_krw === null ? null : Number(folded.allow_cap_krw);
      lane = folded.allow_preferred_lane ?? null;
      isOverride = rowCap !== null && folded.allow_is_override !== false;
      planId = folded.plan_id;
      planStartedOn = folded.plan_started_on;
      planEndsOn = folded.plan_ends_on;
      planDefaultCap = folded.plan_default_cap_krw === null ? null : Number(folded.plan_default_cap_krw);
      extraKrw = Math.max(0, Number(folded.extra_krw ?? 0));
    }
  } else {
    // Deploy-order safe fallback when some 0176 tables or columns are not migrated yet.
    if (schema.hasAllowancesTable) {
      const aRow = (
        await sql.query<{ monthly_cap_krw: number; preferred_lane: string | null; is_override?: boolean }>(
          schema.hasOverrideCol
            ? 'select monthly_cap_krw, preferred_lane, is_override from brand_studio_allowances where organization_id = $1'
            : 'select monthly_cap_krw, preferred_lane from brand_studio_allowances where organization_id = $1',
          [organizationId],
        )
      ).rows[0];
      if (aRow) {
        rowCap = Number(aRow.monthly_cap_krw);
        lane = aRow.preferred_lane ?? null;
        isOverride = schema.hasOverrideCol ? aRow.is_override !== false : true;
      }
    }
    if (!isOverride && schema.hasPlanAssignments && schema.hasPlanDefaults) {
      const pRow = (
        await sql.query<{
          plan_id: string;
          started_on: string;
          ends_on: string | null;
          default_cap: number | null;
        }>(
          `select p.plan_id, p.started_on::text as started_on, p.ends_on::text as ends_on, d.monthly_cap_krw as default_cap
             from brand_plan_assignments p
             left join brand_plan_allowance_defaults d on d.plan_id = p.plan_id
            where p.organization_id = $1`,
          [organizationId],
        )
      ).rows[0];
      if (pRow) {
        planId = pRow.plan_id;
        planStartedOn = pRow.started_on;
        planEndsOn = pRow.ends_on;
        planDefaultCap = pRow.default_cap === null ? null : Number(pRow.default_cap);
      }
    }
    if (schema.hasGrants) {
      const gRow = (
        await sql.query<{ extra: string | number }>(
          `select coalesce(sum(amount_krw), 0)::bigint as extra
             from brand_allowance_grants
            where organization_id = $1
              and revoked_at is null
              and valid_month = $2`,
          [organizationId, month],
        )
      ).rows[0];
      extraKrw = Math.max(0, Number(gRow?.extra ?? 0));
    }
  }

  const preferredLane = lane && (STUDIO_LANES as readonly string[]).includes(lane) ? (lane as StudioLane) : null;
  let source: AllowanceSource = 'default';
  let baseCapKrw = env.defaultMonthlyKrw;
  let planCycle: BillingCycle | null = null;

  // R3 item 6: a paid plan with no stored default (no row, or a cleared one) opens its confirmed credits; a stored row
  // wins, an override wins over both. Same statements as before: only this choice changed.
  const resolvedPlanCap =
    planId && (PAID_BRAND_PLAN_IDS as readonly string[]).includes(planId) ? resolvePlanCapKrw(planId, planDefaultCap) : null;
  if (isOverride && rowCap !== null) {
    source = 'override';
    baseCapKrw = rowCap;
  } else if (planId && planStartedOn && resolvedPlanCap !== null) {
    const { active } = planActiveWithGrace(
      { startedOn: planStartedOn, endsOn: planEndsOn },
      today,
      graceDays,
    );
    if (active) {
      source = 'plan';
      // B1c: the full plan cap every cycle (no first-month proration); the cycle runs from the plan start day and
      // simply continues through the grace days after `ends_on`.
      baseCapKrw = resolvedPlanCap;
      planCycle = cycleContaining(planStartedOn, today);
    }
  }

  if (source !== 'plan' || !planCycle || !planStartedOn) {
    // Overrides, the env default, no plan: the KST calendar month, exactly as before B1c.
    return {
      capKrw: Math.max(0, baseCapKrw) + extraKrw,
      baseCapKrw: Math.max(0, baseCapKrw),
      extraKrw,
      source,
      usedKrw: await usedKrwIn(sql, organizationId, window),
      resetsAt: window.end.toISOString(),
      preferredLane,
      configured: isOverride || source === 'plan',
    };
  }

  // Plan organizations (B1c): ONE window, the current cycle. Used = usage inside it; cap = full plan cap + the grants
  // attached to it. Nothing from an earlier cycle or month is added or subtracted.
  const rangeColumns = schema.hasGrants && (await rangeGrantColumnsReady(sql));
  const totals = await planCycleTotals(sql, organizationId, {
    cycle: planCycle,
    withGrants: schema.hasGrants,
    rangeColumns,
    // B1c-2: only once 0186 is there (the cycle columns) and with the flag on.
    withUnpaidCheck: rangeColumns && (await unpaidCycleCheckReady(sql)),
    todayKst: today,
  });
  // B1c-2, the unpaid 50% cap (founder 2026-11-24): while an issued invoice of the epoch is past its due date and unpaid,
  // the PLAN part is halved; before the due date it is full. Grants are never halved.
  const planCap = totals.overdueUnpaid ? floor10((Math.max(0, baseCapKrw) * 50) / 100) : Math.max(0, baseCapKrw);
  extraKrw = totals.grantsKrw;
  const cycleAt = cycleWindow(planCycle);
  return {
    capKrw: planCap + extraKrw,
    baseCapKrw: planCap,
    extraKrw,
    source,
    usedKrw: totals.usedKrw,
    resetsAt: cycleAt.end.toISOString(),
    preferredLane,
    configured: true,
    ...(totals.overdueUnpaid ? { planCapHalvedUnpaid: true as const } : {}),
    cycle: {
      anchor: planStartedOn,
      index: planCycle.index,
      start: planCycle.start,
      end: planCycle.end,
      startAt: cycleAt.start.toISOString(),
      endAt: cycleAt.end.toISOString(),
    },
  };
}

/** What screens receive. `window` (R1) tells them whether the credits run on a billing cycle or the calendar month. */
export function allowanceView(a: StudioAllowance): StudioAllowanceView {
  return { capKrw: a.capKrw, usedKrw: a.usedKrw, resetsAt: a.resetsAt, window: allowanceWindowView(a) };
}

export type AllowanceVerdict = { ok: true; allowance: StudioAllowance } | { ok: false; code: 'allowance_closed' | 'allowance_exhausted' };

/**
 * Lock the organization row, then check that `estimateKrw` still fits this month. Call inside the
 * transaction that inserts the job, so the check and the insert share one view: a second request
 * for the same organization waits on the lock and then sees the first one's reservation.
 */
export async function reserveAllowance(
  tx: SqlRunner,
  organizationId: string,
  estimateKrw: number,
  env: { defaultMonthlyKrw: number; planGraceDays?: number },
  now: Date = new Date(),
): Promise<AllowanceVerdict> {
  await tx.query('select id from brand_organizations where id = $1 for update', [organizationId]);
  const allowance = await loadAllowance(tx, organizationId, env, now);
  if (allowance.capKrw <= 0) return { ok: false, code: 'allowance_closed' };
  if (allowance.usedKrw + Math.max(0, estimateKrw) > allowance.capKrw) return { ok: false, code: 'allowance_exhausted' };
  return { ok: true, allowance };
}

/* ------------------------------------------------------------------ admin */

export interface StudioAllowanceRow {
  organizationId: string;
  monthlyCapKrw: number;
  isOverride: boolean;
  preferredLane: StudioLane | null;
  note: string;
  updatedAt: string | null;
}

export async function loadAllowanceRow(sql: SqlRunner, organizationId: string): Promise<StudioAllowanceRow | null> {
  try {
    const withOverride = await hasColumn(sql, 'brand_studio_allowances', 'is_override');
    const row = (
      await sql.query<{
        monthly_cap_krw: number;
        is_override?: boolean;
        preferred_lane: string | null;
        note: string;
        updated_at: unknown;
      }>(
        withOverride
          ? 'select monthly_cap_krw, is_override, preferred_lane, note, updated_at from brand_studio_allowances where organization_id = $1'
          : 'select monthly_cap_krw, preferred_lane, note, updated_at from brand_studio_allowances where organization_id = $1',
        [organizationId],
      )
    ).rows[0];
    if (!row) return null;
    return {
      organizationId,
      monthlyCapKrw: Number(row.monthly_cap_krw),
      isOverride: withOverride ? row.is_override !== false : true,
      preferredLane: (STUDIO_LANES as readonly string[]).includes(row.preferred_lane ?? '') ? (row.preferred_lane as StudioLane) : null,
      note: String(row.note ?? ''),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at == null ? null : String(row.updated_at),
    };
  } catch (error) {
    // Before migration 0076 the admin page must still render.
    if ((error as { code?: string } | null)?.code === '42P01') return null;
    throw error;
  }
}

const AllowanceInput = z.object({
  organizationId: z.uuid(),
  monthlyCapKrw: z.number().int().min(0).max(100_000_000).optional(),
  preferredLane: z.enum(STUDIO_LANES).nullable(),
  note: z.string().trim().max(500).default(''),
  forceOverride: z.boolean().optional(),
});

export type SetAllowanceOutcome =
  | { ok: true; id: string }
  | { ok: false; code: 'sign_in_required' | 'forbidden' | 'not_found' | 'invalid'; field?: string };

/** Admin only. The profile row decides who is an administrator, never the viewer object. */
export async function setStudioAllowance(deps: { sql: SqlRunner }, viewer: Viewer, input: unknown): Promise<SetAllowanceOutcome> {
  if (!z.uuid().safeParse(viewer.userId).success) return { ok: false, code: 'sign_in_required' };
  const parsed = AllowanceInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid', field: (parsed.error.issues[0]?.path ?? []).map(String).join('.') };
  const v = parsed.data;
  return deps.sql.transaction(async (sql) => {
    // FOR KEY SHARE does not conflict with FOR NO KEY UPDATE on `profiles`, avoiding lock cycles while verifying admin first.
    const profile = (
      await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for key share', [viewer.userId])
    ).rows[0];
    if (!profile) return { ok: false as const, code: 'sign_in_required' as const };
    if (profile.is_admin !== true) return { ok: false as const, code: 'forbidden' as const };
    if (!(await sql.query('select id from brand_organizations where id = $1 for update', [v.organizationId])).rows[0])
      return { ok: false as const, code: 'not_found' as const };

    const schema = await loadAllowanceSchemaState(sql);
    const withOverride = schema.hasOverrideCol;
    const existingRow = schema.hasAllowancesTable
      ? (
          await sql.query<{ monthly_cap_krw: number; is_override?: boolean }>(
            withOverride
              ? 'select monthly_cap_krw, is_override from brand_studio_allowances where organization_id = $1 for update'
              : 'select monthly_cap_krw from brand_studio_allowances where organization_id = $1 for update',
            [v.organizationId],
          )
        ).rows[0]
      : undefined;

    let activePlanDefaultCap: number | null = null;
    if (schema.hasPlanAssignments && schema.hasPlanDefaults) {
      const planRow = (
        await sql.query<{
          plan_id: string;
          started_on: string;
          ends_on: string | null;
          default_cap: number | null;
        }>(
          `select p.plan_id, p.started_on::text as started_on, p.ends_on::text as ends_on,
                  d.monthly_cap_krw as default_cap
             from brand_plan_assignments p
             left join brand_plan_allowance_defaults d on d.plan_id = p.plan_id
            where p.organization_id = $1`,
          [v.organizationId],
        )
      ).rows[0];
      // R3 item 6: a paid plan without a stored default follows its confirmed credits.
      const planCap =
        planRow && (PAID_BRAND_PLAN_IDS as readonly string[]).includes(planRow.plan_id)
          ? resolvePlanCapKrw(planRow.plan_id, planRow.default_cap)
          : null;
      if (planRow && planCap !== null) {
        const { active } = planActiveWithGrace(
          { startedOn: String(planRow.started_on), endsOn: planRow.ends_on == null ? null : String(planRow.ends_on) },
          kstDayOf(new Date()),
          planGraceDaysFromEnv(),
        );
        if (active) activePlanDefaultCap = planCap;
      }
    }

    if (!existingRow && activePlanDefaultCap === null && v.monthlyCapKrw === undefined) {
      return { ok: false as const, code: 'invalid' as const, field: 'monthlyCapKrw' };
    }

    const dbInPlanDefault = existingRow ? existingRow.is_override === false : activePlanDefaultCap !== null;
    const dbPlanCap = activePlanDefaultCap ?? (existingRow ? Number(existingRow.monthly_cap_krw) : 0);
    const preservePlanDefault =
      withOverride &&
      !v.forceOverride &&
      dbInPlanDefault &&
      (v.monthlyCapKrw === undefined ||
        v.monthlyCapKrw === dbPlanCap ||
        (existingRow !== undefined && v.monthlyCapKrw === Number(existingRow.monthly_cap_krw)));
    const isOverride = !preservePlanDefault;
    const capToWrite = preservePlanDefault ? dbPlanCap : (v.monthlyCapKrw ?? dbPlanCap);

    if (withOverride) {
      await sql.query(
        `insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note, updated_by, updated_at)
           values ($1, $2, $3, $4, $5, $6, now())
         on conflict (organization_id) do update
           set monthly_cap_krw = excluded.monthly_cap_krw, is_override = excluded.is_override, preferred_lane = excluded.preferred_lane,
               note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`,
        [v.organizationId, capToWrite, isOverride, v.preferredLane, v.note, viewer.userId],
      );
    } else {
      await sql.query(
        `insert into brand_studio_allowances (organization_id, monthly_cap_krw, preferred_lane, note, updated_by, updated_at)
           values ($1, $2, $3, $4, $5, now())
         on conflict (organization_id) do update
           set monthly_cap_krw = excluded.monthly_cap_krw, preferred_lane = excluded.preferred_lane,
               note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`,
        [v.organizationId, capToWrite, v.preferredLane, v.note, viewer.userId],
      );
    }
    return { ok: true as const, id: v.organizationId };
  });
}
