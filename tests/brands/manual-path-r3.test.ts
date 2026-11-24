import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer } from '@/lib/auth/identity';
import { formatBillingOutcomeDetail, loadBrandBillingOverview } from '@/lib/admin/brand-billing-console';
import { brandOrgListFilter, loadBrandOrgList } from '@/lib/admin/brand-org-list';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { loadBrandBillingPageState } from '@/lib/brands/billing-page-data';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  listBrandInvoices,
  loadCustomerBrandBilling,
  markBrandInvoicePaid,
  recordBrandInvoiceTaxInvoice,
  saveBrandBillingProfileAdmin,
  setPlanAllowanceDefault,
  setPlanAndAllowance,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { BRAND_PLAN_CREDITS, planCapKrwFromCredits, resolvePlanCapKrw } from '@/lib/brands/billing/plan-credits';
import { planUpgradeEffect } from '@/lib/brands/billing/plan-upgrade';
import { syncPlanDefaultSnapshot } from '@/lib/brands/billing/snapshot';
import { loadPlanAssignment, setPlanAssignment } from '@/lib/brands/plans';
import { loadBrandSubscription, runBrandSubscriptionTick } from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { pre0182Db } from '@/tests/brands/helpers/invoice-flag-off-parity';
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * R3 (docs: notes R3-manual-path-brief.md): the manual "first customer" path with `BRAND_BILLING_AUTO_ISSUE` off —
 * approve → plan → cycle invoice → issue → deposit → tax invoice → discount → extra credits → upgrade → downgrade → end.
 * Items 2–7 at the service and operation level; the screens are in manual-path-r3-admin-ui.test.tsx.
 */

let h: AdminHarness;
let sql: SqlRunner;
const at = (iso: string) => () => new Date(iso);
const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };
const DEFAULTS_SQL =
  "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw";

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

async function assignPlan(orgId: string, planId: string, startedOn = '2026-11-17', endsOn: string | null = null) {
  await sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', $3, $4, 1)",
    [orgId, planId, startedOn, endsOn],
  );
}

/** The current cycle's invoice of a manual plan organization: drafted and issued at `issuedIso`, paid when asked. */
async function cycleInvoice(orgId: string, issuedIso: string, state: 'draft' | 'issued' | 'paid', cycle: 'current' | 'next' = 'current') {
  const now = at(issuedIso);
  const drafted = await draftBrandInvoice({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, cycle });
  if (!drafted.ok) throw new Error(`draft: ${drafted.code} ${drafted.detail ?? ''}`);
  if (state === 'draft') return drafted.invoice.id;
  const issued = await issueBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
  if (!issued.ok) throw new Error(`issue: ${issued.code}`);
  if (state === 'paid') {
    const paid = await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id, paidMethod: 'transfer' });
    if (!paid.ok) throw new Error(`paid: ${paid.code}`);
  }
  return drafted.invoice.id;
}

async function invoiceRow(id: string) {
  return (
    await sql.query<{ status: string; due_on: string | null; paid_at: unknown; tax_invoice_issued_on: string | null; tax_invoice_ref: string | null }>(
      `select status, due_on::text as due_on, paid_at, tax_invoice_issued_on::text as tax_invoice_issued_on, tax_invoice_ref
         from brand_invoices where id = $1`,
      [id],
    )
  ).rows[0]!;
}

async function events(invoiceId: string, action: string): Promise<number> {
  return Number(
    (await sql.query<{ n: number }>('select count(*)::int as n from brand_invoice_events where invoice_id = $1 and action = $2', [invoiceId, action])).rows[0]?.n ?? 0,
  );
}

beforeEach(async () => {
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
  h = await adminHarness();
  sql = runner(h.db);
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-24T03:00:00Z')); // 2026-11-24 12:00 KST
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await h.close();
});

