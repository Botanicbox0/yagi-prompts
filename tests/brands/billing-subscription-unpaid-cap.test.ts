import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAllowance, reserveAllowance } from '@/lib/brand-studio/usage';
import { markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { grantExtraAllowance } from '@/lib/brands/billing/allowance';
import { runBrandSubscriptionTick } from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1c-2 brief, "Unpaid 50% credit cap", as changed by the founder on 2026-11-24 (fix round 1, A): for a plan organization
 * with a non-ended subscription (flag on, schema ready), while an issued invoice of the current epoch is past its due date
 * and unpaid, the PLAN part of the cap is floor10(plan cap × 50 / 100); before the due date, and once paid, the full cap. Grants are never halved. The check is folded into the plan
 * organization's one allowance statement: no extra statement for anyone, and with the flag off the SQL is unchanged.
 */

const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };
const PLAN_69 = 650_000;
const HALF_69 = 325_000;

let h: AdminHarness;
let sql: SqlRunner;
const at = (iso: string) => () => new Date(iso);

async function makeOrg(name: string): Promise<string> {
  const res = await createStudioOrganization({ sql }, ADMIN_VIEWER, { name, requestId: randomUUID() });
  if (!res.ok) throw new Error(res.code);
  const saved = await saveBrandBillingProfileAdmin({ sql }, ADMIN_VIEWER, {
    organizationId: res.id,
    companyLegalName: name,
    businessRegNo: '111-11-11119',
    representativeName: 'Fixture Owner',
    businessAddress: 'Seoul',
    taxInvoiceEmail: 'billing@fixture.invalid',
    contactName: 'Ops',
    contactPhone: '02-000-0000',
  });
  expect(saved.ok).toBe(true);
  return res.id;
}

async function start(orgId: string, startedOn: string, early: boolean) {
  const s = await startConfirmed({ sql, now: at(`${startedOn}T01:00:00Z`) }, ADMIN_VIEWER, {
    organizationId: orgId,
    planId: 'b2b_69',
    startedOn,
    ...(early ? { activateBeforePayment: true, confirm: true } : {}),
  });
  if (!s.ok || !s.applied) throw new Error('start failed');
  return s;
}

const pay = (invoiceId: string, iso: string, paidAt?: string) =>
  markBrandInvoicePaid({ sql, now: at(iso) }, ADMIN_VIEWER, { invoiceId, paidMethod: 'transfer', ...(paidAt ? { paidAt } : {}) });

const use = (orgId: string, krw: number, iso: string) =>
  sql.query(
    `insert into brand_studio_jobs (organization_id, created_by, request_id, kind, status, model, prompt, estimate_krw, usage_krw, created_at, finished_at)
     values ($1, $2, $3, 'image', 'succeeded', 'seedream-5.5', 'p', $4, $4, $5, $5)`,
    [orgId, ADMIN_VIEWER.userId, `use_${randomUUID().slice(0, 12)}`, krw, iso],
  );

/**
 * ONE recording runner per test over the same database (statement text with whitespace collapsed, and parameters).
 * One runner = one schema-cache root, so the cached probes behave as on a long-lived server connection.
 */
let rec: { sql: SqlRunner; log: Array<{ text: string; params: unknown[] }> };

async function recordLoad(orgId: string, nowIso: string) {
  rec.log.length = 0;
  const result = await loadAllowance(rec.sql, orgId, STUDIO, new Date(nowIso));
  return { result, log: rec.log.splice(0) };
}

beforeEach(async () => {
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  h = await adminHarness();
  sql = runner(h.db);
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  const log: Array<{ text: string; params: unknown[] }> = [];
  rec = {
    log,
    sql: makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
      log.push({ text: text.replace(/\s+/g, ' ').trim(), params });
      return sql.query<T>(text, params);
    }),
  };
  await sql.query(
    "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw",
  );
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await h.close();
});

