import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertLegacyDraft } from '@/tests/brands/helpers/legacy-invoice';
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
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/**
 * Review round 5 (notes: B1a-fixes-5.md): for a subscribed organization the job is the only issuer; every
 * remaining admin path on subscription invoices is enumerated; notices from events; access failures at once.
 */

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

const SUBSCRIBED_OPS: Record<string, string> = {
  // Subscription invoices of a subscribed organization (round 5, A): the complete admin list.
  'brandBilling.invoice.draft': 'refused:subscription_owns_period',
  'brandBilling.invoice.updateDraft': 'memo only; amounts refused:subscription_draft_locked',
  'brandBilling.invoice.issue': 'refused:subscription_job_issues',
  'brandBilling.invoice.markPaid': 'allowed (paid date not after today)',
  'brandBilling.invoice.void': 'allowed (draft -> re-drafted; issued -> waived)',
  'brandBilling.invoice.recordTaxInvoice': 'allowed',
  // Subscription operations (allowed; they run the engine).
  'brandSubscription.start': 'refused:subscription_exists (already subscribed)',
  'brandSubscription.cancel': 'allowed',
  'brandSubscription.undoCancel': 'allowed',
  'brandSubscription.scheduleDowngrade': 'allowed',
  'brandSubscription.clearPendingPlan': 'allowed',
  'brandSubscription.reissuePeriod': 'allowed (current month, after a void)',
  'brandSubscription.reconcile': 'allowed (may issue)',
  // B1c-3: the mid-cycle upgrade issues the new cycle through the engine; the manual upgrade refuses a subscribed organization.
  'brandSubscription.upgrade': 'allowed (paid current cycle; issues the new cycle at once)',
  'brandBilling.planUpgrade': 'refused:subscription_upgrade_only',
  // Organization-level billing operations that write no subscription invoice.
  'brandBilling.planAndAllowance.set': 'plan refused:subscription_managed (allowance-only allowed)',
  'brandBilling.planDefault.set': 'not an invoice write',
  'brandBilling.discount.grant': 'allowed (supported way to change the amount before issue)',
  'brandBilling.discount.end': 'allowed',
  'brandBilling.discountCode.create': 'not an invoice write',
  'brandBilling.discountCode.disable': 'not an invoice write',
  'brandBilling.profile.set': 'not an invoice write',
  'brandBilling.grant.create': 'not an invoice write',
  'brandBilling.grant.revoke': 'not an invoice write',
};

async function grantDiscount(orgId: string, percent: number) {
  await sql.query(
    "insert into brand_discounts (organization_id, percent, invoices_total, status, created_by) values ($1, $2, null, 'active', $3)",
    [orgId, percent, ADMIN_VIEWER.userId],
  );
}

async function snapshotInvoices(orgId: string) {
  return (
    await sql.query<Record<string, unknown>>(
      `select id::text as id, status, period, plan_id, base_list_krw, discount_percent, total_krw, due_on::text as due_on,
              subscription_epoch, issued_at::text as issued_at
         from brand_invoices where organization_id = $1 order by id`,
      [orgId],
    )
  ).rows;
}