describe('R3 item 2: the tax invoice is recorded with the automatic billing flag off', () => {
  it('records date and reference on an issued or paid invoice, audited, repeatable; a draft and a sandboxed organization are refused', async () => {
    await sql.query(DEFAULTS_SQL);
    const orgId = await makeOrg('Tax Flag Off Fixture');
    await assignPlan(orgId, 'b2b_29');
    const issued = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'issued');

    const first = await h.run('brandBilling.invoice.recordTaxInvoice', { invoiceId: issued, issuedOn: '2026-11-24', ref: 'HT-20261124-0001' });
    expect(first).toMatchObject({ ok: true, code: 'saved' });
    expect(await invoiceRow(issued)).toMatchObject({ status: 'issued', tax_invoice_issued_on: '2026-11-24', tax_invoice_ref: 'HT-20261124-0001' });
    expect(await events(issued, 'tax_invoice_recorded')).toBe(1);
    // Same values again: same state, audited again (as with the flag on).
    expect(await h.run('brandBilling.invoice.recordTaxInvoice', { invoiceId: issued, issuedOn: '2026-11-24', ref: 'HT-20261124-0001' })).toMatchObject({ ok: true });
    expect(await invoiceRow(issued)).toMatchObject({ tax_invoice_issued_on: '2026-11-24', tax_invoice_ref: 'HT-20261124-0001' });
    expect(await events(issued, 'tax_invoice_recorded')).toBe(2);

    await markBrandInvoicePaid({ sql, now: at('2026-11-24T04:00:00Z') }, ADMIN_VIEWER, { invoiceId: issued, paidMethod: 'transfer' });
    expect(await h.run('brandBilling.invoice.recordTaxInvoice', { invoiceId: issued, issuedOn: '2026-11-25', ref: 'HT-2' })).toMatchObject({ ok: true });
    expect(await invoiceRow(issued)).toMatchObject({ status: 'paid', tax_invoice_issued_on: '2026-11-25', tax_invoice_ref: 'HT-2' });

    const draft = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'draft', 'next');
    expect(await h.run('brandBilling.invoice.recordTaxInvoice', { invoiceId: draft, issuedOn: '2026-11-24', ref: 'X' })).toMatchObject({
      ok: false,
      detail: expect.stringContaining('invoice_not_issued_or_paid'),
    });

    const sandboxed = await makeOrg('Morphic Tax Fixture');
    const month = await draftBrandInvoice({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { organizationId: sandboxed, period: '2026-11', planId: 'b2b_29' });
    if (!month.ok) throw new Error(month.code);
    await issueBrandInvoice({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: month.invoice.id });
    expect(await h.run('brandBilling.invoice.recordTaxInvoice', { invoiceId: month.invoice.id, issuedOn: '2026-11-24', ref: 'X' })).toMatchObject({
      ok: false,
      code: 'invalid',
    });
    expect(await invoiceRow(month.invoice.id)).toMatchObject({ tax_invoice_issued_on: null });
  });

  it('before 0182 the service answers "unavailable" instead of throwing', async () => {
    const db = await pre0182Db();
    try {
      const old = runner(db);
      await seedProfile(old, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      expect(await recordBrandInvoiceTaxInvoice({ sql: old }, ADMIN_VIEWER, { invoiceId: randomUUID(), issuedOn: '2026-11-24', ref: 'X' })).toEqual({
        ok: false,
        code: 'unavailable',
      });
    } finally {
      await db.close();
    }
  });
});