describe('B1c-2: the unpaid 50% cap before 0186', () => {
  it('with the flag on and no cycle columns a plan load is unchanged: no subscription statement, no extra probe', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { coreMigrationFiles, readMigration } = await import('@/lib/db/migrations');
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => m < '0186_')) await db.exec(readMigration(file));
      const owner = randomUUID();
      const org = randomUUID();
      await db.query('insert into auth.users (id) values ($1)', [owner]);
      await db.query("insert into profiles (id, email) values ($1, 'pre0186-half@fixture.invalid')", [owner]);
      await db.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [org, 'Pre-0186 Half', owner, randomUUID()]);
      await db.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
      await db.query("insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', null, 1)", [org]);
      const log: string[] = [];
      const pre = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
        log.push(JSON.stringify([text.replace(/\s+/g, ' ').trim(), params]));
        return { rows: (await db.query<T>(text, params as never[])).rows as T[] };
      });
      const now = new Date('2026-11-20T01:00:00Z');
      const load = async () => {
        log.length = 0;
        expect(await loadAllowance(pre, org, STUDIO, now)).toMatchObject({ source: 'plan', capKrw: 270_000 });
        return log.splice(0);
      };
      const onCold = await load();
      const onWarm = await load();
      vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
      const offWarm = await load();
      // Flag on before 0186: not one statement or parameter more than flag off, and nothing about subscriptions.
      expect(onWarm).toEqual(offWarm);
      expect([...onCold, ...onWarm].some((s) => s.includes('brand_subscriptions'))).toBe(false);
    } finally {
      await db.close();
    }
  });
});

