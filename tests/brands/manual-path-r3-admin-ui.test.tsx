import { randomUUID } from 'node:crypto';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatSubscriptionStartDetail } from '@/lib/admin/billing-preview-detail';
import { outcomeUrl } from '@/lib/admin/dispatch';
import { draftBrandInvoice, issueBrandInvoice, markBrandInvoicePaid, saveBrandBillingProfileAdmin } from '@/lib/brands/billing';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { pre0182Db } from '@/tests/brands/helpers/invoice-flag-off-parity';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * R3 admin screens (manual path, `BRAND_BILLING_AUTO_ISSUE` off): the upgrade confirm after the redirect (item 1), the
 * tax-invoice control (item 2), the due date (item 4), what applies when a plan default is unset (item 6) and the screen
 * details of item 8 — rendered through the real organization and billing pages. "Now" is 2026-11-25 10:00 KST.
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

const ko = getDictionary('ko');
const od = ko.adminConsole.brandOrgDetail;
const NOW = new Date('2026-11-25T01:00:00Z');
const at = (iso: string) => () => new Date(iso);
const DEFAULTS_SQL =
  "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000), ('b2b_49', 460000), ('b2b_69', 650000) on conflict (plan_id) do update set monthly_cap_krw = excluded.monthly_cap_krw";

let h: AdminHarness;
let sql: SqlRunner;

async function render(page: Promise<React.ReactNode>): Promise<string> {
  return new Response((await prerender(await page, { signal: AbortSignal.timeout(5000) })).prelude).text();
}

async function renderOrg(id: string, searchParams: Record<string, string> = {}): Promise<string> {
  const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
  return render(OrgDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(searchParams) }));
}

async function renderBilling(searchParams: Record<string, string> = {}): Promise<string> {
  const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
  return render(BrandBillingPage({ searchParams: Promise.resolve(searchParams) }));
}

