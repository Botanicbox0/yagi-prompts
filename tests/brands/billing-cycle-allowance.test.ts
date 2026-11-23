import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allowanceWindow, loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { cycleContaining, kstDayStartUtc } from '@/lib/brands/billing/cycle';
import { addCalendarDays, kstDayOf } from '@/lib/brands/billing/math';
import { freshDb } from '@/tests/helpers/pglite';
import { studioFixture, type StudioFixture } from '@/tests/brand-studio/server/helpers';
import { prorationParityScenario } from '@/tests/brands/helpers/allowance-proration-parity';
import type { ParityOp } from '@/tests/brands/helpers/workspace-approval-parity';

/**
 * B1c-1 §3 and fix round 1: a plan organization has exactly ONE allowance window, its current billing cycle (one month
 * from the plan start day): used = usage inside the cycle, cap = full plan cap + the grants attached to the cycle. A
 * grant attaches to the one cycle containing its effective start day (a monthly grant: the later of its creation day
 * and the 1st of its month; a date-range grant: `valid_from`), never to a cycle before the plan start. Overrides, the
 * env default and organizations without a plan stay on the KST calendar month, byte for byte.
 */
const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };

describe('parity with origin/main for every source but plan', () => {
  const fixture = JSON.parse(
    readFileSync(join(process.cwd(), 'tests', 'brands', 'fixtures', 'brand-allowance-proration-parity.json'), 'utf8'),
  ) as { ops: ParityOp[] };
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
      expect(pinned).toBe(14);

      const load = (name: string) => actual.find((o) => o.op === `${name}:load`)!.result as Record<string, unknown>;
      const before = (name: string) => fixture.ops.find((o) => o.op === `${name}:load`)!.result as Record<string, unknown>;
      // At 2026-11-10 (KST): a plan started Nov 5 runs Nov 5 → Dec 5 with the full cap.
      expect(load('planMidMonth')).toEqual({
        ...before('planMidMonth'),
        capKrw: 270_000,
        baseCapKrw: 270_000,
        resetsAt: '2026-12-04T15:00:00.000Z',
        cycle: { anchor: '2026-11-05', index: 0, start: '2026-11-05', end: '2026-12-05', startAt: '2026-11-04T15:00:00.000Z', endAt: '2026-12-04T15:00:00.000Z' },
      });
      // The November grant was created Nov 5, inside the Nov 5 cycle: it belongs to it.
      expect(load('planMidMonthGrant')).toMatchObject({ capKrw: 274_000, extraKrw: 4_000, resetsAt: '2026-12-04T15:00:00.000Z' });
      // Started Nov 1 and the grant created Nov 5: the Nov 1 cycle.
      expect(load('planFirstOfMonthGrant')).toMatchObject({ capKrw: 300_000, extraKrw: 30_000, cycle: { start: '2026-11-01', end: '2026-12-01' } });
      expect(load('planPreviousMonth')).toMatchObject({ capKrw: 650_000, resetsAt: '2026-11-14T15:00:00.000Z', cycle: { index: 0, start: '2026-10-15', end: '2026-11-15' } });
      expect(load('planFirstOfMonth')).toMatchObject({ capKrw: 270_000, resetsAt: before('planFirstOfMonth').resetsAt, cycle: { start: '2026-11-01', end: '2026-12-01' } });
      expect(load('planToday')).toMatchObject({ capKrw: 650_000, resetsAt: '2026-12-09T15:00:00.000Z' });
      for (const name of ['overrideOnly', 'overridePlanMidMonth', 'defaultOnly', 'planTomorrow']) expect(load(name)).not.toHaveProperty('cycle');
      for (const name of [...PLAN_CASES]) expect(load(name)).not.toHaveProperty('grantsLeftKrw');
    } finally {
      await db.close();
    }
  });
});

