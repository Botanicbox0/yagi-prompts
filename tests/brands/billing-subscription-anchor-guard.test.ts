import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { startDayMoveBlocked } from '@/lib/brands/billing/cycle-invoices';
import { loadPlanAssignment, setPlanAssignment, SUBSCRIPTION_MANAGED_PLAN, upsertPlanAssignmentInTx } from '@/lib/brands/plans';
import { loadBrandSubscription, runBrandSubscriptionTick } from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1c-2 × B1c-1 fix (c): moving a plan's start day is refused with `cycle_already_invoiced` while an invoice covers
 * today or later — on the ADMIN path only. The subscription engine moves the anchor itself (first payment, resume
 * after suspension) through `upsertPlanAssignmentInTx` with the system actor; that path must keep working.
 */

let h: AdminHarness;
let sql: SqlRunner;
const at = (iso: string) => () => new Date(iso);

async function makeOrg(name: string): Promise<string> {
  const res = await createStudioOrganization({ sql }, ADMIN_VIEWER, { name, requestId: randomUUID() });
  if (!res.ok) throw new Error(res.code);
  await saveBrandBillingProfileAdmin({ sql }, ADMIN_VIEWER, {
    organizationId: res.id,
    companyLegalName: name,
    businessRegNo: '111-11-11119',
    representativeName: 'Fixture Owner',
    businessAddress: 'Seoul',
    taxInvoiceEmail: 'billing@fixture.invalid',
    contactName: 'Ops',
    contactPhone: '02-000-0000',
  });
  return res.id;
}

async function paidFrom(orgId: string, paidOn: string) {
  const s = await startConfirmed({ sql, now: at(`${paidOn}T01:00:00Z`) }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_69', startedOn: paidOn });
  if (!s.ok || !s.applied) throw new Error('start failed');
  const paid = await markBrandInvoicePaid({ sql, now: at(`${paidOn}T03:00:00Z`) }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: paidOn });
  expect(paid.ok).toBe(true);
  return s;
}

const tick = (iso: string) => runBrandSubscriptionTick({ sql, now: at(iso) });

beforeEach(async () => {
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '7');
  h = await adminHarness();
  sql = runner(h.db);
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await h.close();
});

describe('the start-day guard sits on the admin path; the engine still moves its anchor', () => {
  it('first payment and resume move the anchor while invoices cover today — exactly when an admin move is refused', async () => {
    const orgId = await makeOrg('Anchor Engine Fixture');
    await paidFrom(orgId, '2027-01-17');
    // First payment: the anchor is the paid day although the paid cycle covers today.
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-01-17' });
    expect(await startDayMoveBlocked(sql, orgId, '2027-01-20', '2027-01-17')).toBe(true);

    for (const d of ['2027-02-10', '2027-02-17', '2027-03-04', '2027-03-17']) await tick(`${d}T01:00:00Z`);
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'suspended' });
    const feb = (await sql.query<{ id: string }>("select id::text as id from brand_invoices where organization_id = $1 and cycle_start = '2027-02-17'", [orgId])).rows[0]!;
    await markBrandInvoicePaid({ sql, now: at('2027-03-25T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: feb.id, paidMethod: 'transfer', paidAt: '2027-03-25' });
    // Resume: a new cycle and anchor on the paid day, written by the engine (system actor) through the guarded writer.
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-03-25', endsOn: '2027-04-08' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active', reconcileFailures: 0 });
    // At this moment an admin moving the start day would be refused (the restart invoice covers today).
    expect(await startDayMoveBlocked(sql, orgId, '2027-03-30', '2027-03-25')).toBe(true);
  });

  it('both ways on the shared writer: the system actor moves the start day, the admin actor gets cycle_already_invoiced', async () => {
    const orgId = await makeOrg('Anchor Writer Fixture');
    await paidFrom(orgId, '2027-01-17');
    const write = (actor: { kind: 'system' } | { kind: 'admin'; userId: string }, startedOn: string) =>
      sql.transaction((tx) =>
        upsertPlanAssignmentInTx(tx, {
          organizationId: orgId,
          planId: 'b2b_69',
          billingMode: 'invoice',
          startedOn,
          endsOn: '2027-02-17',
          seats: null,
          note: '',
          actor,
          recordActorKind: true,
          organizationLock: 'no key update',
          now: new Date('2027-01-20T01:00:00Z'),
        }),
      );
    expect(await write({ kind: 'admin', userId: ADMIN_VIEWER.userId! }, '2027-01-18')).toEqual({ ok: false, code: 'conflict', field: 'cycle_already_invoiced' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-01-17' });
    expect(await write({ kind: 'system' }, '2027-01-18')).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-01-18' });
  });

  it('the admin plan operation: flag on → the subscription owns the plan; flag off → the start-day guard refuses', async () => {
    const orgId = await makeOrg('Anchor Admin Fixture');
    await paidFrom(orgId, '2027-01-17');
    const current = await loadPlanAssignment(sql, orgId);
    const move = () =>
      setPlanAssignment({ sql, now: at('2027-01-20T01:00:00Z') }, ADMIN_VIEWER, {
        organizationId: orgId,
        planId: 'b2b_69',
        billingMode: 'invoice',
        startedOn: '2027-01-19',
        endsOn: current!.endsOn,
        seats: null,
        note: '',
        expectedRevision: current!.revision,
      });
    expect(await move()).toEqual({ ok: false, code: 'conflict', field: SUBSCRIPTION_MANAGED_PLAN });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    expect(await move()).toEqual({ ok: false, code: 'conflict', field: 'cycle_already_invoiced' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-01-17' });
  });
});
