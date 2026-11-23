import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import { loadBrandOrgDetailOps } from '@/lib/admin/brand-org-detail';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  listBrandInvoices,
  markBrandInvoicePaid,
  recordBrandInvoiceTaxInvoice,
  saveBrandBillingProfileAdmin,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { loadPlanAssignment } from '@/lib/brands/plans';
import {
  cancelSubscription,
  loadBrandSubscription,
  reissueSubscriptionPeriod,
  runBrandSubscriptionTick,
  startSubscription,
} from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { reissueConfirmed, startConfirmed, startSubscriptionCompat, reissueCompat } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/** Review round 3 (notes: B1a-fixes-3.md): integration tests for items 1, 2, 3, 5 and 6. */

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

/** A runner over the same database that fails the job's draft insert while `failing.on` is set. */
const failing = { on: false };
function failingRunner(db: PGlite): SqlRunner {
  return makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    if (failing.on && /^\s*insert into brand_invoices\s*\(/i.test(text)) {
      throw Object.assign(new Error('forced draft failure'), { code: '23514' });
    }
    const res = await db.query<T>(text, params as never[]);
    return { rows: res.rows as T[] };
  });
}

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

async function startPaid(organizationId: string, startedOn = '2026-11-01') {
  const s = await startSubscriptionCompat({ sql, now: at(`${startedOn}T01:00:00Z`) }, ADMIN_VIEWER, { organizationId, planId: 'b2b_69', startedOn });
  if (!s.ok || !s.applied) throw new Error('start failed');
  await markBrandInvoicePaid({ sql, now: at(`${startedOn}T02:00:00Z`) }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
  return s;
}

async function invoiceRow(id: string) {
  return (
    await sql.query<{ status: string; due_on: string | null; subscription_epoch: number | null; void_reason: string; voided_by: string | null }>(
      `select status, due_on::text as due_on, subscription_epoch, void_reason, voided_by::text as voided_by
         from brand_invoices where id = $1`,
      [id],
    )
  ).rows[0]!;
}

async function notices(surface?: string) {
  return (
    await sql.query<{ preview: string; surface: string }>(
      `select preview, surface from team_notice_deliveries where kind = 'ops_alert' ${surface ? 'and surface = $1' : ''} order by created_at, id`,
      surface ? [surface] : [],
    )
  ).rows;
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
  failing.on = false;
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await h.close();
});