describe('R3 item 3: the manual paid date runs from the issue day through today (KST)', () => {
  it('refuses an earlier and a later day with the allowed range, writes nothing, and accepts both ends', async () => {
    await sql.query(DEFAULTS_SQL);
    const orgId = await makeOrg('Paid Date Fixture');
    await assignPlan(orgId, 'b2b_29');
    const id = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'issued');
    const now = at('2026-11-24T05:00:00Z');

    const before = await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: id, paidAt: '2026-11-10', paidMethod: 'transfer' });
    expect(before).toEqual({ ok: false, code: 'invalid', detail: 'paid_at_before_issue:2026-11-24~2026-11-24' });
    const later = await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: id, paidAt: '2026-11-25', paidMethod: 'transfer' });
    expect(later).toEqual({ ok: false, code: 'invalid', detail: 'paid_at_in_future:2026-11-24~2026-11-24' });
    expect(await invoiceRow(id)).toMatchObject({ status: 'issued', paid_at: null });
    expect(await events(id, 'paid')).toBe(0);

    const op = await h.run('brandBilling.invoice.markPaid', { invoiceId: id, paidAt: '2026-11-03', paidMethod: 'transfer' });
    expect(op.ok).toBe(false);
    if (op.ok) return;
    expect(formatBillingOutcomeDetail(op.detail, 'ko')).toContain('2026-11-24');
    expect(formatBillingOutcomeDetail(op.detail, 'ko')).toMatch(/발행일/);
    expect(formatBillingOutcomeDetail(op.detail, 'en')).toContain('2026-11-24');
    expect(formatBillingOutcomeDetail(op.detail, 'en')).not.toMatch(/[가-힣]/);

    // A later day, then both ends of the range.
    vi.setSystemTime(new Date('2026-11-27T03:00:00Z'));
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-27T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: id, paidAt: '2026-11-28', paidMethod: 'transfer' }),
    ).toEqual({ ok: false, code: 'invalid', detail: 'paid_at_in_future:2026-11-24~2026-11-27' });
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-27T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: id, paidAt: '2026-11-24', paidMethod: 'transfer' }),
    ).toMatchObject({ ok: true });

    const other = await makeOrg('Paid Today Fixture');
    await assignPlan(other, 'b2b_29');
    const id2 = await cycleInvoice(other, '2026-11-24T03:00:00Z', 'issued');
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-27T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: id2, paidAt: '2026-11-27', paidMethod: 'transfer' }),
    ).toMatchObject({ ok: true });
  });

  it('the subscribed path keeps its own rules: a first payment before the reissue day but after the start is still accepted', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const orgId = await makeOrg('Subscribed Paid Date Fixture');
    const s = await startConfirmed({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29', startedOn: '2026-11-20' });
    if (!s.ok || !s.applied) throw new Error('start failed');
    // Issued on 11-20; recorded on 11-24 with a paid day of 11-20 (the subscription start day, before "today").
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidAt: '2026-11-20', paidMethod: 'transfer' }),
    ).toMatchObject({ ok: true });
    const s2Org = await makeOrg('Subscribed Before Start Fixture');
    const s2 = await startConfirmed({ sql, now: at('2026-11-20T01:00:00Z') }, ADMIN_VIEWER, { organizationId: s2Org, planId: 'b2b_29', startedOn: '2026-11-20' });
    if (!s2.ok || !s2.applied) throw new Error('start failed');
    expect(
      await markBrandInvoicePaid({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: s2.firstInvoiceId, paidAt: '2026-11-19', paidMethod: 'transfer' }),
    ).toMatchObject({ ok: false, detail: 'paid_at_before_start' });
  });
});

