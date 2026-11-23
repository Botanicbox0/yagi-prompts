import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Viewer } from '@/lib/auth/identity';
import { loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { loadCustomerExtraGrants } from '@/lib/brands/billing-page-data';
import {
  grantExtraAllowance,
  listExtraAllowanceGrants,
  loadActiveExtraGrantsTotal,
  revokeExtraAllowance,
} from '@/lib/brands/billing/allowance';
import { isOrganizationUploadApproved } from '@/lib/brands/upload-gate';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1b-1 §4: the flag-off scenario for `BRAND_WORKSPACE_APPROVAL`, recorded from origin/main (ade904ee) into
 * `tests/brands/fixtures/brand-workspace-approval-flag-off-parity.json` and replayed by
 * `tests/brands/workspace-approval-parity.test.ts` against the current code, on the schema before 0184 and after it.
 *
 * Every statement is recorded with whitespace collapsed and ids replaced by `<uuid>`; the clock-driven timestamps
 * the database stamps itself (`created_at`, `revoked_at`) are replaced by `<time>` in results.
 */

export type Logged = { text: string; params: unknown[] };
export type ParityOp = { op: string; log: unknown; result: unknown };

export function recorder(db: PGlite): { sql: SqlRunner; log: Logged[] } {
  const log: Logged[] = [];
  const sql = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    log.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    const res = await db.query<T>(text, params as never[]);
    return { rows: res.rows as T[] };
  });
  return { sql, log };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const CLOCK_KEYS = new Set(['createdAt', 'revokedAt', 'updatedAt']);

export function normalize(value: unknown): unknown {
  const text = JSON.stringify(value === undefined ? null : value, (key, v) =>
    CLOCK_KEYS.has(key) && typeof v === 'string' ? '<time>' : v,
  );
  return JSON.parse(text.replace(UUID_RE, '<uuid>'));
}

/** Every core migration before 0184: the schema production runs until 0184/0185 are applied. */
export async function pre0184Db(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
  for (const file of coreMigrationFiles().filter((m) => m < '0184_')) await db.exec(readMigration(file));
  return db;
}

export const PARITY_NOW = new Date('2026-11-10T01:00:00Z');
export const PARITY_STUDIO_ENV = { defaultMonthlyKrw: 0, planGraceDays: 14 } as const;

/**
 * The scenario: an organization on an explicit allowance override (account lane) that also has a plan, an
 * organization on a plan default, a new unapproved organization and one created before the upload cutoff; the
 * grant operations, `loadAllowance`, `reserveAllowance` and `isOrganizationUploadApproved` across them.
 * The caller stubs `BRAND_STUDIO_DEFAULT_MONTHLY_KRW=0` and `BRAND_PLAN_GRACE_DAYS=14`.
 */