describe('B1a review round 3', () => {
  it('item 1 (+ round 4 B3/B6): a first invoice started on the 25th is due on the 30th, expires after the 7-day margin, and the notice counts the void and the recorded tax invoice', async () => {
    const orgId = await makeOrg('First Due Fixture');
    const preview = await startSubscriptionCompat({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-25',
      previewOnly: true,
    });
    expect(preview).toMatchObject({ ok: true, applied: false, preview: { dueOn: '2026-11-30', shortPaymentWindow: false } });
    const s = await startSubscriptionCompat({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-25',
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    expect(await invoiceRow(s.firstInvoiceId)).toMatchObject({ status: 'issued', due_on: '2026-11-30' });
    const tax = await recordBrandInvoiceTaxInvoice({ sql, now: at('2026-11-26T01:00:00Z') }, ADMIN_VIEWER, {
      invoiceId: s.firstInvoiceId,
      issuedOn: '2026-11-26',
      ref: 'TEST-REF-0001',
    });
    expect(tax.ok).toBe(true);

    for (const iso of ['2026-11-30T01:00:00Z', '2026-12-01T01:00:00Z', '2026-12-07T01:00:00Z']) {
      expect(await runBrandSubscriptionTick({ sql, now: at(iso) }), iso).toMatchObject({ voided: 0 });
      expect(await invoiceRow(s.firstInvoiceId), iso).toMatchObject({ status: 'issued' });
    }
    const before = (await notices()).length;
    const dec8 = await runBrandSubscriptionTick({ sql, now: at('2026-12-08T01:00:00Z') });
    expect(dec8).toMatchObject({ voided: 1, voidNoticeEnqueued: true });
    expect(await invoiceRow(s.firstInvoiceId)).toMatchObject({ status: 'void', void_reason: 'first_invoice_expired', voided_by: null });
    // B1a-2: the same run also sends the daily attention notice (this pending subscription now needs a reissue).
    const all = (await notices()).slice(before);
    expect(all.filter((n) => n.surface === 'brand_billing:subscription_attention')).toHaveLength(1);
    const added = all.filter((n) => n.surface !== 'brand_billing:subscription_attention');
    expect(added).toHaveLength(1);
    expect(added[0]!.preview).toContain('시스템 취소 1건 (기한 지난 첫 청구서 1건)');
    expect(added[0]!.preview).toContain('세금계산서 발행 기록이 있는 취소 1건 — 수정 세금계산서 필요');
    expect(added[0]!.preview).not.toContain('First Due Fixture');
    expect(added[0]!.preview).not.toContain(orgId);
    expect(added[0]!.preview).toContain('이후 입금이 확인되면 다시 발행');
    // A second run on the same day adds nothing.
    await runBrandSubscriptionTick({ sql, now: at('2026-12-08T03:00:00Z') });
    expect((await notices()).length).toBe(before + 2);

    // The admin page marks the void row that had a tax invoice recorded.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-09T01:00:00Z'));
    const html = await renderOrg(orgId);
    expect(html).toContain('data-void-needs-corrective-tax-invoice');
    expect(html).toContain('수정 세금계산서 필요');
  });

  it('item 1: starting on the 29th warns about the short payment window in the preview and on the page', async () => {
    const orgId = await makeOrg('Short Window Fixture');
    const preview = await startSubscriptionCompat({ sql, now: at('2026-11-29T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-29',
      previewOnly: true,
    });
    expect(preview).toMatchObject({ ok: true, applied: false, preview: { dueOn: '2026-11-30', shortPaymentWindow: true } });
    // Early access: no first-invoice rule, no warning.
    const early = await startSubscriptionCompat({ sql, now: at('2026-11-29T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-29',
      activateBeforePayment: true,
      previewOnly: true,
    });
    expect(early).toMatchObject({ ok: true, applied: false, preview: { dueOn: '2026-12-13', shortPaymentWindow: false } });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-29T01:00:00Z'));
    const step1 = await h.run('brandSubscription.start', {
      organizationId: orgId,
      planId: 'b2b_69',
      collectionMethod: 'transfer',
      startedOn: '2026-11-29',
    });
    expect(step1).toMatchObject({ ok: true, code: 'prepared' });
    expect(String(step1.detail)).toContain('due=2026-11-30');
    expect(String(step1.detail)).toContain('short_window=1');
    const html = await renderOrg(orgId, { ok: 'prepared', detail: String(step1.detail) });
    expect(html).toContain('data-subscription-short-window');
  });

  it('item 2: a failing draft never freezes the organization — status and ends_on are still written, failures are counted, one notice at 3, reset on success', async () => {
    const orgId = await makeOrg('Failure Fixture');
    const s = await startConfirmed({ sql, now: at('2026-11-01T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-01',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2026-11-15' });
    // Paid while the flag was off: no post-commit reconcile, so the row is still pending with access to Nov 15.
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    await markBrandInvoicePaid({ sql, now: at('2026-11-10T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'pending' });

    const failSql = failingRunner(h.db);
    failing.on = true;
    const failureNotices = 'brand_billing:subscription_reconcile_failures';
    const results = [];
    for (const [i, iso] of ['2026-11-25T01:00:00Z', '2026-11-26T01:00:00Z', '2026-11-27T01:00:00Z', '2026-11-28T01:00:00Z'].entries()) {
      const t = await runBrandSubscriptionTick({ sql: failSql, now: at(iso) });
      results.push(t);
      // Round 4, B5: reported on every KST day an organization is at 3 or more (here Nov 27 and Nov 28).
      expect(t, iso).toMatchObject({ processed: 1, errors: 0, partialFailures: 1, drafted: 0, failureNoticeEnqueued: i >= 2 });
      // The rest of the reconcile still ran: status and access end follow the payment.
      expect(await loadBrandSubscription(sql, orgId), iso).toMatchObject({
        status: 'active',
        reconcileFailures: i + 1,
        lastReconcileError: 'draft:db:23514',
      });
      expect(await loadPlanAssignment(sql, orgId), iso).toMatchObject({ endsOn: '2026-12-01' });
    }
    const alerts = await notices(failureNotices);
    expect(alerts).toHaveLength(2);
    expect(alerts[0]!.preview).toContain('자동 정산이 실패한 조직이 1곳');
    expect(alerts[0]!.preview).not.toContain('Failure Fixture');
    expect(alerts[0]!.preview).not.toContain(orgId);

    // The card shows the count, the code and the reconcile button.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-28T02:00:00Z'));
    const html = await renderOrg(orgId);
    expect(html).toContain('data-subscription-reconcile-failures');
    expect(html).toContain('자동 정산 4회 연속 실패 · 마지막 코드 draft:db:23514');
    expect(html).toContain('brandSubscription.reconcile');
    vi.useRealTimers();

    // A clean run drafts December and resets the counter.
    failing.on = false;
    const ok = await runBrandSubscriptionTick({ sql: failSql, now: at('2026-11-29T01:00:00Z') });
    expect(ok).toMatchObject({ drafted: 1, partialFailures: 0, errors: 0 });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ reconcileFailures: 0, lastReconcileError: null });
    expect((await notices(failureNotices)).length).toBe(2);
  });

  for (const grace of [0, 14]) {
    it(`item 3: issuing the job's December draft by hand on Nov 26 is due Dec 15 and never shortens the paid November (grace ${grace})`, async () => {
      vi.stubEnv('BRAND_PLAN_GRACE_DAYS', String(grace));
      const orgId = await makeOrg(`Hand Issue Fixture ${grace}`);
      await startPaid(orgId);
      expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2026-12-01' });
      // Round 4, A: the job drafts December (D-7); an admin can no longer create it.
      await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
      const dec = (await listBrandInvoices(sql, { organizationId: orgId })).find((i) => i.period === '2026-12' && i.status === 'draft')!;
      // Round 5, A1: only the job issues it (on Dec 1, due Dec 15); a hand-issue is refused.
      const issued = await issueBrandInvoice({ sql, now: at('2026-11-26T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec.id });
      expect(issued).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_job_issues' });
      expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2026-12-01' });
      await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
      expect(await invoiceRow(dec.id)).toMatchObject({ status: 'issued', due_on: '2026-12-15' });
      expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2026-12-15' });
      for (const iso of ['2026-12-02T01:00:00Z', '2026-12-10T01:00:00Z']) {
        await runBrandSubscriptionTick({ sql, now: at(iso) });
        expect(await loadBrandSubscription(sql, orgId), iso).toMatchObject({ status: 'active' });
        expect(await loadPlanAssignment(sql, orgId), iso).toMatchObject({ endsOn: '2026-12-15' });
      }
    });
  }

  it('item 3 + item 1: a draft issued by hand while nothing is paid (no early access) is a first invoice — due inside its month', async () => {
    const orgId = await makeOrg('Hand First Fixture');
    const s = await startSubscriptionCompat({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_69', startedOn: '2026-11-20' });
    if (!s.ok || !s.applied) throw new Error('start failed');
    await voidBrandInvoice({ sql, now: at('2026-11-21T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, reason: 'wrong amount' });
    // Round 4: an admin can only draft such a month while the flag is off (a null-epoch leftover); issued by hand
    // before any reconcile it gets the subscription's enrichment.
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const redo = await draftBrandInvoice({ sql, now: at('2026-11-22T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-11', planId: 'b2b_69' });
    if (!redo.ok) throw new Error(redo.code);
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    // Round 5, A1/A3: the leftover cannot be issued by hand; the next reconcile voids it, and the month is
    // re-issued through `reissuePeriod`, due inside the month (min(Nov 25 + 14, Nov 30)).
    expect(await issueBrandInvoice({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: redo.invoice.id })).toMatchObject({
      ok: false,
      detail: 'subscription_job_issues',
    });
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T02:00:00Z') });
    expect(await invoiceRow(redo.invoice.id)).toMatchObject({ status: 'void', void_reason: 'null_epoch_draft' });
    const re = await reissueConfirmed({ sql, now: at('2026-11-25T03:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-11' });
    if (!re.ok || !re.applied) throw new Error('reissue failed');
    expect(await invoiceRow(re.invoice.id)).toMatchObject({ status: 'issued', due_on: '2026-11-30' });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-08T01:00:00Z') });
    expect(await invoiceRow(re.invoice.id)).toMatchObject({ status: 'void', void_reason: 'first_invoice_expired' });
  });

  it('item 5: the service refuses a confirm without the preview digest (start with and without early access, reissue)', async () => {
    const orgId = await makeOrg('Digest Fixture');
    for (const activateBeforePayment of [false, true]) {
      expect(
        await startSubscriptionCompat({ sql, now: at('2026-11-03T01:00:00Z') }, ADMIN_VIEWER, {
          organizationId: orgId,
          planId: 'b2b_69',
          startedOn: '2026-11-03',
          activateBeforePayment,
          confirm: true,
        }),
      ).toMatchObject({ ok: false, code: 'invalid', field: 'previewDigest', detail: 'preview_required' });
    }
    expect(await loadBrandSubscription(sql, orgId)).toBeNull();
    const s = await startSubscriptionCompat({ sql, now: at('2026-11-03T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_69', startedOn: '2026-11-03' });
    if (!s.ok || !s.applied) throw new Error('start failed');
    await voidBrandInvoice({ sql, now: at('2026-11-04T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, reason: 'redo' });
    expect(
      await reissueCompat({ sql, now: at('2026-11-05T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-11', confirm: true }),
    ).toMatchObject({ ok: false, code: 'invalid', field: 'previewDigest', detail: 'preview_required' });
    // Reissue of a never-paid subscription without early access uses the first-invoice due date.
    const preview = await reissueCompat({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period: '2026-11' });
    expect(preview).toMatchObject({ ok: true, applied: false, preview: { reason: 'admin_voided', dueOn: '2026-11-30' } });
  });

  it('item 6: preview_required has the neutral text in both languages', () => {
    expect(formatBillingOutcomeDetail('invalid:preview_required', 'ko')).toContain('미리보기를 확인한 뒤 다시 실행하세요.');
    expect(formatBillingOutcomeDetail('invalid:preview_required', 'en')).toContain('Check the preview, then run it again.');
    expect(formatBillingOutcomeDetail('invalid:preview_required', 'ko')).not.toContain('입금 전');
  });
});
