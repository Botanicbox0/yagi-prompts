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
import { enqueueReconcileFailureNotice } from '@/lib/brands/subscriptions/notices';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { reissueConfirmed, startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/** B1a-2 (notes: B1a2-brief.md): reissue keeps day count and due date; notices; reporting; registry classification. */

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

/**
 * Every admin operation that writes brand plans, brand invoices or brand subscriptions, with its behaviour for
 * an organization that has a live subscription (B1a-2, item 4). Every other registered operation must be on
 * NON_WRITER_OPS. A new operation on neither list fails the test.
 */
const SUBSCRIBED_WRITERS: Record<string, string> = {
  'brandBilling.invoice.draft': 'refused:subscription_owns_period',
  'brandBilling.invoice.updateDraft': 'memo only; amounts refused:subscription_draft_locked',
  'brandBilling.invoice.issue': 'refused:subscription_job_issues',
  'brandBilling.invoice.markPaid': 'allowed (paid date not after today; a failed subscription update is reported)',
  'brandBilling.invoice.void': 'allowed (draft -> re-drafted; issued -> waived; a failed subscription update is reported)',
  'brandBilling.invoice.recordTaxInvoice': 'allowed',
  'brandBilling.planAndAllowance.set': 'plan refused:subscription_managed (allowance-only allowed)',
  'brandBilling.planDefault.set': 'plan defaults (no organization row)',
  'brandBilling.discount.grant': 'allowed (applied by the job on issue day)',
  'brandBilling.discount.end': 'allowed',
  'brandBilling.discountCode.create': 'codes only',
  'brandBilling.discountCode.disable': 'codes only',
  'brandBilling.profile.set': 'billing profile only',
  'brandBilling.grant.create': 'credit grant only',
  'brandBilling.grant.revoke': 'credit grant only',
  // B1b (BRAND_WORKSPACE_APPROVAL): writes brand_workspace_approvals and one trial row in brand_allowance_grants, never a
  // plan, invoice or subscription row. Not refused for a subscribed organization: once per organization, the trial is
  // added on top of its plan cap like any grant.
  'brandWorkspace.approve': 'approval record + one trial credit grant only (allowed; added on top of the plan cap)',
  'brandEngine.plan': 'refused:subscription_managed',
  'brandSubscription.start': 'refused:subscription_exists',
  'brandSubscription.cancel': 'allowed',
  'brandSubscription.undoCancel': 'allowed',
  'brandSubscription.scheduleDowngrade': 'allowed',
  'brandSubscription.clearPendingPlan': 'allowed',
  'brandSubscription.reissuePeriod': 'allowed (current month after a void; same day count and due date)',
  'brandSubscription.reconcile': 'allowed (may issue; a failure is reported)',
  // B1c-3: the mid-cycle upgrade (cuts the paid cycle, moves the plan, a carry grant, a new cycle's invoice).
  'brandSubscription.upgrade': 'allowed (paid current cycle only; issues the new cycle at once)',
  'brandBilling.planUpgrade': 'refused:subscription_upgrade_only',
};

const NON_WRITER_OPS: readonly string[] = [
  // docs/PERSONAL-STUDIO.md §6.1: a person's stored 19+ answer (adult_confirmations) + an audit row, nothing brand.
  'account.adultConfirmation.correct',
  'account.deletion.cancel',
  'account.deletion.complete',
  'account.deletion.run',
  'billing.payment.recheck',
  'block.create',
  'block.delete',
  'block.move',
  'block.update',
  'block.visibility',
  'brandEngine.featurePolicy',
  'brandEngine.identityConfirm',
  'brandEngine.identityDraft',
  'brandEngine.storageQuota',
  'brandEngine.storageReconcile',
  'brandInquiry.status',
  // docs/BRAND-PROJECT-SPINE.md §6 (slice 3b + N2): the home's news slots (brand_announcements + an audit row), nothing billed.
  'brandNews.delete',
  'brandNews.end',
  'brandNews.publish',
  'brandNews.save',
  'brandProduction.contract',
  'brandProduction.enabled',
  'brandProduction.template',
  'brandUsage.buyer',
  'brandUsage.close',
  'brandUsage.compensation',
  'brandUsage.consent',
  'brandUsage.consentWithdraw',
  'brandUsage.grantEvent',
  'brandUsage.grantStart',
  'brandUsage.message',
  'brandUsage.quote',
  'brandUsage.reconcile',
  'brandUsage.reopen',
  'brandUsage.resolve',
  'brandUsage.scope',
  'brandUsage.triage',
  'brandWorkspace.content',
  'brandWorkspace.contract',
  'brandWorkspace.contractShare',
  'brandWorkspace.cover',
  'brandWorkspace.createProject',
  'brandWorkspace.externalPosts',
  'brandWorkspace.invite',
  'brandWorkspace.logo',
  'brandWorkspace.logoRemove',
  'brandWorkspace.message',
  'brandWorkspace.metrics',
  'brandWorkspace.metricsBatch',
  'brandWorkspace.organization',
  'brandWorkspace.post',
  'brandWorkspace.postPresentation',
  'brandWorkspace.report',
  'brandWorkspace.revokeAccess',
  'brandWorkspace.revokeInvite',
  'brandWorkspace.shortlistCriteria',
  'brandWorkspace.shortlistImport',
  'brandWorkspace.shortlistRemove',
  'brandWorkspace.shortlistShare',
  'brandWorkspace.shortlistTriage',
  'brandWorkspace.status',
  'brandWorkspace.support',
  'brandWorkspace.visibility',
  'brand_rooms.channel.ack',
  'brand_rooms.delivery.add',
  'brand_rooms.message.delete',
  'brand_rooms.message.pin',
  'brand_rooms.message.send',
  'brand_rooms.share.create',
  'brand_rooms.share.revoke',
  'brand_rooms.storyboard.create',
  'brand_rooms.storyboard.delete',
  'brand_rooms.storyboard.frames',
  'brand_rooms.storyboard.share',
  'brand_rooms.storyboard.update',
  'brand_rooms.storyboard.version',
  'brand_studio.allowance.set',
  'brand_studio.review.create',
  'brand_studio.review.reply',
  'brand_studio.review.resolve',
  'brand_studio.review.status',
  'caches.refresh',
  'campaign.create',
  'campaign.status',
  'campaign.update',
  'campaignApplication.decline',
  'campaignApplication.metrics',
  'campaignApplication.pay',
  'campaignApplication.reject',
  'campaignApplication.select',
  'campaignApplication.verify',
  'campaignCollaboration.bind',
  'campaignCollaboration.file',
  'campaignCollaboration.message',
  'campaignFunding.quote',
  'campaignFunding.reconcile',
  'campaignFunding.refund',
  'campaignFunding.releaseUnpaid',
  'campaignFunding.reviewReward',
  'campaignFunding.voidExpired',
  'campaignProduction.configure',
  'campaignProduction.resolve',
  'campaignProduction.retry',
  'campaignRisk.review',
  'campaignRisk.slackConnectionTest',
  'community.claim',
  'community.moderate',
  'community.offer',
  'community.offerDisable',
  'community.policy',
  'community.quality',
  'community.reply',
  'contest.archive',
  'contest.create',
  'contest.publish',
  'contest.unpublish',
  'contest.update',
  'contestEntry.approve',
  'contestEntry.placement',
  'contestEntry.reject',
  'creative.application',
  'creative.format',
  'creative.grant',
  'creative.settle',
  'format.reviseRecipe',
  'format.setOriginalPost',
  'landingMedia.replace',
  'landingMedia.reset',
  'payout.export',
  'platform.manage',
  'platform.review',
  'playbook.archive',
  'playbook.create',
  'policy.update',
  'post.hide',
  'post.restore',
  'prompt.announce',
  'prompt.approve',
  'prompt.archive',
  'prompt.create',
  'prompt.createSet',
  'prompt.declareStyling',
  'prompt.feature',
  'prompt.marks',
  'prompt.reject',
  'prompt.update',
  'prompt.visibility',
  'render.resendNotice',
  'render.retry',
  'renderFeedback.status',
  'revision.discardDraft',
  'revision.hero',
  'revision.heroClear',
  'revision.metadata',
  'revision.openDraft',
  'revision.overrides',
  'revision.prepare',
  'revision.publish',
  'social.reject',
  'social.verify',
  'step.create',
  'step.delete',
  'step.move',
  'step.update',
  'support.delivery.retry',
  'support.reply',
  'support.slack.connectionTest',
];

async function attentionNotices() {
  return notices('brand_billing:subscription_attention');
}

describe('B1a-2 — reissue keeps the day count and the due date', () => {
  async function januaryAt23Days(orgId: string) {
    await startPaid(orgId);
    for (const iso of ['2026-11-25T01:00:00Z', '2026-12-01T01:00:00Z', '2026-12-25T01:00:00Z', '2026-12-30T01:00:00Z', '2027-01-01T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql, now: at(iso) });
    }
    const [dec] = await invoiceOf(orgId, '2026-12');
    await markBrandInvoicePaid({ sql, now: at('2027-01-09T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec!.id, paidMethod: 'transfer', paidAt: '2027-01-09' });
    const [jan] = await invoiceOf(orgId, '2027-01');
    expect(await invoiceRow(jan!.id)).toMatchObject({ status: 'issued', prorated_days: 23, due_on: '2027-01-23' });
    return jan!;
  }

  it('review follow-up 1: an early-access first invoice (29 days, due Jan 17) is reissued on Jan 5, 12 and 20 unchanged', async () => {
    const orgId = await makeOrg('Early Reissue Fixture');
    const s = await startConfirmed({ sql, now: at('2027-01-03T01:00:00Z') }, ADMIN_VIEWER, {
      organizationId: orgId,
      planId: 'b2b_69',
      startedOn: '2027-01-03',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    expect(await invoiceRow(s.firstInvoiceId)).toMatchObject({ prorated_days: null, due_on: '2027-01-17' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ endsOn: '2027-01-17' });
    let current = s.firstInvoiceId;
    for (const day of ['2027-01-05', '2027-01-12', '2027-01-20']) {
      await voidBrandInvoice({ sql, now: at(`${day}T01:00:00Z`) }, ADMIN_VIEWER, { invoiceId: current, reason: 'redo' });
      const re = await reissueConfirmed({ sql, now: at(`${day}T02:00:00Z`) }, ADMIN_VIEWER, { organizationId: orgId, period: '2027-01' });
      if (!re.ok || !re.applied) throw new Error(`reissue failed ${day}`);
      expect(await invoiceRow(re.invoice.id), day).toMatchObject({ status: 'issued', prorated_days: null, due_on: '2027-01-17' });
      expect(await loadPlanAssignment(sql, orgId), day).toMatchObject({ endsOn: '2027-01-17' });
      current = re.invoice.id;
    }
  });

});

describe('B1a-2 — the 1st of the month for a customer behind on payment (founder decision: as Stripe does)', () => {
  async function decemberUnpaid(orgId: string) {
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    expect(await invoiceRow(dec!.id)).toMatchObject({ status: 'issued', due_on: '2026-12-15' });
    return dec!;
  }

  it('past_due on the 1st (previous invoice unpaid, past its due date, inside grace): the new month IS issued on the 1st, full month, due the 1st + 14', async () => {
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '30');
    const orgId = await makeOrg('Past Due On The First Fixture');
    await decemberUnpaid(orgId);
    for (const iso of ['2026-12-20T01:00:00Z', '2026-12-25T01:00:00Z']) await runBrandSubscriptionTick({ sql, now: at(iso) });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'past_due' });
    await runBrandSubscriptionTick({ sql, now: at('2027-01-01T01:00:00Z') });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'past_due' });
    const [jan] = await invoiceOf(orgId, '2027-01');
    expect(jan).toMatchObject({ status: 'issued', proratedDays: null });
    expect(await invoiceRow(jan!.id)).toMatchObject({ due_on: '2027-01-15' });
  });

  it('suspended on the 1st (previous invoice unpaid past due + grace): NO new-month invoice is drafted or issued while suspended; paying the old invoice bills the month from the payment day', async () => {
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '7');
    const orgId = await makeOrg('Suspended On The First Fixture');
    const dec = await decemberUnpaid(orgId);
    for (const iso of ['2026-12-23T01:00:00Z', '2026-12-25T01:00:00Z', '2027-01-01T01:00:00Z', '2027-01-05T01:00:00Z', '2027-01-08T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql, now: at(iso) });
      expect(await loadBrandSubscription(sql, orgId), iso).toMatchObject({ status: 'suspended' });
      expect(await invoiceOf(orgId, '2027-01'), iso).toEqual([]);
    }
    await markBrandInvoicePaid({ sql, now: at('2027-01-09T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: dec.id, paidMethod: 'transfer', paidAt: '2027-01-09' });
    const [jan] = await invoiceOf(orgId, '2027-01');
    // B1c-2, rule 8: the payment starts a new full-price cycle on the paid date.
    expect(jan).toMatchObject({ status: 'issued', proratedDays: null, cycleStart: '2027-01-09' });
    expect(await loadBrandSubscription(sql, orgId)).toMatchObject({ status: 'active' });
  });
});

describe('B1a-2 — notices, reporting and classification', () => {
  it('item 2: the failure notice is keyed on the failing organizations — "A recovers, B fails" on the same day is sent', async () => {
    const a = await makeOrg('Failing A Fixture');
    const b = await makeOrg('Failing B Fixture');
    await startPaid(a);
    await startPaid(b);
    const setFailures = (org: string, n: number) =>
      sql.query("update brand_subscriptions set reconcile_failures = $2, last_reconcile_error = 'draft:db:23514' where organization_id = $1", [org, n]);
    const surface = 'brand_billing:subscription_reconcile_failures';
    await setFailures(a, 3);
    expect(await enqueueReconcileFailureNotice(sql, '2026-11-25')).toBe(true);
    await setFailures(a, 0);
    await setFailures(b, 3);
    expect(await enqueueReconcileFailureNotice(sql, '2026-11-25')).toBe(true);
    expect(await enqueueReconcileFailureNotice(sql, '2026-11-25')).toBe(false);
    const sent = await notices(surface);
    expect(sent).toHaveLength(2);
    for (const n of sent) {
      expect(n.preview).toContain('1곳');
      expect(n.preview).not.toContain(a);
      expect(n.preview).not.toContain(b);
    }
  });

  it('item 3: a paid invoice whose subscription could not be updated says so (service, operation and screen)', async () => {
    const orgId = await makeOrg('Paid Not Updated Fixture');
    const s = await startUnpaid(orgId, '2026-11-03');
    await sql.query(`create or replace function test_fail_plan() returns trigger language plpgsql as $$
      begin raise exception 'forced plan failure' using errcode = '23514'; end $$`);
    await sql.query('create trigger test_fail_plan before insert or update on brand_plan_assignments for each row execute function test_fail_plan()');
    const paid = await markBrandInvoicePaid({ sql, now: at('2026-11-05T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
    expect(paid).toMatchObject({ ok: true, invoice: { status: 'paid' }, reconcileDeferred: true, accessNotUpdated: true });

    const other = await makeOrg('Paid Not Updated Op Fixture');
    const s2 = await startUnpaid(other, '2026-11-03');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-05T02:00:00Z'));
    const op = await h.run('brandBilling.invoice.markPaid', { invoiceId: s2.firstInvoiceId, paidMethod: 'transfer' });
    expect(op).toMatchObject({ ok: true, detail: 'subscription_access_not_updated' });
    const html = await renderOrg(other, { ok: 'saved', detail: 'subscription_access_not_updated' });
    expect(html).toContain('입금 기록은 저장했습니다');
    expect(html).toContain('재계산');
    await sql.query('drop trigger test_fail_plan on brand_plan_assignments');
  });

  it('review follow-up 2: a void whose subscription update fails says the CANCELLATION is saved (not a payment)', async () => {
    const orgId = await makeOrg('Void Not Updated Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    await runBrandSubscriptionTick({ sql, now: at('2026-12-01T01:00:00Z') });
    const [dec] = await invoiceOf(orgId, '2026-12');
    await sql.query(`create or replace function test_fail_plan() returns trigger language plpgsql as $$
      begin raise exception 'forced plan failure' using errcode = '23514'; end $$`);
    await sql.query('create trigger test_fail_plan before insert or update on brand_plan_assignments for each row execute function test_fail_plan()');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-05T01:00:00Z'));
    const op = await h.run('brandBilling.invoice.void', { invoiceId: dec!.id, reason: 'goodwill' });
    expect(op).toMatchObject({ ok: true, detail: 'subscription_void_not_updated' });
    const html = await renderOrg(orgId, { ok: 'saved', detail: 'subscription_void_not_updated' });
    expect(html).toContain('취소 기록은 저장했습니다');
    expect(html).not.toContain('입금 기록은 저장했습니다');
    expect(html).toContain('재계산');
    expect(formatBillingOutcomeDetail('subscription_void_not_updated', 'en')).toContain('cancellation is recorded');
    await sql.query('drop trigger test_fail_plan on brand_plan_assignments');
  });

  it('item 4: the WHOLE operation registry is classified; brandEngine.plan is refused for a subscribed organization', async () => {
    const { ADMIN_OPERATIONS } = await import('@/lib/admin/operations');
    const registered = Object.keys(ADMIN_OPERATIONS).sort();
    const classified = [...Object.keys(SUBSCRIBED_WRITERS), ...NON_WRITER_OPS].sort();
    expect(new Set(classified).size, 'an operation is on both lists').toBe(classified.length);
    expect(registered).toEqual(classified);

    const orgId = await makeOrg('Engine Plan Fixture');
    await startPaid(orgId);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-06T01:00:00Z'));
    const revision = (await sql.query<{ revision: number }>('select revision from brand_plan_assignments where organization_id = $1', [orgId])).rows[0]?.revision ?? 0;
    const res = await h.run('brandEngine.plan', {
      organizationId: orgId,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-06',
      expectedRevision: String(revision),
    });
    expect(res).toMatchObject({ ok: false, detail: 'conflict:subscription_managed' });
  });

  it('item 5: one daily notice counts suspended subscriptions and pending ones waiting for a reissue; the console shows both', async () => {
    const suspendedOrg = await makeOrg('Suspended Count Fixture');
    await startPaid(suspendedOrg);
    for (const iso of ['2026-11-25T01:00:00Z', '2026-12-01T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql, now: at(iso) });
    }
    const reissueOrg = await makeOrg('Reissue Count Fixture');
    const r = await startUnpaid(reissueOrg, '2026-12-03');
    await voidBrandInvoice({ sql, now: at('2026-12-04T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: r.firstInvoiceId, reason: 'redo' });
    const before = (await attentionNotices()).length;
    for (const iso of ['2026-12-30T01:00:00Z', '2026-12-30T02:00:00Z', '2026-12-30T03:00:00Z']) {
      await runBrandSubscriptionTick({ sql, now: at(iso) });
    }
    expect(await loadBrandSubscription(sql, suspendedOrg)).toMatchObject({ status: 'suspended' });
    const sent = (await attentionNotices()).slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.preview).toContain('이용 정지 1곳');
    expect(sent[0]!.preview).toContain('다시 발행이 필요한 대기 1곳');
    expect(sent[0]!.preview).not.toContain('Fixture');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-30T04:00:00Z'));
    const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
    const html = await new Response(
      (await prerender(await BrandBillingPage({ searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
    ).text();
    expect(html).toContain('data-subscription-attention');
    expect(html).toMatch(/data-suspended-count="1"/);
    expect(html).toMatch(/data-reissue-count="1"/);
  });

  it('item 5: no attention notice when nothing is suspended or waiting for a reissue', async () => {
    const orgId = await makeOrg('Healthy Fixture');
    await startPaid(orgId);
    await runBrandSubscriptionTick({ sql, now: at('2026-11-25T01:00:00Z') });
    expect(await attentionNotices()).toHaveLength(0);
  });
});
