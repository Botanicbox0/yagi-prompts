import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import {
  draftBrandInvoice,
  draftBrandInvoiceInTx,
  issueBrandInvoice,
  listBrandInvoices,
  markBrandInvoicePaid,
  recordBrandInvoiceTaxInvoice,
  saveBrandBillingProfileAdmin,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { loadPlanAssignment } from '@/lib/brands/plans';
import {
  cancelSubscription,
  loadBrandSubscription,
  reconcileSubscriptionAdmin,
  reissueSubscriptionPeriod,
  runBrandSubscriptionTick,
  scheduleDowngrade,
  startSubscription,
} from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { reissueConfirmed, startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { addCalendarDays as addDays } from '@/lib/brands/billing/math';
import { runner } from '@/tests/helpers/pglite';

/** B1c-2 (notes: B1c2-brief.md): the subscription engine on plan-start-day cycles, rule by rule on the real service. */

const ssrMocks = vi.hoisted(() => ({ sql: null as SqlRunner | null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/admin/brand-workspace',
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to });
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/auth/viewer', () => ({
  requireAdmin: async () => ADMIN_VIEWER,
  getViewer: async () => ADMIN_VIEWER,
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => ssrMocks.sql }));
vi.mock('@/lib/i18n/server', () => ({ getLocaleFromHeaders: async () => 'ko' }));
vi.mock('@/lib/routing/request-surface', () => ({
  requestSurface: async () => ({ admin: true, brand: false, workspace: true, origin: 'https://admin.twings.app' }),
  publicHref: (p: string) => `https://twings.app${p}`,
}));

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

async function startUnpaid(organizationId: string, startedOn: string, extra: Record<string, unknown> = {}) {
  const s = await startConfirmed({ sql, now: at(`${startedOn}T01:00:00Z`) }, ADMIN_VIEWER, { organizationId, planId: 'b2b_69', startedOn, ...extra });
  if (!s.ok || !s.applied) throw new Error('start failed');
  return s;
}

async function startPaid(organizationId: string, startedOn = '2026-11-01') {
  const s = await startUnpaid(organizationId, startedOn);
  const paid = await markBrandInvoicePaid({ sql, now: at(`${startedOn}T02:00:00Z`) }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
  expect(paid.ok).toBe(true);
  return s;
}

async function invoiceRow(id: string) {
  return (
    await sql.query<{
      status: string;
      period: string;
      plan_id: string;
      due_on: string | null;
      subscription_epoch: number | null;
      void_reason: string;
      prorated_days: number | null;
      base_list_krw: number;
      memo: string;
      issued_via: string | null;
    }>(
      `select status, period, plan_id, due_on::text as due_on, subscription_epoch, void_reason, prorated_days,
              base_list_krw, memo, issued_via
         from brand_invoices where id = $1`,
      [id],
    )
  ).rows[0]!;
}

async function invoiceOf(organizationId: string, period: string) {
  const list = await listBrandInvoices(sql, { organizationId });
  return list.filter((i) => i.period === period && i.status !== 'void');
}

async function notices(surface?: string) {
  return (
    await sql.query<{ preview: string; surface: string }>(
      `select preview, surface from team_notice_deliveries where kind = 'ops_alert' ${surface ? 'and surface = $1' : ''} order by created_at, id`,
      surface ? [surface] : [],
    )
  ).rows;
}

async function failDraftInserts(on: boolean) {
  if (on) {
    await sql.query(`create or replace function test_fail_draft_insert() returns trigger language plpgsql as $$
      begin
        if new.status = 'draft' then raise exception 'forced draft failure' using errcode = '23514'; end if;
        return new;
      end $$`);
    await sql.query('create trigger test_fail_draft_insert before insert on brand_invoices for each row execute function test_fail_draft_insert()');
  } else {
    await sql.query('drop trigger if exists test_fail_draft_insert on brand_invoices');
  }
}

async function renderOrg(id: string, searchParams: Record<string, string> = {}): Promise<string> {
  const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
  return new Response(
    (
      await prerender(await OrgDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) }), {
        signal: AbortSignal.timeout(5000),
      })
    ).prelude,
  ).text();
}

