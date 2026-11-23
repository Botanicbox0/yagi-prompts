import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STUDIO_CREDIT_KRW } from '@/lib/brand-studio/credits';
import { STUDIO_USAGE_FACTORS } from '@/lib/brand-studio/usage-rate';
import { BRAND_INVOICE_VAT_PERCENT, PAID_BRAND_PLAN_IDS } from '@/lib/brands/billing/math';
import {
  BRAND_CARD_FEE_RATE,
  BRAND_MARGIN_FLOOR,
  BRAND_PLAN_CREDITS,
  BRAND_PLAN_LIST_KRW,
  BRAND_TRANSFER_FEE_KRW,
  BRAND_TRIAL_CREDITS,
  cardFeeKrw,
  planCapKrwFromCredits,
  worstCaseMarginKrw,
  worstCostKrwPerCredit,
} from '@/lib/brands/billing/plan-credits';
import { BRAND_PLANS } from '@/lib/brands/plans';

/**
 * docs/BRAND-RECURRING-BILLING.md §6.3, §6.5, §6.6 (2–3, 6): the decided plan credits, the card-margin rule and the
 * trial bound, pinned against the decided numbers. A changed number fails here until the math is redone.
 */
const RECOMPUTE = 'recompute docs/BRAND-RECURRING-BILLING.md §6.3 before changing this';

describe('pinned constants (§6.6-3)', () => {
  it('states every input of the margin math as a literal', () => {
    expect(STUDIO_USAGE_FACTORS.krwPerUsd, RECOMPUTE).toBe(1400);
    expect(STUDIO_USAGE_FACTORS.imageMarkup, RECOMPUTE).toBe(1.12);
    expect(STUDIO_USAGE_FACTORS.videoMargin, RECOMPUTE).toBe(0.11);
    expect(STUDIO_CREDIT_KRW, RECOMPUTE).toBe(10);
    expect(BRAND_PLANS.b2b_29.monthlyKrw, RECOMPUTE).toBe(290_000);
    expect(BRAND_PLANS.b2b_49.monthlyKrw, RECOMPUTE).toBe(490_000);
    expect(BRAND_PLANS.b2b_69.monthlyKrw, RECOMPUTE).toBe(690_000);
    expect(BRAND_PLAN_CREDITS, RECOMPUTE).toEqual({ b2b_29: 27_000, b2b_49: 46_000, b2b_69: 65_000 });
    expect(BRAND_CARD_FEE_RATE, RECOMPUTE).toBe(0.0374);
    expect(BRAND_INVOICE_VAT_PERCENT, RECOMPUTE).toBe(10);
    expect(BRAND_TRANSFER_FEE_KRW, RECOMPUTE).toBe(440);
    expect(BRAND_MARGIN_FLOOR, RECOMPUTE).toBe(0.1);
    expect(BRAND_TRIAL_CREDITS, RECOMPUTE).toBe(400);
  });

  it('restates the plan prices only as copies of lib/brands/plans.ts (that module is server-only)', () => {
    for (const plan of PAID_BRAND_PLAN_IDS) expect(BRAND_PLAN_LIST_KRW[plan], `${plan}: ${RECOMPUTE}`).toBe(BRAND_PLANS[plan].monthlyKrw);
    expect(Object.keys(BRAND_PLAN_CREDITS).sort()).toEqual([...PAID_BRAND_PLAN_IDS].sort());
  });
});

describe('helpers', () => {
  it('worst cost per credit is built from the existing constants: 10 / 1.11 KRW', () => {
    expect(worstCostKrwPerCredit()).toBeCloseTo(10 / 1.11, 12);
    expect(worstCostKrwPerCredit()).toBe(STUDIO_CREDIT_KRW / (1 + STUDIO_USAGE_FACTORS.videoMargin));
  });

  it('plan cap in KRW is credits x 10 (what brand_plan_allowance_defaults stores)', () => {
    expect(planCapKrwFromCredits('b2b_29')).toBe(270_000);
    expect(planCapKrwFromCredits('b2b_49')).toBe(460_000);
    expect(planCapKrwFromCredits('b2b_69')).toBe(650_000);
  });

  it('card fee = ceil(price x 1.1 x 0.0374) on the VAT-inclusive charge', () => {
    expect(cardFeeKrw(290_000)).toBe(11_931);
    expect(cardFeeKrw(490_000)).toBe(20_159);
    expect(cardFeeKrw(690_000)).toBe(28_387);
    expect(cardFeeKrw(0)).toBe(0);
    // An exact product is not pushed up a won by float noise: 100,000 x 1.1 x 0.0374 = 4,114 exactly.
    expect(cardFeeKrw(100_000)).toBe(4_114);
  });

  it('worst-case margin matches the §6.3 table (card 34,826 / 55,427 / 76,027; transfer +440 back)', () => {
    expect(Math.round(worstCaseMarginKrw('b2b_29', 'card'))).toBe(34_826);
    expect(Math.round(worstCaseMarginKrw('b2b_49', 'card'))).toBe(55_427);
    expect(Math.round(worstCaseMarginKrw('b2b_69', 'card'))).toBe(76_027);
    expect(Math.round(worstCaseMarginKrw('b2b_29', 'transfer'))).toBe(46_317);
    expect(Math.round(worstCaseMarginKrw('b2b_49', 'transfer'))).toBe(75_146);
    expect(Math.round(worstCaseMarginKrw('b2b_69', 'transfer'))).toBe(103_974);
  });
});

