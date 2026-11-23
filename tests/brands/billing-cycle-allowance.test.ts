import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowanceWindow, loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { freshDb } from '@/tests/helpers/pglite';
import { studioFixture, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { prorationParityScenario } from '@/tests/brands/helpers/allowance-proration-parity';
import type { ParityOp } from '@/tests/brands/helpers/workspace-approval-parity';

/**
 * B1c-1 §3: a plan organization's allowance runs on its billing cycle (one month from the plan start day), with the
 * full plan cap every cycle; overrides, the env default and organizations without a plan stay on the KST calendar
 * month, byte for byte (fixture recorded from origin/main's lib/brand-studio/usage.ts).
 */
const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };

describe('parity with origin/main for every source but plan', () => {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), 'tests', 'brands', 'fixtures', 'brand-allowance-proration-parity.json'), 'utf8'),
  ) as { ops: ParityOp[] };
  // Plan organizations change on purpose (cycle window, full cap); everything else must not.
  const PLAN_CASES = new Set(['planFirstOfMonth', 'planFirstOfMonthGrant', 'planPreviousMonth', 'planMidMonth', 'planMidMonthGrant', 'planToday']);

  it('override (also with a mid-month plan), default and not-yet-started plans: identical SQL, parameters and results', async () => {
    const db = await freshDb();
    try {
      const actual = await prorationParityScenario(db);
      expect(actual.map((o) => o.op)).toEqual(fixture.ops.map((o) => o.op));
      let pinned = 0;
      for (const [i, expected] of fixture.ops.entries()) {
        if (PLAN_CASES.has(expected.op.split(':')[0]!)) continue;
        expect(actual[i]!.log, `${expected.op}: SQL`).toEqual(expected.log);
        expect(actual[i]!.result, `${expected.op}: result`).toEqual(expected.result);
        pinned += 1;
      }
      expect(pinned).toBe(14); // 7 cases x (load + reserve)

      const load = (name: string) => actual.find((o) => o.op === `${name}:load`)!.result as Record<string, unknown>;
      const before = (name: string) => fixture.ops.find((o) => o.op === `${name}:load`)!.result as Record<string, unknown>;
      // At 2026-11-10 (KST): a plan started Nov 5 runs Nov 5 → Dec 5 with the full cap (no first-month proration).
      expect(load('planMidMonth')).toEqual({
        ...before('planMidMonth'),
        capKrw: 270_000,
        baseCapKrw: 270_000,
        resetsAt: '2026-12-04T15:00:00.000Z',
        cycle: { anchor: '2026-11-05', index: 0, start: '2026-11-05', end: '2026-12-05', startAt: '2026-11-04T15:00:00.000Z', endAt: '2026-12-04T15:00:00.000Z' },
        grantsLeftKrw: 0,
      });
      expect(load('planMidMonthGrant')).toMatchObject({ capKrw: 274_000, extraKrw: 4_000, grantsLeftKrw: 4_000, resetsAt: '2026-12-04T15:00:00.000Z' });
      // Started Oct 15: the cycle containing Nov 10 is Oct 15 → Nov 15.
      expect(load('planPreviousMonth')).toMatchObject({ capKrw: 650_000, resetsAt: '2026-11-14T15:00:00.000Z', cycle: { index: 0, start: '2026-10-15', end: '2026-11-15' } });
      // Started on the 1st: the cycle is the calendar month; the reset is the same instant as before.
      expect(load('planFirstOfMonth')).toMatchObject({ capKrw: 270_000, resetsAt: before('planFirstOfMonth').resetsAt, cycle: { start: '2026-11-01', end: '2026-12-01' } });
      expect(load('planToday')).toMatchObject({ capKrw: 650_000, resetsAt: '2026-12-09T15:00:00.000Z' });
      for (const name of ['overrideOnly', 'overridePlanMidMonth', 'defaultOnly', 'planTomorrow']) expect(load(name)).not.toHaveProperty('cycle');
    } finally {
      await db.close();
    }
  });
});