beforeEach(async () => {
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  h = await adminHarness();
  sql = runner(h.db);
  ssrMocks.sql = sql;
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await h.close();
});

async function inv(id: string) {
  return (
    await sql.query<{ status: string; cycle_start: string | null; cycle_end: string | null; due_on: string | null; prorated_days: number | null; plan_id: string; void_reason: string; base_list_krw: number }>(
      `select status, cycle_start::text as cycle_start, cycle_end::text as cycle_end, due_on::text as due_on, prorated_days, plan_id, void_reason, base_list_krw
         from brand_invoices where id = $1`,
      [id],
    )
  ).rows[0]!;
}

async function cycleInvoices(orgId: string) {
  return (
    await sql.query<{ id: string; status: string; cycle_start: string | null; cycle_end: string | null; due_on: string | null; prorated_days: number | null; plan_id: string }>(
      `select id::text as id, status, cycle_start::text as cycle_start, cycle_end::text as cycle_end, due_on::text as due_on, prorated_days, plan_id
         from brand_invoices where organization_id = $1 and kind = 'subscription' order by created_at, id`,
      [orgId],
    )
  ).rows;
}

const tick = (iso: string) => runBrandSubscriptionTick({ sql, now: at(iso) });

/** A subscription whose first payment (paid date `paidOn`) starts cycle 0 on that day. */
async function paidFrom(orgId: string, paidOn: string, startedOn = paidOn) {
  const s = await startUnpaid(orgId, startedOn);
  const paid = await markBrandInvoicePaid({ sql, now: at(`${paidOn}T03:00:00Z`) }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: paidOn });
  expect(paid.ok).toBe(true);
  return s;
}

