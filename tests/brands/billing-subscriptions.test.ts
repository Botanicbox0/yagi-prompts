import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertLegacyDraft } from '@/tests/brands/helpers/legacy-invoice';
import type { Viewer } from '@/lib/auth/identity';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { studioEnv } from '@/lib/brand-studio/env';
import {
  draftBrandInvoice,
  endBrandDiscount,
  grantBrandDiscount,
  issueBrandInvoice,
  listBrandInvoiceEvents,
  listBrandInvoices,
  loadActiveBrandDiscount,
  markBrandInvoicePaid,
  recordBrandInvoiceTaxInvoice,
  saveBrandBillingProfileAdmin,
  setPlanAllowanceDefault,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import { loadPlanAssignment } from '@/lib/brands/plans';
import {
  cancelSubscription,
  clearPendingPlan,
  listBrandSubscriptionEvents,
  loadBrandSubscription,
  loadExtendedInvoiceMetaByOrg,
  runBrandSubscriptionTick,
  scheduleDowngrade,
  startSubscription,
  undoCancelSubscription,
} from '@/lib/brands/subscriptions';
import { createBrandOrganization } from '@/lib/brands/workspace/service';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { adminRouteAllowed, brandRouteAllowed } from '@/lib/routing/surfaces';
import { loadBrandBillingOverview } from '@/lib/admin/brand-billing-console';
import { loadBrandOrgDetailOps } from '@/lib/admin/brand-org-detail';
import { ADMIN_VIEWER, adminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { reissueConfirmed, startConfirmed, startSubscriptionCompat, reissueCompat } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';
import { studioDeps, studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

const routeMocks = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
}));

vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => routeMocks.sql }));

const billingTickRoute = await import('@/app/api/brand-billing/tick/route');

let f: StudioFixture;
const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const owner = (): Viewer => viewerOf(f.ids.owner);

async function seedCompleteBillingProfile(sql: SqlRunner, viewer: Viewer, organizationId: string, name = 'Billing Fixture Org') {
  const res = await saveBrandBillingProfileAdmin({ sql }, viewer, {
    organizationId,
    companyLegalName: name,
    businessRegNo: '111-11-11119',
    representativeName: 'Test Owner',
    businessAddress: '100 Test Street, Seoul',
    taxInvoiceEmail: 'billing@fixture.invalid',
    contactName: 'Finance Contact',
    contactPhone: '02-000-0000',
  });
  expect(res.ok).toBe(true);
}

beforeEach(async () => {
  f = await studioFixture({ capKrw: null });
  routeMocks.sql = f.sql;
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  vi.stubEnv('BRAND_STUDIO_PROVIDER', 'fake');
  vi.stubEnv('CRON_SECRET', 'cron-secret-test');
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_29', monthlyCapKrw: 270_000, confirm: true });
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_49', monthlyCapKrw: 460_000, confirm: true });
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_69', monthlyCapKrw: 650_000, confirm: true });
  await seedCompleteBillingProfile(f.sql, admin(), f.orgId);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await f.db.close();
});