describe('before 0186: the range-column probe is not repeated on every plan load', () => {
  it('a missing column is remembered for a while (one probe, not one per call)', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { coreMigrationFiles, readMigration } = await import('@/lib/db/migrations');
    const { runner } = await import('@/tests/helpers/pglite');
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => m < '0186_')) await db.exec(readMigration(file));
      const sql = runner(db);
      const owner = randomUUID();
      const org = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [owner]);
      await db.query("insert into profiles (id, email) values ($1, 'pre0186@fixture.invalid')", [owner]);
      await db.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org, 'Pre-0186', owner, randomUUID()]);
      await db.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
      await db.query("insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', null, 1)", [org]);
      const texts: string[] = [];
      const spy = { query: async <T,>(text: string, params?: unknown[]) => { texts.push(text); return sql.query<T>(text, params); }, transaction: sql.transaction };
      const now = new Date('2026-11-20T01:00:00Z');
      const probes = () => texts.filter((t) => t.includes('pg_attribute') && !t.includes('is_override')).length;
      for (let i = 0; i < 3; i++) expect(await loadAllowance(spy as never, org, STUDIO, now)).toMatchObject({ source: 'plan', capKrw: 270_000 });
      // One probe for the missing `valid_from` column over three loads (without the negative cache: three).
      expect(probes()).toBe(1);
    } finally {
      await db.close();
    }
  });
});