describe('R3 item 4: a manually issued cycle invoice stores its due date', () => {
  it('due_on = issue day + 14 on a cycle invoice; a calendar-month invoice of an organization without a plan is unchanged', async () => {
    await sql.query(DEFAULTS_SQL);
    const orgId = await makeOrg('Due Date Fixture');
    await assignPlan(orgId, 'b2b_29');
    const id = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'issued');
    expect(await invoiceRow(id)).toMatchObject({ due_on: '2026-12-08' });

    const noPlan = await makeOrg('No Plan Due Fixture');
    const month = await draftBrandInvoice({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { organizationId: noPlan, period: '2026-11', planId: 'b2b_29' });
    if (!month.ok) throw new Error(month.code);
    await issueBrandInvoice({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: month.invoice.id });
    expect(await invoiceRow(month.invoice.id)).toMatchObject({ due_on: null });

    // With the flag off nothing else reads it: overdue is still "more than 14 days after the issue instant".
    const overdueAt = async (iso: string) => (await listBrandInvoices(sql, { organizationId: orgId, now: new Date(iso) })).find((i) => i.id === id)?.overdue;
    expect(await overdueAt('2026-12-08T02:59:00Z')).toBe(false);
    expect(await overdueAt('2026-12-08T03:01:00Z')).toBe(true);
    expect(await overdueAt('2026-12-09T00:00:00Z')).toBe(true);
    // ... and the plan part of the cap is never halved with the flag off.
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2026-12-10T03:00:00Z'))).toMatchObject({ baseCapKrw: 270_000 });
  });

  it('flag on: adoption keeps the stored due date and the unpaid-50% check reads it', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await sql.query(DEFAULTS_SQL);
    const orgId = await makeOrg('Adopt Due Fixture');
    const s = await startConfirmed({ sql, now: at('2027-01-17T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_29', startedOn: '2027-01-17' });
    if (!s.ok || !s.applied) throw new Error('start failed');
    expect(
      (await markBrandInvoicePaid({ sql, now: at('2027-01-17T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2027-01-17' })).ok,
    ).toBe(true);
    await runBrandSubscriptionTick({ sql, now: at('2027-01-17T04:00:00Z') });

    // The flag goes off; the admin extends the plan by hand (§5.9 "켜기 전에" 5), bills the next cycle and issues it early.
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    await sql.query("update brand_plan_assignments set ends_on = '2027-03-17' where organization_id = $1", [orgId]);
    const drafted = await draftBrandInvoice({ sql, now: at('2027-02-10T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'next' });
    if (!drafted.ok) throw new Error(`draft ${drafted.code} ${drafted.detail ?? ''}`);
    expect(await issueBrandInvoice({ sql, now: at('2027-02-10T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id })).toMatchObject({ ok: true });
    expect(await invoiceRow(drafted.invoice.id)).toMatchObject({ due_on: '2027-02-24' });

    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    await runBrandSubscriptionTick({ sql, now: at('2027-02-11T01:00:00Z') });
    const adopted = (
      await sql.query<{ subscription_epoch: number | null; due_on: string }>('select subscription_epoch, due_on::text as due_on from brand_invoices where id = $1', [
        drafted.invoice.id,
      ])
    ).rows[0]!;
    expect(adopted).toMatchObject({ due_on: '2027-02-24' });
    expect(adopted.subscription_epoch).not.toBeNull();
    // Due day: full plan cap; the day after, while unpaid: half.
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2027-02-24T03:00:00Z'))).toMatchObject({ baseCapKrw: 270_000 });
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2027-02-25T03:00:00Z'))).toMatchObject({ baseCapKrw: 135_000, planCapHalvedUnpaid: true });
    expect(await loadBrandSubscription(sql, orgId)).not.toBeNull();
  });
});

describe('R3 item 5: a draft the customer never saw is not on the customer list', () => {
  it('hides voided invoices that were never issued; voided-after-issue stays (owner and staff views)', async () => {
    await sql.query(DEFAULTS_SQL);
    const ownerId = randomUUID();
    await seedProfile(sql, { id: ownerId, email: 'r3-owner@fixture.invalid' });
    const orgId = await makeOrg('Customer List Fixture');
    await sql.query("insert into brand_memberships (organization_id, user_id, role) values ($1, $2, 'owner')", [orgId, ownerId]);
    await assignPlan(orgId, 'b2b_29');
    const now = at('2026-11-24T03:00:00Z');
    const paid = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'paid');
    const neverIssued = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'draft', 'next');
    expect((await voidBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: neverIssued, reason: 'plan_upgrade' })).ok).toBe(true);
    const issuedThenVoid = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'issued', 'next');
    expect((await voidBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: issuedThenVoid, reason: 'wrong' })).ok).toBe(true);

    const owner: Viewer = { tier: 'free', userId: ownerId, email: 'r3-owner@fixture.invalid', isAdmin: false, locale: 'ko' };
    const res = await loadCustomerBrandBilling({ sql, env: STUDIO, now }, owner, orgId);
    if (!res.ok) throw new Error(res.code);
    expect(res.billing.invoices.map((i) => i.id).sort()).toEqual([paid, issuedThenVoid].sort());

    const staff = await loadBrandBillingPageState({ sql, env: STUDIO, now }, ADMIN_VIEWER, { id: orgId, name: 'Customer List Fixture', role: 'studio' });
    if (staff.kind !== 'ready') throw new Error(staff.kind);
    expect(staff.billing.invoices.map((i) => i.id).sort()).toEqual([paid, issuedThenVoid].sort());
  });
});

describe('R3 item 6: a paid plan without a stored default opens its confirmed credits', () => {
  it('uses credits x 10 KRW for each paid plan on the cycle window; a stored row wins; an override wins over both; project-only is unchanged', async () => {
    const now = new Date('2026-11-25T03:00:00Z');
    for (const planId of ['b2b_29', 'b2b_49', 'b2b_69'] as const) {
      const orgId = await makeOrg(`No Default ${planId} Fixture`);
      await assignPlan(orgId, planId);
      expect(await loadAllowance(sql, orgId, STUDIO, now)).toMatchObject({
        source: 'plan',
        baseCapKrw: BRAND_PLAN_CREDITS[planId] * 10,
        configured: true,
        cycle: { start: '2026-11-17', end: '2026-12-17' },
      });
    }
    const stored = await makeOrg('Stored Default Fixture');
    await assignPlan(stored, 'b2b_29');
    await sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 300000)");
    expect(await loadAllowance(sql, stored, STUDIO, now)).toMatchObject({ source: 'plan', baseCapKrw: 300_000 });
    // A cleared row (null) is unset: the confirmed value applies.
    await sql.query("update brand_plan_allowance_defaults set monthly_cap_krw = null where plan_id = 'b2b_29'");
    expect(await loadAllowance(sql, stored, STUDIO, now)).toMatchObject({ source: 'plan', baseCapKrw: 270_000 });

    const override = await makeOrg('Override Wins Fixture');
    await assignPlan(override, 'b2b_49');
    await sql.query("insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note) values ($1, 777000, true, 'x')", [override]);
    expect(await loadAllowance(sql, override, STUDIO, now)).toMatchObject({ source: 'override', baseCapKrw: 777_000 });

    const project = await makeOrg('Project Only Fixture');
    await assignPlan(project, 'project_only');
    const projectAllowance = await loadAllowance(sql, project, { defaultMonthlyKrw: 12_000, planGraceDays: 14 }, now);
    expect(projectAllowance).toMatchObject({ source: 'default', baseCapKrw: 12_000 });
    expect(projectAllowance.cycle).toBeUndefined();
  });

  it('the resolver, the upgrade preview and the refusal agree: plan_cap_not_set only for a plan with no confirmed credits', async () => {
    for (const planId of ['b2b_29', 'b2b_49', 'b2b_69'] as const) {
      expect(resolvePlanCapKrw(planId, null)).toBe(planCapKrwFromCredits(planId));
      expect(resolvePlanCapKrw(planId, 123_000)).toBe(123_000);
    }
    expect(resolvePlanCapKrw('b2b_99', null)).toBeNull();
    expect(resolvePlanCapKrw('project_only', null)).toBeNull();
    // The defensive path of the pure core stays: a plan id the caps do not know.
    expect(
      planUpgradeEffect({
        todayKst: '2026-11-25',
        oldPlanId: 'b2b_29',
        newPlanId: 'b2b_49',
        currentCycle: { start: '2026-11-17', end: '2026-12-17' },
        planActive: true,
        sandboxed: false,
        allowanceSource: 'plan',
        oldCapKrw: 270_000,
        oldUsedKrw: 0,
        planCapsKrw: { b2b_29: 270_000, b2b_49: resolvePlanCapKrw('b2b_99', null), b2b_69: 650_000 },
        listPricesKrw: { b2b_29: 290_000, b2b_49: 490_000, b2b_69: 690_000 },
        discountPercent: 0,
      }),
    ).toEqual({ ok: false, code: 'plan_cap_not_set' });

    // No default rows at all: the manual upgrade previews with the confirmed caps and carries from the plan cap.
    const orgId = await makeOrg('Upgrade No Default Fixture');
    await assignPlan(orgId, 'b2b_29');
    await cycleInvoice(orgId, '2026-11-17T01:00:00Z', 'paid');
    vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
    const step1 = await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_69' });
    expect(step1).toMatchObject({ ok: true, code: 'prepared' });
    expect(step1.detail).toContain('|carry=270000|');
    expect(step1.detail).toContain('|cap=650000|');
  });

  it('a stored row that differs from the confirmed value wins in every reader: allowance, upgrade preview and carry, snapshot, plan form, default preview, summaries', async () => {
    // Production carries rows; when one differs from the code constant the ROW wins (coordinator check (a)).
    await sql.query(
      "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 300000), ('b2b_49', 500000), ('b2b_69', 700000)",
    );
    expect(planCapKrwFromCredits('b2b_29')).not.toBe(300_000);
    const now = new Date('2026-11-25T03:00:00Z');
    const orgId = await makeOrg('Row Wins Fixture');
    await assignPlan(orgId, 'b2b_29');
    await cycleInvoice(orgId, '2026-11-17T01:00:00Z', 'paid');
    expect(await loadAllowance(sql, orgId, STUDIO, now)).toMatchObject({ source: 'plan', baseCapKrw: 300_000 });

    vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
    const step1 = await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_49' });
    expect(step1).toMatchObject({ ok: true, code: 'prepared' });
    expect(step1.detail).toContain('|carry=300000|');
    expect(step1.detail).toContain('|cap=500000|');

    await syncPlanDefaultSnapshot(sql, orgId, ADMIN_VIEWER.userId!, { now, graceDays: 14 });
    expect((await sql.query<{ monthly_cap_krw: number }>('select monthly_cap_krw from brand_studio_allowances where organization_id = $1', [orgId])).rows[0]).toEqual({
      monthly_cap_krw: 300_000,
    });
    const formOrg = await makeOrg('Row Wins Form Fixture');
    expect(
      await setPlanAndAllowance({ sql, now: at('2026-11-25T03:00:00Z') }, ADMIN_VIEWER, {
        organizationId: formOrg,
        planId: 'b2b_69',
        billingMode: 'invoice',
        startedOn: '2026-11-20',
        expectedRevision: 0,
        allowanceMode: 'plan_default',
      }),
    ).toMatchObject({ ok: true });
    expect((await sql.query<{ monthly_cap_krw: number }>('select monthly_cap_krw from brand_studio_allowances where organization_id = $1', [formOrg])).rows[0]).toEqual({
      monthly_cap_krw: 700_000,
    });
    const preview = await setPlanAllowanceDefault({ sql, now: at('2026-11-25T03:00:00Z'), env: STUDIO }, ADMIN_VIEWER, { planId: 'b2b_29', monthlyCapKrw: 270_000 });
    expect(preview).toMatchObject({ ok: true, applied: false, affectedOrganizations: [{ organizationId: orgId, beforeCapKrw: 300_000, afterCapKrw: 270_000 }] });

    const list = await loadBrandOrgList(sql, ADMIN_VIEWER, brandOrgListFilter({ sort: 'name_asc' }), { env: STUDIO, now });
    expect(list?.rows.find((r) => r.id === orgId)).toMatchObject({ allowanceSource: 'plan', baseCapKrw: 300_000 });
    const overview = await loadBrandBillingOverview(sql, ADMIN_VIEWER, { env: STUDIO, now });
    expect(overview?.planDefaults.find((d) => d.planId === 'b2b_29')).toMatchObject({ monthlyCapKrw: 300_000, effectiveCapKrw: 300_000 });
    expect(resolvePlanCapKrw('b2b_29', 300_000)).toBe(300_000);
  });

  it('every admin reader and writer of the plan default agrees: snapshot, plan form, default preview, organization list, overview', async () => {
    const orgId = await makeOrg('Readers Agree Fixture');
    await assignPlan(orgId, 'b2b_49');
    await syncPlanDefaultSnapshot(sql, orgId, ADMIN_VIEWER.userId!, { now: new Date('2026-11-25T03:00:00Z'), graceDays: 14 });
    expect(
      (await sql.query<{ monthly_cap_krw: number; is_override: boolean }>('select monthly_cap_krw, is_override from brand_studio_allowances where organization_id = $1', [orgId]))
        .rows[0],
    ).toEqual({ monthly_cap_krw: 460_000, is_override: false });

    const formOrg = await makeOrg('Plan Form Snapshot Fixture');
    expect(
      await setPlanAndAllowance({ sql, now: at('2026-11-25T03:00:00Z') }, ADMIN_VIEWER, {
        organizationId: formOrg,
        planId: 'b2b_69',
        billingMode: 'invoice',
        startedOn: '2026-11-20',
        expectedRevision: 0,
        allowanceMode: 'plan_default',
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await sql.query<{ monthly_cap_krw: number }>('select monthly_cap_krw from brand_studio_allowances where organization_id = $1', [formOrg])).rows[0],
    ).toEqual({ monthly_cap_krw: 650_000 });

    // Setting a default previews the change from the confirmed value, not from the env default.
    const preview = await setPlanAllowanceDefault({ sql, now: at('2026-11-25T03:00:00Z'), env: STUDIO }, ADMIN_VIEWER, { planId: 'b2b_49', monthlyCapKrw: 460_000 });
    expect(preview).toMatchObject({ ok: true, applied: false, affectedCount: 0 });
    const lower = await setPlanAllowanceDefault({ sql, now: at('2026-11-25T03:00:00Z'), env: STUDIO }, ADMIN_VIEWER, { planId: 'b2b_49', monthlyCapKrw: 400_000 });
    expect(lower).toMatchObject({ ok: true, applied: false, affectedOrganizations: [{ organizationId: orgId, beforeCapKrw: 460_000, afterCapKrw: 400_000 }] });

    const list = await loadBrandOrgList(sql, ADMIN_VIEWER, brandOrgListFilter({ sort: 'name_asc' }), { env: STUDIO, now: new Date('2026-11-25T03:00:00Z') });
    expect(list?.rows.find((r) => r.id === orgId)).toMatchObject({ allowanceSource: 'plan', baseCapKrw: 460_000 });

    const overview = await loadBrandBillingOverview(sql, ADMIN_VIEWER, { env: STUDIO, now: new Date('2026-11-25T03:00:00Z') });
    expect(overview?.planDefaults.find((d) => d.planId === 'b2b_49')).toMatchObject({ monthlyCapKrw: null, effectiveCapKrw: 460_000 });
  });
});

describe('R3 item 7: a lower plan through the plan forms waits for the next cycle', () => {
  const form = (organizationId: string, planId: string, extra: Record<string, string> = {}) =>
    h.run('brandBilling.planAndAllowance.set', {
      organizationId,
      expectedRevision: '1',
      planId,
      billingMode: 'invoice',
      startedOn: '2026-11-17',
      endsOn: '',
      planNote: '',
      allowanceMode: 'plan_default',
      allowanceNote: '',
      ...extra,
    });
  const engine = (organizationId: string, planId: string, endsOn: string | null = null, now = '2026-11-25T01:00:00Z') =>
    setPlanAssignment({ sql, now: at(now) }, ADMIN_VIEWER, {
      organizationId,
      planId,
      billingMode: 'invoice',
      startedOn: '2026-11-17',
      endsOn,
      seats: null,
      note: '',
      expectedRevision: 1,
    });

  beforeEach(async () => {
    await sql.query(DEFAULTS_SQL);
    vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
  });

  it('refuses a lower paid plan while an issued or paid cycle invoice covers today, naming the next cycle start', async () => {
    const paid = await makeOrg('Downgrade Paid Fixture');
    await assignPlan(paid, 'b2b_69');
    await cycleInvoice(paid, '2026-11-17T01:00:00Z', 'paid');
    expect(await engine(paid, 'b2b_29')).toMatchObject({ ok: false, code: 'conflict', field: 'plan_downgrade_next_cycle', detail: '2026-12-17' });
    const out = await form(paid, 'b2b_49');
    expect(out).toMatchObject({ ok: false, detail: 'conflict:plan_downgrade_next_cycle:2026-12-17' });
    if (out.ok) return;
    expect(formatBillingOutcomeDetail(out.detail, 'ko')).toContain(
      '주기 중간에는 낮은 플랜으로 바꿀 수 없습니다. 다음 주기 시작일(12월 17일)에 바꾸세요.',
    );
    expect(formatBillingOutcomeDetail(out.detail, 'en')).toContain('Dec 17');
    expect(formatBillingOutcomeDetail(out.detail, 'en')).not.toMatch(/[가-힣]/);
    const engineOp = await h.run('brandEngine.plan', {
      organizationId: paid,
      expectedRevision: '1',
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-17',
      endsOn: '',
      note: '',
    });
    expect(engineOp).toMatchObject({ ok: false, detail: 'conflict:plan_downgrade_next_cycle:2026-12-17' });
    expect(await loadPlanAssignment(sql, paid)).toMatchObject({ planId: 'b2b_69', revision: 1 });
    expect(await loadAllowance(sql, paid, STUDIO, new Date('2026-11-25T02:00:00Z'))).toMatchObject({ baseCapKrw: 650_000 });

    const issuedOnly = await makeOrg('Downgrade Issued Fixture');
    await assignPlan(issuedOnly, 'b2b_49');
    await cycleInvoice(issuedOnly, '2026-11-17T01:00:00Z', 'issued');
    expect(await form(issuedOnly, 'b2b_29')).toMatchObject({ ok: false, detail: 'conflict:plan_downgrade_next_cycle:2026-12-17' });
  });

  it('a draft alone, the boundary day, ending the plan and same-plan edits are unchanged', async () => {
    const draftOnly = await makeOrg('Downgrade Draft Fixture');
    await assignPlan(draftOnly, 'b2b_49');
    await cycleInvoice(draftOnly, '2026-11-17T01:00:00Z', 'draft');
    expect(await form(draftOnly, 'b2b_29')).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, draftOnly)).toMatchObject({ planId: 'b2b_29' });

    // Ending the plan (same plan, an end day) and a same-plan note edit go through while the paid cycle covers today.
    const ending = await makeOrg('Downgrade Ending Fixture');
    await assignPlan(ending, 'b2b_69');
    await cycleInvoice(ending, '2026-11-17T01:00:00Z', 'paid');
    expect(await form(ending, 'b2b_69', { endsOn: '2026-12-17' })).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, ending)).toMatchObject({ planId: 'b2b_69', endsOn: '2026-12-17' });
    expect(await form(ending, 'b2b_69', { expectedRevision: '2', endsOn: '2026-12-17', planNote: 'note' })).toMatchObject({ ok: true });

    // On the boundary day (the next cycle starts today; its invoice is only a draft) the lower plan is accepted.
    const boundary = await makeOrg('Downgrade Boundary Fixture');
    await assignPlan(boundary, 'b2b_69');
    await cycleInvoice(boundary, '2026-11-17T01:00:00Z', 'paid');
    await cycleInvoice(boundary, '2026-12-10T01:00:00Z', 'draft', 'next');
    vi.setSystemTime(new Date('2026-12-17T01:00:00Z'));
    expect(await engine(boundary, 'b2b_29', null, '2026-12-17T01:00:00Z')).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, boundary)).toMatchObject({ planId: 'b2b_29', startedOn: '2026-11-17' });
  });
});

