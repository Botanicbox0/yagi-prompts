import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPlanUpgradeDetail, parsePlanUpgradeDetail } from '@/lib/admin/plan-upgrade-detail';
import { draftBrandInvoice, issueBrandInvoice, markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { listPlanUpgradeCarries } from '@/lib/brands/billing/plan-upgrade-apply';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { adminConsoleEn, adminConsoleKo } from '@/messages/admin-console';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { startConfirmed } from '@/tests/brands/helpers/subscription-confirm';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1c-3 admin screens: "플랜 올림" on the subscription card and the plan panel, the step-1 preview and step-2 confirm
 * form, and the carry grant in the grant list — rendered through the real organization page. "Now" is fixed at
 * 2026-11-25 10:00 KST; the fixtures' plans start on 2026-11-17 (cycle 11-17 ~ 12-16, paid).
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

const NOW = new Date('2026-11-25T01:00:00Z');
const at = (iso: string) => () => new Date(iso);

let h: AdminHarness;
let sql: SqlRunner;

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
  if (!saved.ok) throw new Error(saved.code);
  return res.id;
}

/** A manual plan organization whose current cycle (11-17 ~ 12-16) is invoiced and paid. */
async function manualPaidOrg(name: string, planId = 'b2b_29'): Promise<string> {
  const orgId = await makeOrg(name);
  await sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', '2026-11-17', null, 1)",
    [orgId, planId],
  );
  const now = at('2026-11-17T01:00:00Z');
  const drafted = await draftBrandInvoice({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'current' });
  if (!drafted.ok) throw new Error(drafted.code);
  await issueBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
  await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id, paidMethod: 'transfer' });
  return orgId;
}

/** A subscribed organization (flag on) whose first invoice is paid. */
async function subscribedPaidOrg(name: string, planId = 'b2b_29'): Promise<string> {
  const orgId = await makeOrg(name);
  const s = await startConfirmed({ sql, now: at('2026-11-17T01:00:00Z') }, ADMIN_VIEWER, { organizationId: orgId, planId, startedOn: '2026-11-17' });
  if (!s.ok || !s.applied) throw new Error('start failed');
  await markBrandInvoicePaid({ sql, now: at('2026-11-17T02:00:00Z') }, ADMIN_VIEWER, {
    invoiceId: s.firstInvoiceId,
    paidMethod: 'transfer',
    paidAt: '2026-11-17',
  });
  return orgId;
}

/** The element that carries `marker`, up to the first `close` after it. */
function slice(html: string, marker: string, open: string, close: string): string {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  return html.slice(html.lastIndexOf(open, at), html.indexOf(close, at) + close.length);
}
const FORM = (mode: string) => `data-plan-upgrade-form="true" data-plan-upgrade-mode="${mode}"`;
const upgradeForm = (html: string, mode: string) => slice(html, FORM(mode), '<div', '</form>');
const between = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
/** The preview block: from its marker to the end of the confirm form inside it. */
const previewBlock = (html: string) => slice(html, 'data-plan-upgrade-preview=', '<div', '</form>');
const confirmForm = (html: string) => slice(html, 'data-plan-upgrade-confirm=', '<div', '</form>');

async function prepared(op: 'brandBilling.planUpgrade' | 'brandSubscription.upgrade', organizationId: string, planId: string) {
  const step1 = await h.run(op, { organizationId, planId });
  if (!step1.ok || step1.code !== 'prepared' || !step1.detail) throw new Error(`step 1 failed: ${JSON.stringify(step1)}`);
  return step1.detail;
}

beforeEach(async () => {
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  h = await adminHarness();
  sql = runner(h.db);
  ssrMocks.sql = sql;
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  await sql.query(
    "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw",
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await h.close();
});

describe('plan upgrade form', () => {
  it('subscribed organization: the form is on the subscription card, with higher plans only', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const orgId = await subscribedPaidOrg('Upgrade UI Subscribed Fixture');
    const html = await renderOrg(orgId);
    const form = upgradeForm(html, 'subscription');
    expect(form).toContain('value="brandSubscription.upgrade"');
    expect(form).toContain('<option value="b2b_49"');
    expect(form).toContain('<option value="b2b_69"');
    expect(form).not.toContain('<option value="b2b_29"');
    expect(html.indexOf(FORM('subscription'))).toBeGreaterThan(html.indexOf('id="billing-subscription"'));
    // Not also on the plan panel while the subscription lives.
    expect(html).not.toContain(FORM('manual'));
  });

  it('manual plan organization: the form is on the plan panel', async () => {
    const orgId = await manualPaidOrg('Upgrade UI Manual Fixture');
    const html = await renderOrg(orgId);
    const panel = between(html, 'id="billing-plan-allowance"', 'id="billing-profile"');
    const form = upgradeForm(panel, 'manual');
    expect(form).toContain('value="brandBilling.planUpgrade"');
    expect(form).toContain('<option value="b2b_49"');
    expect(form).toContain('<option value="b2b_69"');
    expect(form).not.toContain('<option value="b2b_29"');
    expect(html).not.toContain(FORM('subscription'));
  });

  it('fix round 1: with the flag off, an organization with a non-ended subscription gets no manual form', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const orgId = await subscribedPaidOrg('Upgrade UI Flag Off Fixture');
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
    const html = await renderOrg(orgId);
    expect(html).not.toContain(FORM('manual'));
    expect(html).not.toContain(FORM('subscription'));
  });

  it('b2b_69 (nothing higher) and an organization without a plan get no form', async () => {
    const top = await manualPaidOrg('Upgrade UI Top Plan Fixture', 'b2b_69');
    expect(await renderOrg(top)).not.toContain('data-plan-upgrade-form');
    const none = await makeOrg('Upgrade UI No Plan Fixture');
    expect(await renderOrg(none)).not.toContain('data-plan-upgrade-form');
  });
});

