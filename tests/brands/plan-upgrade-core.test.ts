import { describe, expect, it } from 'vitest';
import { cycleContaining, cycleStartAt } from '@/lib/brands/billing/cycle';
import {
  addCalendarDays,
  daysInYearMonth,
  diffCalendarDays,
  invoiceAmounts,
  PAID_BRAND_PLAN_IDS,
  type PaidBrandPlanId,
} from '@/lib/brands/billing/math';
import {
  BRAND_MARGIN_FLOOR,
  BRAND_PLAN_LIST_KRW,
  cardFeeKrw,
  planCapKrwFromCredits,
  worstCostKrwPerCredit,
} from '@/lib/brands/billing/plan-credits';
import { planUpgradeEffect, type PlanUpgradeInput } from '@/lib/brands/billing/plan-upgrade';

/**
 * B1c-3 (notes: B1c3-brief.md §1): the pure upgrade core. A mid-cycle upgrade charges the new plan's full price that
 * day, starts a new cycle on it, carries the old cycle's unused credits once, and refunds nothing.
 */

const CAPS: Record<PaidBrandPlanId, number> = {
  b2b_29: planCapKrwFromCredits('b2b_29'),
  b2b_49: planCapKrwFromCredits('b2b_49'),
  b2b_69: planCapKrwFromCredits('b2b_69'),
};

function input(over: Partial<PlanUpgradeInput> = {}): PlanUpgradeInput {
  return {
    todayKst: '2026-11-25',
    oldPlanId: 'b2b_29',
    newPlanId: 'b2b_49',
    currentCycle: { start: '2026-11-17', end: '2026-12-17' },
    planActive: true,
    sandboxed: false,
    allowanceSource: 'plan',
    oldCapKrw: 270_000,
    oldUsedKrw: 100_000,
    planCapsKrw: CAPS,
    listPricesKrw: BRAND_PLAN_LIST_KRW,
    discountPercent: 0,
    ...over,
  };
}

describe('planUpgradeEffect — worked example (brief §4)', () => {
  it('day 9 of a 29 cycle with 100,000 of 270,000 used → 49: carry 170,000, new cycle from today, 539,000 due today + 14', () => {
    const effect = planUpgradeEffect(input());
    expect(effect).toEqual({
      ok: true,
      oldPlanId: 'b2b_29',
      newPlanId: 'b2b_49',
      oldCycle: { start: '2026-11-17', end: '2026-11-25', endBefore: '2026-12-17' },
      newCycle: { start: '2026-11-25', end: '2026-12-25' },
      carryKrw: 170_000,
      carryValidFrom: '2026-11-25',
      carryValidUntil: '2026-12-24',
      newPlanCapKrw: 460_000,
      invoice: {
        listKrw: 490_000,
        discountPercent: 0,
        discountKrw: 0,
        supplyKrw: 490_000,
        vatKrw: 49_000,
        totalKrw: 539_000,
        dueOn: '2026-12-09',
      },
    });
  });

  it('the carry is rounded down to 10 won and never negative', () => {
    expect(planUpgradeEffect(input({ oldUsedKrw: 100_007 }))).toMatchObject({ carryKrw: 169_990 });
    expect(planUpgradeEffect(input({ oldUsedKrw: 269_995 }))).toMatchObject({ carryKrw: 0 });
    expect(planUpgradeEffect(input({ oldUsedKrw: 300_000 }))).toMatchObject({ carryKrw: 0 });
  });

  it('grants attached to the old cycle are part of what is carried (everything still usable)', () => {
    expect(planUpgradeEffect(input({ oldCapKrw: 320_000, oldUsedKrw: 100_000 }))).toMatchObject({ carryKrw: 220_000 });
  });

  it('an override organization is upgraded for billing but carries nothing (its cap is the override)', () => {
    expect(planUpgradeEffect(input({ allowanceSource: 'override', oldCapKrw: 1_000_000 }))).toMatchObject({ ok: true, carryKrw: 0 });
    expect(planUpgradeEffect(input({ allowanceSource: 'default' }))).toMatchObject({ ok: true, carryKrw: 0 });
  });

  it('the discount in force applies to the new invoice; nothing is prorated', () => {
    const effect = planUpgradeEffect(input({ newPlanId: 'b2b_69', discountPercent: 10 }));
    expect(effect).toMatchObject({
      ok: true,
      invoice: { listKrw: 690_000, discountPercent: 10, discountKrw: 69_000, supplyKrw: 621_000, vatKrw: 62_100, totalKrw: 683_100 },
    });
  });

  it('month-end: an upgrade on Jan 31 runs to Feb 28 and then keeps day 31', () => {
    const effect = planUpgradeEffect(input({ todayKst: '2027-01-31', currentCycle: { start: '2027-01-17', end: '2027-02-17' } }));
    expect(effect).toMatchObject({ newCycle: { start: '2027-01-31', end: '2027-02-28' }, carryValidUntil: '2027-02-27', invoice: { dueOn: '2027-02-14' } });
    expect(cycleContaining('2027-01-31', '2027-03-15')).toMatchObject({ start: '2027-02-28', end: '2027-03-31' });
  });
});

