import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import { loadBrandOrgDetailOps } from '@/lib/admin/brand-org-detail';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  listBrandInvoices,
  markBrandInvoicePaid,
  saveBrandBillingProfileAdmin,
  setPlanAllowanceDefault,
  updateDraftBrandInvoice,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { loadPlanAssignment, setPlanAssignment } from '@/lib/brands/plans';
import {
  cancelSubscription,
  clearPendingPlan,
  loadBrandSubscription,
  loadExtendedInvoiceMetaByOrg,
  reconcileSubscriptionAdmin,
  reissueSubscriptionPeriod,
  runBrandSubscriptionTick,
  scheduleDowngrade,
  startSubscription,
  undoCancelSubscription,
} from '@/lib/brands/subscriptions';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed, startSubscriptionCompat, reissueCompat } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';
import { studioFixture, viewerOf, type StudioFixture } from '@/tests/brand-studio/server/helpers';

/** Review round 2 (docs: notes B1a-fixes-2.md): integration tests for items 1, 2, 3, 5, 7, 8 and 10(c). */

function recorder(db: PGlite): { sql: SqlRunner; log: string[] } {
  const log: string[] = [];
  const sql = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
    log.push(text.replace(/\s+/g, ' ').trim());
    const res = await db.query<T>(text, params as never[]);
    return { rows: res.rows as T[] };
  });
  return { sql, log };
}

let f: StudioFixture;
const admin = (): Viewer => ({ ...viewerOf(f.ids.admin), isAdmin: true });
const at = (iso: string) => () => new Date(iso);