describe('plan upgrade preview and confirm', () => {
  it('manual: every preview line, then the confirm form with the digest and the previewed plan', async () => {
    const orgId = await manualPaidOrg('Upgrade UI Preview Fixture');
    const detail = await prepared('brandBilling.planUpgrade', orgId, 'b2b_49');
    const digest = parsePlanUpgradeDetail(detail)!.digest;
    const html = await renderOrg(orgId, { ok: 'prepared', detail });

    const preview = previewBlock(html);
    expect(preview).toContain('data-plan-upgrade-mode="manual"');
    expect(preview).toContain('플랜 올림 미리보기: 29 플랜 → 49 플랜');
    expect(preview).toContain('지금 주기 11월 17일 ~ 12월 16일 → 11월 24일에 끝남(오늘 전날)');
    expect(preview).toContain('새 주기 11월 25일 ~ 12월 24일 · 다음 청구일 12월 25일');
    expect(preview).toContain('이월 크레딧 27,000, 새 주기 끝(12월 24일)에 소멸');
    expect(preview).toContain('새 플랜 크레딧 46,000');
    expect(preview).toContain('청구 금액 539,000원 (공급가 490,000원 + 부가세 49,000원, 할인 0%) · 납기 12월 9일');
    // Fix round 1: say that the credits open at once and the new cycle's invoice is a draft the admin still issues.
    expect(preview).toContain('새 플랜 크레딧은 바로 열립니다. 새 주기 청구서는 초안으로 만들어지고, 청구서 목록에서 직접 발행해야 합니다');
    expect(preview).toContain('이전 플랜의 남은 기간은 환불하지 않습니다');
    expect(preview).not.toContain('data-upgrade-line="downgrade-cleared"');
    expect(preview).not.toContain('data-upgrade-line="drafts-voided"');
    // It sits on the plan panel.
    expect(between(html, 'id="billing-plan-allowance"', 'id="billing-profile"')).toContain('data-plan-upgrade-preview');

    const confirm = confirmForm(html);
    expect(confirm).toContain('value="brandBilling.planUpgrade"');
    expect(confirm).toContain(`name="previewDigest" value="${digest}"`);
    expect(confirm).toContain('name="previewPlanId" value="b2b_49"');
    expect(confirm).toContain('name="planId" value="b2b_49"');
    expect(confirm).toContain('name="confirm" value="1"');
    expect(confirm).toContain('name="_confirm"');

    // The banner says what to do; the raw preview string is not shown.
    expect(html).toContain('플랜 올림 미리보기 완료');
    expect(html).not.toContain('mode=manual|today=');
  });

  it('subscription: the unpaid/paid credits, issued today, on the subscription card', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const orgId = await subscribedPaidOrg('Upgrade UI Subscription Preview Fixture');
    const detail = await prepared('brandSubscription.upgrade', orgId, 'b2b_49');
    const html = await renderOrg(orgId, { ok: 'prepared', detail });
    const preview = previewBlock(html);
    expect(preview).toContain('data-plan-upgrade-mode="subscription"');
    // B1c-2 fix round: full until the due date, half only once the new invoice is overdue and unpaid.
    expect(preview).toContain('새 플랜 크레딧 46,000 · 납기(12월 9일)가 지나도 미납이면 23,000');
    expect(preview).toContain('오늘 바로 발행됩니다');
    expect(preview).toContain('이전 플랜의 남은 기간은 환불하지 않습니다');
    expect(html.indexOf('data-plan-upgrade-preview')).toBeGreaterThan(html.indexOf('id="billing-subscription"'));
    expect(confirmForm(html)).toContain('value="brandSubscription.upgrade"');
  });

  it('the conditional lines: a cleared scheduled downgrade, voided drafts and no carry', async () => {
    const orgId = await manualPaidOrg('Upgrade UI Lines Fixture');
    const detail = formatPlanUpgradeDetail({
      oldPlanId: 'b2b_29',
      newPlanId: 'b2b_49',
      mode: 'manual',
      todayKst: '2026-11-25',
      oldCycle: { start: '2026-11-17', end: '2026-11-25', endBefore: '2026-12-17' },
      newCycle: { start: '2026-11-25', end: '2026-12-25' },
      carryKrw: 0,
      carryValidUntil: '2026-12-24',
      newPlanCapKrw: 460_000,
      newPlanCapUnpaidKrw: null,
      supplyKrw: 441_000,
      vatKrw: 44_100,
      totalKrw: 485_100,
      discountPercent: 10,
      dueOn: '2026-12-09',
      scheduledDowngradeCleared: 'b2b_29',
      draftsVoided: 2,
      digest: '0123456789abcdef',
    });
    const preview = previewBlock(await renderOrg(orgId, { ok: 'prepared', detail }));
    expect(preview).toContain('이월 없음');
    expect(preview).toContain('예약된 플랜 내림 29 플랜 취소');
    expect(preview).toContain('취소되는 초안 청구서 2건');
    expect(preview).toContain('할인 10%');
  });
});