describe('R3 item 8: billing conflicts do not read as a campaign conflict', () => {
  it('a plan, billing or subscription operation answers billingConflict', async () => {
    await sql.query(DEFAULTS_SQL);
    vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
    const orgId = await makeOrg('Billing Conflict Fixture');
    await assignPlan(orgId, 'b2b_29');
    await cycleInvoice(orgId, '2026-11-17T01:00:00Z', 'paid');
    const raised = await h.run('brandBilling.planAndAllowance.set', {
      organizationId: orgId,
      expectedRevision: '1',
      planId: 'b2b_49',
      billingMode: 'invoice',
      startedOn: '2026-11-17',
      endsOn: '',
      planNote: '',
      allowanceMode: 'plan_default',
      allowanceNote: '',
    });
    expect(raised).toMatchObject({ ok: false, code: 'billingConflict' });
    const stale = await h.run('brandBilling.planAndAllowance.set', {
      organizationId: orgId,
      expectedRevision: '7',
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-17',
      endsOn: '2026-12-17',
      planNote: '',
      allowanceMode: 'plan_default',
      allowanceNote: '',
    });
    expect(stale).toMatchObject({ ok: false, code: 'billingConflict' });
    const paidAgain = (await listBrandInvoices(sql, { organizationId: orgId })).find((i) => i.status === 'paid')!;
    expect(await h.run('brandBilling.invoice.markPaid', { invoiceId: paidAgain.id, paidMethod: 'transfer' })).toMatchObject({ ok: false, code: 'billingConflict' });
    expect(await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_29' })).toMatchObject({ ok: false });
    const engineConflict = await h.run('brandEngine.plan', {
      organizationId: orgId,
      expectedRevision: '1',
      planId: 'b2b_69',
      billingMode: 'invoice',
      startedOn: '2026-11-17',
      endsOn: '',
      note: '',
    });
    expect(engineConflict).toMatchObject({ ok: false, code: 'billingConflict' });
  });
});