async function seedCompleteBillingProfile(sql: SqlRunner, viewer: Viewer, organizationId: string, name: string) {
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

async function startPaid(organizationId: string, planId: 'b2b_29' | 'b2b_49' | 'b2b_69' = 'b2b_69') {
  const s = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-01T01:00:00Z') }, admin(), {
    organizationId,
    planId,
    startedOn: '2026-11-01',
  });
  if (!s.ok || !s.applied) throw new Error('start failed');
  await markBrandInvoicePaid({ sql: f.sql, now: at('2026-11-01T02:00:00Z') }, admin(), { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
  return s;
}

async function invoiceRow(id: string) {
  return (
    await f.sql.query<{
      status: string;
      base_list_krw: number;
      discount_percent: number;
      total_krw: number;
      due_on: string | null;
      collection_method: string | null;
      subscription_epoch: number | null;
      created_via: string | null;
      voided_by: string | null;
      void_reason: string;
    }>(
      `select status, base_list_krw, discount_percent, total_krw, due_on::text as due_on, collection_method,
              subscription_epoch, created_via, voided_by::text as voided_by, void_reason
         from brand_invoices where id = $1`,
      [id],
    )
  ).rows[0]!;
}

beforeEach(async () => {
  f = await studioFixture({ capKrw: null });
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_29', monthlyCapKrw: 270_000, confirm: true });
  await setPlanAllowanceDefault({ sql: f.sql }, admin(), { planId: 'b2b_69', monthlyCapKrw: 650_000, confirm: true });
  await seedCompleteBillingProfile(f.sql, admin(), f.orgId, 'Review Two Fixture');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await f.db.close();
});

describe('B1a review round 2', () => {
  it('item 2: every subscription path locks the organization FOR NO KEY UPDATE and never FOR UPDATE', async () => {
    const r = recorder(f.db);
    const s = await startConfirmed({ sql: r.sql, now: at('2026-11-01T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-01',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: r.sql, now: at('2026-11-02T01:00:00Z') }, admin(), { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
    await runBrandSubscriptionTick({ sql: r.sql, now: at('2026-11-25T01:00:00Z') });
    await runBrandSubscriptionTick({ sql: r.sql, now: at('2026-12-01T01:00:00Z') });
    await scheduleDowngrade({ sql: r.sql, now: at('2026-12-02T01:00:00Z') }, admin(), { organizationId: f.orgId, planId: 'b2b_29' });
    await clearPendingPlan({ sql: r.sql, now: at('2026-12-02T02:00:00Z') }, admin(), { organizationId: f.orgId });
    await reconcileSubscriptionAdmin({ sql: r.sql, now: at('2026-12-02T03:00:00Z') }, admin(), { organizationId: f.orgId });
    const dec = (await listBrandInvoices(f.sql, { organizationId: f.orgId })).find((i) => i.period === '2026-12')!;
    await voidBrandInvoice({ sql: r.sql, now: at('2026-12-03T01:00:00Z') }, admin(), { invoiceId: dec.id, reason: 'redo' });
    const preview = await reissueCompat({ sql: r.sql, now: at('2026-12-03T02:00:00Z') }, admin(), { organizationId: f.orgId, period: '2026-12' });
    if (!preview.ok || preview.applied) throw new Error('preview failed');
    await reissueCompat({ sql: r.sql, now: at('2026-12-03T02:00:00Z') }, admin(), {
      organizationId: f.orgId,
      period: '2026-12',
      confirm: true,
      previewDigest: preview.preview.digest,
    });
    await cancelSubscription({ sql: r.sql, now: at('2026-12-04T01:00:00Z') }, admin(), { organizationId: f.orgId });
    await undoCancelSubscription({ sql: r.sql, now: at('2026-12-04T02:00:00Z') }, admin(), { organizationId: f.orgId });
    // Round 4, A1: an admin drafts only months before the subscription (origin/main's own statement).
    await draftBrandInvoice({ sql: r.sql, now: at('2026-12-05T01:00:00Z') }, admin(), { organizationId: f.orgId, period: '2026-10', planId: 'b2b_69' });

    const orgLocks = r.log.filter((t) => /from brand_organizations .*for (no key )?update/.test(t));
    expect(orgLocks.length).toBeGreaterThan(10);
    const upgrades = orgLocks.filter((t) => / for update$/.test(t));
    // Round 5, A2: the admin draft is refused after the `no key update` lock, so origin/main's own FOR UPDATE
    // statement is never reached for a subscribed organization.
    expect(upgrades).toEqual([]);
    expect(orgLocks.filter((t) => t.endsWith('for no key update')).length).toBe(orgLocks.length);
  });

  it('item 3: an admin-voided month after a paid one is waived — active all month, January billed on Jan 1, reissue only while current, past label', async () => {
    await startPaid(f.orgId);
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-11-25T01:00:00Z') });
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-01T01:00:00Z') });
    const dec = (await listBrandInvoices(f.sql, { organizationId: f.orgId })).find((i) => i.period === '2026-12')!;
    await voidBrandInvoice({ sql: f.sql, now: at('2026-12-05T01:00:00Z') }, admin(), { invoiceId: dec.id, reason: 'goodwill' });
    for (const iso of ['2026-12-06T01:00:00Z', '2026-12-16T01:00:00Z', '2026-12-31T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql: f.sql, now: at(iso) });
      expect(await loadBrandSubscription(f.sql, f.orgId), iso).toMatchObject({ status: 'active' });
      expect(await loadPlanAssignment(f.sql, f.orgId), iso).toMatchObject({ endsOn: '2027-01-01' });
    }
    const panelDec = await loadBrandOrgDetailOps(f.sql, admin(), f.orgId, { now: new Date('2026-12-10T01:00:00Z') });
    expect(panelDec?.subscriptionPanel?.facts).toMatchObject({ currentPeriodWaived: true, waivedPeriods: ['2026-12-01'], needsReissue: false });
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2027-01-01T01:00:00Z') });
    const jan = (await listBrandInvoices(f.sql, { organizationId: f.orgId })).find((i) => i.period === '2027-01');
    expect(jan).toMatchObject({ status: 'issued', proratedDays: null });
    expect((await listBrandInvoices(f.sql, { organizationId: f.orgId })).filter((i) => i.period === '2026-12').map((i) => i.status)).toEqual(['void']);
    expect(
      await reissueCompat({ sql: f.sql, now: at('2027-01-05T01:00:00Z') }, admin(), { organizationId: f.orgId, period: '2026-12' }),
    ).toMatchObject({ ok: false, field: 'period', detail: 'reissue_current_period_only' });
    const panelJan = await loadBrandOrgDetailOps(f.sql, admin(), f.orgId, { now: new Date('2027-01-05T01:00:00Z') });
    expect(panelJan?.subscriptionPanel?.facts).toMatchObject({ currentPeriodWaived: false, waivedPeriods: ['2026-12-01'] });
  });

  it('item 3 (B1c-2 rule 4): a never-paid first invoice expires when today > due + 14 (system void, discount returned), the subscription waits with an alert, and reissue works in a later month', async () => {
    await f.sql.query(
      "insert into brand_discounts (organization_id, percent, invoices_total, status, created_by) values ($1, 10, 1, 'active', $2)",
      [f.orgId, f.ids.admin],
    );
    const s = await startSubscriptionCompat({ sql: f.sql, now: at('2026-11-20T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-20',
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    // B1c-2, rule 4: due on the start day + 14 (Dec 4); voided when today > due + 14 (Dec 19).
    expect(await invoiceRow(s.firstInvoiceId)).toMatchObject({ due_on: '2026-12-04' });
    for (const iso of ['2026-12-04T01:00:00Z', '2026-12-10T01:00:00Z', '2026-12-18T01:00:00Z']) {
      await runBrandSubscriptionTick({ sql: f.sql, now: at(iso) });
      expect(await invoiceRow(s.firstInvoiceId), iso).toMatchObject({ status: 'issued' });
    }
    const dec = await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-19T01:00:00Z') });
    expect(dec).toMatchObject({ voided: 1, issued: 0, drafted: 0 });
    expect(await invoiceRow(s.firstInvoiceId)).toMatchObject({ status: 'void', voided_by: null, void_reason: 'first_invoice_expired' });
    const event = (
      await f.sql.query<{ actor_kind: string }>("select actor_kind from brand_invoice_events where invoice_id = $1 and action = 'voided'", [s.firstInvoiceId])
    ).rows[0];
    expect(event?.actor_kind).toBe('system');
    expect((await f.sql.query<{ invoices_used: number }>('select invoices_used from brand_discounts where organization_id = $1', [f.orgId])).rows[0]!.invoices_used).toBe(0);
    for (const iso of ['2026-12-25T01:00:00Z', '2027-01-01T01:00:00Z', '2027-01-10T01:00:00Z']) {
      const t = await runBrandSubscriptionTick({ sql: f.sql, now: at(iso) });
      expect(t, iso).toMatchObject({ drafted: 0, issued: 0 });
    }
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'pending' });
    expect(await loadPlanAssignment(f.sql, f.orgId)).toBeNull();
    const panel = await loadBrandOrgDetailOps(f.sql, admin(), f.orgId, { now: new Date('2027-01-10T01:00:00Z') });
    expect(panel?.subscriptionPanel?.facts).toMatchObject({ needsReissue: true, nothingPaid: true });

    const preview = await reissueCompat({ sql: f.sql, now: at('2027-01-10T01:00:00Z') }, admin(), { organizationId: f.orgId, period: '2027-01' });
    // B1c-2: a new first invoice without a cycle, full price, due today + 14 (no proration anywhere).
    expect(preview).toMatchObject({ ok: true, applied: false, preview: { reason: 'needs_reissue', prorateFromDay: null, proratedDays: null, cycleStart: null, dueOn: '2027-01-24' } });
    if (!preview.ok || preview.applied) return;
    const applied = await reissueCompat({ sql: f.sql, now: at('2027-01-10T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      period: '2027-01',
      confirm: true,
      previewDigest: preview.preview.digest,
    });
    expect(applied).toMatchObject({ ok: true, applied: true, invoice: { status: 'issued', period: '2027-01', proratedDays: null } });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'pending' });
  });

  it('item 3: early access with a voided first invoice has no access and gets no further invoices until a reissue re-opens it', async () => {
    const s = await startConfirmed({ sql: f.sql, now: at('2026-11-20T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      startedOn: '2026-11-20',
      activateBeforePayment: true,
      confirm: true,
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    await voidBrandInvoice({ sql: f.sql, now: at('2026-11-22T01:00:00Z') }, admin(), { invoiceId: s.firstInvoiceId, reason: 'wrong plan' });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'pending' });
    expect(await loadPlanAssignment(f.sql, f.orgId)).toBeNull();
    for (const iso of ['2026-11-25T01:00:00Z', '2026-12-01T01:00:00Z', '2026-12-15T01:00:00Z']) {
      expect(await runBrandSubscriptionTick({ sql: f.sql, now: at(iso) }), iso).toMatchObject({ drafted: 0, issued: 0 });
      expect(await loadPlanAssignment(f.sql, f.orgId), iso).toBeNull();
    }
    const preview = await reissueCompat({ sql: f.sql, now: at('2026-12-15T01:00:00Z') }, admin(), { organizationId: f.orgId, period: '2026-11' });
    if (!preview.ok || preview.applied) throw new Error('preview failed');
    await reissueCompat({ sql: f.sql, now: at('2026-12-15T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      period: '2026-11',
      confirm: true,
      previewDigest: preview.preview.digest,
    });
    // B1c-2: the reissue copies the voided cycle [Nov 20, Dec 20) and its due date (Dec 4); early access applies again.
    expect(await loadPlanAssignment(f.sql, f.orgId)).toMatchObject({ endsOn: '2026-12-04' });
  });

  it('item 5: plan edits are refused while a subscription owns the plan; allowance-only changes keep working', async () => {
    await startPaid(f.orgId);
    const current = await loadPlanAssignment(f.sql, f.orgId);
    expect(current).toMatchObject({ planId: 'b2b_69', endsOn: '2026-12-01' });
    const refused = await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: current!.startedOn,
      endsOn: '2027-06-01',
      seats: null,
      note: '',
      expectedRevision: current!.revision,
    });
    expect(refused).toEqual({ ok: false, code: 'conflict', field: 'subscription_managed' });
    expect(formatBillingOutcomeDetail('conflict:subscription_managed', 'ko')).toContain('구독 중인 조직의 플랜은 구독 화면에서 바꿉니다');
    // Seats/note only: allowed (the plan fields stay as the subscription wrote them).
    const seatsOnly = await setPlanAssignment({ sql: f.sql }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      billingMode: 'invoice',
      startedOn: current!.startedOn,
      endsOn: current!.endsOn,
      seats: 5,
      note: 'five seats',
      expectedRevision: current!.revision,
    });
    expect(seatsOnly).toMatchObject({ ok: true });

    const h = await adminHarness();
    try {
      const sql = runner(h.db);
      await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: 'ops-r2@fixture.invalid' });
      const orgId = randomUUID();
      await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [orgId, 'Plan Guard Fixture', ADMIN_VIEWER.userId, randomUUID()]);
      await seedCompleteBillingProfile(sql, ADMIN_VIEWER, orgId, 'Plan Guard Fixture');
      const s = await startSubscriptionCompat({ sql, now: at('2026-11-01T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_49', startedOn: '2026-11-01' });
      if (!s.ok || !s.applied) throw new Error('start failed');
      await markBrandInvoicePaid({ sql, now: at('2026-11-01T02:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer' });
      const plan = (await loadPlanAssignment(sql, orgId))!;
      const base = {
        organizationId: orgId,
        planId: plan.planId,
        billingMode: plan.billingMode,
        startedOn: plan.startedOn,
        endsOn: plan.endsOn ?? '',
        expectedRevision: String(plan.revision),
        allowanceMode: 'override',
        monthlyCapKrw: '123000',
        preferredLane: 'sunra_mcp',
        allowanceNote: 'cap only',
      };
      expect(await h.run('brandBilling.planAndAllowance.set', { ...base, endsOn: '2027-12-01' })).toMatchObject({
        ok: false,
        detail: 'conflict:subscription_managed',
      });
      expect(await h.run('brandEngine.plan', { organizationId: orgId, planId: 'b2b_29', billingMode: 'invoice', startedOn: plan.startedOn, endsOn: '', expectedRevision: String(plan.revision) })).toMatchObject({
        ok: false,
        detail: 'conflict:subscription_managed',
      });
      expect(await h.run('brandBilling.planAndAllowance.set', base)).toMatchObject({ ok: true });
      const allowance = (await sql.query<{ monthly_cap_krw: number; is_override: boolean }>('select monthly_cap_krw, is_override from brand_studio_allowances where organization_id = $1', [orgId])).rows[0];
      expect(allowance).toMatchObject({ monthly_cap_krw: 123000, is_override: true });
      expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', endsOn: plan.endsOn });
    } finally {
      await h.close();
    }
  });

  it('item 7: the job reports graceDaysBelowOne and the panel warns when grace is below 1', async () => {
    await startPaid(f.orgId);
    expect(await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-11-02T01:00:00Z'), graceDays: 0 })).toMatchObject({ graceDaysBelowOne: true });
    expect(await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-11-02T02:00:00Z') })).toMatchObject({ graceDaysBelowOne: false });
    vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '0');
    const panel = await loadBrandOrgDetailOps(f.sql, admin(), f.orgId, { now: new Date('2026-11-02T01:00:00Z'), env: { defaultMonthlyKrw: 0, planGraceDays: 0 } as never });
    expect(panel?.subscriptionPanel?.facts).toMatchObject({ graceDays: 0 });
  });

  it('item 8 (B1c-2): the job voids the next cycle\'s draft once that cycle ended unbilled while suspended; an admin drafts no month', async () => {
    const s = await startSubscriptionCompat({ sql: f.sql, now: at('2026-10-20T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      planId: 'b2b_69',
      startedOn: '2026-10-20',
    });
    if (!s.ok || !s.applied) throw new Error('start failed');
    await markBrandInvoicePaid({ sql: f.sql, now: at('2026-10-21T01:00:00Z') }, admin(), { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-10-20' });
    for (const iso of ['2026-11-13T01:00:00Z', '2026-11-20T01:00:00Z', '2026-12-13T01:00:00Z']) await runBrandSubscriptionTick({ sql: f.sql, now: at(iso) });
    const decDraft = (await listBrandInvoices(f.sql, { organizationId: f.orgId })).find((i) => i.cycleStart === '2026-12-20')!;
    expect(decDraft.status).toBe('draft');
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-19T01:00:00Z') });
    expect(await loadBrandSubscription(f.sql, f.orgId)).toMatchObject({ status: 'suspended' });
    const adminPast = await draftBrandInvoice({ sql: f.sql, now: at('2026-12-19T02:00:00Z') }, admin(), {
      organizationId: f.orgId,
      period: '2026-09',
      planId: 'b2b_69',
    });
    expect(adminPast).toMatchObject({ ok: false, code: 'conflict', detail: 'subscription_owns_period' });
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-20T01:00:00Z') });
    expect(await invoiceRow(decDraft.id)).toMatchObject({ status: 'draft' });
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2027-01-20T01:00:00Z') });
    expect(await invoiceRow(decDraft.id)).toMatchObject({ status: 'void', voided_by: null, void_reason: 'stale_system_draft' });
  });

  it('item 10 (c): discount use counts across draft -> issue -> void -> reissue', async () => {
    await f.sql.query(
      "insert into brand_discounts (organization_id, percent, invoices_total, status, created_by) values ($1, 15, 3, 'active', $2)",
      [f.orgId, f.ids.admin],
    );
    const used = async () =>
      (await f.sql.query<{ invoices_used: number; status: string }>('select invoices_used, status from brand_discounts where organization_id = $1', [f.orgId])).rows[0]!;
    const s = await startPaid(f.orgId); // November issued: 1 use
    expect(await used()).toMatchObject({ invoices_used: 1 });
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-11-25T01:00:00Z') }); // December draft: no use
    expect(await used()).toMatchObject({ invoices_used: 1 });
    await runBrandSubscriptionTick({ sql: f.sql, now: at('2026-12-01T01:00:00Z') }); // December issued: 2
    expect(await used()).toMatchObject({ invoices_used: 2 });
    const dec = (await listBrandInvoices(f.sql, { organizationId: f.orgId })).find((i) => i.period === '2026-12' && i.status === 'issued')!;
    await voidBrandInvoice({ sql: f.sql, now: at('2026-12-02T01:00:00Z') }, admin(), { invoiceId: dec.id, reason: 'wrong' }); // returned: 1
    expect(await used()).toMatchObject({ invoices_used: 1 });
    const preview = await reissueCompat({ sql: f.sql, now: at('2026-12-03T01:00:00Z') }, admin(), { organizationId: f.orgId, period: '2026-12' });
    if (!preview.ok || preview.applied) throw new Error('preview failed');
    expect(preview.preview).toMatchObject({ discountPercent: 15, proratedDays: null });
    await reissueCompat({ sql: f.sql, now: at('2026-12-03T01:00:00Z') }, admin(), {
      organizationId: f.orgId,
      period: '2026-12',
      confirm: true,
      previewDigest: preview.preview.digest,
    }); // reissued: 2
    expect(await used()).toMatchObject({ invoices_used: 2, status: 'active' });
    const meta = await loadExtendedInvoiceMetaByOrg(f.sql, f.orgId);
    // November, December (void), December (reissued): every invoice carries the epoch.
    expect([...meta.values()].filter((m) => m.subscriptionEpoch === s.subscription.epoch).length).toBe(3);
  });
});
