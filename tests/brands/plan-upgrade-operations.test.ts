import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatBillingOutcomeDetail } from '@/lib/admin/brand-billing-console';
import { parsePlanUpgradeDetail } from '@/lib/admin/plan-upgrade-detail';
import { draftBrandInvoice, issueBrandInvoice, markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { loadPlanAssignment } from '@/lib/brands/plans';
import { scheduleDowngrade } from '@/lib/brands/subscriptions';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/** B1c-3 (notes: B1c3-brief.md §3): the two admin operations, two-step confirm with a preview digest. */

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

async function manualPaidOrg(name: string) {
  const orgId = await makeOrg(name);
  await sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', '2026-11-17', null, 1)",
    [orgId],
  );
  const now = at('2026-11-17T01:00:00Z');
  const drafted = await draftBrandInvoice({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'current' });
  if (!drafted.ok) throw new Error(drafted.code);
  await issueBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
  await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id, paidMethod: 'transfer' });
  return orgId;
}

async function subscribedPaidOrg(name: string, planId = 'b2b_29') {
  const orgId = await makeOrg(name);
  const s = await startConfirmed({ sql, now: at('2026-11-17T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId, startedOn: '2026-11-17' });
  if (!s.ok || !s.applied) throw new Error('start failed');
  await markBrandInvoicePaid({ sql, now: at('2026-11-17T02:00:00Z') }, ADMIN_VIEWER, { invoiceId: s.firstInvoiceId, paidMethod: 'transfer', paidAt: '2026-11-17' });
  return orgId;
}

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

describe('brandBilling.planUpgrade (manual plan organizations, no flag)', () => {
  it('step 1 prepares a preview with its digest; step 2 needs the digest, the same plan and the confirm box', async () => {
    const orgId = await manualPaidOrg('Upgrade Op Manual Fixture');
    const step1 = await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_49' });
    expect(step1).toMatchObject({ ok: true, code: 'prepared' });
    if (!step1.ok) return;
    const preview = parsePlanUpgradeDetail(step1.detail);
    expect(preview).toMatchObject({
      oldPlanId: 'b2b_29',
      newPlanId: 'b2b_49',
      mode: 'manual',
      todayKst: '2026-11-25',
      oldCycle: { start: '2026-11-17', end: '2026-11-25', endBefore: '2026-12-17' },
      newCycle: { start: '2026-11-25', end: '2026-12-25' },
      carryKrw: 270_000,
      carryValidUntil: '2026-12-24',
      newPlanCapKrw: 460_000,
      newPlanCapUnpaidKrw: null,
      totalKrw: 539_000,
      dueOn: '2026-12-09',
    });
    const digest = preview!.digest;
    expect(await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_49', confirm: '1', _confirm: '1' })).toMatchObject({
      ok: false,
      code: 'invalid',
      detail: 'upgrade:preview_required',
    });
    expect(
      await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_69', confirm: '1', _confirm: '1', previewDigest: digest, previewPlanId: 'b2b_49' }),
    ).toMatchObject({ ok: false, code: 'invalid', detail: 'upgrade:preview_mismatch' });
    expect(
      await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_49', confirm: '1', previewDigest: digest, previewPlanId: 'b2b_49' }),
    ).toMatchObject({ ok: false, code: 'invalid', detail: 'upgrade:upgrade_confirm_check' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_29' });
    const done = await h.run('brandBilling.planUpgrade', {
      organizationId: orgId,
      planId: 'b2b_49',
      confirm: '1',
      _confirm: '1',
      previewDigest: digest,
      previewPlanId: 'b2b_49',
    });
    expect(done).toMatchObject({ ok: true, code: 'saved' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', startedOn: '2026-11-25' });
    const again = await h.run('brandBilling.planUpgrade', {
      organizationId: orgId,
      planId: 'b2b_49',
      confirm: '1',
      _confirm: '1',
      previewDigest: digest,
      previewPlanId: 'b2b_49',
    });
    expect(again).toMatchObject({ ok: false, detail: 'upgrade:conflict:already_upgraded_today' });
    expect(formatBillingOutcomeDetail(again.ok ? undefined : again.detail, 'ko')).toContain('오늘 이미 플랜을 올렸습니다');
  });

  it('works with BRAND_BILLING_AUTO_ISSUE off; refuses a subscribed organization (use the subscription operation)', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const subscribed = await subscribedPaidOrg('Upgrade Op Subscribed Manual Fixture');
    expect(await h.run('brandBilling.planUpgrade', { organizationId: subscribed, planId: 'b2b_49' })).toMatchObject({
      ok: false,
      detail: 'upgrade:conflict:subscription_upgrade_only',
    });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const orgId = await manualPaidOrg('Upgrade Op Flag Off Fixture');
    expect(await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_49' })).toMatchObject({ ok: true, code: 'prepared' });
  });
});

describe('brandSubscription.upgrade (subscribed organizations, flag on)', () => {
  it('flag off → disabled; flag on → preview and confirm; the downgrade operation points to the upgrade', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const orgId = await subscribedPaidOrg('Upgrade Op Subscription Fixture');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    expect(await h.run('brandSubscription.upgrade', { organizationId: orgId, planId: 'b2b_49' })).toMatchObject({ ok: false, code: 'disabled' });
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    expect(await scheduleDowngrade({ sql }, ADMIN_VIEWER, { organizationId: orgId, planId: 'b2b_69' })).toMatchObject({
      ok: false,
      code: 'invalid',
      field: 'planId',
      detail: 'upgrade_use_upgrade_operation',
    });
    const step1 = await h.run('brandSubscription.upgrade', { organizationId: orgId, planId: 'b2b_49' });
    expect(step1).toMatchObject({ ok: true, code: 'prepared' });
    if (!step1.ok) return;
    const preview = parsePlanUpgradeDetail(step1.detail);
    expect(preview).toMatchObject({ mode: 'subscription', newPlanCapUnpaidKrw: 230_000, totalKrw: 539_000 });
    const done = await h.run('brandSubscription.upgrade', {
      organizationId: orgId,
      planId: 'b2b_49',
      confirm: '1',
      _confirm: '1',
      previewDigest: preview!.digest,
      previewPlanId: 'b2b_49',
    });
    expect(done).toMatchObject({ ok: true, code: 'saved' });
    expect(await loadPlanAssignment(sql, orgId)).toMatchObject({ planId: 'b2b_49', startedOn: '2026-11-25', endsOn: '2026-12-09' });
  });

  it('every refusal reason has a Korean and an English line', () => {
    for (const token of [
      'already_upgraded_today',
      'current_cycle_unpaid',
      'current_cycle_not_invoiced',
      'current_cycle_waived',
      'current_invoice_not_cycle',
      'upgrade_on_cycle_start',
      'later_cycle_already_issued',
      'subscription_upgrade_only',
      'no_subscription',
      'subscription_not_active',
      'subscription_canceling',
      'plan_not_active',
      'no_plan',
      'not_an_upgrade',
      'same_plan',
      'project_only',
      'plan_cap_not_set',
      'cycle_mismatch',
      'overlapping_invoices',
      'outside_current_cycle',
      'upgrade_confirm_check',
      'upgrade_issue_failed',
    ]) {
      const ko = formatBillingOutcomeDetail(`upgrade:conflict:${token}`, 'ko')!;
      const en = formatBillingOutcomeDetail(`upgrade:conflict:${token}`, 'en')!;
      expect(ko, token).not.toBe(`upgrade:conflict:${token}`);
      expect(en, token).not.toBe(`upgrade:conflict:${token}`);
      expect(ko, token).toMatch(/[가-힣]/);
      expect(en, token).not.toMatch(/[가-힣]/);
    }
    // Fix round 1: the first day of a cycle says when an upgrade becomes possible, not to void a paid invoice.
    expect(formatBillingOutcomeDetail('upgrade:conflict:upgrade_on_cycle_start', 'ko')).toContain('주기 첫날에는 올릴 수 없습니다. 내일부터 올릴 수 있습니다.');
    expect(formatBillingOutcomeDetail('upgrade:conflict:upgrade_on_cycle_start', 'ko')).not.toContain('취소');
  });

  it('fix round 1: upgrade wording only for the two upgrade operations; shared codes of other operations keep their own lines', () => {
    // The downgrade operation's own refusals and the plan forms' pointer to the upgrade.
    expect(formatBillingOutcomeDetail('planId:same_plan', 'ko')).not.toContain('지금과 같은 플랜입니다');
    expect(formatBillingOutcomeDetail('planId:project_only_not_subscribable', 'ko')).toContain('프로젝트 전용 플랜은 정기구독');
    expect(formatBillingOutcomeDetail('planId:upgrade_use_upgrade_operation', 'ko')).toContain('플랜 올림');
    expect(formatBillingOutcomeDetail('conflict:plan_upgrade_required', 'ko')).toContain('플랜 올림');
    expect(formatBillingOutcomeDetail('conflict:plan_upgrade_required', 'en')).not.toMatch(/[가-힣]/);
    // The same tokens from an upgrade operation get the upgrade lines.
    expect(formatBillingOutcomeDetail('upgrade:planId:same_plan', 'ko')).toContain('지금과 같은 플랜입니다');
  });
});