describe('B1c-2 — billing cycles from the plan start day (real service)', () => {
  it('rule 4: the first invoice has no cycle and no access; a late-recorded payment starts cycle 0 on the paid date', async () => {
    const orgId = await makeOrg('First Payment Fixture');
    const s = await startUnpaid(orgId, '2026-11-10');
    expect(await inv(s.firstInvoiceId)).toMatchObject({ status: 'issued', cycle_start: null, due_on: '2026-11-24', prorated_days: null });
    expect(await loadPlanAssignment(sql, orgId)).toBeNull();
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'pending' });
    await tick('2026-11-25T01:00:00Z');
    expect(await loadPlanAssignment(sql, orgId)).toBeNull();
    await markBrandInvoicePaid({ sql, now: at('2026-11-27T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-11-20' });
    expect(await inv(s.firstInvoiceId)).toMatchObject({ status: 'paid', cycle_start: '2026-11-20', cycle_end: '2026-12-20' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2026-11-20', endsOn: '2026-12-20' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active' });
  });

  it('rule 4: unpaid past due + 14 → system void; the reissue is a new first invoice without a cycle, due today + 14', async () => {
    const orgId = await makeOrg('First Expiry Fixture');
    const s = await startUnpaid(orgId, '2026-11-10');
    await tick('2026-12-08T01:00:00Z');
    expect(await inv(s.firstInvoiceId)).toMatchObject({ status: 'issued' });
    await tick('2026-12-09T01:00:00Z');
    expect(await inv(s.firstInvoiceId)).toMatchObject({ status: 'void', void_reason: 'first_invoice_expired' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'pending' });
    const re = await reissueConfirmed({ sql, now: at('2026-12-09T02:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-12' });
    if (!re.ok || !re.applied) throw new Error('reissue failed');
    expect(await inv(re.invoice.id)).toMatchObject({ status: 'issued', cycle_start: null, due_on: '2026-12-23', prorated_days: null });
  });

  it('rule 5: early access starts cycle 0 on the start day with access at once; no expiry', async () => {
    const orgId = await makeOrg('Early Cycle Fixture');
    const s = await startConfirmed({ sql, now: at('2026-11-10T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-10',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    expect(await inv(s.firstInvoiceId)).toMatchObject({ cycle_start: '2026-11-10', cycle_end: '2026-12-10', due_on: '2026-11-24' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2026-11-10', endsOn: '2026-11-24' });
    await tick('2026-12-20T01:00:00Z');
    expect(await inv(s.firstInvoiceId)).toMatchObject({ status: 'issued' });
    await markBrandInvoicePaid({ sql, now: at('2026-12-21T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-12-21' });
    expect(await inv(s.firstInvoiceId)).toMatchObject({ status: 'paid', cycle_start: '2026-11-10' });
  });

  for (const [anchor, draftDay, boundary, nextEnd] of [
    ['2027-01-17', '2027-02-10', '2027-02-17', '2027-03-17'],
    ['2027-01-31', '2027-02-21', '2027-02-28', '2027-03-31'],
  ] as const) {
    it(`rule 6: anchor ${anchor} — the next cycle is drafted on ${draftDay} and issued on ${boundary} (full price, due + 14)`, async () => {
      const orgId = await makeOrg(`Boundary ${anchor} Fixture`);
      await paidFrom(orgId, anchor);
      await tick(`${addDays(draftDay, -1)}T01:00:00Z`);
      expect((await cycleInvoices(orgId)).filter((i) => i.cycle_start === boundary)).toEqual([]);
      await tick(`${draftDay}T01:00:00Z`);
      const [draft] = (await cycleInvoices(orgId)).filter((i) => i.cycle_start === boundary);
      expect(draft).toMatchObject({ status: 'draft', cycle_end: nextEnd, prorated_days: null });
      await tick(`${boundary}T01:00:00Z`);
      expect(await inv(draft!.id)).toMatchObject({ status: 'issued', due_on: addDays(boundary, 14), base_list_krw: 690_000 });
      expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: anchor, endsOn: addDays(boundary, 14) });
    });
  }

  it('rule 6: past_due on the boundary → the cycle is issued; suspended on the boundary → nothing, on any day while suspended', async () => {
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '30');
    const a = await makeOrg('Past Due Boundary Fixture');
    await paidFrom(a, '2027-01-17');
    for (const d of ['2027-02-10', '2027-02-17', '2027-03-10']) await tick(`${d}T01:00:00Z`);
    expect(await loadBrandSubscription(sql, a)).toMatchObject({ status: 'past_due' });
    await tick('2027-03-17T01:00:00Z');
    expect((await cycleInvoices(a)).find((i) => i.cycle_start === '2027-03-17')).toMatchObject({ status: 'issued', due_on: '2027-03-31' });

    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '7');
    const b = await makeOrg('Suspended Boundary Fixture');
    await paidFrom(b, '2027-01-17');
    for (const d of ['2027-02-10', '2027-02-17', '2027-03-11']) await tick(`${d}T01:00:00Z`);
    expect(await loadBrandSubscription(sql, b)).toMatchObject({ status: 'suspended' });
    for (const d of ['2027-03-12', '2027-03-17', '2027-03-24']) {
      await tick(`${d}T01:00:00Z`);
      expect((await cycleInvoices(b)).filter((i) => (i.cycle_start ?? '') >= '2027-03-17' && i.status !== 'void'), d).toEqual([]);
    }
  });

  it('rule 8: paying while suspended starts a NEW cycle on the paid date with a full-price invoice; the gap is never billed', async () => {
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '7');
    const orgId = await makeOrg('Resume Restart Fixture');
    await paidFrom(orgId, '2027-01-17');
    for (const d of ['2027-02-10', '2027-02-17', '2027-03-04', '2027-03-17']) await tick(`${d}T01:00:00Z`);
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'suspended' });
    const feb = (await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17')!;
    await markBrandInvoicePaid({ sql, now: at('2027-03-25T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: feb.id, paidMethod: 'transfer', paidAt: '2027-03-25' });
    const live = (await cycleInvoices(orgId)).filter((i) => i.status !== 'void');
    const restart = live.find((i) => i.cycle_start === '2027-03-25');
    expect(restart).toMatchObject({ status: 'issued', cycle_end: '2027-04-25', due_on: '2027-04-08', prorated_days: null });
    expect(live.some((i) => i.cycle_start === '2027-03-17')).toBe(false);
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-03-25', endsOn: '2027-04-08' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active' });
  });

  it('rule 8: paying while only past_due keeps the cycle and the anchor', async () => {
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
    const orgId = await makeOrg('Past Due Pay Fixture');
    await paidFrom(orgId, '2027-01-17');
    for (const d of ['2027-02-10', '2027-02-17', '2027-03-05']) await tick(`${d}T01:00:00Z`);
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'past_due' });
    const feb = (await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17')!;
    await markBrandInvoicePaid({ sql, now: at('2027-03-06T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: feb.id, paidMethod: 'transfer', paidAt: '2027-03-06' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ startedOn: '2027-01-17', endsOn: '2027-03-17' });
    await tick('2027-03-17T01:00:00Z');
    expect((await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-03-17')).toMatchObject({ status: 'issued' });
  });

  it('rule 9: an admin void of an issued cycle after a paid one waives it; the reissue keeps the cycle dates and the due date', async () => {
    const orgId = await makeOrg('Waive Cycle Fixture');
    await paidFrom(orgId, '2027-01-17');
    await tick('2027-02-17T01:00:00Z');
    const feb = (await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17')!;
    expect(feb).toMatchObject({ status: 'issued', due_on: '2027-03-03' });
    await voidBrandInvoice({ sql, now: at('2027-02-20T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: feb.id, reason: 'goodwill' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2027-03-17' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active' });
    const re = await reissueConfirmed({ sql, now: at('2027-02-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2027-02' });
    if (!re.ok || !re.applied) throw new Error('reissue failed');
    expect(await inv(re.invoice.id)).toMatchObject({ cycle_start: '2027-02-17', cycle_end: '2027-03-17', due_on: '2027-03-03', prorated_days: null });
    // Voiding a DRAFT waives nothing: the job drafts the next cycle again.
    await tick('2027-03-10T01:00:00Z');
    const mar = (await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-03-17' && i.status === 'draft')!;
    await voidBrandInvoice({ sql, now: at('2027-03-11T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: mar.id, reason: 'redo' });
    await tick('2027-03-11T02:00:00Z');
    expect((await cycleInvoices(orgId)).filter((i) => i.cycle_start === '2027-03-17' && i.status === 'draft')).toHaveLength(1);
  });

  it('rule 10: a downgrade applies to the first cycle that starts after it was scheduled', async () => {
    const orgId = await makeOrg('Downgrade Cycle Fixture');
    await paidFrom(orgId, '2027-01-17');
    expect(await scheduleDowngrade({ sql, now: at('2027-01-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' })).toMatchObject({
      ok: true,
      subscription: { pendingPlanEffectivePeriod: '2027-02' },
    });
    await tick('2027-02-10T01:00:00Z');
    expect((await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17')).toMatchObject({ status: 'draft', plan_id: 'b2b_29' });
    await tick('2027-02-16T01:00:00Z');
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_69' });
    await tick('2027-02-17T01:00:00Z');
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_29', pendingPlanId: null });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29' });
  });

  it('rule 10: scheduled before the next cycle starts in the same month, the downgrade applies from that cycle (not the next month)', async () => {
    const orgId = await makeOrg('Downgrade Same Month Fixture');
    await paidFrom(orgId, '2026-12-20');
    expect(await scheduleDowngrade({ sql, now: at('2027-01-05T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' })).toMatchObject({
      ok: true,
      subscription: { pendingPlanEffectivePeriod: '2027-01' },
    });
    await tick('2027-01-13T01:00:00Z');
    expect((await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-01-20')).toMatchObject({ status: 'draft', plan_id: 'b2b_29' });
  });

  it('pre-0186: with the flag on and no cycle columns the job does nothing (schema not ready)', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { coreMigrationFiles, readMigration } = await import('@/lib/db/migrations');
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => !m.startsWith('0186_'))) await db.exec(readMigration(file));
      const old = runner(db);
      expect(await runBrandSubscriptionTick({ sql: old, now: at('2026-12-01T01:00:00Z') })).toEqual({ ok: true, skipped: 'schema_not_ready' });
    } finally {
      await db.close();
    }
  });

  it('rule 10: cancel with something paid voids the next draft, keeps access to the cycle end, then ends; undo before the end restores billing', async () => {
    const orgId = await makeOrg('Cancel Cycle Fixture');
    await paidFrom(orgId, '2027-01-17');
    await tick('2027-02-10T01:00:00Z');
    const draft = (await cycleInvoices(orgId)).find((i) => i.cycle_start === '2027-02-17')!;
    await cancelSubscription({ sql, now: at('2027-02-11T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await inv(draft.id)).toMatchObject({ status: 'void', void_reason: 'subscription_canceled_future_draft' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2027-02-17' });
    const { undoCancelSubscription } = await import('@/lib/brands/subscriptions');
    await undoCancelSubscription({ sql, now: at('2027-02-12T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    await tick('2027-02-12T02:00:00Z');
    expect((await cycleInvoices(orgId)).filter((i) => i.cycle_start === '2027-02-17' && i.status === 'draft')).toHaveLength(1);
    await cancelSubscription({ sql, now: at('2027-02-13T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    await tick('2027-02-17T01:00:00Z');
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'ended' });
    expect((await cycleInvoices(orgId)).filter((i) => (i.cycle_start ?? '') >= '2027-02-17' && i.status !== 'void')).toEqual([]);
  });

  it('rule 11: a flag-off issued invoice without a cycle is adopted into the cycle that starts in its month; an overlapping one is held', async () => {
    const orgId = await makeOrg('Adopt Cycle Fixture');
    await paidFrom(orgId, '2027-01-17');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    await tick('2027-02-01T01:00:00Z');
    const { draftBrandInvoice: draftOff, issueBrandInvoice: issueOff } = await import('@/lib/brands/billing');
    await sql.query('update brand_plan_assignments set started_on = started_on where organization_id = $1', [orgId]);
    const legacy = await sql.query<{ id: string }>(
      `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent, discount_krw, supply_krw, vat_krw, total_krw,
                                   status, issued_at, created_at, updated_at, kind)
       values (gen_random_uuid(), $1, '2027-02', 'b2b_69', 690000, 690000, 0, 0, 690000, 69000, 759000, 'issued', '2027-02-02T01:00:00Z', '2027-02-02T01:00:00Z', '2027-02-02T01:00:00Z', 'subscription')
       returning id::text as id`,
      [orgId],
    );
    void draftOff;
    void issueOff;
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await tick('2027-02-03T01:00:00Z');
    expect(await inv(legacy.rows[0]!.id)).toMatchObject({ status: 'issued', cycle_start: '2027-02-17', cycle_end: '2027-03-17', due_on: '2027-03-03' });
  });

  it('two overlapping runs on the same day leave exactly one invoice per cycle', async () => {
    const orgId = await makeOrg('Overlap Runs Fixture');
    await paidFrom(orgId, '2027-01-17');
    await Promise.all([tick('2027-02-17T01:00:00Z'), tick('2027-02-17T01:00:01Z')]);
    expect((await cycleInvoices(orgId)).filter((i) => i.cycle_start === '2027-02-17' && i.status !== 'void')).toHaveLength(1);
  });
});

/** Insert a non-void subscription invoice straight into the ledger (cycle row, or calendar-month row when `cycle` is null). */
async function insertSubscriptionRow(orgId: string, period: string, status: 'issued' | 'paid', cycle: [string, string] | null, epoch: number | null = null) {
  return (
    await sql.query<{ id: string }>(
      `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent, discount_krw, supply_krw, vat_krw, total_krw,
                                   status, issued_at, paid_at, created_at, updated_at, kind, subscription_epoch, cycle_start, cycle_end)
       values (gen_random_uuid(), $1, $2, 'b2b_69', 690000, 690000, 0, 0, 690000, 69000, 759000, $3, '2026-10-01T01:00:00Z',
               case when $3 = 'paid' then '2026-10-01T02:00:00Z'::timestamptz else null end, '2026-10-01T01:00:00Z', '2026-10-01T01:00:00Z', 'subscription', $4, $5::date, $6::date)
       returning id::text as id`,
      [orgId, period, status, epoch, cycle?.[0] ?? null, cycle?.[1] ?? null],
    )
  ).rows[0]!.id;
}

/** The engine's own draft write (what the job's `draft` step calls). */
function engineDraft(orgId: string, period: string, nowIso: string, cycle: [string, string] | null) {
  return sql.transaction((tx) =>
    draftBrandInvoiceInTx(
      tx,
      { kind: 'system' },
      { organizationId: orgId, period, planId: 'b2b_69', prorate: false, applyActiveDiscount: true, manualAmounts: false, manualReason: '', memo: '' },
      new Date(nowIso),
      { kind: 'subscription', coversMonths: 1, dueOn: null, collectionMethod: 'transfer', subscriptionEpoch: 1, cycleStart: cycle?.[0] ?? null, cycleEnd: cycle?.[1] ?? null },
    ),
  );
}

describe('B1c-2 × B1c-1: the engine never drafts an invoice that overlaps a non-void subscription invoice', () => {
  it('a cycle draft is checked over its own cycle: a calendar-month row of a LATER month inside the cycle blocks it', async () => {
    const orgId = await makeOrg('Overlap Legacy Month Fixture');
    await insertSubscriptionRow(orgId, '2027-01', 'issued', null);
    expect(await engineDraft(orgId, '2026-12', '2026-12-10T01:00:00Z', ['2026-12-17', '2027-01-17'])).toEqual({ ok: false, code: 'conflict' });
    // The cycle ending on the 1st of that month touches it but does not overlap.
    expect(await engineDraft(orgId, '2026-12', '2026-11-24T01:00:00Z', ['2026-11-30', '2026-12-31'])).toMatchObject({ ok: true });
  });

  it('a cycle draft is blocked by an overlapping cycle row (dates, not months) and allowed right after it', async () => {
    const orgId = await makeOrg('Overlap Cycle Row Fixture');
    await insertSubscriptionRow(orgId, '2026-11', 'paid', ['2026-11-25', '2026-12-25']);
    expect(await engineDraft(orgId, '2026-12', '2026-12-10T01:00:00Z', ['2026-12-17', '2027-01-17'])).toEqual({ ok: false, code: 'conflict' });
    expect(await engineDraft(orgId, '2026-12', '2026-12-18T01:00:00Z', ['2026-12-25', '2027-01-25'])).toMatchObject({ ok: true });
  });

  it('a first invoice without a cycle is checked over one cycle from today: blocked by a row covering those days', async () => {
    const orgId = await makeOrg('Overlap First Invoice Fixture');
    await insertSubscriptionRow(orgId, '2026-12', 'issued', null);
    expect(await engineDraft(orgId, '2026-11', '2026-11-25T01:00:00Z', null)).toEqual({ ok: false, code: 'conflict' });
  });

  it('a new subscription can start later in the month an earlier one ended (the earlier cycle does not reach the new days)', async () => {
    const orgId = await makeOrg('Restart Same Month Fixture');
    await paidFrom(orgId, '2026-10-20');
    await cancelSubscription({ sql, now: at('2026-11-10T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    await tick('2026-11-20T01:00:00Z');
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'ended' });
    const again = await startUnpaid(orgId, '2026-11-25');
    expect(await inv(again.firstInvoiceId)).toMatchObject({ status: 'issued', cycle_start: null, due_on: '2026-12-09' });
    await markBrandInvoicePaid({ sql, now: at('2026-11-26T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: again.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-11-26' });
    expect(await inv(again.firstInvoiceId)).toMatchObject({ status: 'paid', cycle_start: '2026-11-26', cycle_end: '2026-12-26' });
  });
});