describe('carry grant after an upgrade', () => {
  it('a real two-step upgrade: the carry row shows 이월, its days and expiry, and the new cycle', async () => {
    const orgId = await manualPaidOrg('Upgrade UI Carry Fixture');
    const detail = await prepared('brandBilling.planUpgrade', orgId, 'b2b_49');
    const done = await h.run('brandBilling.planUpgrade', {
      organizationId: orgId,
      planId: 'b2b_49',
      previewPlanId: 'b2b_49',
      previewDigest: parsePlanUpgradeDetail(detail)!.digest,
      confirm: '1',
      _confirm: '1',
    });
    expect(done).toMatchObject({ ok: true, code: 'saved' });
    // Fix round 1: the manual result says the credits are open and the new cycle's invoice is a draft to issue; the plan
    // panel warns until that invoice is issued.
    if (!done.ok) return;
    expect(done.detail).toMatch(/^upgrade_manual_draft:[0-9a-f-]{36}$/);
    const saved = await renderOrg(orgId, { ok: 'saved', detail: done.detail! });
    expect(saved).toContain('플랜을 올렸습니다. 새 플랜 크레딧은 바로 열렸고, 새 주기 청구서는 아직 초안입니다. 청구서 목록에서 발행하세요');
    const panel = between(saved, 'id="billing-plan-allowance"', 'id="billing-profile"');
    expect(panel).toContain('data-plan-upgrade-unissued');
    expect(panel).toContain('올린 주기의 청구서가 아직 발행되지 않았습니다');
    const [carry] = await listPlanUpgradeCarries(sql, orgId);
    expect(carry).toMatchObject({ validFrom: '2026-11-25', validUntil: '2026-12-24', revoked: false });

    const html = await renderOrg(orgId);
    const row = slice(html, `data-grant-row="${carry!.id}"`, '<tr', '</tr>');
    expect(row).toContain('data-grant-carry');
    expect(row).toContain('이월(플랜 올림)');
    expect(row).toContain('11월 25일 ~ 12월 24일, 새 주기 끝에 소멸');
    expect(slice(row, 'data-grant-cycle=', '<span', '</span>')).toContain('이번 주기 끝(12월 24일)까지');
    // The plan is now b2b_69-only upgradable.
    const form = upgradeForm(html, 'manual');
    expect(form).toContain('<option value="b2b_69"');
    expect(form).not.toContain('<option value="b2b_49"');
    // Once the admin issues the new cycle's invoice the warning goes away.
    const draftId = done.detail!.slice('upgrade_manual_draft:'.length);
    expect(await issueBrandInvoice({ sql, now: () => NOW }, ADMIN_VIEWER, { invoiceId: draftId })).toMatchObject({ ok: true });
    expect(await renderOrg(orgId)).not.toContain('data-plan-upgrade-unissued');
  });
});

describe('dictionary', () => {
  it('ko and en carry the same plan-upgrade keys, and ko is not English', () => {
    const pick = (o: Record<string, unknown>) => Object.keys(o).filter((k) => /^(planUpgrade|grantCarry)/.test(k)).sort();
    const ko = adminConsoleKo.brandOrgDetail.billing as unknown as Record<string, string>;
    const en = adminConsoleEn.brandOrgDetail.billing as unknown as Record<string, string>;
    expect(pick(ko)).toEqual(pick(en));
    expect(pick(ko).length).toBeGreaterThanOrEqual(20);
    for (const key of pick(ko)) {
      expect(ko[key], key).toMatch(/[가-힣]/);
      expect(en[key], key).not.toMatch(/[가-힣]/);
    }
  });
});