describe('B1a review round 5 — A: the job is the only issuer', () => {
  it('A1 probe: the January draft cannot be issued by hand on Jan 5 while suspended; paying December bills January from Jan 9', async () => {
    const orgId = await makeOrg('Suspended Probe Fixture');
    await startPaid(orgId);
    for (const iso of ['2026-11-25T01:00:00Z', '2026-12-01T01:00:00Z', '2026-12-25T01:00:00Z', '2026-12-30T01:00:00Z', '2027-01-01T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql, now: at(iso) });
    }
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'suspended' });
    const [jan] = await invoiceOf(orgId, '2027-01');
    expect(jan).toMatchObject({ status: 'draft' });
    expect(await issueBrandInvoice({ sql, now: at('2027-01-05T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: jan!.id })).toMatchObject({
      ok: false,
      code: 'conflict',
      detail: 'subscription_job_issues',
    });
    expect(await invoiceRow(jan!.id)).toMatchObject({ status: 'draft' });
    const [dec] = await invoiceOf(orgId, '2026-12');
    await markBrandInvoicePaid({ sql, now: at('2027-01-09T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id, paidMethod: 'transfer', paidAt: '2027-01-09' });
    const [janNow] = await invoiceOf(orgId, '2027-01');
    // B1c-2, rule 8: a new cycle starts on the paid date (full price); the old anchor's January draft is voided.
    expect(janNow).toMatchObject({ status: 'issued', proratedDays: null, cycleStart: '2027-01-09' });
    expect(await invoiceRow(jan!.id)).toMatchObject({ status: 'void' });
  });

  it('A1 probe: a discount granted after the D-7 draft is applied by the job on issue day (no hand-issue at the old amount)', async () => {
    const orgId = await makeOrg('Discount Probe Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    expect(await invoiceRow(dec!.id)).toMatchObject({ base_list_krw: 690_000 });
    await grantDiscount(orgId, 20);
    expect(await issueBrandInvoice({ sql, now: at('2026-11-28T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id })).toMatchObject({
      ok: false,
      detail: 'subscription_job_issues',
    });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    const row = (await sql.query<{ status: string; discount_percent: number }>('select status, discount_percent from brand_invoices where id = $1', [dec!.id])).rows[0];
    expect(row).toMatchObject({ status: 'issued', discount_percent: 20 });
  });

  it('A2/A3: no admin draft for any month; a null-epoch leftover draft can be voided but neither re-priced nor issued', async () => {
    const orgId = await makeOrg('Any Month Fixture');
    await startPaid(orgId);
    for (const period of ['2026-10', '2026-06', '2027-05']) {
      expect(
        await draftBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period, planId: 'b2b_69' }),
        period,
      ).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_owns_period' });
    }
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    // B1c fix round: a plan organization's admin draft covers a billing cycle and never one starting on or after the plan end
    // (here the subscription's paid-through day), so this flag-off leftover is written as the calendar-month row the admin
    // path used to write.
    const left = await insertLegacyDraft(sql, { organizationId: orgId, period: '2027-02', planId: 'b2b_69', actorId: ADMIN_VIEWER.userId! });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    expect(await invoiceRow(left.invoice.id)).toMatchObject({ subscription_epoch: null });
    expect(
      await updateDraftBrandInvoice({ sql, now: at('2026-11-21T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: left.invoice.id, baseListKrw: 100_000 }),
    ).toMatchObject({ ok: false, detail: 'subscription_draft_locked' });
    expect(await issueBrandInvoice({ sql, now: at('2026-11-21T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: left.invoice.id })).toMatchObject({
      ok: false,
      detail: 'subscription_job_issues',
    });
    expect(await voidBrandInvoice({ sql, now: at('2026-11-21T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: left.invoice.id, reason: 'leftover' })).toMatchObject({
      ok: true,
    });
    // Flag off: origin/main behaviour (an admin issues by hand).
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    // B1c fix round: a plan organization's admin draft covers a billing cycle and never one starting on or after the plan end
    // (here the subscription's paid-through day), so this flag-off leftover is written as the calendar-month row the admin
    // path used to write.
    const offDraft = await insertLegacyDraft(sql, { organizationId: orgId, period: '2027-04', planId: 'b2b_69', actorId: ADMIN_VIEWER.userId! });
    expect(await issueBrandInvoice({ sql, now: at('2026-11-21T02:00:00Z') }, ADMIN_VIEWER, { invoiceId: offDraft.invoice.id })).toMatchObject({ ok: true });
  });

  it('A5: a cancel with something paid voids a future month that is already issued (state built directly) and the void is reported', async () => {
    const orgId = await makeOrg('Future Issued Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    await sql.query(
      "update brand_invoices set status = 'issued', issued_at = $2::timestamptz, due_on = '2026-12-15' where id = $1",
      [dec!.id, '2026-11-26T01:00:00Z'],
    );
    const before = (await notices()).length;
    await cancelSubscription({ sql, now: at('2026-11-27T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await invoiceRow(dec!.id)).toMatchObject({ status: 'void', void_reason: 'subscription_canceled_future_invoice' });
    await runBrandSubscriptionTick({ sql, now: at('2026-11-27T02:00:00Z') });
    const added = (await notices()).slice(before).map((n) => n.preview).join('\n');
    expect(added).toContain('해지(다음 주기 청구서) 1건');
    // The subscription ends with November; nothing is left for a later month.
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'ended' });
    expect((await listBrandInvoices(sql, { organizationId: orgId })).filter((i) => i.period > '2026-11' && i.status !== 'void')).toEqual([]);
  });

  it('A6: the admin texts name the two supported ways and never a separate manual invoice', () => {
    for (const detail of ['conflict:subscription_draft_locked', 'conflict:subscription_owns_period', 'conflict:subscription_job_issues']) {
      const ko = formatBillingOutcomeDetail(detail, 'ko') ?? '';
      const en = formatBillingOutcomeDetail(detail, 'en') ?? '';
      expect(ko, detail).toContain('할인');
      expect(ko, detail).toContain('다시 발행');
      expect(ko, detail).not.toContain('별도 청구서');
      expect(en, detail).toContain('discount');
      expect(en.toLowerCase(), detail).not.toContain('separate invoice');
    }
    expect(formatBillingOutcomeDetail('conflict:subscription_job_issues', 'ko')).toContain('재계산');
  });

  it('A: every admin billing operation is classified, and the invoice operations behave as listed for a subscribed organization', async () => {
    const { ADMIN_OPERATIONS } = await import('@/lib/admin/operations');
    const names = Object.keys(ADMIN_OPERATIONS).filter((n) => n.startsWith('brandBilling.') || n.startsWith('brandSubscription.'));
    expect(names.sort()).toEqual(Object.keys(SUBSCRIBED_OPS).sort());

    const orgId = await makeOrg('Enumeration Fixture');
    const s = await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T01:00:00Z'));
    const run = (name: string, fields: Record<string, string>) => h.run(name, fields);
    expect(await run('brandBilling.invoice.draft', { organizationId: orgId, period: '2027-03', planId: 'b2b_69' })).toMatchObject({
      ok: false,
      detail: 'conflict:subscription_owns_period',
    });
    expect(await run('brandBilling.invoice.updateDraft', { invoiceId: dec!.id, baseListKrw: '400000' })).toMatchObject({
      ok: false,
      detail: 'conflict:subscription_draft_locked',
    });
    expect(await run('brandBilling.invoice.updateDraft', { invoiceId: dec!.id, memo: 'PO 77' })).toMatchObject({ ok: true });
    expect(await run('brandBilling.invoice.issue', { invoiceId: dec!.id })).toMatchObject({ ok: false, detail: 'conflict:subscription_job_issues' });
    expect(await run('brandBilling.invoice.recordTaxInvoice', { invoiceId: s.firstInvoiceId, issuedOn: '2026-11-26', ref: 'TEST-REF-0005' })).toMatchObject({
      ok: true,
    });
    expect(await run('brandBilling.invoice.void', { invoiceId: dec!.id, reason: 'redo' })).toMatchObject({ ok: true });
    expect(await run('brandBilling.planAndAllowance.set', { organizationId: orgId, planId: 'b2b_29', billingMode: 'invoice', startedOn: '2026-11-26' })).toMatchObject({
      ok: false,
    });
    expect(await run('brandSubscription.start', { organizationId: orgId, planId: 'b2b_69', collectionMethod: 'transfer', startedOn: '2026-11-26' })).toMatchObject({
      ok: false,
      detail: 'conflict:subscription_exists',
    });
    for (const op of ['brandSubscription.reconcile', 'brandSubscription.cancel', 'brandSubscription.undoCancel']) {
      expect(await run(op, { organizationId: orgId }), op).toMatchObject({ ok: true });
    }
    // Mark paid: a date after today is refused for a subscribed organization; today is fine.
    vi.useRealTimers();
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    const [decIssued] = await invoiceOf(orgId, '2026-12');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-02T01:00:00Z'));
    expect(await run('brandBilling.invoice.markPaid', { invoiceId: decIssued!.id, paidMethod: 'transfer', paidAt: '2026-12-03' })).toMatchObject({
      ok: false,
      detail: 'invalid:paid_at_in_future',
    });
    expect(await run('brandBilling.invoice.markPaid', { invoiceId: decIssued!.id, paidMethod: 'transfer', paidAt: '2026-12-02' })).toMatchObject({ ok: true });
  });

  it('C (a): refused admin actions on random days change nothing', async () => {
    const orgId = await makeOrg('Random Refusal Fixture');
    await startPaid(orgId);
    let seed = 20261124;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let day = '2026-11-20';
    for (let k = 0; k < 10; k += 1) {
      day = new Date(Date.parse(`${day}T00:00:00Z`) + (1 + Math.floor(rand() * 6)) * 86_400_000).toISOString().slice(0, 10);
      await runBrandSubscriptionTick({ sql, now: at(`${day}T01:00:00Z`) });
      const drafts = (await listBrandInvoices(sql, { organizationId: orgId })).filter((i) => i.status === 'draft');
      const before = await snapshotInvoices(orgId);
      const choice = Math.floor(rand() * 3);
      if (choice === 0 || drafts.length === 0) {
        const period = `2026-${String(9 + Math.floor(rand() * 4)).padStart(2, '0')}`;
        expect(await draftBrandInvoice({ sql, now: at(`${day}T02:00:00Z`) }, ADMIN_VIEWER, { organizationId: orgId, period, planId: 'b2b_69' })).toMatchObject({
          ok: false,
          detail: 'subscription_owns_period',
        });
      } else if (choice === 1) {
        expect(
          await updateDraftBrandInvoice({ sql, now: at(`${day}T02:00:00Z`) }, ADMIN_VIEWER, { invoiceId: drafts[0]!.id, baseListKrw: 1_000 + k }),
        ).toMatchObject({ ok: false, detail: 'subscription_draft_locked' });
      } else {
        expect(await issueBrandInvoice({ sql, now: at(`${day}T02:00:00Z`) }, ADMIN_VIEWER, { invoiceId: drafts[0]!.id })).toMatchObject({
          ok: false,
          detail: 'subscription_job_issues',
        });
      }
      expect(await snapshotInvoices(orgId), day).toEqual(before);
    }
  });
});

describe('B1a review round 5 — B: remaining findings', () => {
  it('B1: the tax-invoice notice covers invoices issued by an admin reconcile (from the events), once', async () => {
    const orgId = await makeOrg('Issued Notice Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const before = (await notices('brand_billing:tax_invoices_pending')).length;
    const r = await reconcileSubscriptionAdmin({ sql, now: at('2026-12-01T00:30:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(r).toMatchObject({ ok: true, summary: { issuedPeriods: ['2026-12'] } });
    const t = await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    expect(t).toMatchObject({ issued: 0, noticeEnqueued: true });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T02:00:00Z') });
    const added = (await notices('brand_billing:tax_invoices_pending')).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.preview).toContain('청구서 1건 발행');
    expect(added[0]!.preview).not.toContain(orgId);
  });

  it('B2: a plan-write failure after a payment keeps the status and the other steps, reports at once, and the admin reconcile returns reconcile_failed', async () => {
    const orgId = await makeOrg('Plan Write Fixture');
    const s = await startUnpaid(orgId, '2026-11-03');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const left = await draftBrandInvoice({ sql, now: at('2026-11-04T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2027-01', planId: 'b2b_69' });
    if (!left.ok) throw new Error(left.code);
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await sql.query(`create or replace function test_fail_plan() returns trigger language plpgsql as $$
      begin raise exception 'forced plan failure' using errcode = '23514'; end $$`);
    await sql.query('create trigger test_fail_plan before insert or update on brand_plan_assignments for each row execute function test_fail_plan()');
    const surface = 'brand_billing:subscription_reconcile_failures';
    const paid = await markBrandInvoicePaid({ sql, now: at('2026-11-05T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
    expect(paid).toMatchObject({ ok: true });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active', reconcileFailures: 1 });
    expect((await loadBrandSubscription(sql, orgId))!.lastReconcileError).toMatch(/^access:syncAssignment:/);
    // The null-epoch leftover was voided in the same reconcile and stays voided.
    expect(await invoiceRow(left.invoice.id)).toMatchObject({ status: 'void', void_reason: 'null_epoch_draft' });
    // Reported at once (first failure), not at 3.
    expect(await notices(surface)).toHaveLength(1);
    const admin = await reconcileSubscriptionAdmin({ sql, now: at('2026-11-05T02:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(admin).toMatchObject({ ok: false, code: 'conflict' });
    expect((admin as { detail?: string }).detail).toMatch(/^reconcile_failed:access:syncAssignment:/);
    await sql.query('drop trigger test_fail_plan on brand_plan_assignments');
    expect(await reconcileSubscriptionAdmin({ sql, now: at('2026-11-05T03:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId })).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2026-12-05' });
  });

  it('B3: a null due date on an issued invoice of the epoch is normalised once, with a system event', async () => {
    const orgId = await makeOrg('Null Due Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    await sql.query('update brand_invoices set due_on = null where id = $1', [dec!.id]);
    await runBrandSubscriptionTick({ sql, now: at('2026-12-02T01:00:00Z') });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-03T01:00:00Z') });
    expect(await invoiceRow(dec!.id)).toMatchObject({ due_on: '2026-12-15' });
    const events = (
      await sql.query<{ action: string; actor_kind: string }>(
        "select action, actor_kind from brand_invoice_events where invoice_id = $1 and note = 'due date normalised'",
        [dec!.id],
      )
    ).rows;
    expect(events).toEqual([{ action: 'edited', actor_kind: 'system' }]);
  });

  it('B4: a paid date after today is refused for a subscribed organization; with the flag off the manual path refuses it too', async () => {
    const orgId = await makeOrg('Paid Future Fixture');
    const s = await startUnpaid(orgId, '2026-11-03');
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-05T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-11-06' }),
    ).toMatchObject({ ok: false, code: 'invalid', detail: 'paid_at_in_future' });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    // R3 item 3 (changed on purpose): with the flag off this was accepted; the manual path now bounds the paid day to
    // [issue day, today] and names the range.
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-05T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-11-06' }),
    ).toMatchObject({ ok: false, code: 'invalid', detail: 'paid_at_in_future:2026-11-03~2026-11-05' });
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-05T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-11-05' }),
    ).toMatchObject({ ok: true });
  });
});