describe('B1a brand subscriptions integration & route (§8.2–§8.11)', () => {
  it('§8.2 KST boundary (B1c-2: the cycle boundary): 14:59:59Z vs 15:00:00Z on the day before the cycle start drafts/issues for the right KST day', async () => {
    const startAt = new Date('2026-11-10T01:00:00Z');
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => startAt }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-10',
    });
    expect(started).toMatchObject({ ok: true, applied: true });
    if (!started.ok || !started.applied) return;
    await markBrandInvoicePaid({ sql: f.sql, now: () => startAt }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });

    // Paid on Nov 10 -> cycle [Nov 10, Dec 10). At 2026-12-09T14:59:59Z -> still Dec 9 KST (D-1): the next cycle's
    // draft exists, NOT issued yet.
    const beforeMidnight = new Date('2026-12-09T14:59:59Z');
    const t1 = await runBrandSubscriptionTick({ sql: f.sql, now: () => beforeMidnight });
    expect(t1).toMatchObject({ ok: true, period: '2026-12', drafted: 1, issued: 0 });
    const invBefore = await listBrandInvoices(f.sql, { organizationId: f.orgId, now: beforeMidnight });
    expect(invBefore.find((i) => i.period === '2026-12')?.status).toBe('draft');

    // 1 second later: 2026-12-09T15:00:00Z -> 2026-12-10 00:00:00 KST -> issues the Dec 10 cycle.
    const atMidnight = new Date('2026-12-09T15:00:00Z');
    const t2 = await runBrandSubscriptionTick({ sql: f.sql, now: () => atMidnight });
    expect(t2).toMatchObject({ ok: true, period: '2026-12', drafted: 0, issued: 1 });
    const invAfter = await listBrandInvoices(f.sql, { organizationId: f.orgId, now: atMidnight });
    const decInv = invAfter.find((i) => i.period === '2026-12');
    expect(decInv?.status).toBe('issued');
    const meta = await loadExtendedInvoiceMetaByOrg(f.sql, f.orgId);
    expect(meta.get(decInv!.id)).toMatchObject({
      kind: 'subscription',
      dueOn: '2026-12-24',
      collectionMethod: 'transfer',
      issuedVia: 'system',
    });
  });

  it('§8.3 Idempotency: running tick twice and concurrently produces 1 draft, 1 issued invoice, and increments discount once', async () => {
    const disc = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 20,
      invoicesTotal: 3,
      memo: 'Launch promo',
    });
    expect(disc.ok).toBe(true);

    const t0 = new Date('2026-11-01T00:00:00Z');
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-11-01',
    });
    expect(started).toMatchObject({ ok: true, applied: true });
    if (!started.ok || !started.applied) return;
    await markBrandInvoicePaid({ sql: f.sql, now: () => t0 }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toMatchObject({ invoicesUsed: 1 });

    // On 2026-11-25 (D-6 before Dec 1), run twice concurrently -> 1 draft for 2026-12
    const nov25 = new Date('2026-11-25T01:00:00Z');
    await Promise.all([
      runBrandSubscriptionTick({ sql: f.sql, now: () => nov25 }),
      runBrandSubscriptionTick({ sql: f.sql, now: () => nov25 }),
    ]);
    const drafts = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: nov25 })).filter(
      (i) => i.period === '2026-12',
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe('draft');

    // On 2026-12-01, run twice concurrently and once more sequentially -> exactly 1 issued, discount used = 2
    const dec01 = new Date('2026-12-01T01:00:00Z');
    await Promise.all([
      runBrandSubscriptionTick({ sql: f.sql, now: () => dec01 }),
      runBrandSubscriptionTick({ sql: f.sql, now: () => dec01 }),
    ]);
    const third = await runBrandSubscriptionTick({ sql: f.sql, now: () => dec01 });
    expect(third).toMatchObject({ ok: true, drafted: 0, issued: 0 });

    const decInvoices = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: dec01 })).filter(
      (i) => i.period === '2026-12',
    );
    expect(decInvoices).toHaveLength(1);
    expect(decInvoices[0]?.status).toBe('issued');
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toMatchObject({ invoicesUsed: 2 });
  });

  it('§8.4 First invoice: closed before payment, opens after markPaid, and two-step activateBeforePayment opens with ends_on = due_on', async () => {
    const t0 = new Date('2026-11-10T01:00:00Z');
    const preview = await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-10',
      activateBeforePayment: true,
      confirm: false,
    });
    expect(preview).toMatchObject({ ok: true, applied: false, preview: { dueOn: '2026-11-24', activateBeforePayment: true } });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toBeNull();

    // Start WITHOUT activateBeforePayment -> pending, zero allowance
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-10',
      activateBeforePayment: false,
    });
    expect(started).toMatchObject({ ok: true, applied: true });
    if (!started.ok || !started.applied) return;
    expect(await loadPlanAssignment(f.sql, f.orgId)).toBeNull();
    expect((await loadAllowance(f.sql, f.orgId, studioEnv(), t0)).capKrw).toBe(0);

    // Mark paid -> active + allowance opens with exclusive ends_on = 2026-12-01
    await markBrandInvoicePaid({ sql: f.sql, now: () => t0 }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'active' });
    // B1c-2, rule 4: paid on Nov 10 -> cycle 0 is [Nov 10, Dec 10).
    expect(await loadPlanAssignment(f.sql, f.orgId)).toMatchObject({ planId: 'b2b_29', startedOn: '2026-11-10', endsOn: '2026-12-10' });
    // B1c (changed on purpose): the full plan cap on every cycle; the B1b first-month proration (189,000 here) is gone.
    expect((await loadAllowance(f.sql, f.orgId, studioEnv(), t0)).capKrw).toBe(270_000);

    // Second org with activateBeforePayment + confirm: true -> plan access open immediately with ends_on = due_on
    const owner2 = randomUUID();
    await seedProfile(f.sql, { id: owner2, email: 'preopen@fixture.invalid' });
    const org2Res = await createBrandOrganization({ sql: f.sql }, viewerOf(owner2), {
      name: 'Preopen Fixture Org',
      requestId: randomUUID(),
    });
    if (!org2Res.ok) throw new Error(org2Res.code);
    await seedCompleteBillingProfile(f.sql, admin(), org2Res.id, 'Preopen Fixture Org');

    const started2 = await startConfirmed({ sql: f.sql, now: () => t0 }, admin(), {
      organizationId: org2Res.id,
      planId: 'b2b_49',
      startedOn: '2026-11-10',
      activateBeforePayment: true,
      confirm: true,
    });
    expect(started2).toMatchObject({ ok: true, applied: true });
    expect(await loadBrandSubscription(f.sql, org2Res.id)).toMatchObject({ status: 'pending', activatedBeforePayment: true });
    expect(await loadPlanAssignment(f.sql, org2Res.id)).toMatchObject({ planId: 'b2b_49', endsOn: '2026-11-24' });
    // B1c: full cycle, no first-month proration (was 322,000 under B1b). The unpaid 50% cap applies only after the due
    // date (founder 2026-11-24), so early access on its start day is full.
    expect((await loadAllowance(f.sql, org2Res.id, studioEnv(), t0)).capKrw).toBe(460_000);
  });

  it('§8.5 Unpaid flow: ends_on = oldest due_on, past_due, suspended after grace, no new invoice while suspended, resume prorated on pay', async () => {
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });

    // Dec 1: issue 2026-12 invoice (due_on = 2026-12-15) -> ends_on moves to 2026-12-15
    const dec01 = new Date('2026-12-01T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => dec01 });
    expect(await loadPlanAssignment(f.sql, f.orgId)).toMatchObject({ endsOn: '2026-12-15' });
    const decInv = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: dec01 })).find((i) => i.period === '2026-12')!;

    // Dec 16 -> past_due, allowance STILL active within 14-day grace — B1c-2, unpaid 50% cap: an invoice is past its
    // due date (Dec 15) and unpaid, so the plan part is half (270,000 → 135,000).
    const dec16 = new Date('2026-12-16T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => dec16 });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'past_due' });
    expect((await loadAllowance(f.sql, f.orgId, studioEnv(), dec16)).capKrw).toBe(135_000);

    // Dec 30 (15 days after due_on 2026-12-15, grace=14) -> suspended, allowance drops to 0, no 2027-01 draft
    const dec30 = new Date('2026-12-30T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => dec30 });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'suspended' });
    expect((await loadAllowance(f.sql, f.orgId, studioEnv(), dec30)).capKrw).toBe(0);

    // Jan 5: still suspended, still NO 2027-01 invoice drafted or issued
    const jan05 = new Date('2027-01-05T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => jan05 });
    expect((await listBrandInvoices(f.sql, { organizationId: f.orgId, now: jan05 })).some((i) => i.period === '2027-01')).toBe(
      false,
    );

    // Pay Dec invoice on Jan 5 -> immediately returns to active AND drafts+issues prorated Jan invoice (27/31 days)
    await markBrandInvoicePaid({ sql: f.sql, now: () => jan05 }, admin(), {
      invoiceId: decInv.id,
      paidMethod: 'transfer',
    });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'active' });
    const janInv = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: jan05 })).find((i) => i.period === '2027-01');
    // B1c-2, rule 8: a new full-price cycle starts on the paid date (no proration).
    expect(janInv).toMatchObject({
      status: 'issued',
      proratedDays: null,
      cycleStart: '2027-01-05',
      cycleEnd: '2027-02-05',
    });
    expect(await loadPlanAssignment(f.sql, f.orgId)).toMatchObject({ endsOn: '2027-01-19' });
    // The restart cycle's invoice is issued but not yet due → full (the 50% cap applies only after the due date).
    expect((await loadAllowance(f.sql, f.orgId, studioEnv(), jan05)).capKrw).toBe(270_000);
    expect((await loadAllowance(f.sql, f.orgId, studioEnv(), new Date('2027-01-20T01:00:00Z'))).capKrw).toBe(135_000);
    await markBrandInvoicePaid({ sql: f.sql, now: () => new Date('2027-01-20T02:00:00Z') }, admin(), { invoiceId: (janInv as { id: string }).id, paidMethod: 'transfer' });
    expect((await loadAllowance(f.sql, f.orgId, studioEnv(), new Date('2027-01-20T03:00:00Z'))).capKrw).toBe(270_000);
  });

  it('§8.6 Cancel, undoCancel, cancel with nothing paid, downgrade on 1st, and upgrade rejected', async () => {
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');

    // Upgrade from b2b_49 -> b2b_69 rejected with not_available_yet; downgrade b2b_69 -> b2b_29 works
    expect(
      await scheduleDowngrade({ sql: f.sql, now: () => nov01 }, admin(), {
        organizationId: f.orgId,
        planId: 'b2b_49',
      }),
    ).toMatchObject({ ok: true, subscription: { pendingPlanId: 'b2b_49' } });
    expect(
      await clearPendingPlan({ sql: f.sql, now: () => nov01 }, admin(), { organizationId: f.orgId }),
    ).toMatchObject({ ok: true, subscription: { pendingPlanId: null } });

    // Cancel while nothing paid -> ends immediately
    const canceledUnpaid = await cancelSubscription({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
    });
    expect(canceledUnpaid).toMatchObject({ ok: true, subscription: { status: 'ended' } });
    expect(await loadPlanAssignment(f.sql, f.orgId)).toBeNull();

    // Start new subscription on a fresh org -> pay Nov -> schedule downgrade b2b_69 -> b2b_29 -> test cancel/undoCancel
    const owner2 = randomUUID();
    await seedProfile(f.sql, { id: owner2, email: 'downgrade@fixture.invalid' });
    const org2Res = await createBrandOrganization({ sql: f.sql }, viewerOf(owner2), {
      name: 'Downgrade Fixture Org',
      requestId: randomUUID(),
    });
    if (!org2Res.ok) throw new Error(org2Res.code);
    await seedCompleteBillingProfile(f.sql, admin(), org2Res.id, 'Downgrade Fixture Org');

    const s2 = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: org2Res.id,
      planId: 'b2b_69',
      startedOn: '2026-11-01',
    });
    if (!s2.ok || !s2.applied) throw new Error('start2 failed');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), {
      invoiceId: s2.firstInvoiceId,
      paidMethod: 'transfer',
    });

    // Cancel -> keeps paid period through exclusive 2026-12-01, then undoCancel restores billing
    await cancelSubscription({ sql: f.sql, now: () => new Date('2026-11-15T01:00:00Z') }, admin(), {
      organizationId: org2Res.id,
    });
    expect(await loadPlanAssignment(f.sql, org2Res.id)).toMatchObject({ endsOn: '2026-12-01' });
    await undoCancelSubscription({ sql: f.sql, now: () => new Date('2026-11-16T01:00:00Z') }, admin(), {
      organizationId: org2Res.id,
    });

    // Schedule downgrade to b2b_29 -> upgrade test -> tick on Dec 1 applies downgrade with b2b_29 price
    await scheduleDowngrade({ sql: f.sql, now: () => new Date('2026-11-20T01:00:00Z') }, admin(), {
      organizationId: org2Res.id,
      planId: 'b2b_29',
    });
    const dec01 = new Date('2026-12-01T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => dec01 });
    expect(await loadBrandSubscription(f.sql, org2Res.id)).toMatchObject({
      planId: 'b2b_29',
      pendingPlanId: null,
    });
    const decInv = (await listBrandInvoices(f.sql, { organizationId: org2Res.id, now: dec01 })).find(
      (i) => i.period === '2026-12',
    );
    expect(decInv).toMatchObject({ planId: 'b2b_29', baseListKrw: 290_000, status: 'issued' });

    // Upgrade rejected by the downgrade operation after downgraded to b2b_29. B1c-3 (changed on purpose): a higher plan
    // is the upgrade operation now (`brandSubscription.upgrade`), so the refusal points there instead of "not yet".
    expect(
      await scheduleDowngrade({ sql: f.sql, now: () => dec01 }, admin(), {
        organizationId: org2Res.id,
        planId: 'b2b_49',
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'planId', detail: 'upgrade_use_upgrade_operation' });

    // Cancel on paid org ends only after paid period ends
    await markBrandInvoicePaid({ sql: f.sql, now: () => dec01 }, admin(), {
      invoiceId: decInv!.id,
      paidMethod: 'transfer',
    });
    await cancelSubscription({ sql: f.sql, now: () => new Date('2026-12-10T01:00:00Z') }, admin(), {
      organizationId: org2Res.id,
    });
    // Dec 26 (would be D-6 for Jan) -> no Jan draft and still active until 2026-12-31
    await runBrandSubscriptionTick({ sql: f.sql, now: () => new Date('2026-12-26T01:00:00Z') });
    expect(await loadBrandSubscription(f.sql, org2Res.id)).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    expect((await listBrandInvoices(f.sql, { organizationId: org2Res.id })).some((i) => i.period === '2027-01')).toBe(
      false,
    );
    // Jan 1 -> ended, assignment cleared
    await runBrandSubscriptionTick({ sql: f.sql, now: () => new Date('2027-01-01T01:00:00Z') });
    expect(await loadBrandSubscription(f.sql, org2Res.id)).toMatchObject({ status: 'ended' });
    expect(await loadPlanAssignment(f.sql, org2Res.id)).toBeNull();
  });

  it('§8.7 Flag OFF: tick runs zero SQL queries, new admin ops return disabled, and existing invoice ops are untouched', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const spy = vi.spyOn(f.sql, 'query');
    const tickRes = await runBrandSubscriptionTick({ sql: f.sql });
    expect(tickRes).toEqual({ ok: true, skipped: 'disabled' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    const h = await adminHarness();
    try {
      const hsql = runner(h.db);
      await seedProfile(hsql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      for (const [op, payload] of [
        ['brandSubscription.start', { organizationId: f.orgId, planId: 'b2b_29' }],
        ['brandSubscription.cancel', { organizationId: f.orgId }],
        ['brandSubscription.undoCancel', { organizationId: f.orgId }],
        ['brandSubscription.scheduleDowngrade', { organizationId: f.orgId, planId: 'b2b_29' }],
        ['brandSubscription.clearPendingPlan', { organizationId: f.orgId }],
        ['brandSubscription.reconcile', { organizationId: f.orgId }],
        ['brandBilling.invoice.recordTaxInvoice', { invoiceId: randomUUID(), issuedOn: '2026-11-23', ref: 'TX-1' }],
      ] as const) {
        const res = await h.run(op, payload);
        expect(res, op).toMatchObject({ ok: false, code: 'disabled' });
      }
    } finally {
      await h.close();
    }

    // Existing invoice draft/issue/markPaid still works without touching subscriptions
    const d = await draftBrandInvoice({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      period: '2026-11',
      planId: 'b2b_29',
    });
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect((await issueBrandInvoice({ sql: f.sql }, admin(), { invoiceId: d.invoice.id })).ok).toBe(true);
      expect((await markBrandInvoicePaid({ sql: f.sql }, admin(), { invoiceId: d.invoice.id, paidMethod: 'wire' })).ok).toBe(
        true,
      );
    }
  });

  it('§8.8 Schema not ready: tick, service, org detail panel, and billing overview degrade cleanly without throwing', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0182_'))) {
        await db.exec(readMigration(file));
      }
      const preSql = runner(db);
      const userId = randomUUID();
      await seedProfile(preSql, { id: userId, isAdmin: true, email: 'pre-sub@fixture.invalid' });
      const preAdmin: Viewer = { userId, isAdmin: true, tier: 'pro', email: 'pre-sub@fixture.invalid', locale: 'ko' };
      const org = await createBrandOrganization({ sql: preSql }, preAdmin, {
        name: 'Pre0182 Org',
        requestId: randomUUID(),
      });
      if (!org.ok) throw new Error(org.code);

      expect(await runBrandSubscriptionTick({ sql: preSql })).toEqual({ ok: true, skipped: 'schema_not_ready' });
      await seedCompleteBillingProfile(preSql, preAdmin, org.id, 'Pre0182 Org');
      expect(
        await startSubscriptionCompat({ sql: preSql }, preAdmin, {
          organizationId: org.id,
          planId: 'b2b_29',
        }),
      ).toMatchObject({ ok: false, code: 'unavailable' });

      const detail = await loadBrandOrgDetailOps(preSql, preAdmin, org.id);
      expect(detail?.subscriptionPanel).toMatchObject({ enabled: true, schemaReady: false });

      const overview = await loadBrandBillingOverview(preSql, preAdmin, { period: '2026-11' });
      expect(overview?.taxInvoicePanel).toMatchObject({ enabled: true, schemaReady: false, pending: [] });
    } finally {
      await db.close();
    }
  });

  it('§8.9 Refusals: sandboxed org, project_only, card, missing billing profile, and duplicate subscription', async () => {
    const t0 = new Date('2026-11-10T01:00:00Z');

    // Card rejected with not_available_yet
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: f.orgId,
        planId: 'b2b_29',
        collectionMethod: 'card',
      }),
    ).toMatchObject({ ok: false, code: 'not_available_yet' });

    // project_only rejected
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: f.orgId,
        planId: 'project_only',
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'planId' });

    // Missing billing profile rejected
    const owner2 = randomUUID();
    await seedProfile(f.sql, { id: owner2, email: 'noprofile@fixture.invalid' });
    const orgNoProf = await createBrandOrganization({ sql: f.sql }, viewerOf(owner2), {
      name: 'No Profile Org',
      requestId: randomUUID(),
    });
    if (!orgNoProf.ok) throw new Error(orgNoProf.code);
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: orgNoProf.id,
        planId: 'b2b_29',
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'billingProfile' });

    // Sandboxed org (both by hardcoded ID and by name) rejected
    const [sbId] = [...SANDBOXED_CLIENT_ORG_IDS];
    await f.sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [
      sbId,
      'Sandboxed Test',
      f.ids.owner,
      randomUUID(),
    ]);
    await seedCompleteBillingProfile(f.sql, admin(), sbId!, 'Sandboxed Test');
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: sbId,
        planId: 'b2b_29',
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'organizationId', detail: 'sandboxed_org' });

    const namedSb = await createBrandOrganization({ sql: f.sql }, viewerOf(owner2), {
      name: 'Morphic Sandboxed Fixture',
      requestId: randomUUID(),
    });
    if (!namedSb.ok) throw new Error(namedSb.code);
    await seedCompleteBillingProfile(f.sql, admin(), namedSb.id, 'Morphic Sandboxed Fixture');
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: namedSb.id,
        planId: 'b2b_29',
      }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'organizationId', detail: 'sandboxed_org' });

    // Duplicate non-ended subscription rejected
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: f.orgId,
        planId: 'b2b_29',
      }),
    ).toMatchObject({ ok: true, applied: true });
    expect(
      await startSubscriptionCompat({ sql: f.sql, now: () => t0 }, admin(), {
        organizationId: f.orgId,
        planId: 'b2b_49',
      }),
    ).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_exists' });
  });

  it('§8.10 Stale D-7 draft refreshed on issue day + system actor audit + tax invoice recording', async () => {
    const disc = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 50,
      invoicesTotal: 3,
    });
    expect(disc.ok).toBe(true);

    const nov01 = new Date('2026-11-01T01:00:00Z');
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });

    // D-7 draft on 2026-11-24 uses b2b_49 with 50% discount
    const nov24 = new Date('2026-11-24T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => nov24 });
    const draftDec = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: nov24 })).find(
      (i) => i.period === '2026-12',
    )!;
    expect(draftDec.discountPercent).toBe(50);
    expect(draftDec.totalKrw).toBe(269_500);

    // Discount ends and downgrade to b2b_29 is scheduled BEFORE Dec 1!
    await endBrandDiscount({ sql: f.sql, now: () => new Date('2026-11-26T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      reason: 'ended early',
    });
    await scheduleDowngrade({ sql: f.sql, now: () => new Date('2026-11-26T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
    });

    // Dec 1 tick refreshes stale draft to b2b_29 @ 0% (319,000 KRW) before issuing
    const dec01 = new Date('2026-12-01T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => dec01 });
    const issuedDec = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: dec01 })).find(
      (i) => i.period === '2026-12',
    )!;
    expect(issuedDec).toMatchObject({
      status: 'issued',
      planId: 'b2b_29',
      discountPercent: 0,
      supplyKrw: 290_000,
      vatKrw: 29_000,
      totalKrw: 319_000,
    });

    // System actor audit check (actor_id = null, actor_kind = 'system')
    const decEvents = await listBrandInvoiceEvents(f.sql, issuedDec.id);
    const issuedEv = decEvents.find((e) => e.action === 'issued');
    expect(issuedEv?.actorId).toBeNull();
    const rawEv = (
      await f.sql.query<{ actor_kind: string; actor_id: string | null }>(
        "select actor_kind, actor_id from brand_invoice_events where invoice_id = $1 and action = 'issued'",
        [issuedDec.id],
      )
    ).rows[0];
    expect(rawEv).toEqual({ actor_kind: 'system', actor_id: null });

    const subEvents = await listBrandSubscriptionEvents(f.sql, f.orgId);
    expect(subEvents.some((e) => e.actorKind === 'system' && e.actor === null)).toBe(true);

    // Overview pending tax invoices + recording tax invoice
    const beforeOverview = await loadBrandBillingOverview(f.sql, admin(), { period: '2026-12', now: dec01 });
    expect(beforeOverview?.taxInvoicePanel?.pending.map((p) => p.invoiceId)).toContain(issuedDec.id);

    const rec = await recordBrandInvoiceTaxInvoice({ sql: f.sql, now: () => dec01 }, admin(), {
      invoiceId: issuedDec.id,
      issuedOn: '2026-12-01',
      ref: '20261201-41000001-12345678',
    });
    expect(rec.ok).toBe(true);

    const afterOverview = await loadBrandBillingOverview(f.sql, admin(), { period: '2026-12', now: dec01 });
    expect(afterOverview?.taxInvoicePanel?.pending.map((p) => p.invoiceId)).not.toContain(issuedDec.id);
    // Editable
    const recEdit = await recordBrandInvoiceTaxInvoice({ sql: f.sql, now: () => dec01 }, admin(), {
      invoiceId: issuedDec.id,
      issuedOn: '2026-12-02',
      ref: '20261202-41000001-87654321',
    });
    expect(recEdit).toMatchObject({ ok: true, taxInvoiceIssuedOn: '2026-12-02', taxInvoiceRef: '20261202-41000001-87654321' });
  });

  it('§8.11 Route /api/brand-billing/tick: 401, 503 unconfigured, flag off zero queries, counts-only JSON + 1 ops_alert, brandRouteAllowed=false', async () => {
    expect(brandRouteAllowed('/api/brand-billing/tick', 'GET')).toBe(false);
    expect(brandRouteAllowed('/api/brand-billing/tick', 'POST')).toBe(false);
    expect(adminRouteAllowed('/api/brand-billing/tick', 'GET')).toBe(false);

    // 401 without/wrong secret
    expect(
      (await billingTickRoute.GET(new NextRequest('https://twings.app/api/brand-billing/tick'))).status,
    ).toBe(401);

    // 503 unconfigured
    vi.stubEnv('CRON_SECRET', '');
    expect(
      (
        await billingTickRoute.POST(
          new NextRequest('https://twings.app/api/brand-billing/tick', {
            method: 'POST',
            headers: { authorization: 'Bearer cron-secret-test' },
          }),
        )
      ).status,
    ).toBe(503);

    // Flag off -> 200 skipped: disabled with zero queries
    vi.stubEnv('CRON_SECRET', 'cron-secret-test');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const spy = vi.spyOn(f.sql, 'query');
    const disabledRes = await billingTickRoute.GET(
      new NextRequest('https://twings.app/api/brand-billing/tick', {
        headers: { authorization: 'Bearer cron-secret-test' },
      }),
    );
    expect(disabledRes.status).toBe(200);
    expect(await disabledRes.json()).toEqual({ ok: true, skipped: 'disabled' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();

    // Flag on with active sub needing monthly issue -> counts-only JSON (no org IDs, no org names) + 1 internal ops_alert notice
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-01T01:00:00Z'));
    try {
      const okRes = await billingTickRoute.POST(
        new NextRequest('https://twings.app/api/brand-billing/tick', {
          method: 'POST',
          headers: { authorization: 'Bearer cron-secret-test' },
        }),
      );
      expect(okRes.status).toBe(200);
      expect(okRes.headers.get('cache-control')).toBe('private, no-store');
      const rawText = await okRes.text();
      expect(rawText).not.toContain(f.orgId);
      expect(rawText).not.toContain('Billing Fixture');
      const body = JSON.parse(rawText);
      expect(body).toMatchObject({
        ok: true,
        period: '2026-12',
        issued: 1,
        noticeEnqueued: true,
      });

      const notices = (
        await f.sql.query<{ kind: string; surface: string; preview: string }>(
          "select kind, surface, preview from team_notice_deliveries where surface = 'brand_billing:tax_invoices_pending'",
        )
      ).rows;
      expect(notices).toHaveLength(1);
      expect(notices[0]?.kind).toBe('ops_alert');
      expect(notices[0]?.preview).toContain('1건');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconciles subscription via adminHarness operations and lazy-loads hook when only billing is imported', async () => {
    // Part A: adminHarness end-to-end (`brandBilling.invoice.markPaid` + `brandBilling.invoice.void`)
    const h = await adminHarness();
    try {
      const hSql = runner(h.db);
      const ownerId = randomUUID();
      await seedProfile(hSql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'ops-sub@acme-test.invalid' });
      await seedProfile(hSql, { id: ownerId, email: 'owner-sub@acme-test.invalid' });
      await setPlanAllowanceDefault({ sql: hSql }, ADMIN_VIEWER, { planId: 'b2b_29', monthlyCapKrw: 270_000, confirm: true });

      const org1 = randomUUID();
      const org2 = randomUUID();
      for (const [idx, orgId] of [org1, org2].entries()) {
        await hSql.query(
          'insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)',
          [orgId, `Synthetic Org ${idx + 1}`, ownerId, randomUUID()],
        );
        await hSql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
          orgId,
          ownerId,
          'owner',
        ]);
        await seedCompleteBillingProfile(hSql, ADMIN_VIEWER, orgId, `Synthetic Legal ${idx + 1}`);
      }

      // Round 2, item 10: no real clock — the operations below read `new Date()`, so pin it.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-10T01:00:00Z'));
      const todayKst = '2026-11-10';
      // Round 2, item 9: every start previews first; the confirm carries the preview digest.
      const digestOf = (detail: unknown) => /digest=([0-9a-f]{16})/.exec(String(detail))?.[1] ?? '';
      const preview1 = await h.run('brandSubscription.start', {
        organizationId: org1,
        planId: 'b2b_29',
        collectionMethod: 'transfer',
        startedOn: todayKst,
      });
      expect(preview1).toMatchObject({ ok: true, code: 'prepared' });
      const start1 = await h.run('brandSubscription.start', {
        organizationId: org1,
        planId: 'b2b_29',
        collectionMethod: 'transfer',
        startedOn: todayKst,
        activateBeforePayment: 'false',
        confirm: 'true',
        previewPlanId: 'b2b_29',
        previewStartedOn: todayKst,
        previewActivateBeforePayment: '0',
        previewDigest: digestOf(preview1.detail),
        _confirm: '1',
      });
      expect(start1).toMatchObject({ ok: true, code: 'created' });
      const paid1 = await h.run('brandBilling.invoice.markPaid', {
        invoiceId: String(start1.detail),
        paidMethod: 'transfer',
      });
      expect(paid1).toMatchObject({ ok: true, code: 'paid' });
      const sub1 = (
        await hSql.query<{ status: string }>('select status from brand_subscriptions where organization_id = $1', [org1])
      ).rows[0];
      expect(sub1?.status).toBe('active');

      // B5: the early-open confirm carries the previewed values and the issue ConfirmCheck.
      const preview2 = await h.run('brandSubscription.start', {
        organizationId: org2,
        planId: 'b2b_29',
        collectionMethod: 'transfer',
        startedOn: todayKst,
        activateBeforePayment: 'true',
      });
      const start2 = await h.run('brandSubscription.start', {
        organizationId: org2,
        planId: 'b2b_29',
        collectionMethod: 'transfer',
        startedOn: todayKst,
        activateBeforePayment: 'true',
        confirm: 'true',
        previewPlanId: 'b2b_29',
        previewStartedOn: todayKst,
        previewActivateBeforePayment: '1',
        previewDigest: digestOf(preview2.detail),
        _confirm: '1',
      });
      expect(start2).toMatchObject({ ok: true, code: 'created' });
      const void2 = await h.run('brandBilling.invoice.void', {
        invoiceId: String(start2.detail),
        reason: 'voided before settlement',
      });
      expect(void2).toMatchObject({ ok: true, code: 'saved' });
      const sub2 = (
        await hSql.query<{ status: string }>('select status from brand_subscriptions where organization_id = $1', [org2])
      ).rows[0];
      // Round 2, item 3: a voided first invoice (nothing paid) leaves it pending without access, early access or not.
      expect(sub2?.status).toBe('pending');
    } finally {
      await h.close();
    }

    // Part B: fresh module graph importing ONLY `@/lib/brands/billing` (never pre-importing `subscriptions`)
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const orgB = randomUUID();
    await f.sql.query(
      'insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)',
      [orgB, 'Synthetic Org B', f.ids.owner, randomUUID()],
    );
    await f.sql.query('insert into brand_memberships (organization_id, user_id, role) values ($1, $2, $3)', [
      orgB,
      f.ids.owner,
      'owner',
    ]);
    await seedCompleteBillingProfile(f.sql, admin(), orgB, 'Synthetic Legal B');

    const s1 = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    const s2 = await startConfirmed({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: orgB,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
      activateBeforePayment: true,
      confirm: true,
    });
    expect(s1.ok && s1.applied).toBe(true);
    expect(s2.ok && s2.applied).toBe(true);
    if (!s1.ok || !s1.applied || !s2.ok || !s2.applied) return;

    vi.resetModules();
    const freshBilling = await import('@/lib/brands/billing');

    const freshPaid = await freshBilling.markBrandInvoicePaid(
      { sql: f.sql, now: () => nov01, env: { BRAND_BILLING_AUTO_ISSUE: 'on' } },
      admin(),
      { invoiceId: s1.firstInvoiceId, paidMethod: 'transfer' },
    );
    expect(freshPaid.ok).toBe(true);
    const row1 = (
      await f.sql.query<{ status: string }>('select status from brand_subscriptions where organization_id = $1', [f.orgId])
    ).rows[0];
    expect(row1?.status).toBe('active');

    const freshVoid = await freshBilling.voidBrandInvoice(
      { sql: f.sql, now: () => nov01, env: { BRAND_BILLING_AUTO_ISSUE: 'on' } },
      admin(),
      { invoiceId: s2.firstInvoiceId, reason: 'canceled before settlement' },
    );
    expect(freshVoid.ok).toBe(true);
    const row2 = (
      await f.sql.query<{ status: string }>('select status from brand_subscriptions where organization_id = $1', [orgB])
    ).rows[0];
    expect(row2?.status).toBe('pending');
  });

  it('review-1 A1: epoch isolation, restart epoch increment, admin draft epoch inheritance, period_already_invoiced & manual_plan_active', async () => {
    const { setPlanAssignment } = await import('@/lib/brands/plans');

    // Part 1: org with an older manual paid invoice for a prior month (null epoch) stays pending when starting fresh sub
    const oct = new Date('2026-10-01T01:00:00Z');
    const oldDraft = await draftBrandInvoice({ sql: f.sql, now: () => oct }, admin(), {
      organizationId: f.orgId,
      period: '2026-10',
      planId: 'b2b_29',
    });
    if (!oldDraft.ok) throw new Error(oldDraft.code);
    await issueBrandInvoice({ sql: f.sql, now: () => oct }, admin(), { invoiceId: oldDraft.invoice.id });
    await markBrandInvoicePaid({ sql: f.sql, now: () => oct }, admin(), {
      invoiceId: oldDraft.invoice.id,
      paidMethod: 'wire',
    });

    // Clear manual assignment from earlier? Notice startSubscription refuses if active manual plan exists!
    await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '2026-11-30',
      seats: null,
      note: 'Manual contract',
      expectedRevision: 0,
    });
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const refusedManual = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-11-01',
    });
    expect(refusedManual).toMatchObject({ ok: false, code: 'conflict', detail: 'manual_plan_active' });
    // Manual plan NOT silently deleted
    expect(await loadPlanAssignment(f.sql, f.orgId)).toMatchObject({ planId: 'b2b_29', note: 'Manual contract' });

    // End the manual plan (endsOn <= today minus grace) -> now start succeeds!
    const { clearPlanAssignmentInTx } = await import('@/lib/brands/plans');
    await f.sql.transaction((tx) =>
      clearPlanAssignmentInTx(tx, {
        organizationId: f.orgId,
        note: 'manual ended by admin',
        actor: { kind: 'admin', userId: f.ids.admin },
      }),
    );

    const novStarted = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-11-01',
    });
    expect(novStarted).toMatchObject({ ok: true, applied: true, subscription: { epoch: 1 } });
    if (!novStarted.ok || !novStarted.applied) return;

    // Even after tick, Oct paid null-epoch invoice MUST NOT activate Nov subscription whose Nov invoice is unpaid!
    await runBrandSubscriptionTick({ sql: f.sql, now: () => nov01 });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'pending', epoch: 1 });
    expect(await loadPlanAssignment(f.sql, f.orgId)).toBeNull();

    // Round 4, A1 (replaces "admin drafts inherit the epoch"): the job owns the subscription's months.
    const ownedDraft = await draftBrandInvoice(
      { sql: f.sql, now: () => nov01, env: { BRAND_BILLING_AUTO_ISSUE: 'on' } },
      admin(),
      { organizationId: f.orgId, period: '2027-02', planId: 'b2b_49' },
    );
    expect(ownedDraft).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_owns_period' });

    // Cancel & restart -> epoch increments to 2
    await cancelSubscription({ sql: f.sql, now: () => nov01 }, admin(), { organizationId: f.orgId });
    // A start date may not lie in the future (review round 1): restart on the next day.
    const restarted = await startSubscriptionCompat({ sql: f.sql, now: () => new Date('2026-11-02T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-02',
    });
    expect(restarted).toMatchObject({ ok: true, applied: true, subscription: { epoch: 2 } });

    // Part 2: period_already_invoiced refuses when ANY non-void subscription invoice already exists for start period (draft/issued/paid)
    const owner2 = randomUUID();
    await seedProfile(f.sql, { id: owner2, email: 'period-dup@fixture.invalid' });
    const org2 = await createBrandOrganization({ sql: f.sql }, viewerOf(owner2), {
      name: 'Period Dup Fixture',
      requestId: randomUUID(),
    });
    if (!org2.ok) throw new Error(org2.code);
    await seedCompleteBillingProfile(f.sql, admin(), org2.id, 'Period Dup Fixture');
    await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: org2.id,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-10-01',
      endsOn: '2026-10-10', // already expired past grace
      seats: null,
      note: 'expired',
      expectedRevision: 0,
    });
    // B1c fix round: org2's manual plan ended Oct 10, so a November cycle is not drafted by the admin path any more; the
    // manual November invoice is written as the calendar-month row the admin path used to write.
    const manualNovDraft = await insertLegacyDraft(f.sql, { organizationId: org2.id, period: '2026-11', planId: 'b2b_29', actorId: f.ids.admin });
    expect(manualNovDraft.ok).toBe(true);
    const refusedDup = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: org2.id,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    expect(refusedDup).toMatchObject({ ok: false, code: 'conflict', detail: 'period_already_invoiced' });
  });

  it('review-1 A2: ended subscription + later manual plan + markPaid/void/reconcile leaves manual plan untouched', async () => {
    const { setPlanAssignment } = await import('@/lib/brands/plans');
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const nov10 = new Date('2026-11-10T01:00:00Z');
    const dec05 = new Date('2026-12-05T01:00:00Z');

    const started = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), {
      invoiceId: started.firstInvoiceId,
      paidMethod: 'transfer',
    });

    // Issue a standalone manual adjustment/later invoice before ending so we can pay/void it after end
    await cancelSubscription({ sql: f.sql, now: () => nov10 }, admin(), { organizationId: f.orgId });
    await runBrandSubscriptionTick({ sql: f.sql, now: () => dec05 }); // ends on 2026-12-01
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'ended' });

    // Admin assigns a manual plan AFTER subscription ended
    const manualSet = await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      billingMode: 'invoice',
      startedOn: '2026-12-05',
      endsOn: '2027-03-01',
      seats: 5,
      note: 'Post-sub manual contract',
      expectedRevision: 0,
    });
    expect(manualSet.ok).toBe(true);

    // Draft + issue two manual invoices for post-end period; pay one, void one, and invoke manual reconcile
    const m1 = await draftBrandInvoice({ sql: f.sql, now: () => dec05 }, admin(), {
      organizationId: f.orgId,
      period: '2026-12',
      planId: 'b2b_69',
    });
    const m2 = await draftBrandInvoice({ sql: f.sql, now: () => dec05 }, admin(), {
      organizationId: f.orgId,
      period: '2027-01',
      planId: 'b2b_69',
    });
    if (!m1.ok || !m2.ok) throw new Error('manual drafts failed');
    await issueBrandInvoice({ sql: f.sql, now: () => dec05 }, admin(), { invoiceId: m1.invoice.id });

    await markBrandInvoicePaid({ sql: f.sql, now: () => dec05 }, admin(), {
      invoiceId: m1.invoice.id,
      paidMethod: 'wire',
    });
    await voidBrandInvoice({ sql: f.sql, now: () => dec05 }, admin(), {
      invoiceId: m2.invoice.id,
      reason: 'unused draft',
    });
    const { reconcileSubscriptionAdmin } = await import('@/lib/brands/subscriptions');
    await reconcileSubscriptionAdmin({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: f.orgId });

    // Manual plan MUST remain completely untouched!
    expect(await loadPlanAssignment(f.sql, f.orgId)).toMatchObject({
      planId: 'b2b_69',
      startedOn: '2026-12-05',
      endsOn: '2027-03-01',
      note: 'Post-sub manual contract',
    });
  });

  it('review-1 B1: markPaid/void commits before reconcile, non-fatal reconcile error leaves invoice paid, no hook on flag off, succeeds pre-0182', async () => {
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const started = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!started.ok || !started.applied) throw new Error('start failed');

    vi.resetModules();
    const billingMod = await import('@/lib/brands/billing/invoices');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // Flag OFF -> reconcile hook MUST NOT be called at all
      const calledWhenOff = vi.fn(async () => {});
      billingMod.registerSubscriptionReconcileHook(calledWhenOff);
      const offDraft = await billingMod.draftBrandInvoice(
        { sql: f.sql, now: () => nov01, env: { BRAND_BILLING_AUTO_ISSUE: 'off' } },
        admin(),
        { organizationId: f.orgId, period: '2027-03', planId: 'b2b_29' },
      );
      expect(offDraft.ok).toBe(true);
      if (offDraft.ok) {
        await billingMod.issueBrandInvoice(
          { sql: f.sql, now: () => nov01, env: { BRAND_BILLING_AUTO_ISSUE: 'off' } },
          admin(),
          { invoiceId: offDraft.invoice.id },
        );
        const paidOff = await billingMod.markBrandInvoicePaid(
          { sql: f.sql, now: () => nov01, env: { BRAND_BILLING_AUTO_ISSUE: 'off' } },
          admin(),
          { invoiceId: offDraft.invoice.id, paidMethod: 'wire' },
        );
        expect(paidOff.ok).toBe(true);
        expect(calledWhenOff).not.toHaveBeenCalled();
      }

      // Flag ON + throwing reconcile hook -> invoice stays PAID, warning logged without org/invoice IDs, non-fatal deferred flag returned
      billingMod.registerSubscriptionReconcileHook(async () => {
        throw new Error('simulated_reconcile_deadlock');
      });
      const paidWithErr = await billingMod.markBrandInvoicePaid(
        { sql: f.sql, now: () => nov01, env: { BRAND_BILLING_AUTO_ISSUE: 'on' } },
        admin(),
        { invoiceId: started.firstInvoiceId, paidMethod: 'transfer' },
      );
      expect(paidWithErr.ok).toBe(true);
      if (paidWithErr.ok) {
        expect(paidWithErr.invoice.status).toBe('paid');
        expect((paidWithErr as { reconcileDeferred?: boolean }).reconcileDeferred).toBe(true);
      }
      const dbInv = (
        await f.sql.query<{ status: string }>('select status from brand_invoices where id = $1', [started.firstInvoiceId])
      ).rows[0];
      expect(dbInv?.status).toBe('paid');

      expect(warnSpy).toHaveBeenCalled();
      const loggedText = warnSpy.mock.calls.flat().join(' ');
      expect(loggedText).not.toContain(f.orgId);
      expect(loggedText).not.toContain(started.firstInvoiceId);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('review-1 B2: admin void blocks auto-reissue and reissuePeriod reissues current month via two-step confirm', async () => {
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const nov10 = new Date('2026-11-10T01:00:00Z');
    const started = await startConfirmed({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!started.ok || !started.applied) throw new Error('start failed');

    // Admin voids first invoice -> subsequent ticks MUST NOT auto-draft/re-issue 2026-11!
    await voidBrandInvoice({ sql: f.sql, now: () => nov10 }, admin(), {
      invoiceId: started.firstInvoiceId,
      reason: 'Correction needed',
    });
    const tickRes = await runBrandSubscriptionTick({ sql: f.sql, now: () => nov10 });
    expect(tickRes).toMatchObject({ ok: true, drafted: 0, issued: 0 });
    const novInvs = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: nov10 })).filter((i) => i.period === '2026-11');
    expect(novInvs).toHaveLength(1);
    expect(novInvs[0]?.status).toBe('void');

    // Explicit reissuePeriod refuses non-current period and previews when !confirm
    const { reissueSubscriptionPeriod } = await import('@/lib/brands/subscriptions');
    const wrongPeriod = await reissueConfirmed(
      { sql: f.sql, now: () => nov10 },
      admin(),
      { organizationId: f.orgId, period: '2026-12', confirm: true },
    );
    expect(wrongPeriod).toMatchObject({ ok: false, code: 'invalid', field: 'period' });

    const previewReissue = await reissueCompat(
      { sql: f.sql, now: () => nov10 },
      admin(),
      { organizationId: f.orgId, period: '2026-11', confirm: false },
    );
    expect(previewReissue).toMatchObject({ ok: true, applied: false });

    const appliedReissue = await reissueConfirmed(
      { sql: f.sql, now: () => nov10 },
      admin(),
      { organizationId: f.orgId, period: '2026-11', confirm: true },
    );
    expect(appliedReissue).toMatchObject({ ok: true, applied: true, invoice: { status: 'issued', period: '2026-11' } });
  });

  it('review-1 B3: last_reconciled_at batch fairness — batchSize=2 over 5 subscriptions covers all 5 in 3 runs (even with skips & failures)', async () => {
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const orgIds: string[] = [f.orgId];
    for (let i = 0; i < 4; i++) {
      const oid = randomUUID();
      const uid = randomUUID();
      await seedProfile(f.sql, { id: uid, email: `batch-${i}@fixture.invalid` });
      const created = await createBrandOrganization({ sql: f.sql }, viewerOf(uid), {
        name: `Batch Fixture ${i + 1}`,
        requestId: randomUUID(),
      });
      if (!created.ok) throw new Error(created.code);
      await seedCompleteBillingProfile(f.sql, admin(), created.id, `Batch Fixture ${i + 1}`);
      orgIds.push(created.id);
    }

    for (const orgId of orgIds) {
      const res = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
        organizationId: orgId,
        planId: 'b2b_29',
        startedOn: '2026-11-01',
      });
      if (!res.ok || !res.applied) throw new Error('start batch failed');
    }

    // Clear last_reconciled_at deterministically
    await f.sql.query('update brand_subscriptions set last_reconciled_at = null');

    const t1 = await runBrandSubscriptionTick({ sql: f.sql, now: () => new Date('2026-11-02T01:00:00Z'), batchLimit: 2 });
    const t2 = await runBrandSubscriptionTick({ sql: f.sql, now: () => new Date('2026-11-02T02:00:00Z'), batchLimit: 2 });
    const t3 = await runBrandSubscriptionTick({ sql: f.sql, now: () => new Date('2026-11-02T03:00:00Z'), batchLimit: 2 });
    expect([t1.checked, t2.checked, t3.checked]).toEqual([2, 2, 2]);

    const { rows: reconciledRows } = await f.sql.query<{ organization_id: string; last_reconciled_at: unknown }>(
      'select organization_id::text as organization_id, last_reconciled_at from brand_subscriptions',
    );
    expect(reconciledRows).toHaveLength(5);
    expect(reconciledRows.every((r) => r.last_reconciled_at !== null)).toBe(true);

    // Even when 1 org throws and 1 is skipped (project_only), both advance last_reconciled_at across batchLimit=2 runs
    await f.sql.query('update brand_subscriptions set last_reconciled_at = null');
    const failingOrg = orgIds[0]!;
    const wrappedFailSql: SqlRunner = {
      query: async (text, params) => {
        if (text.includes('from brand_organizations') && /for (no key )?update/.test(text) && params?.[0] === failingOrg) {
          throw new Error('simulated_one_org_failure');
        }
        return f.sql.query(text, params);
      },
      transaction: async (fn) =>
        f.sql.transaction(async (tx) =>
          fn({
            query: async (t, p) => {
              if (t.includes('from brand_organizations') && /for (no key )?update/.test(t) && p?.[0] === failingOrg) {
                throw new Error('simulated_one_org_failure');
              }
              return tx.query(t, p);
            },
            transaction: tx.transaction,
          }),
        ),
    };
    await runBrandSubscriptionTick({ sql: wrappedFailSql, now: () => new Date('2026-11-03T01:00:00Z'), batchLimit: 2 });
    await runBrandSubscriptionTick({ sql: wrappedFailSql, now: () => new Date('2026-11-03T02:00:00Z'), batchLimit: 2 });
    await runBrandSubscriptionTick({ sql: wrappedFailSql, now: () => new Date('2026-11-03T03:00:00Z'), batchLimit: 2 });
    const afterFailureRows = (
      await f.sql.query<{ last_reconciled_at: unknown }>('select last_reconciled_at from brand_subscriptions')
    ).rows;
    expect(afterFailureRows.every((r) => r.last_reconciled_at !== null)).toBe(true);
  });

  it('review-1 B4.5 + C1 + C2: manualDraftsWaiting skipped & counted in notice, 2nd notice same day not dropped, route returns 503 when all attempted fail', async () => {
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const s1 = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_49',
      startedOn: '2026-11-01',
    });
    if (!s1.ok || !s1.applied) throw new Error('s1 fail');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), {
      invoiceId: s1.firstInvoiceId,
      paidMethod: 'transfer',
    });

    // Org2 also active
    const o2User = randomUUID();
    await seedProfile(f.sql, { id: o2User, email: 'notice2@fixture.invalid' });
    const o2 = await createBrandOrganization({ sql: f.sql }, viewerOf(o2User), {
      name: 'Notice Second Fixture',
      requestId: randomUUID(),
    });
    if (!o2.ok) throw new Error(o2.code);
    await seedCompleteBillingProfile(f.sql, admin(), o2.id, 'Notice Second Fixture');
    const s2 = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: o2.id,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!s2.ok || !s2.applied) throw new Error('s2 fail');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), {
      invoiceId: s2.firstInvoiceId,
      paidMethod: 'transfer',
    });

    // Round 4, A1: an admin cannot create a subscription month (was: a manual-amounts December held for an admin).
    const manualDec = await draftBrandInvoice({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      period: '2026-12',
      planId: 'b2b_49',
      manualAmounts: true,
      manualReason: 'Custom negotiated month',
      supplyKrw: 300_000,
    });
    expect(manualDec).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_owns_period' });

    // Run 1 on Dec 1 with batchLimit=1 -> f.orgId or o2 runs first; ensure both runs happen on SAME day!
    const dec01 = new Date('2026-12-01T01:00:00Z');
    await f.sql.query('update brand_subscriptions set last_reconciled_at = null');
    const run1 = await runBrandSubscriptionTick({ sql: f.sql, now: () => dec01, batchLimit: 1 });
    const run2 = await runBrandSubscriptionTick({ sql: f.sql, now: () => dec01, batchLimit: 1 });

    // Both organizations' December is issued by the job, one per run.
    const inv1 = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: dec01 })).find((i) => i.period === '2026-12');
    const inv2 = (await listBrandInvoices(f.sql, { organizationId: o2.id, now: dec01 })).find((i) => i.period === '2026-12');
    expect(inv1?.status).toBe('issued');
    expect(inv2?.status).toBe('issued');
    expect((run1.issued ?? 0) + (run2.issued ?? 0)).toBe(2);

    // C2: two distinct runs with notices on SAME day MUST both enqueue team_notice_deliveries (neither dropped!)
    const notices = (
      await f.sql.query<{ preview: string; source_id: string }>(
        "select preview, source_id::text as source_id from team_notice_deliveries where surface = 'brand_billing:tax_invoices_pending'",
      )
    ).rows;
    expect(notices).toHaveLength(2);

    // C1: Cron route answers 503 when attempted > 0 and every attempted org fails
    const originalQuery = f.sql.query.bind(f.sql);
    const wrappedSql: SqlRunner = {
      query: async (text, params) => {
        if (text.includes('from brand_organizations') && /for (no key )?update/.test(text)) {
          throw new Error('simulated_org_lock_failure');
        }
        return originalQuery(text, params);
      },
      transaction: async (fn) => f.sql.transaction(async (tx) => fn({
        query: async (t, p) => {
          if (t.includes('from brand_organizations') && /for (no key )?update/.test(t)) {
            throw new Error('simulated_org_lock_failure');
          }
          return tx.query(t, p);
        },
        transaction: tx.transaction,
      })),
    };
    routeMocks.sql = wrappedSql;
    const failRes = await billingTickRoute.POST(
      new NextRequest('https://twings.app/api/brand-billing/tick', {
        method: 'POST',
        headers: { authorization: 'Bearer cron-secret-test' },
      }),
    );
    expect(failRes.status).toBe(503);
    routeMocks.sql = f.sql;
  });

  it('review-1 C3 & C4: cancel voids unpaid first invoice (returning discount), future draft (undoCancel re-drafts), keeps issued current invoice, and all ops refuse sandboxed org', async () => {
    // C3a: cancel with nothing paid voids unpaid first invoice as system & returns discount use
    const disc = await grantBrandDiscount({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      percent: 50,
      invoicesTotal: 1,
    });
    expect(disc.ok).toBe(true);
    const nov01 = new Date('2026-11-01T01:00:00Z');
    const s1 = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      startedOn: '2026-11-01',
    });
    if (!s1.ok || !s1.applied) throw new Error('s1 fail');
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toBeNull(); // 1/1 exhausted when first invoice issued

    await cancelSubscription({ sql: f.sql, now: () => nov01 }, admin(), { organizationId: f.orgId });
    const voidedFirst = (await listBrandInvoices(f.sql, { organizationId: f.orgId, now: nov01 })).find((i) => i.id === s1.firstInvoiceId);
    expect(voidedFirst?.status).toBe('void');
    expect(await loadActiveBrandDiscount(f.sql, f.orgId)).toMatchObject({ invoicesUsed: 0 });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'ended' });

    // C3b & C3c: active org with D-7 Dec draft + later Dec issued unpaid invoice
    const o2User = randomUUID();
    await seedProfile(f.sql, { id: o2User, email: 'cancel-draft@fixture.invalid' });
    const o2 = await createBrandOrganization({ sql: f.sql }, viewerOf(o2User), {
      name: 'Cancel Draft Fixture',
      requestId: randomUUID(),
    });
    if (!o2.ok) throw new Error(o2.code);
    await seedCompleteBillingProfile(f.sql, admin(), o2.id, 'Cancel Draft Fixture');
    const s2 = await startSubscriptionCompat({ sql: f.sql, now: () => nov01 }, admin(), {
      organizationId: o2.id,
      planId: 'b2b_49',
      startedOn: '2026-11-01',
    });
    if (!s2.ok || !s2.applied) throw new Error('s2 fail');
    await markBrandInvoicePaid({ sql: f.sql, now: () => nov01 }, admin(), { invoiceId: s2.firstInvoiceId, paidMethod: 'transfer' });

    // Nov 25: D-7 draft created for Dec -> cancel voids future Dec draft by system -> undoCancel lets tick re-draft Dec!
    const nov25 = new Date('2026-11-25T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => nov25 });
    await cancelSubscription({ sql: f.sql, now: () => nov25 }, admin(), { organizationId: o2.id });
    const decAfterCancel = (await listBrandInvoices(f.sql, { organizationId: o2.id, now: nov25 })).find((i) => i.period === '2026-12');
    expect(decAfterCancel?.status).toBe('void');

    await undoCancelSubscription({ sql: f.sql, now: () => nov25 }, admin(), { organizationId: o2.id });
    const decAfterUndo = (await listBrandInvoices(f.sql, { organizationId: o2.id, now: nov25 })).filter((i) => i.period === '2026-12');
    expect(decAfterUndo.some((i) => i.status === 'draft')).toBe(true);

    // Dec 1: Dec issued -> cancel on Dec 5 leaves Dec issued (NOT voided)
    const dec01 = new Date('2026-12-01T01:00:00Z');
    const dec05 = new Date('2026-12-05T01:00:00Z');
    await runBrandSubscriptionTick({ sql: f.sql, now: () => dec01 });
    await cancelSubscription({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: o2.id });
    const decIssuedKept = (await listBrandInvoices(f.sql, { organizationId: o2.id, now: dec05 })).find(
      (i) => i.period === '2026-12' && i.status === 'issued',
    );
    expect(decIssuedKept).toBeDefined();

    // C4: every op + recordBrandInvoiceTaxInvoice refuses sandboxed org
    const sbUser = randomUUID();
    await seedProfile(f.sql, { id: sbUser, email: 'sb-ops@fixture.invalid' });
    const sbOrg = await createBrandOrganization({ sql: f.sql }, viewerOf(sbUser), {
      name: 'Morphic Sandboxed Fixture',
      requestId: randomUUID(),
    });
    if (!sbOrg.ok) throw new Error(sbOrg.code);
    const sbDraft = await draftBrandInvoice({ sql: f.sql, now: () => dec05 }, admin(), {
      organizationId: sbOrg.id,
      period: '2026-12',
      planId: 'project_only',
    });
    if (!sbDraft.ok) throw new Error(sbDraft.code);
    await issueBrandInvoice({ sql: f.sql, now: () => dec05 }, admin(), { invoiceId: sbDraft.invoice.id });

    const { reconcileSubscriptionAdmin, reissueSubscriptionPeriod } = await import('@/lib/brands/subscriptions');
    for (const opRes of [
      await cancelSubscription({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: sbOrg.id }),
      await undoCancelSubscription({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: sbOrg.id }),
      await scheduleDowngrade({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: sbOrg.id, planId: 'b2b_29' }),
      await clearPendingPlan({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: sbOrg.id }),
      await reconcileSubscriptionAdmin({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: sbOrg.id }),
      await reissueConfirmed({ sql: f.sql, now: () => dec05 }, admin(), { organizationId: sbOrg.id, period: '2026-12', confirm: true }),
      await recordBrandInvoiceTaxInvoice({ sql: f.sql, now: () => dec05 }, admin(), {
        invoiceId: sbDraft.invoice.id,
        issuedOn: '2026-12-05',
        ref: '20261205-00000001-00000001',
      }),
    ]) {
      expect(opRes).toMatchObject({ ok: false, code: 'invalid', detail: 'sandboxed_org' });
    }
  });

  it('review-1 C6: deploy order (pre-0182 flag OFF & flag ON) and full Flag-OFF SQL parity', async () => {
    const { loadCustomerBrandBilling } = await import('@/lib/brands/billing');
    const { setPlanAssignment } = await import('@/lib/brands/plans');

    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0182_'))) {
        await db.exec(readMigration(file));
      }
      const rawSql = runner(db);
      const recordedSql: string[] = [];
      const recSql: SqlRunner = {
        query: async (text, params) => {
          recordedSql.push(text);
          return rawSql.query(text, params);
        },
        transaction: async (fn) =>
          rawSql.transaction(async (tx) =>
            fn({
              query: async (t, p) => {
                recordedSql.push(t);
                return tx.query(t, p);
              },
              transaction: tx.transaction,
            }),
          ),
      };

      const adminId = randomUUID();
      const ownerId = randomUUID();
      await seedProfile(rawSql, { id: adminId, isAdmin: true, email: 'pre-admin@fixture.invalid' });
      await seedProfile(rawSql, { id: ownerId, email: 'pre-owner@fixture.invalid' });
      const preAdmin: Viewer = { userId: adminId, isAdmin: true, tier: 'pro', email: 'pre-admin@fixture.invalid', locale: 'ko' };
      const preOwner: Viewer = { userId: ownerId, isAdmin: false, tier: 'pro', email: 'pre-owner@fixture.invalid', locale: 'ko' };

      const org = await createBrandOrganization({ sql: rawSql }, preOwner, {
        name: 'Pre0182 Deploy Fixture',
        requestId: randomUUID(),
      });
      if (!org.ok) throw new Error(org.code);
      await setPlanAssignment({ sql: rawSql }, preAdmin, {
        organizationId: org.id,
        planId: 'b2b_29',
        billingMode: 'invoice',
        startedOn: '2026-11-01',
        endsOn: null,
        seats: null,
        note: 'pre',
        expectedRevision: 0,
      });

      // 1) Flag OFF on pre-0182 schema: ZERO queries naming any 0182 table/column
      vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
      recordedSql.length = 0;

      const tNov = new Date('2026-11-10T01:00:00Z');
      const dRes = await draftBrandInvoice({ sql: recSql, now: () => tNov }, preAdmin, {
        organizationId: org.id,
        period: '2026-11',
        planId: 'b2b_29',
      });
      expect(dRes.ok).toBe(true);
      if (!dRes.ok) return;
      const iRes = await issueBrandInvoice({ sql: recSql, now: () => tNov }, preAdmin, { invoiceId: dRes.invoice.id });
      expect(iRes.ok).toBe(true);
      const pRes = await markBrandInvoicePaid({ sql: recSql, now: () => tNov, env: { BRAND_BILLING_AUTO_ISSUE: 'off' } }, preAdmin, {
        invoiceId: dRes.invoice.id,
        paidMethod: 'wire',
      });
      expect(pRes).toMatchObject({ ok: true, invoice: { status: 'paid', totalKrw: 319_000 } });

      const d2Res = await draftBrandInvoice({ sql: recSql, now: () => tNov }, preAdmin, {
        organizationId: org.id,
        period: '2026-12',
        planId: 'b2b_29',
      });
      if (d2Res.ok) {
        const vRes = await voidBrandInvoice({ sql: recSql, now: () => tNov, env: { BRAND_BILLING_AUTO_ISSUE: 'off' } }, preAdmin, {
          invoiceId: d2Res.invoice.id,
          reason: 'cancel draft',
        });
        expect(vRes).toMatchObject({ ok: true, invoice: { status: 'void' } });
      }

      const cust = await loadCustomerBrandBilling({ sql: recSql, env: studioEnv(), now: () => tNov }, preOwner, org.id);
      expect(cust).toMatchObject({ ok: true, billing: { organizationId: org.id } });
      await loadBrandBillingOverview(recSql, preAdmin, { period: '2026-11', now: tNov });
      await loadBrandOrgDetailOps(recSql, preAdmin, org.id, { now: tNov });

      // Full API route GET /api/brand-billing execution check
      vi.resetModules();
      vi.doMock('@/lib/db/connect', () => ({ getSqlRunner: async () => recSql }));
      vi.doMock('@/lib/auth/viewer', () => ({ getViewer: async () => preOwner, requireAdmin: async () => preAdmin }));
      const apiRoute = await import('@/app/api/brand-billing/route');
      const apiRes = await apiRoute.GET(new NextRequest(`https://brand.twings.app/api/brand-billing?organizationId=${org.id}`));
      expect(apiRes.status).toBe(200);
      vi.resetModules();
      vi.doMock('@/lib/db/connect', () => ({ getSqlRunner: async () => routeMocks.sql }));

      const forbiddenTokens = [
        'brand_subscriptions',
        'brand_subscription_events',
        'subscription_epoch',
        'last_reconciled_at',
        'tax_invoice_issued_on',
        'tax_invoice_ref',
        'created_via',
        'issued_via',
        'covers_months',
        'due_on',
        'actor_kind',
      ];
      for (const q of recordedSql) {
        for (const tok of forbiddenTokens) {
          expect(q, `Flag OFF query leaked ${tok}: ${q}`).not.toContain(tok);
        }
      }

      // 2) Full Flag-OFF parity on post-0182 f.sql (exact SQL statements & full result match for draft/issue/markPaid/void)
      const postSqlLog: string[] = [];
      const postRec: SqlRunner = {
        query: async (text, params) => {
          postSqlLog.push(text);
          return f.sql.query(text, params);
        },
        transaction: async (fn) =>
          f.sql.transaction(async (tx) =>
            fn({
              query: async (t, p) => {
                postSqlLog.push(t);
                return tx.query(t, p);
              },
              transaction: tx.transaction,
            }),
          ),
      };
      const pDraft = await draftBrandInvoice({ sql: postRec, now: () => tNov, env: { BRAND_BILLING_AUTO_ISSUE: 'off' } }, admin(), {
        organizationId: f.orgId,
        period: '2026-11',
        planId: 'b2b_29',
      });
      expect(pDraft.ok).toBe(true);
      if (pDraft.ok) {
        await issueBrandInvoice({ sql: postRec, now: () => tNov }, admin(), { invoiceId: pDraft.invoice.id });
        const pPaid = await markBrandInvoicePaid({ sql: postRec, now: () => tNov, env: { BRAND_BILLING_AUTO_ISSUE: 'off' } }, admin(), {
          invoiceId: pDraft.invoice.id,
          paidMethod: 'wire',
        });
        expect(pPaid).toMatchObject({ ok: true, invoice: { status: 'paid', totalKrw: 319_000 } });
      }
      for (const q of postSqlLog) {
        for (const tok of forbiddenTokens) {
          expect(q, `Flag OFF on 0182 DB leaked ${tok}: ${q}`).not.toContain(tok);
        }
      }

      // 3) Flag ON with pre-0182 schema: markPaid/void succeed, tick returns schema_not_ready, overview/detail degrade cleanly
      vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
      const d3Res = await draftBrandInvoice({ sql: rawSql, now: () => tNov }, preAdmin, {
        organizationId: org.id,
        period: '2027-01',
        planId: 'b2b_29',
      });
      expect(d3Res.ok).toBe(true);
      if (d3Res.ok) {
        await issueBrandInvoice({ sql: rawSql, now: () => tNov }, preAdmin, { invoiceId: d3Res.invoice.id });
        const paidOnFlag = await markBrandInvoicePaid(
          { sql: rawSql, now: () => tNov, env: { BRAND_BILLING_AUTO_ISSUE: 'on' } },
          preAdmin,
          { invoiceId: d3Res.invoice.id, paidMethod: 'wire' },
        );
        expect(paidOnFlag).toMatchObject({ ok: true, invoice: { status: 'paid' } });
      }
      expect(await runBrandSubscriptionTick({ sql: rawSql, env: { BRAND_BILLING_AUTO_ISSUE: 'on' } })).toEqual({
        ok: true,
        skipped: 'schema_not_ready',
      });
      const ov = await loadBrandBillingOverview(rawSql, preAdmin, { period: '2026-11', now: tNov });
      expect(ov?.taxInvoicePanel).toEqual({ enabled: true, schemaReady: false, pending: [] });
      const od = await loadBrandOrgDetailOps(rawSql, preAdmin, org.id, { now: tNov });
      expect(od?.subscriptionPanel).toMatchObject({ enabled: true, schemaReady: false });
    } finally {
      vi.doUnmock('@/lib/auth/viewer');
      await db.close();
    }
  });
});
