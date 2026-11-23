import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';
import { normalize, recorder, type ParityOp } from './workspace-approval-parity';

/**
 * B1b fix round 1, C: every allowance source, with and without grants, recorded from the `loadAllowance` /
 * `reserveAllowance` of origin/main (lib/brand-studio/usage.ts unchanged since ade904ee) into
 * `tests/brands/fixtures/brand-allowance-proration-parity.json`. First-month proration may change the returned cap of a
 * plan that started after the 1st of the current month; it must not change a single statement, nor any other result.
 */
export const PRORATION_NOW = new Date('2026-11-10T01:00:00Z'); // November 2026: 30 days
export const PRORATION_STUDIO_ENV = { defaultMonthlyKrw: 0, planGraceDays: 14 } as const;

export type ProrationCase = {
  name: string;
  override?: boolean;
  plan?: { planId: 'b2b_29' | 'b2b_49' | 'b2b_69'; startedOn: string };
  grantKrw?: number;
};

export const PRORATION_CASES: ProrationCase[] = [
  { name: 'overrideOnly', override: true },
  { name: 'overrideWithGrant', override: true, grantKrw: 50_000 },
  { name: 'overridePlanMidMonth', override: true, plan: { planId: 'b2b_49', startedOn: '2026-11-05' } },
  { name: 'overridePlanMidMonthGrant', override: true, plan: { planId: 'b2b_49', startedOn: '2026-11-05' }, grantKrw: 4_000 },
  { name: 'planFirstOfMonth', plan: { planId: 'b2b_29', startedOn: '2026-11-01' } },
  { name: 'planFirstOfMonthGrant', plan: { planId: 'b2b_29', startedOn: '2026-11-01' }, grantKrw: 30_000 },
  { name: 'planPreviousMonth', plan: { planId: 'b2b_69', startedOn: '2026-10-15' } },
  { name: 'planMidMonth', plan: { planId: 'b2b_29', startedOn: '2026-11-05' } },
  { name: 'planMidMonthGrant', plan: { planId: 'b2b_29', startedOn: '2026-11-05' }, grantKrw: 4_000 },
  { name: 'planToday', plan: { planId: 'b2b_69', startedOn: '2026-11-10' } },
  { name: 'planTomorrow', plan: { planId: 'b2b_29', startedOn: '2026-11-11' } },
  { name: 'defaultOnly' },
  { name: 'defaultWithGrant', grantKrw: 10_000 },
];

export async function prorationParityScenario(db: PGlite): Promise<ParityOp[]> {
  const base = runner(db);
  const ownerId = randomUUID();
  await seedProfile(base, { id: ownerId, email: 'proration-parity-owner@fixture.invalid' });
  await base.query(
    "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000)",
  );
  const out: ParityOp[] = [];
  const run = async <R,>(op: string, fn: (sql: SqlRunner) => Promise<R>) => {
    const r = recorder(db);
    const result = await fn(r.sql);
    out.push({ op, log: normalize(r.log), result: normalize(result) });
  };
  for (const c of PRORATION_CASES) {
    const orgId = randomUUID();
    await base.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [orgId, `Proration ${c.name}`, ownerId, randomUUID()]);
    if (c.override) {
      await base.query(
        "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note) values ($1, 777000, true, 'sunra_mcp', 'override fixture')",
        [orgId],
      );
    }
    if (c.plan) {
      await base.query(
        "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', $3, null, 1)",
        [orgId, c.plan.planId, c.plan.startedOn],
      );
    }
    if (c.grantKrw) {
      await base.query("insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason) values ($1, $2, '2026-11', 'fixture')", [orgId, c.grantKrw]);
    }
    await run(`${c.name}:load`, (sql) => loadAllowance(sql, orgId, PRORATION_STUDIO_ENV, PRORATION_NOW));
    await run(`${c.name}:reserve`, (sql) => sql.transaction((tx) => reserveAllowance(tx, orgId, 5_000, PRORATION_STUDIO_ENV, PRORATION_NOW)));
  }
  return out;
}
