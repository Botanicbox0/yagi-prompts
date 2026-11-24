import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import { parsePlanUpgradeDetail } from '@/lib/admin/plan-upgrade-detail';
import {
  draftBrandInvoice,
  issueBrandInvoice,
  listBrandInvoices,
  markBrandInvoicePaid,
  saveBrandBillingProfileAdmin,
  voidBrandInvoice,
} from '@/lib/brands/billing';
import { loadPlanAssignment, setPlanAssignment } from '@/lib/brands/plans';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { makeSingleConnectionRunner, type SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * R3 fix round 1 (notes: R3-fixes-1.md, review R3-review.md): B1 the paid-date range bounds cycle invoices only; M1 the
 * downgrade refusal names what is true when the next cycle is already issued or paid, or today is a cycle's first day;
 * M2 `project_only` counts as a lower plan; M3 a cycle that began with a manual upgrade keeps its plan; M4 the due date of
 * a manually issued cycle invoice follows the engine rule `max(issue day, cycle start) + 14`. Flag off throughout.
 */

let h: AdminHarness;
let sql: SqlRunner;
const at = (iso: string) => () => new Date(iso);
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

async function assignPlan(orgId: string, planId: string, startedOn = '2026-11-17') {
  await sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', $3, null, 1)",
    [orgId, planId, startedOn],
  );
}

async function cycleInvoice(orgId: string, iso: string, state: 'draft' | 'issued' | 'paid', cycle: 'current' | 'next' = 'current') {
  const now = at(iso);
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

async function dueOn(id: string): Promise<string | null> {
  return (await sql.query<{ due_on: string | null }>('select due_on::text as due_on from brand_invoices where id = $1', [id])).rows[0]!.due_on;
}

/** The plan form as rendered, with the assignment's current revision and dates. */
async function planForm(organizationId: string, planId: string) {
  const current = await loadPlanAssignment(sql, organizationId);
  return h.run('brandBilling.planAndAllowance.set', {
    organizationId,
    expectedRevision: String(current?.revision ?? 0),
    planId,
    billingMode: 'invoice',
    startedOn: current?.startedOn ?? '2026-11-17',
    endsOn: current?.endsOn ?? '',
    planNote: current?.note ?? '',
    allowanceMode: 'plan_default',
    allowanceNote: '',
  });
}

/** "플랜 올림" on the manual path, both steps through the admin operation. */
async function manualUpgrade(organizationId: string, planId: string) {
  const step1 = await h.run('brandBilling.planUpgrade', { organizationId, planId });
  const preview = step1.ok ? parsePlanUpgradeDetail(step1.detail) : null;
  if (!preview) throw new Error(`upgrade preview: ${JSON.stringify(step1)}`);
  const step2 = await h.run('brandBilling.planUpgrade', {
    organizationId,
    planId,
    confirm: '1',
    previewDigest: preview.digest,
    previewPlanId: planId,
    _confirm: '1',
  });
  if (!step2.ok) throw new Error(`upgrade confirm: ${JSON.stringify(step2)}`);
}

const detailOf = (out: { ok: boolean; detail?: string }) => (out.ok ? '' : (out.detail ?? ''));
const ko = (out: { ok: boolean; detail?: string }) => formatBillingOutcomeDetail(detailOf(out), 'ko') ?? '';
const en = (out: { ok: boolean; detail?: string }) => formatBillingOutcomeDetail(detailOf(out), 'en') ?? '';

beforeEach(async () => {
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
  h = await adminHarness();
  sql = runner(h.db);
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await h.close();
});

describe('B1: the paid-date range bounds cycle invoices only', () => {
  it('a no-plan or override organization calendar-month invoice takes any paid date, with no extra statement', async () => {
    vi.setSystemTime(new Date('2026-11-26T03:00:00Z'));
    const now = at('2026-11-26T03:00:00Z');
    const monthInvoice = async (orgId: string, period: string) => {
      const d = await draftBrandInvoice({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, period, planId: 'b2b_29' });
      if (!d.ok) throw new Error(d.code);
      await issueBrandInvoice({ sql, now: at('2026-11-24T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: d.invoice.id });
      return d.invoice.id;
    };
    const noPlan = await makeOrg('B1 No Plan Fixture');
    expect(await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: await monthInvoice(noPlan, '2026-11'), paidAt: '2026-11-20', paidMethod: 'wire' })).toMatchObject({
      ok: true,
    });
    expect(await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: await monthInvoice(noPlan, '2026-12'), paidAt: '2026-11-30', paidMethod: 'wire' })).toMatchObject({
      ok: true,
    });
    const override = await makeOrg('B1 Override Fixture');
    await sql.query("insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note) values ($1, 777000, true, 'x')", [override]);
    expect(await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: await monthInvoice(override, '2026-11'), paidAt: '2026-11-01', paidMethod: 'wire' })).toMatchObject({
      ok: true,
    });

    // The same statements with an out-of-range paid date as without one (only the paid instant differs).
    const texts = async (invoiceId: string, paidAt?: string) => {
      const log: string[] = [];
      const rec = makeSingleConnectionRunner(async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => {
        log.push(text.replace(/\s+/g, ' ').trim());
        return sql.query<T>(text, params);
      });
      expect(await markBrandInvoicePaid({ sql: rec, now }, ADMIN_VIEWER, { invoiceId, paidMethod: 'wire', ...(paidAt ? { paidAt } : {}) })).toMatchObject({ ok: true });
      return log;
    };
    const other = await makeOrg('B1 Statements Fixture');
    expect(await texts(await monthInvoice(other, '2026-11'), '2026-11-01')).toEqual(await texts(await monthInvoice(other, '2026-12')));
  });

  it('a cycle invoice is still bounded', async () => {
    await sql.query(DEFAULTS_SQL);
    const orgId = await makeOrg('B1 Cycle Fixture');
    await assignPlan(orgId, 'b2b_29');
    const id = await cycleInvoice(orgId, '2026-11-24T03:00:00Z', 'issued');
    expect(await markBrandInvoicePaid({ sql, now: at('2026-11-26T03:00:00Z') }, ADMIN_VIEWER, { invoiceId: id, paidAt: '2026-11-20', paidMethod: 'wire' })).toEqual({
      ok: false,
      code: 'invalid',
      detail: 'paid_at_before_issue:2026-11-24~2026-11-26',
    });
  });
});