describe('B1c-2: the unpaid 50% cap on the current cycle', () => {
  it('early access: full until the due date, then half the plan part with a grant still whole; payment restores the full cap at once', async () => {
    const orgId = await makeOrg('Unpaid Half Early Fixture');
    const s = await start(orgId, '2026-11-10', true);
    const granted = await grantExtraAllowance({ sql, now: at('2026-11-11T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      amountKrw: 50_000,
      validMonth: '2026-11',
      reason: 'fixture',
    });
    expect(granted.ok).toBe(true);
    // Fix round 1, A: issued and not yet due → full.
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2026-11-12T01:00:00Z'))).toMatchObject({ source: 'plan', baseCapKrw: PLAN_69, extraKrw: 50_000 });
    const unpaid = await loadAllowance(sql, orgId, STUDIO, new Date('2026-11-25T01:00:00Z'));
    expect(unpaid).toMatchObject({ source: 'plan', baseCapKrw: HALF_69, extraKrw: 50_000, capKrw: HALF_69 + 50_000, planCapHalvedUnpaid: true });
    expect(unpaid.cycle).toMatchObject({ start: '2026-11-10', end: '2026-12-10' });

    expect(await pay(s.firstInvoiceId, '2026-11-26T01:00:00Z')).toMatchObject({ ok: true });
    const paid = await loadAllowance(sql, orgId, STUDIO, new Date('2026-11-26T02:00:00Z'));
    expect(paid).toMatchObject({ source: 'plan', baseCapKrw: PLAN_69, extraKrw: 50_000, capKrw: PLAN_69 + 50_000 });
    expect(paid).not.toHaveProperty('planCapHalvedUnpaid');
  });

  it('the next cycle: full while drafted and while issued but not yet due, half once overdue (reserveAllowance agrees to the won), full again on payment', async () => {
    const orgId = await makeOrg('Unpaid Half Next Fixture');
    const s = await start(orgId, '2026-11-10', false);
    expect(await pay(s.firstInvoiceId, '2026-11-10T03:00:00Z', '2026-11-10')).toMatchObject({ ok: true });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-03T01:00:00Z') });
    // Dec 10 01:00 KST: the Dec 10 cycle has started, its invoice is still a draft (the job has not run yet).
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2026-12-09T16:00:00Z'))).toMatchObject({ baseCapKrw: PLAN_69, capKrw: PLAN_69 });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-10T01:00:00Z') });
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2026-12-10T02:00:00Z'))).toMatchObject({ baseCapKrw: PLAN_69, capKrw: PLAN_69 });
    // Due Dec 24; from Dec 25 (KST) it is overdue.
    const issued = await loadAllowance(sql, orgId, STUDIO, new Date('2026-12-25T02:00:00Z'));
    expect(issued).toMatchObject({ baseCapKrw: HALF_69, capKrw: HALF_69, planCapHalvedUnpaid: true, cycle: { start: '2026-12-10', end: '2027-01-10' } });

    await use(orgId, 300_000, '2026-12-10T03:00:00Z');
    const reserve = (krw: number) => sql.transaction((tx) => reserveAllowance(tx, orgId, krw, STUDIO, new Date('2026-12-25T04:00:00Z')));
    expect(await reserve(25_010)).toEqual({ ok: false, code: 'allowance_exhausted' });
    expect(await reserve(25_000)).toMatchObject({ ok: true });

    const dec = (await sql.query<{ id: string }>("select id::text as id from brand_invoices where organization_id = $1 and cycle_start = '2026-12-10' and status = 'issued'", [orgId])).rows[0]!;
    expect(await pay(dec.id, '2026-12-26T01:00:00Z')).toMatchObject({ ok: true });
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2026-12-26T02:00:00Z'))).toMatchObject({ baseCapKrw: PLAN_69, capKrw: PLAN_69 });
  });

  it('a first invoice without early access gives no plan at all before payment, so nothing is halved', async () => {
    const orgId = await makeOrg('Unpaid Half Pending Fixture');
    await start(orgId, '2026-11-10', false);
    const pending = await loadAllowance(sql, orgId, STUDIO, new Date('2026-11-12T01:00:00Z'));
    expect(pending.source).toBe('default');
    expect(pending).not.toHaveProperty('planCapHalvedUnpaid');
  });

  it('an override organization with an unpaid subscription invoice: the override wins, byte-identical to the flag off', async () => {
    const orgId = await makeOrg('Unpaid Half Override Fixture');
    await start(orgId, '2026-11-10', true);
    await sql.query(
      `insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, preferred_lane, note) values ($1, 777000, true, 'sunra_mcp', 'override fixture')
       on conflict (organization_id) do update set monthly_cap_krw = excluded.monthly_cap_krw, is_override = true, preferred_lane = excluded.preferred_lane, note = excluded.note`,
      [orgId],
    );
    await recordLoad(orgId, '2026-11-12T01:00:00Z'); // warm the schema caches of this runner
    const on = await recordLoad(orgId, '2026-11-12T01:00:00Z');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const off = await recordLoad(orgId, '2026-11-12T01:00:00Z');
    expect(on.result).toMatchObject({ source: 'override', baseCapKrw: 777_000, capKrw: 777_000 });
    expect(on.log).toEqual(off.log);
    expect(on.result).toEqual(off.result);
  });

  it('recorded SQL: no extra statement for a subscribed plan organization, a plain plan organization or a default one; flag off leaves the SQL as it was', async () => {
    const subscribed = await makeOrg('Unpaid Half SQL Subscribed');
    await start(subscribed, '2026-11-10', true);
    const plain = await makeOrg('Unpaid Half SQL Plain');
    await sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_69', 'invoice', '2026-11-10', null, 1)",
      [plain],
    );
    const plainDefault = await makeOrg('Unpaid Half SQL Default');
    const nowIso = '2026-11-25T01:00:00Z'; // the early-access invoice (due Nov 24) is overdue
    // Warm the cached schema probes once with the flag on (a probe runs once per database root, not per load).
    const cold = await recordLoad(subscribed, nowIso);
    expect(cold.result).toMatchObject({ planCapHalvedUnpaid: true });

    const onSub = await recordLoad(subscribed, nowIso);
    const onPlain = await recordLoad(plain, nowIso);
    const onDefault = await recordLoad(plainDefault, nowIso);
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const offSub = await recordLoad(subscribed, nowIso);
    const offPlain = await recordLoad(plain, nowIso);
    const offDefault = await recordLoad(plainDefault, nowIso);

    expect(onSub.result).toMatchObject({ baseCapKrw: HALF_69, planCapHalvedUnpaid: true });
    expect(offSub.result).toMatchObject({ baseCapKrw: PLAN_69, capKrw: PLAN_69 });
    expect(offSub.result).not.toHaveProperty('planCapHalvedUnpaid');
    expect(onPlain.result).toMatchObject({ source: 'plan', baseCapKrw: PLAN_69 });
    expect(onPlain.result).not.toHaveProperty('planCapHalvedUnpaid');

    // Same number of statements with the flag on and off, for every kind of organization.
    expect(onSub.log).toHaveLength(offSub.log.length);
    expect(onPlain.log).toHaveLength(offPlain.log.length);
    expect(onDefault.log).toEqual(offDefault.log);
    // Only the plan organization's one allowance statement differs, and only with the flag on.
    const differing = onSub.log.filter((s, i) => s.text !== offSub.log[i]!.text);
    expect(differing).toHaveLength(1);
    expect(differing[0]!.text).toContain('from brand_subscriptions');
    for (const s of [...offSub.log, ...offPlain.log, ...offDefault.log, ...onDefault.log]) expect(s.text).not.toContain('brand_subscriptions');
  });
});