export async function flagOffParityScenario(db: PGlite): Promise<ParityOp[]> {
  const base = runner(db);
  const adminId = randomUUID();
  const ownerId = randomUUID();
  await seedProfile(base, { id: adminId, isAdmin: true, email: 'approval-parity-admin@fixture.invalid' });
  await seedProfile(base, { id: ownerId, email: 'approval-parity-owner@fixture.invalid' });
  const viewer = { userId: adminId, isAdmin: true, tier: 'pro', email: 'approval-parity-admin@fixture.invalid', locale: 'ko' } as Viewer;

  const newOrg = async (name: string, createdAt: string): Promise<string> => {
    const id = randomUUID();
    await base.query('insert into brand_organizations (id, name, created_by, request_id, created_at) values ($1, $2, $3, $4, $5)', [
      id,
      name,
      ownerId,
      randomUUID(),
      createdAt,
    ]);
    return id;
  };
  const overrideOrg = await newOrg('Parity Override', '2026-11-25T00:00:00+09:00');
  const planOrg = await newOrg('Parity Plan', '2026-11-25T00:00:00+09:00');
  const gatedOrg = await newOrg('Parity Gated', '2026-11-25T00:00:00+09:00');
  const oldOrg = await newOrg('Parity Old', '2026-11-01T00:00:00+09:00');

  await base.query(
    "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note) values ($1, 777000, true, 'sunra_mcp', 'override fixture')",
    [overrideOrg],
  );
  await base.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_49', 'invoice', '2026-11-01', null, 1)",
    [overrideOrg],
  );
  await base.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-01', null, 1)",
    [planOrg],
  );
  await base.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000)");

  const now = () => PARITY_NOW;
  const out: ParityOp[] = [];
  const run = async <R,>(op: string, fn: (sql: SqlRunner) => Promise<R>): Promise<R> => {
    const r = recorder(db);
    const result = await fn(r.sql);
    out.push({ op, log: normalize(r.log), result: normalize(result) });
    return result;
  };

  await run('grantExtra', (sql) =>
    grantExtraAllowance({ sql, now }, viewer, { organizationId: overrideOrg, amountKrw: 50_000, validMonth: '2026-11', reason: 'parity' }),
  );
  await run('grantExtraInvalidMonth', (sql) =>
    grantExtraAllowance({ sql, now }, viewer, { organizationId: overrideOrg, amountKrw: 50_000, validMonth: '2027-05', reason: 'parity' }),
  );
  const planGrant = await run('grantExtraPlan', (sql) =>
    grantExtraAllowance({ sql, now }, viewer, { organizationId: planOrg, amountKrw: 30_000, validMonth: '2026-11', reason: '' }),
  );
  await run('grantExtraNextMonth', (sql) =>
    grantExtraAllowance({ sql, now }, viewer, { organizationId: planOrg, amountKrw: 10_000, validMonth: '2026-12', reason: 'next' }),
  );
  await run('loadOverride', (sql) => loadAllowance(sql, overrideOrg, PARITY_STUDIO_ENV, PARITY_NOW));
  await run('reserveOverride', (sql) => sql.transaction((tx) => reserveAllowance(tx, overrideOrg, 5_000, PARITY_STUDIO_ENV, PARITY_NOW)));
  await run('reserveOverrideTooMuch', (sql) =>
    sql.transaction((tx) => reserveAllowance(tx, overrideOrg, 900_000, PARITY_STUDIO_ENV, PARITY_NOW)),
  );
  await run('loadPlan', (sql) => loadAllowance(sql, planOrg, PARITY_STUDIO_ENV, PARITY_NOW));
  await run('loadGated', (sql) => loadAllowance(sql, gatedOrg, PARITY_STUDIO_ENV, PARITY_NOW));
  await run('reserveGated', (sql) => sql.transaction((tx) => reserveAllowance(tx, gatedOrg, 70, PARITY_STUDIO_ENV, PARITY_NOW)));
  await run('listOverride', (sql) => listExtraAllowanceGrants(sql, overrideOrg, PARITY_NOW));
  await run('activeTotalOverride', (sql) => loadActiveExtraGrantsTotal(sql, overrideOrg, PARITY_NOW));
  const planGrantId = planGrant.ok ? planGrant.id : 'missing';
  await run('revoke', (sql) => revokeExtraAllowance({ sql }, viewer, { grantId: planGrantId, organizationId: planOrg }));
  await run('revokeAgain', (sql) => revokeExtraAllowance({ sql }, viewer, { grantId: planGrantId }));
  await run('listPlan', (sql) => listExtraAllowanceGrants(sql, planOrg, PARITY_NOW));
  await run('customerGrantsPlan', (sql) => loadCustomerExtraGrants(sql, planOrg, PARITY_NOW));
  await run('uploadGated', (sql) => isOrganizationUploadApproved(sql, gatedOrg, PARITY_NOW));
  await run('uploadOverride', (sql) => isOrganizationUploadApproved(sql, overrideOrg, PARITY_NOW));
  await run('uploadPlan', (sql) => isOrganizationUploadApproved(sql, planOrg, PARITY_NOW));
  await run('uploadOld', (sql) => isOrganizationUploadApproved(sql, oldOrg, PARITY_NOW));
  return out;
}
