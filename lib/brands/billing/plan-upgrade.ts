/**
 * B1c-3: a mid-cycle plan upgrade (docs/BRAND-RECURRING-BILLING.md §5.10; founder decisions 2026-11-24).
 *
 * 1. On the day of the upgrade the full price of the new plan is charged and a NEW cycle starts that day (one month,
 *    month-end clamp, `lib/brands/billing/cycle.ts`). The old cycle is cut to `[old start, today)`; the remaining time
 *    of the old plan is not refunded.
 * 2. What was still usable in the old cycle (plan credits and the grants attached to it) is carried ONCE into the new
 *    cycle as a grant that ends with the new cycle. Unused credits never roll over otherwise.
 * 3. Only when the current cycle is paid (checked by the caller, which reads the invoices).
 * 4. Downgrades are unchanged (from the next cycle start, no carry).
 * 5. The carry is a grant: never halved by the unpaid 50% rule.
 *
 * This file is the pure core: explicit inputs, no db, no env, no clock. Client-safe.
 */
import { cycleStartAt } from './cycle';
import { addCalendarDays, invoiceAmounts, isValidCalendarDay, PAID_BRAND_PLAN_IDS, type PaidBrandPlanId } from './math';

/** Due date of the upgrade invoice: the upgrade day + 14 (bank transfer, B1c-2 rule 3). */
export const PLAN_UPGRADE_DUE_DAYS = 14 as const;

export type PlanUpgradeRefusal =
  | 'same_plan'
  | 'not_an_upgrade'
  | 'project_only'
  | 'sandboxed_org'
  | 'plan_not_active'
  /** Today is the first day of the current cycle: the old cycle cannot be cut to zero days (void + new invoice instead). */
  | 'upgrade_on_cycle_start'
  | 'outside_current_cycle'
  | 'plan_cap_not_set';

export interface PlanUpgradeInput {
  /** KST day of the upgrade. */
  todayKst: string;
  oldPlanId: string;
  newPlanId: string;
  /** The paid cycle that contains today, from its invoice (`[start, end)`). */
  currentCycle: { start: string; end: string };
  /** The plan assignment is active today (not in grace after its end). */
  planActive: boolean;
  sandboxed: boolean;
  /** `loadAllowance` source. Only a plan organization carries: an override cap never changes, a default has no plan credits. */
  allowanceSource: 'plan' | 'override' | 'default';
  /** The old cycle's cap as `loadAllowance` reports it: the plan cap plus the grants attached to the cycle. */
  oldCapKrw: number;
  /**
   * Usage of the old cycle as cut: `[cycle start, start of today)`. Usage earlier today counts in the new cycle (it starts
   * at KST midnight), so it is not also taken off the carry.
   */
  oldUsedKrw: number;
  /** Plan default caps (`brand_plan_allowance_defaults`), KRW. */
  planCapsKrw: Readonly<Record<PaidBrandPlanId, number | null>>;
  /** Monthly list prices, KRW, VAT excluded. */
  listPricesKrw: Readonly<Record<PaidBrandPlanId, number>>;
  /** The discount in force today (percent of the list price), 0 when none. */
  discountPercent: number;
}

export interface PlanUpgradeInvoice {
  listKrw: number;
  discountPercent: number;
  discountKrw: number;
  supplyKrw: number;
  vatKrw: number;
  totalKrw: number;
  dueOn: string;
}

export interface PlanUpgradeEffect {
  ok: true;
  oldPlanId: PaidBrandPlanId;
  newPlanId: PaidBrandPlanId;
  /** The old cycle cut to today (`end` exclusive); `endBefore` is where it ended before. */
  oldCycle: { start: string; end: string; endBefore: string };
  /** `[today, one month later)`: today becomes the anchor. */
  newCycle: { start: string; end: string };
  /** Credits carried into the new cycle (KRW, multiple of 10). 0: no carry grant is written. */
  carryKrw: number;
  carryValidFrom: string;
  /** Last day (inclusive) the carry may be used: the new cycle's last day. */
  carryValidUntil: string;
  newPlanCapKrw: number;
  invoice: PlanUpgradeInvoice;
}

const floor10 = (krw: number) => Math.floor(krw / 10) * 10;
const isPaid = (planId: string): planId is PaidBrandPlanId => (PAID_BRAND_PLAN_IDS as readonly string[]).includes(planId);

/** The plan pair alone: same plan, a plan that is not a paid plan, or not higher. Null when it is an upgrade. */
export function planUpgradePairRefusal(oldPlanId: string, newPlanId: string): 'same_plan' | 'project_only' | 'not_an_upgrade' | null {
  if (oldPlanId === newPlanId) return 'same_plan';
  if (!isPaid(oldPlanId) || !isPaid(newPlanId)) return 'project_only';
  if (PAID_BRAND_PLAN_IDS.indexOf(newPlanId) < PAID_BRAND_PLAN_IDS.indexOf(oldPlanId)) return 'not_an_upgrade';
  return null;
}

export function planUpgradeEffect(input: PlanUpgradeInput): PlanUpgradeEffect | { ok: false; code: PlanUpgradeRefusal } {
  const { todayKst, oldPlanId, newPlanId, currentCycle } = input;
  if (!isValidCalendarDay(todayKst)) throw new RangeError(`invalid day: ${todayKst}`);
  if (input.sandboxed) return { ok: false, code: 'sandboxed_org' };
  const pair = planUpgradePairRefusal(oldPlanId, newPlanId);
  if (pair !== null || !isPaid(oldPlanId) || !isPaid(newPlanId)) return { ok: false, code: pair ?? 'project_only' };
  if (!input.planActive) return { ok: false, code: 'plan_not_active' };
  if (todayKst < currentCycle.start || todayKst >= currentCycle.end) return { ok: false, code: 'outside_current_cycle' };
  if (todayKst === currentCycle.start) return { ok: false, code: 'upgrade_on_cycle_start' };
  const newPlanCapKrw = input.planCapsKrw[newPlanId];
  if (newPlanCapKrw === null || newPlanCapKrw === undefined) return { ok: false, code: 'plan_cap_not_set' };

  const carryKrw = input.allowanceSource === 'plan' ? Math.max(0, floor10(input.oldCapKrw - input.oldUsedKrw)) : 0;
  const newCycle = { start: todayKst, end: cycleStartAt(todayKst, 1) };
  const amounts = invoiceAmounts({ listKrw: input.listPricesKrw[newPlanId], discountPct: input.discountPercent, prorate: null });
  return {
    ok: true,
    oldPlanId,
    newPlanId,
    oldCycle: { start: currentCycle.start, end: todayKst, endBefore: currentCycle.end },
    newCycle,
    carryKrw,
    carryValidFrom: todayKst,
    carryValidUntil: addCalendarDays(newCycle.end, -1),
    newPlanCapKrw,
    invoice: {
      listKrw: amounts.listKrw,
      discountPercent: amounts.discountPct,
      discountKrw: amounts.discountKrw,
      supplyKrw: amounts.supplyKrw,
      vatKrw: amounts.vatKrw,
      totalKrw: amounts.totalKrw,
      dueOn: addCalendarDays(todayKst, PLAN_UPGRADE_DUE_DAYS),
    },
  };
}