describe('plan credits leave the decided card margin (§6.6-2)', () => {
  const expectedLeft = { b2b_29: 255_174, b2b_49: 434_573, b2b_69: 613_973 } as const;
  const expectedRight = { b2b_29: 261_000, b2b_49: 441_000, b2b_69: 621_000 } as const;
  const expectedMargin = { b2b_29: 0.12, b2b_49: 0.113, b2b_69: 0.11 } as const;

  for (const plan of PAID_BRAND_PLAN_IDS) {
    it(`${plan}: credits x worst cost + card fee <= price x (1 - 10%), and the card margin stays at most 12.5%`, () => {
      const price = BRAND_PLAN_LIST_KRW[plan];
      const left = BRAND_PLAN_CREDITS[plan] * worstCostKrwPerCredit() + cardFeeKrw(price);
      const right = price * (1 - BRAND_MARGIN_FLOOR);
      expect(Math.round(left), RECOMPUTE).toBe(expectedLeft[plan]);
      expect(right).toBe(expectedRight[plan]);
      expect(left, RECOMPUTE).toBeLessThanOrEqual(right);
      const margin = worstCaseMarginKrw(plan, 'card') / price;
      expect(margin, RECOMPUTE).toBeGreaterThanOrEqual(BRAND_MARGIN_FLOOR);
      expect(margin, `credits cut below the decided 10–12%: ${RECOMPUTE}`).toBeLessThanOrEqual(0.125);
      expect(Math.round(margin * 1000) / 1000).toBe(expectedMargin[plan]);
    });
  }

  it('B1c: over any N consecutive cycles (full price, full credits, no proration, no rollover) the card margin stays >= 10%', () => {
    for (const plan of PAID_BRAND_PLAN_IDS) {
      for (let n = 1; n <= 24; n++) {
        const price = n * BRAND_PLAN_LIST_KRW[plan];
        const fees = n * cardFeeKrw(BRAND_PLAN_LIST_KRW[plan]);
        const worstCost = n * BRAND_PLAN_CREDITS[plan] * worstCostKrwPerCredit();
        expect((price - fees - worstCost) / price, `${plan} x${n}: ${RECOMPUTE}`).toBeGreaterThanOrEqual(BRAND_MARGIN_FLOOR);
      }
    }
  });

  it('a higher plan never makes a credit dearer (10.74 -> 10.65 -> 10.62 KRW)', () => {
    const perCredit = PAID_BRAND_PLAN_IDS.map((plan) => BRAND_PLAN_LIST_KRW[plan] / BRAND_PLAN_CREDITS[plan]);
    expect(perCredit.map((v) => Math.round(v * 100) / 100)).toEqual([10.74, 10.65, 10.62]);
    for (let i = 1; i < perCredit.length; i++) expect(perCredit[i]!).toBeLessThanOrEqual(perCredit[i - 1]!);
  });
});

describe('trial credits (§6.5, §6.6-6)', () => {
  it('400 trial credits cost at most 9,000 KRW whatever they are spent on (about 3,604)', () => {
    const worst = BRAND_TRIAL_CREDITS * worstCostKrwPerCredit();
    expect(worst).toBeLessThanOrEqual(9_000);
    expect(Math.round(worst)).toBe(3_604);
  });
});

describe('seed and fixture agreement (§6.6-5, §6.6-7)', () => {
  const root = process.cwd();
  const filesUnder = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...filesUnder(full));
      else if (/\.(ts|tsx|mjs|js|sql)$/.test(name)) out.push(full);
    }
    return out;
  };

  it('the local database seed does not set plan default caps (nothing to agree with; production holds 270,000 / 460,000 / 650,000)', () => {
    const seedSources = [...filesUnder(join(root, 'scripts')), ...filesUnder(join(root, 'supabase')).filter((f) => !f.includes('migrations'))];
    const writers = seedSources.filter((f) => /brand_plan_allowance_defaults|setPlanAllowanceDefault|planDefault\.set/.test(readFileSync(f, 'utf8')));
    // If a seed starts writing them, it must write the decided values: extend this test to read them.
    expect(writers.map((f) => relative(root, f))).toEqual([]);
  });

  it('every test fixture that seeds the defaults of two or more plans together uses credits x 10 for each', () => {
    // A fixture is a block of consecutive default writes (setup); one plan set to a scenario value inside a single
    // test is an input of that test, not a stand-in for production.
    const call = /setPlanAllowanceDefault\(.*?planId:\s*'(b2b_\d\d)',\s*monthlyCapKrw:\s*([\d_]+)/;
    const fixtures: string[] = [];
    for (const file of filesUnder(join(root, 'tests'))) {
      const lines = readFileSync(file, 'utf8').split('\n');
      const found = lines
        .map((line, i) => ({ i, m: call.exec(line) }))
        .filter((x): x is { i: number; m: RegExpExecArray } => x.m !== null)
        .map(({ i, m }) => ({ line: i, plan: m[1]!, cap: Number(m[2]!.replace(/_/g, '')) }));
      const blocks: Array<typeof found> = [];
      for (const hit of found) {
        const last = blocks.at(-1);
        if (last && hit.line - last.at(-1)!.line <= 3) last.push(hit);
        else blocks.push([hit]);
      }
      for (const block of blocks) {
        if (new Set(block.map((h) => h.plan)).size < 2) continue;
        fixtures.push(`${relative(root, file)}:${block[0]!.line + 1}`);
        for (const { plan, cap, line } of block) {
          expect(cap, `${relative(root, file)}:${line + 1} ${plan}`).toBe(planCapKrwFromCredits(plan as keyof typeof BRAND_PLAN_CREDITS));
        }
      }
    }
    expect(fixtures.length).toBeGreaterThan(0);
  });
});