describe('plan organizations: one window, a grant belongs to one cycle', () => {
  let f: StudioFixture;
  beforeEach(async () => {
    f = await studioFixture({ capKrw: null });
    await f.sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000)");
  });
  afterEach(async () => {
    await f.db.close();
  });

  const plan = (startedOn: string, planId = 'b2b_29', orgId = f.orgId) =>
    f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', $3, null, 1)",
      [orgId, planId, startedOn],
    );
  const used = (krw: number, iso: string, settledKrw = krw, orgId = f.orgId) =>
    f.sql.query(
      `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
       values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'p', $4, $5, $6, $6)`,
      [orgId, f.ids.owner, `use_${randomUUID().slice(0, 12)}`, krw, settledKrw, iso],
    );
  const grant = async (krw: number, month: string, createdIso: string, extra: { from?: string; until?: string; orgId?: string } = {}) =>
    (
      await f.sql.query<{ id: string }>(
        `insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, created_at, valid_from, valid_until)
         values ($1, $2, $3, 'fixture', $4, $5::date, $6::date) returning id::text as id`,
        [extra.orgId ?? f.orgId, krw, month, createdIso, extra.from ?? null, extra.until ?? null],
      )
    ).rows[0]!.id;
  const load = (iso: string, orgId = f.orgId) => loadAllowance(f.sql, orgId, STUDIO, new Date(iso));
  const reserve = (krw: number, iso: string) => f.sql.transaction((tx) => reserveAllowance(tx, f.orgId, krw, STUDIO, new Date(iso)));

  it('a job on the last instant of a cycle counts in that cycle; the first instant of the next sees a fresh full cap', async () => {
    await plan('2026-11-17');
    await used(270_000, '2026-12-16T14:59:59.999Z');
    expect(await load('2026-12-16T14:59:59.999Z')).toMatchObject({ usedKrw: 270_000, capKrw: 270_000, resetsAt: '2026-12-16T15:00:00.000Z' });
    expect(await reserve(10, '2026-12-16T14:59:59.999Z')).toEqual({ ok: false, code: 'allowance_exhausted' });
    expect(await load('2026-12-16T15:00:00.000Z')).toMatchObject({ usedKrw: 0, capKrw: 270_000, resetsAt: '2027-01-16T15:00:00.000Z', cycle: { index: 1 } });
    expect(await reserve(270_000, '2026-12-16T15:00:00.000Z')).toMatchObject({ ok: true });
  });

  it('month-end clamp: a plan started on Jan 31 runs Feb 28 → Mar 31 in 2027', async () => {
    await plan('2027-01-31');
    await used(1_000, '2027-02-27T15:00:00.000Z');
    await used(2_000, '2027-03-30T14:59:59.000Z');
    await used(4_000, '2027-03-30T15:00:00.000Z');
    const feb = await load('2027-03-30T14:00:00Z');
    expect(feb).toMatchObject({ usedKrw: 3_000, resetsAt: '2027-03-30T15:00:00.000Z', cycle: { index: 1, start: '2027-02-28', end: '2027-03-31' } });
    expect(allowanceWindow(feb, new Date('2027-03-30T14:00:00Z'))).toEqual({ kind: 'cycle', start: new Date('2027-02-27T15:00:00.000Z'), end: new Date('2027-03-30T15:00:00.000Z') });
    expect(await load('2027-03-31T01:00:00Z')).toMatchObject({ usedKrw: 4_000, cycle: { index: 2, start: '2027-03-31', end: '2027-04-30' } });
  });

  it('probe 1: a month grant spent before the plan started is not offered again in the plan\'s first cycle', async () => {
    await grant(50_000, '2026-11', '2026-11-01T01:00:00Z');
    expect(await load('2026-11-05T00:00:00Z')).toMatchObject({ source: 'default', capKrw: 50_000 });
    await used(50_000, '2026-11-05T01:00:00Z');
    await plan('2026-11-17');
    expect(await load('2026-11-20T01:00:00Z')).toMatchObject({ source: 'plan', capKrw: 270_000, extraKrw: 0, usedKrw: 0 });
    expect(await reserve(320_000, '2026-11-20T01:00:00Z')).toEqual({ ok: false, code: 'allowance_exhausted' });
    expect(await reserve(270_000, '2026-11-20T01:00:00Z')).toMatchObject({ ok: true });
  });

  it('probe 2a: a December grant spent and revoked in the Nov 17 cycle leaves the Dec 17 cycle whole', async () => {
    await plan('2026-11-17');
    const id = await grant(100_000, '2026-12', '2026-12-01T01:00:00Z');
    await used(100_000, '2026-12-05T01:00:00Z');
    expect(await load('2026-12-06T01:00:00Z')).toMatchObject({ capKrw: 370_000, usedKrw: 100_000 });
    await f.sql.query("update brand_allowance_grants set revoked_at = '2026-12-18T01:00:00Z' where id = $1", [id]);
    expect(await load('2026-12-18T02:00:00Z')).toMatchObject({ capKrw: 270_000, usedKrw: 0 });
    expect(await reserve(270_000, '2026-12-18T02:00:00Z')).toMatchObject({ ok: true });
  });

  it('probe 2b: a job that settled above its reservation in the previous cycle does not touch the next', async () => {
    await plan('2026-11-17');
    await used(5_000, '2026-12-10T01:00:00Z', 30_000);
    expect(await load('2026-12-11T01:00:00Z')).toMatchObject({ usedKrw: 30_000 });
    expect(await load('2026-12-17T01:00:00Z')).toMatchObject({ usedKrw: 0, capKrw: 270_000 });
  });

  it('probe 2c: a downgrade at the boundary after heavy use starts the new cycle at the new full cap', async () => {
    await plan('2026-11-17', 'b2b_49');
    await used(400_000, '2026-12-10T01:00:00Z');
    expect(await load('2026-12-11T01:00:00Z')).toMatchObject({ capKrw: 460_000, usedKrw: 400_000 });
    await f.sql.query("update brand_plan_assignments set plan_id = 'b2b_29' where organization_id = $1", [f.orgId]);
    expect(await load('2026-12-18T01:00:00Z')).toMatchObject({ capKrw: 270_000, usedKrw: 0 });
  });

  it('probe 3: a date-range grant straddling a month end counts once, in the cycle containing its first day, until that cycle ends', async () => {
    await plan('2026-11-17');
    await grant(7_000, '2026-11', '2026-11-20T01:00:00Z', { from: '2026-11-25', until: '2026-12-05' });
    expect(await load('2026-11-24T01:00:00Z')).toMatchObject({ capKrw: 277_000 }); // attached to the Nov 17 cycle
    expect(await load('2026-12-02T01:00:00Z')).toMatchObject({ capKrw: 277_000 });
    expect(await load('2026-12-10T01:00:00Z')).toMatchObject({ capKrw: 277_000 }); // the range end is ignored for a plan
    expect(await load('2026-12-18T01:00:00Z')).toMatchObject({ capKrw: 270_000 });
  });

  it('a grant made for next month belongs to the cycle containing the 1st of that month', async () => {
    await plan('2026-11-03');
    await grant(9_000, '2026-12', '2026-11-20T01:00:00Z');
    expect(await load('2026-11-21T01:00:00Z')).toMatchObject({ capKrw: 279_000, cycle: { start: '2026-11-03', end: '2026-12-03' } });
    expect(await load('2026-12-05T01:00:00Z')).toMatchObject({ capKrw: 270_000, cycle: { start: '2026-12-03' } });
  });

  it('before the start day the plan is not active; during grace after ends_on the cycles continue', async () => {
    await f.sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', '2026-12-17', 1)",
      [f.orgId],
    );
    expect(await load('2026-11-15T01:00:00Z')).toMatchObject({ source: 'default', capKrw: 0 });
    expect(await load('2026-12-20T01:00:00Z')).toMatchObject({ source: 'plan', cycle: { index: 1, start: '2026-12-17', end: '2027-01-17' } });
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

  it('property: every day the extra cap is exactly the grants attached to the current cycle, each grant counts in one cycle at most, and a cycle starts at 0 used', async () => {
    const random = prng(20261125);
    const days: string[] = [];
    for (let d = '2026-10-20'; d <= '2027-02-20'; d = addCalendarDays(d, 1)) days.push(d);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!;
    const orgs: Array<{ id: string; anchor: string; grants: Array<{ id: string; krw: number; start: string; revoked: boolean }> }> = [];
    for (let o = 0; o < 5; o++) {
      const id = randomUUID();
      await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, `Property ${o}`, f.ids.owner, randomUUID()]);
      const anchor = pick(['2026-10-31', '2026-11-01', '2026-11-17', '2026-11-29', '2026-12-30']);
      await plan(anchor, 'b2b_29', id);
      const grants: Array<{ id: string; krw: number; start: string; revoked: boolean }> = [];
      for (let g = 0; g < 8; g++) {
        const krw = (1 + Math.floor(random() * 50)) * 1_000;
        const created = pick(days.slice(0, 90));
        const revoked = random() < 0.2;
        let start: string;
        let gid: string;
        if (random() < 0.3) {
          const from = addCalendarDays(created, Math.floor(random() * 20));
          gid = await grant(krw, from.slice(0, 7), `${created}T03:00:00Z`, { from, until: addCalendarDays(from, Math.floor(random() * 20)), orgId: id });
          start = from;
        } else {
          const month = random() < 0.7 ? created.slice(0, 7) : addCalendarDays(`${created.slice(0, 7)}-28`, 5).slice(0, 7);
          gid = await grant(krw, month, `${created}T03:00:00Z`, { orgId: id });
          start = `${month}-01` > created ? `${month}-01` : created;
        }
        if (revoked) await f.sql.query("update brand_allowance_grants set revoked_at = now() where id = $1", [gid]);
        grants.push({ id: gid, krw, start, revoked });
      }
      orgs.push({ id, anchor, grants });
    }
    const countedIn = new Map<string, Set<string>>();
    let checked = 0;
    for (const day of days) {
      for (const org of orgs) {
        if (day < org.anchor) continue;
        const cycle = cycleContaining(org.anchor, day)!;
        const atStart = day === cycle.start ? await loadAllowance(f.sql, org.id, STUDIO, kstDayStartUtc(day)) : null;
        if (atStart) expect(atStart.usedKrw, `${org.anchor} ${day} first instant`).toBe(0);
        const a = await loadAllowance(f.sql, org.id, STUDIO, new Date(kstDayStartUtc(day).getTime() + 6 * 3_600_000));
        const attached = org.grants.filter((g) => !g.revoked && g.start >= org.anchor && cycleContaining(org.anchor, g.start)!.start === cycle.start);
        expect(a.capKrw - a.baseCapKrw, `${org.anchor} ${day}`).toBe(attached.reduce((n, g) => n + g.krw, 0));
        for (const g of attached) {
          const set = countedIn.get(g.id) ?? new Set<string>();
          set.add(cycle.start);
          countedIn.set(g.id, set);
        }
        checked += 1;
        // Use something today, inside the cycle, after the check.
        if (random() < 0.15) await used((1 + Math.floor(random() * 20)) * 1_000, `${day}T05:00:00Z`, undefined, org.id);
      }
    }
    for (const [, cycles] of countedIn) expect(cycles.size).toBe(1);
    expect(checked).toBeGreaterThan(300);
    expect(kstDayOf(new Date('2026-11-20T01:00:00Z'))).toBe('2026-11-20');
  });
});