describe('M1–M3: the downgrade refusal says what is true', () => {
  beforeEach(async () => {
    await sql.query(DEFAULTS_SQL);
  });

  it('M1: the next cycle invoice already issued — cancel it first; on its first day — cancel, change, issue again (12-16 / 12-17)', async () => {
    vi.setSystemTime(new Date('2026-12-10T01:00:00Z'));
    const orgId = await makeOrg('M1 Issued Next Fixture');
    await assignPlan(orgId, 'b2b_69');
    await cycleInvoice(orgId, '2026-11-17T01:00:00Z', 'paid');
    await cycleInvoice(orgId, '2026-12-10T01:00:00Z', 'issued', 'next');

    vi.setSystemTime(new Date('2026-12-16T01:00:00Z'));
    const before = await planForm(orgId, 'b2b_29');
    expect(before).toMatchObject({ ok: false, code: 'billingConflict', detail: 'conflict:plan_downgrade_next_issued:2026-12-17' });
    expect(ko(before)).toContain('다음 주기 청구서가 이미 발행되어 있습니다. 그 청구서를 취소한 뒤 다음 주기 시작일(12월 17일)에 바꾸세요.');
    expect(en(before)).toMatch(/already issued.*Dec 17/);
    expect(en(before)).not.toMatch(/[가-힣]/);

    vi.setSystemTime(new Date('2026-12-17T01:00:00Z'));
    const firstDay = await planForm(orgId, 'b2b_29');
    expect(firstDay).toMatchObject({ ok: false, code: 'billingConflict', detail: 'conflict:plan_downgrade_cycle_issued_today:2026-12-17' });
    expect(ko(firstDay)).toContain('오늘 시작한 주기의 청구서가 이미 발행되어 있습니다. 그 청구서를 취소하고 플랜을 바꾼 뒤 다시 발행하세요.');
    expect(en(firstDay)).not.toMatch(/[가-힣]/);
    expect(
      await setPlanAssignment({ sql, now: at('2026-12-17T01:00:00Z') }, ADMIN_VIEWER, {
        organizationId: orgId,
        planId: 'b2b_29',
        billingMode: 'invoice',
        startedOn: '2026-11-17',
        endsOn: null,
        seats: null,
        note: '',
        expectedRevision: 1,
      }),
    ).toMatchObject({ ok: false, code: 'conflict', field: 'plan_downgrade_cycle_issued_today', detail: '2026-12-17' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_69' });
  });

  it('M1: the next cycle already paid keeps its plan — the day named is the start of the cycle after it', async () => {
    vi.setSystemTime(new Date('2026-12-10T01:00:00Z'));
    const orgId = await makeOrg('M1 Paid Next Fixture');
    await assignPlan(orgId, 'b2b_69');
    await cycleInvoice(orgId, '2026-11-17T01:00:00Z', 'paid');
    await cycleInvoice(orgId, '2026-12-10T01:00:00Z', 'paid', 'next');

    vi.setSystemTime(new Date('2026-12-16T01:00:00Z'));
    const before = await planForm(orgId, 'b2b_29');
    expect(before).toMatchObject({ ok: false, detail: 'conflict:plan_downgrade_next_paid:2027-01-17' });
    expect(ko(before)).toContain('다음 주기 청구서도 이미 입금되어 그 주기는 지금 플랜으로 이용합니다. 낮은 플랜은 그다음 주기 시작일(1월 17일)에 바꾸세요.');
    expect(en(before)).toMatch(/already paid.*Jan 17/);
    vi.setSystemTime(new Date('2026-12-17T01:00:00Z'));
    // Paid on its first day: the mid-cycle line with the next cycle's start day.
    const firstDay = await planForm(orgId, 'b2b_29');
    expect(firstDay).toMatchObject({ ok: false, detail: 'conflict:plan_downgrade_next_cycle:2027-01-17' });
    expect(ko(firstDay)).toContain('주기 중간에는 낮은 플랜으로 바꿀 수 없습니다. 다음 주기 시작일(1월 17일)에 바꾸세요.');
  });

  it('M2: project_only counts as a lower plan — refused while an issued or paid invoice covers today, allowed otherwise', async () => {
    const paid = await makeOrg('M2 Paid Fixture');
    await assignPlan(paid, 'b2b_49');
    await cycleInvoice(paid, '2026-11-17T01:00:00Z', 'paid');
    const out = await planForm(paid, 'project_only');
    expect(out).toMatchObject({ ok: false, code: 'billingConflict', detail: 'conflict:plan_downgrade_next_cycle:2026-12-17' });
    expect(ko(out)).toContain('다음 주기 시작일(12월 17일)에 바꾸세요.');
    expect(await loadPlanAssignment(sql, paid)).toMatchObject({ planId: 'b2b_49' });
    const issued = await makeOrg('M2 Issued Fixture');
    await assignPlan(issued, 'b2b_29');
    await cycleInvoice(issued, '2026-11-17T01:00:00Z', 'issued');
    expect(await planForm(issued, 'project_only')).toMatchObject({ ok: false, detail: 'conflict:plan_downgrade_next_cycle:2026-12-17' });

    const draftOnly = await makeOrg('M2 Draft Fixture');
    await assignPlan(draftOnly, 'b2b_49');
    await cycleInvoice(draftOnly, '2026-11-17T01:00:00Z', 'draft');
    expect(await planForm(draftOnly, 'project_only')).toMatchObject({ ok: true });
    const none = await makeOrg('M2 None Fixture');
    await assignPlan(none, 'b2b_49');
    expect(await planForm(none, 'project_only')).toMatchObject({ ok: true });
    expect(await loadPlanAssignment(sql, none)).toMatchObject({ planId: 'project_only' });
  });

  it('M3: a cycle that began with a manual upgrade keeps its plan until the next cycle, whatever its invoice status', async () => {
    const upgraded = async (name: string) => {
      vi.setSystemTime(new Date('2026-11-17T01:00:00Z'));
      const orgId = await makeOrg(name);
      await assignPlan(orgId, 'b2b_29');
      await cycleInvoice(orgId, '2026-11-17T01:00:00Z', 'paid');
      vi.setSystemTime(new Date('2026-11-25T01:00:00Z'));
      await manualUpgrade(orgId, 'b2b_49');
      const draft = (await listBrandInvoices(sql, { organizationId: orgId })).find((i) => i.status === 'draft' && i.cycleStart === '2026-11-25');
      if (!draft) throw new Error('no upgraded draft');
      return { orgId, draftId: draft.id };
    };
    const LINE = '이번 주기는 플랜 올림으로 시작했습니다. 낮은 플랜은 다음 주기 시작일(12월 25일)에 바꾸세요.';
    const refused = async (orgId: string, planId = 'b2b_29') => {
      const out = await planForm(orgId, planId);
      expect(out).toMatchObject({ ok: false, code: 'billingConflict', detail: 'conflict:plan_downgrade_upgraded_cycle:2026-12-25' });
      expect(ko(out)).toContain(LINE);
      expect(en(out)).toMatch(/plan upgrade.*Dec 25/);
    };

    const { orgId, draftId } = await upgraded('M3 Upgrade Fixture');
    await refused(orgId); // the same day, draft only
    await refused(orgId, 'project_only');
    vi.setSystemTime(new Date('2026-12-01T01:00:00Z'));
    await refused(orgId); // later in the cycle, still a draft
    expect((await issueBrandInvoice({ sql, now: at('2026-12-01T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: draftId })).ok).toBe(true);
    await refused(orgId); // issued
    vi.setSystemTime(new Date('2026-12-02T01:00:00Z'));
    expect((await markBrandInvoicePaid({ sql, now: at('2026-12-02T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: draftId, paidMethod: 'transfer' })).ok).toBe(true);
    await refused(orgId); // paid
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', startedOn: '2026-11-25' });
    // The next cycle (12-25) is an ordinary one: nothing issued covers it, the lower plan goes through.
    vi.setSystemTime(new Date('2026-12-25T01:00:00Z'));
    expect(await planForm(orgId, 'b2b_29')).toMatchObject({ ok: true });

    // Voiding the upgraded cycle's draft does not lift it (the carry was given for the higher plan).
    const voided = await upgraded('M3 Voided Fixture');
    expect((await voidBrandInvoice({ sql, now: at('2026-11-25T02:00:00Z') }, ADMIN_VIEWER, { invoiceId: voided.draftId, reason: 'redo' })).ok).toBe(true);
    await refused(voided.orgId);
  });
});

describe('M4: due date = max(issue day, cycle start) + 14, the engine rule', () => {
  it('issued before, on and after the cycle start, and at a month end', async () => {
    await sql.query(DEFAULTS_SQL);
    const orgId = await makeOrg('M4 Due Fixture');
    await assignPlan(orgId, 'b2b_29');
    expect(await dueOn(await cycleInvoice(orgId, '2026-11-17T01:00:00Z', 'issued'))).toBe('2026-12-01'); // on the start
    expect(await dueOn(await cycleInvoice(orgId, '2026-12-10T01:00:00Z', 'issued', 'next'))).toBe('2026-12-31'); // before (12-17)
    const after = await makeOrg('M4 Due After Fixture');
    await assignPlan(after, 'b2b_29');
    expect(await dueOn(await cycleInvoice(after, '2026-11-24T03:00:00Z', 'issued'))).toBe('2026-12-08'); // after

    const monthEnd = await makeOrg('M4 Month End Fixture');
    await assignPlan(monthEnd, 'b2b_29', '2027-01-31');
    expect(await dueOn(await cycleInvoice(monthEnd, '2027-01-31T03:00:00Z', 'issued'))).toBe('2027-02-14');
    // The next cycle starts on 02-28 (month-end clamp); issued early on 02-20.
    expect(await dueOn(await cycleInvoice(monthEnd, '2027-02-20T03:00:00Z', 'issued', 'next'))).toBe('2027-03-14');
  });
});