describe('plan organizations on their cycle', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture({ capKrw: null });
    await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
  });
  afterEach(async () => {
    await f.db.close();
  });

  const plan = (startedOn: string) =>
    f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', $2, null, 1)",
      [f.orgId, startedOn],
    );
  const used = (krw: number, iso: string) =>
    f.sql.query(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
       values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'p', $4, $4, $5, $5)`,
      [f.orgId, f.ids.owner, `use_${randomUUID().slice(0, 12)}`, krw, iso],
    );
  const grant = (krw: number, month: string) =>
    f.sql.query("insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason) values ($1, $2, $3, 'fixture')", [f.orgId, krw, month]);
  const load = (iso: string) => loadAllowance(f.sql, f.orgId, STUDIO, new Date(iso));
  const reserve = (krw: number, iso: string) => f.sql.transaction((tx) => reserveAllowance(tx, f.orgId, krw, STUDIO, new Date(iso)));

  it('a job on the last instant of a cycle counts in that cycle; the first instant of the next sees a fresh full cap', async () => {
    await plan('2026-11-17');
    await used(270_000, '2026-12-16T14:59:59.999Z');
    expect(await load('2026-12-16T14:59:59.999Z')).toMatchObject({ usedKrw: 270_000, capKrw: 270_000, resetsAt: '2026-12-16T15:00:00.000Z' });
    expect(await reserve(10, '2026-12-16T14:59:59.999Z')).toEqual({ ok: false, code: 'allowance_exhausted' });
    expect(await load('2026-12-16T15:00:00.000Z')).toMatchObject({ usedKrw: 0, capKrw: 270_000, resetsAt: '2027-01-16T15:00:00.000Z', cycle: { index: 1 } });
    expect(await reserve(270_000, '2026-12-16T15:00:00.000Z')).toMatchObject({ ok: true });
    // Mid-cycle across the calendar month end: December usage still counts in the Nov 17 cycle.
    await used(100, '2026-11-30T14:59:59.999Z');
    await used(200, '2026-11-30T15:00:00.000Z');
    expect(await load('2026-12-05T01:00:00Z')).toMatchObject({ usedKrw: 270_300 });
  });

  it('month-end clamp: a plan started on Jan 31 runs Feb 28 → Mar 31 in 2027', async () => {
    await plan('2027-01-31');
    await used(1_000, '2027-02-27T15:00:00.000Z'); // Feb 28 KST
    await used(2_000, '2027-03-30T14:59:59.000Z'); // Mar 30 KST
    await used(4_000, '2027-03-30T15:00:00.000Z'); // Mar 31 KST: next cycle
    const feb = await load('2027-03-30T14:00:00Z');
    expect(feb).toMatchObject({ usedKrw: 3_000, resetsAt: '2027-03-30T15:00:00.000Z', cycle: { index: 1, start: '2027-02-28', end: '2027-03-31' } });
    expect(allowanceWindow(feb, new Date('2027-03-30T14:00:00Z'))).toEqual({
      kind: 'cycle',
      start: new Date('2027-02-27T15:00:00.000Z'),
      end: new Date('2027-03-30T15:00:00.000Z'),
    });
    expect(await load('2027-03-31T01:00:00Z')).toMatchObject({ usedKrw: 4_000, cycle: { index: 2, start: '2027-03-31', end: '2027-04-30' } });
  });

  it('plan credits first: a month grant is not spent twice when the cycle restarts inside its month', async () => {
    await plan('2026-10-17');
    await grant(50_000, '2026-11');
    await used(280_000, '2026-11-10T01:00:00Z'); // Oct 17 cycle: 270,000 plan + 10,000 of the November grant
    expect(await load('2026-11-15T01:00:00Z')).toMatchObject({ capKrw: 320_000, usedKrw: 280_000, grantsLeftKrw: 40_000 });
    // Nov 17 cycle: a fresh plan cap, and only what is left of the November grant.
    const nov = await load('2026-11-20T01:00:00Z');
    expect(nov).toMatchObject({ capKrw: 320_000, usedKrw: 10_000, grantsLeftKrw: 40_000 });
    expect(nov.capKrw - nov.usedKrw).toBe(270_000 + 40_000);
  });

  it('plan credits first: last month\'s grant use does not eat this month\'s grant', async () => {
    await plan('2026-11-17');
    await grant(50_000, '2026-11');
    await grant(50_000, '2026-12');
    await used(300_000, '2026-11-25T01:00:00Z'); // 270,000 plan + 30,000 of the November grant
    const dec = await load('2026-12-05T01:00:00Z');
    expect(dec).toMatchObject({ capKrw: 320_000, usedKrw: 270_000, grantsLeftKrw: 50_000 });
    expect(dec.capKrw - dec.usedKrw).toBe(50_000); // the plan is spent; December's grant is whole
  });

  it('a date-range grant (0186) counts while today is in its range, never also by its month', async () => {
    await plan('2026-11-17');
    await f.sql.query(
      "insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, kind, valid_from, valid_until) values ($1, 7000, '2026-11', 'range', 'carry', '2026-12-01', '2026-12-10')",
      [f.orgId],
    );
    expect(await load('2026-11-20T01:00:00Z')).toMatchObject({ extraKrw: 0, capKrw: 270_000 });
    expect(await load('2026-12-05T01:00:00Z')).toMatchObject({ extraKrw: 7_000, capKrw: 277_000, grantsLeftKrw: 7_000 });
    expect(await load('2026-12-11T01:00:00Z')).toMatchObject({ extraKrw: 0 });
  });

  it('before the start day the plan is not active; during grace after ends_on the cycles continue', async () => {
    await f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', '2026-12-17', 1)",
      [f.orgId],
    );
    expect(await load('2026-11-15T01:00:00Z')).toMatchObject({ source: 'default', capKrw: 0 });
    expect(await load('2026-12-20T01:00:00Z')).toMatchObject({ source: 'plan', cycle: { index: 1, start: '2026-12-17', end: '2027-01-17' } });
  });
});