async function makeOrg(name: string, on: SqlRunner = sql): Promise<string> {
  const res = await createStudioOrganization({ sql: on }, ADMIN_VIEWER, { name, requestId: randomUUID() });
  if (!res.ok) throw new Error(res.code);
  const saved = await saveBrandBillingProfileAdmin({ sql: on }, ADMIN_VIEWER, {
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

async function planOrg(name: string, planId: string, invoice: 'paid' | 'issued' | 'none', startedOn = '2026-11-17', endsOn: string | null = null) {
  const orgId = await makeOrg(name);
  await sql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, $2, 'invoice', $3, $4, 1)",
    [orgId, planId, startedOn, endsOn],
  );
  if (invoice === 'none') return { orgId, invoiceId: null };
  const now = at(`${startedOn}T01:00:00Z`);
  const drafted = await draftBrandInvoice({ sql, now }, ADMIN_VIEWER, { organizationId: orgId, cycle: 'current' });
  if (!drafted.ok) throw new Error(drafted.code);
  await issueBrandInvoice({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
  if (invoice === 'paid') await markBrandInvoicePaid({ sql, now }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id, paidMethod: 'transfer' });
  return { orgId, invoiceId: drafted.invoice.id };
}

/** The `detail` as the page receives it after the operation's redirect. */
function afterRedirect(back: string, outcome: { ok: true; code: 'prepared'; detail?: string }): Record<string, string> {
  const url = new URL(outcomeUrl(back, outcome), 'https://admin.twings.app');
  return Object.fromEntries(url.searchParams.entries());
}

const banner = (html: string) => /<div role="status"[\s\S]*?<\/div>/.exec(html)?.[0] ?? '';
const rowOf = (html: string, invoiceId: string) => {
  const i = html.indexOf(`data-invoice-row="${invoiceId}"`);
  return i < 0 ? '' : html.slice(i, html.indexOf('</tr>', i));
};

beforeEach(async () => {
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'off');
  h = await adminHarness();
  sql = runner(h.db);
  ssrMocks.sql = sql;
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await h.close();
});

describe('R3 item 1: the upgrade confirm survives the redirect; each prepared state has its own headline', () => {
  it('after step 1 of "플랜 올림" the page shows the preview, the confirm button and the upgrade headline', async () => {
    await sql.query(DEFAULTS_SQL);
    const { orgId } = await planOrg('UI Upgrade Fixture', 'b2b_29', 'paid');
    const step1 = await h.run('brandBilling.planUpgrade', { organizationId: orgId, planId: 'b2b_69' });
    if (!step1.ok || step1.code !== 'prepared') throw new Error(JSON.stringify(step1));
    const params = afterRedirect(`/admin/brand-workspace/organizations/${orgId}#billing-plan-allowance`, { ok: true, code: 'prepared', detail: step1.detail });
    const html = await renderOrg(orgId, params);
    expect(html).toContain('data-plan-upgrade-confirm');
    expect(html).toContain(od.billing.planUpgradeConfirmSubmit);
    expect(banner(html)).toContain(od.billing.planUpgradePreviewedBanner);
    expect(banner(html)).not.toContain(od.billing.subscriptionPreviewedBanner);
  });

  it('a start preview without early access and an unknown prepared detail do not read as the early-access preview', async () => {
    const orgId = await makeOrg('UI Prepared Fixture');
    const start = formatSubscriptionStartDetail({
      planId: 'b2b_29',
      startedOn: '2026-11-25',
      activateBeforePayment: false,
      dueOn: '2026-12-09',
      totalKrw: 319_000,
      digest: '0123456789abcdef',
      shortWindow: false,
    });
    const startHtml = await renderOrg(orgId, { ok: 'prepared', detail: start });
    expect(banner(startHtml)).toContain(od.billing.subscriptionStartPreviewedBanner);
    expect(banner(startHtml)).not.toContain('우선 개방');
    const unknown = await renderOrg(orgId, { ok: 'prepared', detail: 'upgrade=b2b_29>b2b_69|mode=manual|tod' });
    expect(banner(unknown)).toContain(od.billing.previewNeutralBanner);
    expect(banner(unknown)).not.toContain('우선 개방');
  });
});

describe('R3 item 2 and 4: the manual invoice row with the flag off', () => {
  it('an issued cycle invoice shows its due date and the tax-invoice control; recording shows date and reference', async () => {
    await sql.query(DEFAULTS_SQL);
    const { orgId, invoiceId } = await planOrg('UI Tax Fixture', 'b2b_29', 'issued', '2026-11-25');
    const html = await renderOrg(orgId);
    const row = rowOf(html, invoiceId!);
    expect(row).toContain('data-invoice-due-on="2026-12-09"');
    expect(row.replace(/<!-- -->/g, '')).toContain(`${od.billing.invoiceDueOn}: 2026-12-09`);
    expect(row).toContain('brandBilling.invoice.recordTaxInvoice');
    expect(row).toContain(od.billing.taxInvoiceUnissued);

    expect(await h.run('brandBilling.invoice.recordTaxInvoice', { invoiceId: invoiceId!, issuedOn: '2026-11-25', ref: 'HT-UI-0001' })).toMatchObject({ ok: true });
    const after = rowOf(await renderOrg(orgId), invoiceId!);
    expect(after).toContain('2026-11-25');
    expect(after).toContain('HT-UI-0001');
  });

  it('a sandboxed organization gets no control; before 0182 the page renders without it', async () => {
    const sandboxed = await makeOrg('Morphic UI Fixture');
    const drafted = await draftBrandInvoice({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: sandboxed, period: '2026-11', planId: 'b2b_29' });
    if (!drafted.ok) throw new Error(drafted.code);
    await issueBrandInvoice({ sql, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: drafted.invoice.id });
    expect(rowOf(await renderOrg(sandboxed), drafted.invoice.id)).not.toContain('brandBilling.invoice.recordTaxInvoice');

    const db = await pre0182Db();
    try {
      const old = runner(db);
      ssrMocks.sql = old;
      await seedProfile(old, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      const oldOrg = await makeOrg('Pre 0182 UI Fixture', old);
      const month = await draftBrandInvoice({ sql: old, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { organizationId: oldOrg, period: '2026-11', planId: 'b2b_29' });
      if (!month.ok) throw new Error(month.code);
      await issueBrandInvoice({ sql: old, now: at('2026-11-25T01:00:00Z') }, ADMIN_VIEWER, { invoiceId: month.invoice.id });
      const html = await renderOrg(oldOrg);
      expect(html).toContain(`data-invoice-row="${month.invoice.id}"`);
      expect(html).not.toContain('brandBilling.invoice.recordTaxInvoice');
    } finally {
      ssrMocks.sql = sql;
      await db.close();
    }
  });
});

describe('R3 item 6: an unset plan default says what applies', () => {
  it('the plan form and the defaults panel show the confirmed credits instead of the env fallback', async () => {
    const { orgId } = await planOrg('UI Unset Default Fixture', 'b2b_29', 'none');
    const org = await renderOrg(orgId);
    expect(org).toContain('현재 플랜 기본값: 미설정 — 확정 기본값 27,000크레딧 적용');
    expect(org).not.toContain('폴백');

    const billing = await renderBilling();
    const row29 = billing.match(/data-plan-default-row="b2b_29"[\s\S]*?<\/form>/)?.[0] ?? '';
    expect(row29).toContain('미설정 — 확정 기본값 27,000크레딧 적용');
    const row69 = billing.match(/data-plan-default-row="b2b_69"[\s\S]*?<\/form>/)?.[0] ?? '';
    expect(row69).toContain('미설정 — 확정 기본값 65,000크레딧 적용');
    expect(billing).not.toContain('폴백');
  });
});

describe('R3 item 8: admin screen details', () => {
  it('"월 한도 기준" preselects what is true; the default selection saves', async () => {
    const plain = await makeOrg('UI Mode Plain Fixture');
    const plainHtml = await renderOrg(plain);
    expect(plainHtml).toMatch(/<option value="plan_default" selected="">/);
    // The form as rendered (no plan, plan default, no cap) saves.
    expect(
      await h.run('brandBilling.planAndAllowance.set', {
        organizationId: plain,
        expectedRevision: '0',
        planId: '',
        billingMode: 'invoice',
        startedOn: '2026-11-25',
        endsOn: '',
        seats: '',
        planNote: '',
        allowanceMode: 'plan_default',
        monthlyCapKrw: '',
        preferredLane: '',
        allowanceNote: '',
      }),
    ).toMatchObject({ ok: true });
    // Choosing a plan with the default selection saves too.
    expect(
      await h.run('brandBilling.planAndAllowance.set', {
        organizationId: plain,
        expectedRevision: '0',
        planId: 'b2b_29',
        billingMode: 'invoice',
        startedOn: '2026-11-25',
        endsOn: '',
        seats: '',
        planNote: '',
        allowanceMode: 'plan_default',
        monthlyCapKrw: '',
        preferredLane: '',
        allowanceNote: '',
      }),
    ).toMatchObject({ ok: true });

    const overridden = await makeOrg('UI Mode Override Fixture');
    await sql.query("insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note) values ($1, 777000, true, 'x')", [overridden]);
    const html = await renderOrg(overridden);
    expect(html).toMatch(/<option value="override" selected="">/);
    expect(html).toMatch(/name="monthlyCapKrw"[^>]*value="777000"/);
  });

  it('a billing conflict headline is neutral; the grace line names the end and the grace day; KRW inputs show their credits', async () => {
    await sql.query(DEFAULTS_SQL);
    const orgId = await makeOrg('UI Conflict Fixture');
    const conflict = await renderOrg(orgId, { err: 'billingConflict', detail: 'conflict:plan_downgrade_next_cycle:2026-12-17' });
    expect(banner(conflict)).toContain(ko.admin.errBillingConflict);
    expect(banner(conflict)).not.toContain('캠페인');
    expect(banner(conflict)).toContain('다음 주기 시작일(12월 17일)');

    const { orgId: graceOrg } = await planOrg('UI Grace Fixture', 'b2b_29', 'none', '2026-10-20', '2026-11-20');
    const grace = await renderOrg(graceOrg);
    expect(grace).toContain('2026-11-20 종료 · 2026-12-04까지 유예');
    expect(grace).not.toContain('유예 만료');

    const overridden = await makeOrg('UI Credits Fixture');
    await sql.query("insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note) values ($1, 777000, true, 'x')", [overridden]);
    const credits = await renderOrg(overridden);
    expect(credits).toContain('10원 = 1크레딧 · 777,000원 = 77,700크레딧');
    expect(credits).toContain('10원 = 1크레딧 · 10,000원 = 1,000크레딧');
    const billing = await renderBilling();
    const row29 = billing.match(/data-plan-default-row="b2b_29"[\s\S]*?<\/form>/)?.[0] ?? '';
    expect(row29).toContain('10원 = 1크레딧 · 270,000원 = 27,000크레딧');
  });
});