describe('planUpgradeEffect — every plan pair and every refusal', () => {
  const ALL = ['project_only', ...PAID_BRAND_PLAN_IDS] as const;
  for (const from of ALL) {
    for (const to of ALL) {
      it(`${from} → ${to}`, () => {
        const effect = planUpgradeEffect(input({ oldPlanId: from, newPlanId: to }));
        if (from === 'project_only' || to === 'project_only') {
          expect(effect).toEqual({ ok: false, code: from === to ? 'same_plan' : 'project_only' });
          return;
        }
        if (from === to) {
          expect(effect).toEqual({ ok: false, code: 'same_plan' });
          return;
        }
        if (PAID_BRAND_PLAN_IDS.indexOf(to) < PAID_BRAND_PLAN_IDS.indexOf(from)) {
          expect(effect).toEqual({ ok: false, code: 'not_an_upgrade' });
          return;
        }
        const amounts = invoiceAmounts({ listKrw: BRAND_PLAN_LIST_KRW[to], discountPct: 0, prorate: null });
        expect(effect).toMatchObject({
          ok: true,
          newPlanCapKrw: CAPS[to],
          invoice: { listKrw: amounts.listKrw, supplyKrw: amounts.supplyKrw, vatKrw: amounts.vatKrw, totalKrw: amounts.totalKrw },
        });
      });
    }
  }

  it('refusals: first day of the cycle, plan not active, sandboxed, today outside the cycle, new plan without a cap', () => {
    expect(planUpgradeEffect(input({ todayKst: '2026-11-17' }))).toEqual({ ok: false, code: 'upgrade_on_cycle_start' });
    expect(planUpgradeEffect(input({ planActive: false }))).toEqual({ ok: false, code: 'plan_not_active' });
    expect(planUpgradeEffect(input({ sandboxed: true }))).toEqual({ ok: false, code: 'sandboxed_org' });
    expect(planUpgradeEffect(input({ todayKst: '2026-12-17' }))).toEqual({ ok: false, code: 'outside_current_cycle' });
    expect(planUpgradeEffect(input({ todayKst: '2026-11-16' }))).toEqual({ ok: false, code: 'outside_current_cycle' });
    expect(planUpgradeEffect(input({ planCapsKrw: { ...CAPS, b2b_49: null } }))).toEqual({ ok: false, code: 'plan_cap_not_set' });
  });

  it('a sandboxed organization is refused before anything else is looked at', () => {
    expect(planUpgradeEffect(input({ sandboxed: true, newPlanId: 'b2b_29' }))).toEqual({ ok: false, code: 'sandboxed_org' });
  });
});

