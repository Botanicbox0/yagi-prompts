import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import { loadAllowance } from '@/lib/brand-studio/usage';
import { draftBrandInvoice, issueBrandInvoice, markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { loadPlanAssignment, setPlanAssignment } from '@/lib/brands/plans';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1c-3 fix round 1, item 3: the ordinary plan forms (`brandEngine.plan`, `brandBilling.planAndAllowance.set`) must not
 * raise a plan mid-cycle without a charge. While a non-void subscription invoice covers today a HIGHER plan id is refused
 * and the admin is pointed to "플랜 올림"; a lower plan and an organization with no invoice covering today are unchanged.
 */

let h: AdminHarness;
let sql: SqlRunner;
const at = (iso: string) => () => new Date(iso);
const STUDIO = { defaultMonthlyKrw: 0, planGraceDays: 14 };

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

/** A manual plan organization from Nov 17; `invoice`: the first cycle's invoice drafted (and issued, paid) or none. */
async function manualOrg(name: string, planId: string, invoice: 'paid' | 'draft' | 'none') {
  const orgId = await makeOrg(name);
  await sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', '2026-11-17', null, 1)",
    [orgId, planId],
  );
  if (invoice === 'none') return orgId;
  const now = at('2026-11-17T01:00:00Z');
  const drafted = await draftBrandInvoice({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'current' });
  if (!drafted.ok) throw new Error(drafted.code);
  if (invoice === 'paid') {
    await issueBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
    await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id, paidMethod: 'transfer' });
  }
  return orgId;
}

const enginePlan = (organizationId: string, planId: string) =>
  setPlanAssignment({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, {
    organizationId,
    planId,
    billingMode: 'invoice',
    startedOn: '2026-11-17',
    endsOn: null,
    seats: null,
    note: '',
    expectedRevision: 1,
  });

const planForm = (organizationId: string, planId: string) =>
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
  });

beforeEach(async () => {
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  h = await adminHarness();
  sql = runner(h.db);
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  await sql.query(
    "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw",
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await h.close();
});

describe('plan forms mid-cycle (fix round 1, item 3)', () => {
  it('a higher plan is refused while an invoice covers today (paid or draft), on both forms, with a line pointing to 플랜 올림', async () => {
    const paid = await manualOrg('Plan Form Paid Fixture', 'b2b_29', 'paid');
    expect(await enginePlan(paid, 'b2b_69')).toMatchObject({ ok: false, code: 'conflict', field: 'plan_upgrade_required' });
    const engineOp = await h.run('brandEngine.plan', {
      organizationId: paid,
      expectedRevision: '1',
      planId: 'b2b_69',
      billingMode: 'invoice',
      startedOn: '2026-11-17',
      endsOn: '',
      note: '',
    });
    expect(engineOp).toMatchObject({ ok: false, detail: 'conflict:plan_upgrade_required' });
    const form = await planForm(paid, 'b2b_49');
    expect(form.ok).toBe(false);
    if (form.ok) return;
    expect(form.detail).toContain('plan_upgrade_required');
    expect(formatBillingOutcomeDetail(form.detail, 'ko')).toContain('플랜 올림');
    expect(formatBillingOutcomeDetail(form.detail, 'en')).toContain('upgrade');
    expect(await loadPlanAssignment(sql, paid)).toMatchObject({ planId: 'b2b_29', revision: 1 });
    expect(await loadAllowance(sql, paid, STUDIO, new Date('2026-11-25T02:00:00Z'))).toMatchObject({ capKrw: 270_000 });

    const draftOnly = await manualOrg('Plan Form Draft Fixture', 'b2b_29', 'draft');
    expect(await enginePlan(draftOnly, 'b2b_49')).toMatchObject({ ok: false, field: 'plan_upgrade_required' });
  });

  it('a lower plan through the form mid-cycle is unchanged (the lower cap applies at once; no invoice, no new cycle)', async () => {
    const orgId = await manualOrg('Plan Form Lower Fixture', 'b2b_49', 'paid');
    expect(await enginePlan(orgId, 'b2b_29')).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29', startedOn: '2026-11-17' });
    expect(await loadAllowance(sql, orgId, STUDIO, new Date('2026-11-25T02:00:00Z'))).toMatchObject({ capKrw: 270_000 });
  });

  it('with no invoice covering today the form raises the plan as before', async () => {
    const orgId = await manualOrg('Plan Form No Invoice Fixture', 'b2b_29', 'none');
    expect(await enginePlan(orgId, 'b2b_69')).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_69' });
    const other = await manualOrg('Plan Form No Invoice Form Fixture', 'b2b_29', 'none');
    expect(await planForm(other, 'b2b_49')).toMatchObject({ ok: true });
  });
});
