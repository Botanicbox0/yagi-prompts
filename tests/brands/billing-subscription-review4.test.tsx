import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertLegacyDraft } from '@/tests/brands/helpers/legacy-invoice';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  issueBrandInvoiceInTx,
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
 * Review round 4 (notes: B1a-fixes-4.md): the job owns subscription drafts (no held drafts), null-epoch
 * drafts are voided, downgrades follow the invoice, payments count from their paid date, a 7-day margin before
 * a first invoice expires, `period_ended`, daily failure and void notices, facts always written, two modes.
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

describe('B1a review round 4 — A: the job owns subscription drafts', () => {
  it('A1: an admin cannot create a subscription draft for a month the subscription owns; earlier months and flag off are unchanged', async () => {
    const orgId = await makeOrg('Owns Period Fixture');
    await startPaid(orgId);
    for (const period of ['2026-11', '2026-12', '2027-03']) {
      expect(
        await draftBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period, planId: 'b2b_69' }),
        period,
      ).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_owns_period' });
    }
    // Round 5, A2: a month before the subscription started is refused too (it could never be issued).
    expect(
      await draftBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-10', planId: 'b2b_69' }),
    ).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_owns_period' });
    // An organization without a subscription: unchanged.
    const other = await makeOrg('No Subscription Fixture');
    expect(await draftBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: other, period: '2026-12', planId: 'b2b_69' })).toMatchObject({ ok: true });
    // Flag off. B1c fix round (changed on purpose): the admin draft is per billing cycle and a cycle starting on or after
    // the plan's end (here the subscription's paid-through day) is not drafted, so February is refused.
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const offDraft = await draftBrandInvoice({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2027-02', planId: 'b2b_69' });
    expect(offDraft).toMatchObject({ ok: false, code: 'invalid', field: 'period' });
  });

  it('A2/A3: amount changes on the job\'s draft are refused, a memo edit is kept and the job still issues it; hand-issue and void of a system draft', async () => {
    const orgId = await makeOrg('Draft Lock Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    expect(dec).toMatchObject({ status: 'draft' });
    for (const change of [
      { baseListKrw: 400_000 },
      { discountPercent: 20 },
      { planId: 'b2b_29' },
      { proratedDays: 10, periodDays: 31 },
      { manualAmounts: true, manualReason: 'agreed', totalKrw: 100_000 },
    ]) {
      expect(
        await updateDraftBrandInvoice({ sql, now: at('2026-11-26T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id, ...change }),
        JSON.stringify(change),
      ).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_draft_locked' });
    }
    const memo = await updateDraftBrandInvoice({ sql, now: at('2026-11-26T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id, planId: 'b2b_69', memo: 'PO 1234' });
    expect(memo).toMatchObject({ ok: true });
    const t = await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    expect(t).toMatchObject({ issued: 1 });
    expect(t).not.toHaveProperty('adminDraftsWaiting');
    expect(await invoiceRow(dec!.id)).toMatchObject({ status: 'issued', memo: 'PO 1234', due_on: '2026-12-15' });
    await markBrandInvoicePaid({ sql, now: at('2026-12-02T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id, paidMethod: 'transfer' });

    // A3: void a system draft (waives nothing) -> the job drafts the month again; hand-issue gets the enrichment.
    await runBrandSubscriptionTick({ sql, now: at('2026-12-25T01:00:00Z') });
    const [jan] = await invoiceOf(orgId, '2027-01');
    await voidBrandInvoice({ sql, now: at('2026-12-26T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: jan!.id, reason: 'redo' });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-26T02:00:00Z') });
    const [jan2] = await invoiceOf(orgId, '2027-01');
    expect(jan2).toMatchObject({ status: 'draft' });
    expect(jan2!.id).not.toBe(jan!.id);
    // Round 5, A1: hand-issue is refused; the job issues it on the 1st.
    const handIssued = await issueBrandInvoice({ sql, now: at('2026-12-27T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: jan2!.id });
    expect(handIssued).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_job_issues' });
    await runBrandSubscriptionTick({ sql, now: at('2027-01-01T01:00:00Z') });
    expect(await invoiceRow(jan2!.id)).toMatchObject({ status: 'issued', due_on: '2027-01-15', issued_via: 'system' });
  });

  it('A4: when the flag comes back, a null-epoch draft is voided by the system and an issued one is adopted with a due date', async () => {
    const orgId = await makeOrg('Flag Off Fixture');
    const s = await startPaid(orgId);
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    // B1c fix round: a plan organization's admin draft covers a billing cycle and never one starting on or after the plan end
    // (here the subscription's paid-through day), so this flag-off leftover is written as the calendar-month row the admin
    // path used to write.
    const dec = await insertLegacyDraft(sql, { organizationId: orgId, period: '2026-12', planId: 'b2b_69', actorId: ADMIN_VIEWER.userId! });
    const jan = await insertLegacyDraft(sql, { organizationId: orgId, period: '2027-01', planId: 'b2b_69', actorId: ADMIN_VIEWER.userId! });
    if (!dec.ok || !jan.ok) throw new Error('draft failed');
    await issueBrandInvoice({ sql, now: at('2026-11-20T02:00:00Z') }, ADMIN_VIEWER, { invoiceId: jan.invoice.id });
    expect(await invoiceRow(jan.invoice.id)).toMatchObject({ status: 'issued', subscription_epoch: null, due_on: null });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');

    const t = await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    expect(t).toMatchObject({ errors: 0, partialFailures: 0, adopted: 1 });
    expect(await invoiceRow(dec.invoice.id)).toMatchObject({ status: 'void', void_reason: 'null_epoch_draft' });
    const voidEvent = (
      await sql.query<{ actor_kind: string }>("select actor_kind from brand_invoice_events where invoice_id = $1 and action = 'voided'", [dec.invoice.id])
    ).rows;
    expect(voidEvent).toEqual([{ actor_kind: 'system' }]);
    // The job drafts December itself.
    const decNow = await invoiceOf(orgId, '2026-12');
    expect(decNow).toHaveLength(1);
    expect(decNow[0]!.id).not.toBe(dec.invoice.id);
    // January: adopted, due = max(Nov 20, Jan 1) + 14 — never the legacy Nov 20 + 14 that would suspend a paid month.
    expect(await invoiceRow(jan.invoice.id)).toMatchObject({ status: 'issued', subscription_epoch: s.subscription.epoch, due_on: '2027-01-15' });
    for (const iso of ['2026-12-05T01:00:00Z', '2026-12-10T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql, now: at(iso) });
    }
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active' });
  });
});

describe('B1a review round 4 — B: remaining findings', () => {
  async function paidThroughDecember(orgId: string) {
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    await markBrandInvoicePaid({ sql, now: at('2026-12-02T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id, paidMethod: 'transfer' });
  }

  it('B1: a downgrade follows January\'s invoice (issued by the job; a hand-issue on Jan 5 is refused), and a later cancel keeps it', async () => {
    const orgId = await makeOrg('Downgrade Hand Fixture');
    await paidThroughDecember(orgId);
    expect(await scheduleDowngrade({ sql, now: at('2026-12-22T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' })).toMatchObject({ ok: true });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-25T01:00:00Z') });
    const [jan] = await invoiceOf(orgId, '2027-01');
    expect(jan).toMatchObject({ status: 'draft', planId: 'b2b_29' });
    // Round 5, A1: the admin cannot issue January by hand; the next reconcile (here the admin's) issues it.
    expect(await issueBrandInvoice({ sql, now: at('2027-01-05T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: jan!.id })).toMatchObject({
      ok: false,
      detail: 'subscription_job_issues',
    });
    await reconcileSubscriptionAdmin({ sql, now: at('2027-01-05T02:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await invoiceRow(jan!.id)).toMatchObject({ status: 'issued', plan_id: 'b2b_29' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_29', pendingPlanId: null });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29' });
    await cancelSubscription({ sql, now: at('2027-01-06T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_29', cancelAtPeriodEnd: true });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29' });
  });

  it('B1 (follow-up): clearing a downgrade refreshes the job\'s January draft to the plan in force', async () => {
    const orgId = await makeOrg('Downgrade Clear Fixture');
    await paidThroughDecember(orgId);
    await scheduleDowngrade({ sql, now: at('2026-12-22T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-25T01:00:00Z') });
    const [jan] = await invoiceOf(orgId, '2027-01');
    expect(jan).toMatchObject({ planId: 'b2b_29' });
    const { clearPendingPlan } = await import('@/lib/brands/subscriptions');
    expect(await clearPendingPlan({ sql, now: at('2026-12-26T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId })).toMatchObject({ ok: true });
    expect(await invoiceRow(jan!.id)).toMatchObject({ status: 'draft', plan_id: 'b2b_69', base_list_krw: 690_000 });
    await runBrandSubscriptionTick({ sql, now: at('2027-01-01T01:00:00Z') });
    expect(await invoiceRow(jan!.id)).toMatchObject({ status: 'issued', plan_id: 'b2b_69' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_69', pendingPlanId: null });
  });

  it('A3 (follow-up): manual amounts left on the job\'s draft by a flag-off edit are reset when the job issues it', async () => {
    const orgId = await makeOrg('Flag Off Edit Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const edited = await updateDraftBrandInvoice({ sql, now: at('2026-11-26T01:00:00Z') }, ADMIN_VIEWER, {
      invoiceId: dec!.id,
      baseListKrw: 100_000,
    });
    expect(edited).toMatchObject({ ok: true });
    await sql.query('update brand_invoices set manual_amounts = true, manual_reason = $2 where id = $1', [dec!.id, 'flag off edit']);
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    const row = (
      await sql.query<{ status: string; base_list_krw: number; manual_amounts: boolean }>(
        'select status, base_list_krw, manual_amounts from brand_invoices where id = $1',
        [dec!.id],
      )
    ).rows[0]!;
    expect(row).toMatchObject({ status: 'issued', base_list_krw: 690_000, manual_amounts: false });
  });

  it('B1: January cannot be issued early by hand (Dec 28); the job moves the plan on Jan 1, not before', async () => {
    const orgId = await makeOrg('Downgrade Early Fixture');
    await paidThroughDecember(orgId);
    await scheduleDowngrade({ sql, now: at('2026-12-22T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-25T01:00:00Z') });
    const [jan] = await invoiceOf(orgId, '2027-01');
    expect(await issueBrandInvoice({ sql, now: at('2026-12-28T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: jan!.id })).toMatchObject({ ok: false });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_69', pendingPlanId: 'b2b_29' });
    await runBrandSubscriptionTick({ sql, now: at('2027-01-01T01:00:00Z') });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_29', pendingPlanId: null });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29' });
  });

  it('B2 + B4: the month after a suspension is prorated from the paid day; an ended month cannot be issued', async () => {
    const orgId = await makeOrg('Resume Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    for (const iso of ['2026-12-01T01:00:00Z', '2026-12-20T01:00:00Z', '2026-12-30T01:00:00Z', '2027-01-01T01:00:00Z', '2027-01-05T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql, now: at(iso) });
    }
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'suspended' });
    await markBrandInvoicePaid({ sql, now: at('2027-01-09T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id, paidMethod: 'transfer', paidAt: '2027-01-09' });
    const [jan] = await invoiceOf(orgId, '2027-01');
    // B1c-2, rule 8: paying while suspended starts a NEW full-price cycle on the paid date.
    expect(jan).toMatchObject({ status: 'issued', proratedDays: null, cycleStart: '2027-01-09', cycleEnd: '2027-02-09' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active' });

    // B4: a subscription draft of a month that has ended cannot be issued (admin), even if the job never voided it.
    const other = await makeOrg('Ended Month Fixture');
    await startPaid(other);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    const [staleDec] = await invoiceOf(other, '2026-12');
    // Round 5: admins cannot issue at all; `period_ended` guards the job's own issue path.
    const stale = await sql.transaction((tx) =>
      issueBrandInvoiceInTx(tx, { kind: 'system' }, { invoiceId: staleDec!.id }, new Date('2027-01-09T01:00:00Z'), {
        dueOn: '2027-01-23',
        collectionMethod: 'transfer',
      }),
    );
    expect(stale).toMatchObject({ ok: false, code: 'conflict', detail: 'period_ended' });
    expect(await invoiceRow(staleDec!.id)).toMatchObject({ status: 'draft' });
  });

  it('B5: failures counted outside the job are reported by the next run, once per KST day; the admin reconcile reports a failure', async () => {
    const orgId = await makeOrg('Failure Report Fixture');
    await startPaid(orgId);
    await failDraftInserts(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
    const op = await h.run('brandSubscription.reconcile', { organizationId: orgId });
    expect(op).toMatchObject({ ok: false, code: 'brandConflict', detail: 'conflict:reconcile_failed:draft:db:23514' });
    vi.useRealTimers();
    for (let i = 0; i < 2; i += 1) {
      const r = await reconcileSubscriptionAdmin({ sql, now: at('2026-11-25T02:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
      expect(r).toMatchObject({ ok: false, code: 'conflict', detail: 'reconcile_failed:draft:db:23514' });
    }
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ reconcileFailures: 3, lastReconcileError: 'draft:db:23514' });
    await failDraftInserts(false);
    const surface = 'brand_billing:subscription_reconcile_failures';
    // The next run fixes it (counter back to 0), so nothing is reported…
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T03:00:00Z') });
    expect(await notices(surface)).toHaveLength(0);
    // …but a run that sees an organization at >= 3 always reports it, once per KST day.
    await failDraftInserts(true);
    await sql.query('update brand_subscriptions set reconcile_failures = 3 where organization_id = $1', [orgId]);
    await sql.query("delete from brand_invoices where organization_id = $1 and period = '2026-12'", [orgId]).catch(() => undefined);
    const rows = await invoiceOf(orgId, '2026-12');
    for (const r of rows) await voidBrandInvoice({ sql, now: at('2026-11-26T00:30:00Z') }, ADMIN_VIEWER, { invoiceId: r.id, reason: 'redo' });
    await runBrandSubscriptionTick({ sql, now: at('2026-11-26T01:00:00Z') });
    await runBrandSubscriptionTick({ sql, now: at('2026-11-26T02:00:00Z') });
    expect(await notices(surface)).toHaveLength(1);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-27T01:00:00Z') });
    const alerts = await notices(surface);
    expect(alerts).toHaveLength(2);
    expect(alerts[1]!.preview).toContain('조직이 1곳');
    expect(alerts[1]!.preview).not.toContain(orgId);
    await failDraftInserts(false);
  });

  it('B6: a system void done by a cancel is reported by the next job run (counts, tax invoice), once', async () => {
    const orgId = await makeOrg('Cancel Report Fixture');
    const s = await startUnpaid(orgId, '2026-11-10');
    await recordBrandInvoiceTaxInvoice({ sql, now: at('2026-11-11T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, issuedOn: '2026-11-11', ref: 'TEST-REF-0004' });
    const before = (await notices()).length;
    await cancelSubscription({ sql, now: at('2026-11-12T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await invoiceRow(s.firstInvoiceId)).toMatchObject({ status: 'void', void_reason: 'subscription_canceled_unpaid' });
    expect((await notices()).length).toBe(before);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-12T02:00:00Z') });
    await runBrandSubscriptionTick({ sql, now: at('2026-11-12T03:00:00Z') });
    const added = (await notices()).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.preview).toContain('시스템 취소 1건 (해지(결제 없음) 1건)');
    expect(added[0]!.preview).toContain('세금계산서 발행 기록이 있는 취소 1건 — 수정 세금계산서 필요');
    expect(added[0]!.preview).not.toContain('Cancel Report Fixture');
  });

  it('B6: a system void written late in the KST day is reported by the first run after midnight', async () => {
    const orgId = await makeOrg('Late Void Fixture');
    await startUnpaid(orgId, '2026-11-10');
    await runBrandSubscriptionTick({ sql, now: at('2026-11-12T13:00:00Z') }); // 22:00 KST, nothing to report yet
    const before = (await notices()).length;
    await cancelSubscription({ sql, now: at('2026-11-12T14:30:00Z') }, ADMIN_VIEWER, { organizationId: orgId }); // 23:30 KST
    await runBrandSubscriptionTick({ sql, now: at('2026-11-12T15:30:00Z') }); // 00:30 KST on Nov 13
    const added = (await notices()).slice(before);
    expect(added).toHaveLength(1);
    expect(added[0]!.preview).toContain('2026-11-12');
    expect(added[0]!.preview).toContain('해지(결제 없음) 1건');
  });

  it('B1: a cancel before the first run of the month keeps the downgrade the month\'s invoice carries', async () => {
    const orgId = await makeOrg('Downgrade Cancel Fixture');
    await paidThroughDecember(orgId);
    await scheduleDowngrade({ sql, now: at('2026-12-22T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29' });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-25T01:00:00Z') });
    const [jan] = await invoiceOf(orgId, '2027-01');
    // Round 5: no admin path issues it any more; the state is built directly (an issued January carrying 29).
    await sql.query(
      "update brand_invoices set status = 'issued', issued_at = '2026-12-28T01:00:00Z', due_on = '2027-01-15' where id = $1",
      [jan!.id],
    );
    // No job run in January yet; the admin cancels on Jan 2.
    await cancelSubscription({ sql, now: at('2027-01-02T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ planId: 'b2b_29', pendingPlanId: null, cancelAtPeriodEnd: true });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29' });
  });

  it('B7: status and access end are written even when more than three steps fail in one run', async () => {
    const orgId = await makeOrg('Many Failures Fixture');
    const s = await startConfirmed({ sql, now: at('2026-11-01T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-01',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    // Four stale system drafts of earlier months in this epoch (the job voids each one as its own step). B1c-2: written
    // straight into the ledger — the engine's write path no longer creates a cycle-less invoice while another invoice
    // (here the early-access cycle Nov 1 – Dec 1) covers the coming cycle (B1c no-overlap rule).
    for (const period of ['2026-07', '2026-08', '2026-09', '2026-10']) {
      const id = randomUUID();
      await sql.query(
        `insert into brand_invoices (id, organization_id, period, plan_id, base_list_krw, list_krw, discount_percent, discount_krw,
            supply_krw, vat_krw, total_krw, status, created_at, updated_at, kind, covers_months, collection_method, created_via, subscription_epoch)
         values ($1, $2, $3, 'b2b_69', 690000, 690000, 0, 0, 690000, 69000, 759000, 'draft', '2026-11-02T01:00:00Z', '2026-11-02T01:00:00Z',
                 'subscription', 1, 'transfer', 'system', $4)`,
        [id, orgId, period, s.subscription.epoch],
      );
      await sql.query(
        `insert into brand_invoice_events (invoice_id, organization_id, action, from_status, to_status, snapshot, note, actor_id, actor_kind)
         values ($1, $2, 'drafted', null, 'draft', '{}'::jsonb, '', null, 'system')`,
        [id, orgId],
      );
    }
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    await markBrandInvoicePaid({ sql, now: at('2026-11-10T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await sql.query(`create or replace function test_fail_void() returns trigger language plpgsql as $$
      begin
        if new.status = 'void' and old.status = 'draft' then raise exception 'forced void failure' using errcode = '23514'; end if;
        return new;
      end $$`);
    await sql.query('create trigger test_fail_void before update on brand_invoices for each row execute function test_fail_void()');
    const t = await runBrandSubscriptionTick({ sql, now: at('2026-11-20T01:00:00Z') });
    expect(t).toMatchObject({ errors: 0, partialFailures: 1 });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active', reconcileFailures: 1 });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2026-12-01' });
    await sql.query('drop trigger test_fail_void on brand_invoices');
  });

  it('B8 + B9: start and reissue have exactly two modes; the reissue preview warns about a short payment window', async () => {
    const orgId = await makeOrg('Two Modes Fixture');
    expect(
      await startSubscription({ sql, now: at('2026-11-03T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_69', startedOn: '2026-11-03' }),
    ).toMatchObject({ ok: false, code: 'invalid', detail: 'preview_required' });
    expect(await loadBrandSubscription(sql, orgId)).toBeNull();
    const s = await startUnpaid(orgId, '2026-11-03');
    await voidBrandInvoice({ sql, now: at('2026-11-04T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, reason: 'redo' });
    expect(
      await reissueSubscriptionPeriod({ sql, now: at('2026-11-29T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-11' }),
    ).toMatchObject({ ok: false, code: 'invalid', detail: 'preview_required' });
    const preview = await reissueSubscriptionPeriod({ sql, now: at('2026-11-29T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-11', previewOnly: true });
    // B1c-2: due today + 14; the short-payment-window warning is gone with the month-end due date.
    expect(preview).toMatchObject({ ok: true, applied: false, preview: { dueOn: '2026-12-13', shortPaymentWindow: false } });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-29T01:00:00Z'));
    const op = await h.run('brandSubscription.reissuePeriod', { organizationId: orgId, period: '2026-11' });
    expect(op).toMatchObject({ ok: true, code: 'prepared' });
    expect(String(op.detail)).not.toContain('short_window=1');
    const html = await renderOrg(orgId, { ok: 'prepared', detail: String(op.detail) });
    expect(html).not.toContain('data-reissue-short-window');
  });

  it('messages: the new refusals have admin texts in both languages', () => {
    for (const detail of ['conflict:subscription_owns_period', 'conflict:subscription_draft_locked', 'conflict:period_ended', 'conflict:reconcile_failed']) {
      for (const locale of ['ko', 'en'] as const) {
        const text = formatBillingOutcomeDetail(detail, locale) ?? '';
        expect(text, `${detail} ${locale}`).not.toBe(detail);
        expect(text.length, `${detail} ${locale}`).toBeGreaterThan(10);
      }
    }
    expect(formatBillingOutcomeDetail('conflict:subscription_draft_locked', 'ko')).toContain('할인');
    expect(formatBillingOutcomeDetail('conflict:subscription_draft_locked', 'ko')).toContain('취소');
  });
});