/** Seeded PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('planUpgradeEffect — property (seeded)', () => {
  it('carry ≤ unused, the new cycle gets new cap + carry + its own grants, and no upgrade creates unpaid plan credits', () => {
    const random = prng(20261124);
    const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
    const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
    let upgrades = 0;
    for (let run = 0; run < 400; run += 1) {
      const anchorDay = pick([1, 15, 17, 28, 29, 30, 31]);
      const month = int(1, 12);
      const year = pick([2026, 2027, 2028]);
      const period = `${year}-${String(month).padStart(2, '0')}`;
      const anchor = `${period}-${String(Math.min(anchorDay, daysInYearMonth(period))).padStart(2, '0')}`;
      let cycleAnchor = anchor;
      let cycle = { start: anchor, end: cycleStartAt(anchor, 1) };
      let plan: PaidBrandPlanId = pick(['b2b_29', 'b2b_49']);
      let carryIn = 0;
      let planCreditsMadeUsableKrw = 0;
      let feesNetKrw = 0;
      let usedTotalKrw = 0;
      let giftsTotalKrw = 0;
      const discount = pick([0, 0, 5, 10, 20]);
      const pay = (p: PaidBrandPlanId) => {
        const price = BRAND_PLAN_LIST_KRW[p];
        feesNetKrw += price - cardFeeKrw(price);
        planCreditsMadeUsableKrw += CAPS[p];
      };
      pay(plan);
      for (let step = 0; step < int(2, 7); step += 1) {
        const gifts = random() < 0.3 ? int(1, 5) * 10_000 : 0;
        giftsTotalKrw += gifts;
        const cap = CAPS[plan] + carryIn + gifts;
        const length = diffCalendarDays(cycle.end, cycle.start);
        const canUpgrade = plan !== 'b2b_69' && length > 1;
        if (canUpgrade && random() < 0.5) {
          const day = addCalendarDays(cycle.start, int(1, length - 1));
          const usedBefore = Math.min(cap, int(0, cap + 50_000));
          const to: PaidBrandPlanId = plan === 'b2b_29' ? pick(['b2b_49', 'b2b_69']) : 'b2b_69';
          const effect = planUpgradeEffect({
            todayKst: day,
            oldPlanId: plan,
            newPlanId: to,
            currentCycle: cycle,
            planActive: true,
            sandboxed: false,
            allowanceSource: 'plan',
            oldCapKrw: cap,
            oldUsedKrw: usedBefore,
            planCapsKrw: CAPS,
            listPricesKrw: BRAND_PLAN_LIST_KRW,
            discountPercent: discount,
          });
          if (!effect.ok) throw new Error(`refused: ${effect.code}`);
          upgrades += 1;
          // The carry is what was still usable, rounded down to 10 won: never more, never negative.
          expect(effect.carryKrw).toBeGreaterThanOrEqual(0);
          expect(effect.carryKrw).toBeLessThanOrEqual(Math.max(0, cap - usedBefore));
          expect(effect.carryKrw % 10).toBe(0);
          expect(Math.max(0, cap - usedBefore) - effect.carryKrw).toBeLessThan(10);
          // The old cycle ends today (exclusive), the new one starts today: they share only the boundary.
          expect(effect.oldCycle).toEqual({ start: cycle.start, end: day, endBefore: cycle.end });
          expect(effect.newCycle).toEqual({ start: day, end: cycleStartAt(day, 1) });
          expect(effect.carryValidFrom).toBe(day);
          expect(effect.carryValidUntil).toBe(addCalendarDays(effect.newCycle.end, -1));
          // Full price of the new plan, the discount in force, due today + 14 — never prorated.
          const full = invoiceAmounts({ listKrw: BRAND_PLAN_LIST_KRW[to], discountPct: discount, prorate: null });
          expect(effect.invoice).toEqual({
            listKrw: full.listKrw,
            discountPercent: discount,
            discountKrw: full.discountKrw,
            supplyKrw: full.supplyKrw,
            vatKrw: full.vatKrw,
            totalKrw: full.totalKrw,
            dueOn: addCalendarDays(day, 14),
          });
          usedTotalKrw += usedBefore;
          plan = to;
          pay(plan);
          carryIn = effect.carryKrw;
          cycleAnchor = day;
          cycle = effect.newCycle;
          // The new cycle's credits: the new plan's full cap + the carry (+ whatever is granted in it, next step).
          expect(CAPS[plan] + carryIn).toBe(effect.newPlanCapKrw + effect.carryKrw);
        } else {
          usedTotalKrw += int(0, cap);
          carryIn = 0; // unused credits never roll over at a normal cycle end
          cycle = cycleContaining(cycleAnchor, cycle.end)!;
          pay(plan);
        }
      }
      // Margin: plan credits are only ever made usable by a paid invoice (a carried credit was already granted by one),
      // so everything used beyond the gifts is covered, and at the costliest model it leaves the margin floor.
      expect(usedTotalKrw).toBeLessThanOrEqual(planCreditsMadeUsableKrw + giftsTotalKrw);
      const worstCost = (planCreditsMadeUsableKrw / 10) * worstCostKrwPerCredit();
      expect(worstCost).toBeLessThanOrEqual(feesNetKrw * (1 - BRAND_MARGIN_FLOOR));
    }
    expect(upgrades).toBeGreaterThan(200);
  });
});
