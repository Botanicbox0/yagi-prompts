import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { daysInYearMonth, invoiceAmounts, PAID_BRAND_PLAN_IDS, proposeProration } from '@/lib/brands/billing/math';
import {
  BRAND_MARGIN_FLOOR,
  BRAND_PLAN_LIST_KRW,
  cardFeeKrw,
  planCapForMonth,
  planCapKrwFromCredits,
  worstCostKrwPerCredit,
} from '@/lib/brands/billing/plan-credits';
import { approveWorkspace } from '@/lib/brands/billing/workspace-approval';
import { studioFixture, viewerOf } from '@/tests/brand-studio/server/helpers';
import {
  PRORATED_CASES,
  PRORATION_CASES,
  prorationParityScenario,
} from '@/tests/brands/helpers/allowance-proration-parity';
import type { ParityOp } from '@/tests/brands/helpers/workspace-approval-parity';
import { freshDb } from '@/tests/helpers/pglite';

/**
 * B1b fix round 1, C (docs/BRAND-RECURRING-BILLING.md §6.4 "첫 달"): a plan that starts after the 1st gives that month's
 * credits in the same proportion as the money the invoice asks for. Only the plan source changes; overrides, the env
 * default and grants do not; no statement changes.
 */
const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };
const floor10 = (krw: number) => Math.floor(krw / 10) * 10;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('planCapForMonth', () => {
  const cap29 = planCapKrwFromCredits('b2b_29');

  it('day 28 of a 30-day month: 3/30 of the cap, in whole credits', () => {
    expect(planCapForMonth({ planId: 'b2b_29', fullCapKrw: cap29, startedOn: '2026-11-28', month: '2026-11' })).toEqual({
      capKrw: floor10((cap29 * 3) / 30),
      proration: { fullKrw: cap29, days: 3, periodDays: 30 },
    });
    expect(floor10((cap29 * 3) / 30)).toBe(27_000);
  });

  it('started on the 1st, or in an earlier month: the full cap, no proration', () => {
    expect(planCapForMonth({ planId: 'b2b_29', fullCapKrw: cap29, startedOn: '2026-11-01', month: '2026-11' })).toEqual({ capKrw: cap29, proration: null });
    expect(planCapForMonth({ planId: 'b2b_29', fullCapKrw: cap29, startedOn: '2026-10-31', month: '2026-11' })).toEqual({ capKrw: cap29, proration: null });
    expect(planCapForMonth({ planId: 'b2b_29', fullCapKrw: cap29, startedOn: '2025-02-14', month: '2026-11' })).toEqual({ capKrw: cap29, proration: null });
  });

  it('Feb 29 2028 (29-day month) and a 31-day month', () => {
    expect(planCapForMonth({ planId: 'b2b_29', fullCapKrw: cap29, startedOn: '2028-02-29', month: '2028-02' })).toEqual({
      capKrw: 9_310,
      proration: { fullKrw: cap29, days: 1, periodDays: 29 },
    });
    const cap49 = planCapKrwFromCredits('b2b_49');
    expect(planCapForMonth({ planId: 'b2b_49', fullCapKrw: cap49, startedOn: '2026-12-16', month: '2026-12' })).toEqual({
      capKrw: 237_410,
      proration: { fullKrw: cap49, days: 16, periodDays: 31 },
    });
  });

  it('never above the plain day ratio, and at most one credit below it', () => {
    for (const plan of PAID_BRAND_PLAN_IDS) {
      const full = planCapKrwFromCredits(plan);
      for (const month of ['2026-02', '2028-02', '2026-11', '2026-12']) {
        const days = daysInYearMonth(month);
        for (let day = 2; day <= days; day++) {
          const { capKrw } = planCapForMonth({ planId: plan, fullCapKrw: full, startedOn: `${month}-${String(day).padStart(2, '0')}`, month });
          const plain = floor10((full * (days - day + 1)) / days);
          expect(capKrw).toBeLessThanOrEqual(plain);
          expect(plain - capKrw).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  /** Seeded PRNG (mulberry32): deterministic, no dependency. */
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

  it('property: credits never get a better ratio than the money, and the prorated month keeps the card margin floor', () => {
    const random = prng(20261124);
    let checked = 0;
    for (const plan of PAID_BRAND_PLAN_IDS) {
      const price = BRAND_PLAN_LIST_KRW[plan];
      const fullSupply = invoiceAmounts({ listKrw: price }).supplyKrw;
      const decided = planCapKrwFromCredits(plan);
      // The decided cap, plus random caps an admin could set (any whole KRW up to the allowed maximum).
      const caps = [decided, ...Array.from({ length: 25 }, () => Math.floor(random() * 100_000_000) + 1)];
      for (const month of ['2026-02', '2028-02', '2026-11', '2026-12']) {
        const days = daysInYearMonth(month);
        for (let day = 1; day <= days; day++) {
          const startedOn = `${month}-${String(day).padStart(2, '0')}`;
          const prorate = proposeProration(startedOn, month);
          const supply = invoiceAmounts({ listKrw: price, prorate }).supplyKrw;
          for (const full of caps) {
            const { capKrw, proration } = planCapForMonth({ planId: plan, fullCapKrw: full, startedOn, month });
            checked += 1;
            expect(proration === null).toBe(prorate === null);
            if (proration) expect([proration.days, proration.periodDays]).toEqual([prorate!.usedDays, prorate!.totalDays]);
            // capKrw / full <= supply / fullSupply, cross-multiplied to stay in integers.
            expect(capKrw * fullSupply, `${plan} ${startedOn} cap ${full}`).toBeLessThanOrEqual(supply * full);
            if (full === decided) {
              const margin = supply - cardFeeKrw(supply) - (capKrw / 10) * worstCostKrwPerCredit();
              expect(margin / supply, `${plan} ${startedOn}`).toBeGreaterThanOrEqual(BRAND_MARGIN_FLOOR);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(3_000);
  });
});

describe('loadAllowance with first-month proration', () => {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), 'tests', 'brands', 'fixtures', 'brand-allowance-proration-parity.json'), 'utf8'),
  ) as { ops: ParityOp[] };

  it('runs byte-identical SQL for every source; only a plan that started after the 1st returns a smaller cap', async () => {
    const db = await freshDb();
    try {
      const actual = await prorationParityScenario(db);
      expect(actual.map((o) => o.op)).toEqual(fixture.ops.map((o) => o.op));
      for (const [i, expected] of fixture.ops.entries()) {
        const got = actual[i]!;
        expect(got.log, `${expected.op}: SQL and parameters`).toEqual(expected.log);
        const name = expected.op.split(':')[0]!;
        if (!PRORATED_CASES.has(name)) {
          // Overrides (also with a plan that started mid-month), the default, grants, full months: unchanged.
          expect(got.result, `${expected.op}: full result`).toEqual(expected.result);
        }
      }
      expect(PRORATION_CASES.filter((c) => PRORATED_CASES.has(c.name)).length).toBe(3);

      const load = (name: string) => actual.find((o) => o.op === `${name}:load`)!.result as Record<string, unknown>;
      const before = (name: string) => fixture.ops.find((o) => o.op === `${name}:load`)!.result as Record<string, unknown>;
      // November 5: 26 of 30 days. 290,000 x 26 / 30 = 251,333 KRW on the invoice; 270,000 x 251,333 / 290,000 -> 233,990.
      expect(load('planMidMonth')).toEqual({
        ...before('planMidMonth'),
        capKrw: 233_990,
        baseCapKrw: 233_990,
        planProration: { fullKrw: 270_000, days: 26, periodDays: 30 },
      });
      // Grants on top are not prorated.
      expect(load('planMidMonthGrant')).toEqual({
        ...before('planMidMonthGrant'),
        capKrw: 233_990 + 4_000,
        baseCapKrw: 233_990,
        extraKrw: 4_000,
        planProration: { fullKrw: 270_000, days: 26, periodDays: 30 },
      });
      // Started today (the 10th): 21 of 30 days.
      expect(load('planToday')).toMatchObject({ source: 'plan', capKrw: 455_000, baseCapKrw: 455_000, planProration: { fullKrw: 650_000, days: 21, periodDays: 30 } });
      // The reservation result follows the load: same SQL, prorated cap.
      expect(actual.find((o) => o.op === 'planMidMonth:reserve')!.result).toMatchObject({ ok: true, allowance: { capKrw: 233_990 } });
      for (const name of ['overrideOnly', 'overridePlanMidMonth', 'overridePlanMidMonthGrant', 'planFirstOfMonth', 'planPreviousMonth', 'planTomorrow', 'defaultOnly']) {
        expect(load(name)).not.toHaveProperty('planProration');
      }
      expect(load('overridePlanMidMonth')).toMatchObject({ source: 'override', baseCapKrw: 777_000, preferredLane: 'sunra_mcp' });
    } finally {
      await db.close();
    }
  });

  it('reserveAllowance: a run that fits the full cap but not the prorated one is refused in the start month and accepted the next', async () => {
    const f = await studioFixture({ capKrw: null });
    try {
      await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
      await f.sql.query(
        "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-28', null, 1)",
        [f.orgId],
      );
      const reserve = (estimate: number, iso: string) => f.sql.transaction((tx) => reserveAllowance(tx, f.orgId, estimate, STUDIO, new Date(iso)));
      expect(await reserve(27_000, '2026-11-28T03:00:00Z')).toMatchObject({ ok: true, allowance: { capKrw: 27_000 } });
      expect(await reserve(27_010, '2026-11-28T03:00:00Z')).toEqual({ ok: false, code: 'allowance_exhausted' });
      expect(await reserve(200_000, '2026-11-29T03:00:00Z')).toEqual({ ok: false, code: 'allowance_exhausted' });
      expect(await reserve(200_000, '2026-12-01T03:00:00Z')).toMatchObject({ ok: true, allowance: { capKrw: 270_000, source: 'plan' } });
      expect(await loadAllowance(f.sql, f.orgId, STUDIO, new Date('2026-12-01T03:00:00Z'))).not.toHaveProperty('planProration');
    } finally {
      await f.db.close();
    }
  });

  it('the trial grant on top of a prorated plan month is added whole', async () => {
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'on');
    const f = await studioFixture({ capKrw: null });
    try {
      await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
      await f.sql.query(
        "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-28', null, 1)",
        [f.orgId],
      );
      const approved = await approveWorkspace({ sql: f.sql, now: () => new Date('2026-11-28T03:00:00Z') }, { ...viewerOf(f.ids.admin), isAdmin: true }, { organizationId: f.orgId });
      expect(approved).toMatchObject({ ok: true, created: true });
      expect(await loadAllowance(f.sql, f.orgId, STUDIO, new Date('2026-11-28T04:00:00Z'))).toMatchObject({
        source: 'plan',
        baseCapKrw: 27_000,
        extraKrw: 4_000,
        capKrw: 31_000,
        planProration: { fullKrw: 270_000, days: 3, periodDays: 30 },
      });
    } finally {
      await f.db.close();
    }
  });

  it('the production test organization shape (override + account lane) is untouched whatever its plan', async () => {
    const f = await studioFixture({ capKrw: null });
    try {
      const orgId = randomUUID();
      await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [orgId, 'Override lane', f.ids.owner, randomUUID()]);
      await f.sql.query(
        "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane) values ($1, 1000000, true, 'sunra_mcp')",
        [orgId],
      );
      await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_69', 650000)");
      for (const startedOn of ['2026-11-01', '2026-11-17', '2026-11-30', '2026-12-05']) {
        await f.sql.query('delete from brand_plan_assignments where organization_id = $1', [orgId]);
        await f.sql.query(
          "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_69', 'invoice', $2, null, 1)",
          [orgId, startedOn],
        );
        expect(await loadAllowance(f.sql, orgId, STUDIO, new Date('2026-11-30T01:00:00Z')), startedOn).toEqual({
          capKrw: 1_000_000,
          baseCapKrw: 1_000_000,
          extraKrw: 0,
          source: 'override',
          usedKrw: 0,
          resetsAt: '2026-11-30T15:00:00.000Z',
          preferredLane: 'sunra_mcp',
          configured: true,
        });
      }
    } finally {
      await f.db.close();
    }
  });
});
