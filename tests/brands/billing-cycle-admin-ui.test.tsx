import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftBrandInvoice } from '@/lib/brands/billing';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import { coreMigrationFiles, readMigration } from '@/lib/db/migrations';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/**
 * B1c admin screens: the plan billing cycle (one month from the plan start day) on the organization page and the
 * billing console, rendered through the real pages. "Now" is fixed at 2026-11-20 10:00 KST.
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

const NOW = new Date('2026-11-20T01:00:00Z');

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

async function renderOrgList(): Promise<string> {
  const OrgListPage = (await import('@/app/(admin)/admin/brand-workspace/page')).default;
  return new Response(
    (await prerender(await OrgListPage({ searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
  ).text();
}

async function seedGrant(organizationId: string, validMonth: string, createdAt: string, revoked = false): Promise<string> {
  const row = (
    await sql.query<{ id: string }>(
      `insert into brand_allowance_grants (organization_id, amount_krw, valid_month, reason, created_by, created_at, revoked_at, revoked_by)
       values ($1, 10000, $2, 'fixture', $3, $4::timestamptz, $5::timestamptz, $6) returning id::text as id`,
      [organizationId, validMonth, ADMIN_VIEWER.userId, createdAt, revoked ? createdAt : null, revoked ? ADMIN_VIEWER.userId : null],
    )
  ).rows[0]!;
  return row.id;
}

async function renderConsole(): Promise<string> {
  const BrandBillingPage = (await import('@/app/(admin)/admin/brand-billing/page')).default;
  return new Response(
    (await prerender(await BrandBillingPage({ searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) })).prelude,
  ).text();
}

async function makeOrg(runnerSql: SqlRunner, name: string): Promise<string> {
  const res = await createStudioOrganization({ sql: runnerSql }, ADMIN_VIEWER, { name, requestId: randomUUID() });
  if (!res.ok) throw new Error(res.code);
  return res.id;
}

async function seedPlan(runnerSql: SqlRunner, organizationId: string, startedOn: string): Promise<void> {
  await runnerSql.query(
    "insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)",
  );
  await runnerSql.query(
    "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', $2, null, 1)",
    [organizationId, startedOn],
  );
}

/** The element that carries `marker`, up to the first `close` after it. */
function slice(html: string, marker: string, open: string, close: string): string {
  const at = html.indexOf(marker);
  if (at < 0) return '';
  return html.slice(html.lastIndexOf(open, at), html.indexOf(close, at) + close.length);
}
const draftForm = (html: string) => slice(html, 'value="brandBilling.invoice.draft"', '<form', '</form>');
const planCycleBlock = (html: string) => slice(html, 'data-plan-cycle=', '<div', '</div>');
const invoiceRow = (html: string, id: string) => slice(html, `data-invoice-row="${id}"`, '<tr', '</tr>');
const grantRow = (html: string, id: string) => slice(html, `data-grant-row="${id}"`, '<tr', '</tr>');
const grantForm = (html: string) => slice(html, 'value="brandBilling.grant.create"', '<form', '</form>');
const grantCycleCell = (row: string) => slice(row, 'data-grant-cycle=', '<span', '</span>');
const billingRow = (html: string, id: string) => slice(html, `data-billing-invoice-row="${id}"`, '<tr', '</tr>');
function uninvoicedCycles(html: string): string {
  const at = html.indexOf('data-uninvoiced-cycles');
  if (at < 0) return '';
  return html.slice(at, html.indexOf('id="uninvoiced"', at));
}

beforeEach(async () => {
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
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

describe('admin organization page: billing cycle', () => {
  it('plan organization: this cycle, the start day, the next billing day and the credits used this cycle', async () => {
    const id = await makeOrg(sql, 'Cycle fixture plan');
    await seedPlan(sql, id, '2026-11-17');
    const html = await renderOrg(id);

    const block = planCycleBlock(html);
    expect(block).toContain('data-cycle-start="2026-11-17"');
    expect(block).toContain('data-cycle-end="2026-12-17"');
    expect(block).toContain('이번 주기 11월 17일 ~ 12월 16일');
    expect(block).toContain('플랜 시작일(주기 기준일) 11월 17일');
    expect(block).toContain('다음 청구일 12월 17일');
    expect(block).toContain('이번 주기 사용 0 / 27,000크레딧');

    // The plan form says what the start date does and shows the cycle it gives today.
    expect(html).toContain('시작일이 청구 주기의 기준일입니다.');
    expect(slice(html, 'data-started-on-cycle=', '<span', '</span>')).toContain('이번 주기 11월 17일 ~ 12월 16일');
  });

  it('paid plan: the draft form picks this cycle or the next instead of a month, without proration', async () => {
    const id = await makeOrg(sql, 'Cycle fixture draft');
    await seedPlan(sql, id, '2026-11-17');
    const form = draftForm(await renderOrg(id));
    expect(form).toContain('name="cycle"');
    expect(form).toMatch(/<option value="current"[^>]*>이번 주기 \(11월 17일 ~ 12월 16일\)<\/option>/);
    expect(form).toMatch(/<option value="next"[^>]*>다음 주기 \(12월 17일 ~ 1월 16일\)<\/option>/);
    expect(form).not.toContain('name="period"');
    expect(form).not.toContain('name="prorate"');
    expect(form).toContain('주기 청구서는 일할 없이 한 달 요금 전액입니다.');
  });

  it('plan that starts later: "current" is the first cycle, starting on the start day', async () => {
    const id = await makeOrg(sql, 'Cycle fixture future');
    await seedPlan(sql, id, '2026-12-03');
    const html = await renderOrg(id);
    expect(draftForm(html)).toMatch(/<option value="current"[^>]*>첫 주기 \(12월 3일 ~ 1월 2일\)<\/option>/);
    // A cycle that starts in another year than today carries its year.
    expect(draftForm(html)).toMatch(/<option value="next"[^>]*>다음 주기 \(2027년 1월 3일 ~ 2월 2일\)<\/option>/);
    expect(slice(html, 'data-started-on-cycle=', '<span', '</span>')).toContain('첫 주기 12월 3일 ~ 1월 2일');
    // The allowance does not run on the plan before it starts.
    expect(html).not.toContain('data-plan-cycle=');
  });

  it('no plan: the month draft form stays as it was, and there is no cycle block or cycle line', async () => {
    const id = await makeOrg(sql, 'Cycle fixture no plan');
    const html = await renderOrg(id);
    const form = draftForm(html);
    expect(form).toContain('name="period"');
    expect(form).toContain('value="2026-11"');
    expect(form).toContain('name="prorate"');
    expect(form).not.toContain('name="cycle"');
    expect(html).not.toContain('data-plan-cycle=');
    expect(html).not.toContain('data-started-on-cycle=');
  });

  it('override allowance: no plan-cycle block, even with a plan assigned', async () => {
    const id = await makeOrg(sql, 'Cycle fixture override');
    await seedPlan(sql, id, '2026-11-17');
    await sql.query(
      "insert into brand_studio_allowances (organization_id, monthly_cap_krw, is_override, note) values ($1, 500000, true, 'fixture')",
      [id],
    );
    const html = await renderOrg(id);
    expect(html).toContain('data-org-billing');
    expect(html).not.toContain('data-plan-cycle=');
  });

  it('a cycle invoice shows its cycle dates in the invoice table', async () => {
    const id = await makeOrg(sql, 'Cycle fixture invoice');
    await seedPlan(sql, id, '2026-11-17');
    const drafted = await draftBrandInvoice({ sql, now: () => new Date(NOW) }, ADMIN_VIEWER, { organizationId: id, cycle: 'current' });
    if (!drafted.ok) throw new Error(drafted.code);
    expect(drafted.invoice).toMatchObject({ cycleStart: '2026-11-17', cycleEnd: '2026-12-17', period: '2026-11' });
    const row = invoiceRow(await renderOrg(id), drafted.invoice.id);
    expect(row).toContain('data-invoice-cycle="2026-11-17"');
    expect(row).toContain('title="2026-11-17 ~ 2026-12-16"');
    expect(row).toContain('11월 17일 ~ 12월 16일');
  });

  it('before migration 0186: a paid plan keeps the month draft form', async () => {
    const db = new PGlite();
    try {
      await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
      for (const file of coreMigrationFiles().filter((m) => m < '0186_')) await db.exec(readMigration(file));
      const old = runner(db);
      ssrMocks.sql = old;
      await seedProfile(old, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      const id = await makeOrg(old, 'Cycle fixture pre-0186');
      await seedPlan(old, id, '2026-11-17');
      const form = draftForm(await renderOrg(id));
      expect(form).toContain('name="period"');
      expect(form).not.toContain('name="cycle"');

      const consoleHtml = await renderConsole();
      expect(consoleHtml).toContain('data-uninvoiced-cycles-unmigrated');
      expect(consoleHtml).toContain('청구 주기 컬럼(0186)이 아직 적용되지 않았습니다.');
      expect(consoleHtml).not.toContain('data-uninvoiced-cycle-row=');
    } finally {
      await db.close();
    }
  });
});

describe('admin organization page: extra grants on a plan cycle', () => {
  it('each grant shows its cycle: this one, an earlier one, or none before the plan start', async () => {
    const id = await makeOrg(sql, 'Cycle fixture grants');
    await seedPlan(sql, id, '2026-10-17');
    // KST days: 11-18 (this cycle), 10-20 (the first cycle), 10-05 (before the plan start).
    const current = await seedGrant(id, '2026-11', '2026-11-18T03:00:00Z');
    const earlier = await seedGrant(id, '2026-10', '2026-10-20T03:00:00Z');
    const beforePlan = await seedGrant(id, '2026-10', '2026-10-05T03:00:00Z');
    // A November grant made in October starts on 11-01, which still falls in the 10-17 cycle.
    const monthStart = await seedGrant(id, '2026-11', '2026-10-25T03:00:00Z');
    const revoked = await seedGrant(id, '2026-11', '2026-11-19T03:00:00Z', true);
    const html = await renderOrg(id);

    expect(grantCycleCell(grantRow(html, current))).toContain('이번 주기 끝(12월 16일)까지');
    expect(grantCycleCell(grantRow(html, earlier))).toContain('10월 17일 ~ 11월 16일 주기, 11월 16일까지');
    expect(grantCycleCell(grantRow(html, beforePlan))).toContain('플랜 시작 전 지급 — 주기에 포함되지 않음');
    expect(grantCycleCell(grantRow(html, monthStart))).toContain('10월 17일 ~ 11월 16일 주기, 11월 16일까지');
    expect(grantCycleCell(grantRow(html, revoked))).toContain('—');
    expect(grantCycleCell(grantRow(html, revoked))).not.toContain('주기');
  });

  it('grant form: each month option says which cycle the grant joins and until when', async () => {
    const id = await makeOrg(sql, 'Cycle fixture grant form');
    await seedPlan(sql, id, '2026-11-01');
    const form = grantForm(await renderOrg(id));
    // This month starts today (11-20, cycle 11-01 ~ 11-30); next month starts on 12-01, the next cycle.
    expect(form).toMatch(/<option value="2026-11"[^>]*>2026-11 · 이번 주기 끝\(11월 30일\)까지<\/option>/);
    expect(form).toMatch(/<option value="2026-12"[^>]*>2026-12 · 12월 1일 ~ 12월 31일 주기, 12월 31일까지<\/option>/);
    expect(slice(form, 'data-grant-cycle-hint=', '<span', '</span>')).toContain('그 주기 마지막 날까지 씁니다');
  });

  it('no paid plan: grant form and list stay on the calendar month', async () => {
    const id = await makeOrg(sql, 'Cycle fixture grant no plan');
    const grant = await seedGrant(id, '2026-11', '2026-11-18T03:00:00Z');
    const html = await renderOrg(id);
    const form = grantForm(html);
    expect(form).toMatch(/<option value="2026-11"[^>]*>2026-11<\/option>/);
    expect(form).toMatch(/<option value="2026-12"[^>]*>2026-12<\/option>/);
    expect(form).not.toContain('data-grant-cycle-hint');
    expect(grantRow(html, grant)).not.toContain('data-grant-cycle');
  });

  it('moving the start day under an invoiced cycle: the banner says to void the cycle invoice first', async () => {
    const id = await makeOrg(sql, 'Cycle fixture start move');
    await seedPlan(sql, id, '2026-11-17');
    const drafted = await draftBrandInvoice({ sql, now: () => new Date(NOW) }, ADMIN_VIEWER, { organizationId: id, cycle: 'current' });
    if (!drafted.ok) throw new Error(drafted.code);
    const outcome = await h.run('brandBilling.planAndAllowance.set', {
      organizationId: id,
      expectedRevision: 1,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-10',
      endsOn: '',
      planNote: '',
      allowanceMode: 'plan_default',
      allowanceNote: '',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toContain('cycle_already_invoiced');
    const html = await renderOrg(id, { err: outcome.code, detail: outcome.detail ?? '' });
    expect(html).toContain('이 주기의 청구서를 먼저 취소하세요 (주기 중간 재시작은 다음 단계의 플랜 변경 기능)');
    expect(html).not.toContain('동일 기간 청구서가 이미 있거나 동시 수정 충돌이 발생했습니다');
  });

  it('the plan-only form (brandEngine.plan) gives the same reason for a blocked start-day move', async () => {
    const id = await makeOrg(sql, 'Cycle fixture start move engine form');
    await seedPlan(sql, id, '2026-11-17');
    const drafted = await draftBrandInvoice({ sql, now: () => new Date(NOW) }, ADMIN_VIEWER, { organizationId: id, cycle: 'current' });
    if (!drafted.ok) throw new Error(drafted.code);
    const outcome = await h.run('brandEngine.plan', {
      organizationId: id,
      expectedRevision: 1,
      planId: 'b2b_29',
      billingMode: 'invoice',
      startedOn: '2026-11-10',
      endsOn: '',
      note: '',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toContain('cycle_already_invoiced');
  });
});

describe('admin organization list: usage basis', () => {
  it('says the usage sort and the 80% filter count by calendar month', async () => {
    await makeOrg(sql, 'Cycle fixture list');
    const html = await renderOrgList();
    expect(html).toContain('data-brand-org-matrix');
    expect(slice(html, 'data-org-list-usage-basis=', '<p', '</p>')).toContain(
      '사용량 정렬과 80% 필터는 달력 월 기준입니다(플랜 조직의 표시 숫자는 이번 결제 주기 기준).',
    );
  });
});

describe('admin billing console: billing cycle', () => {
  it('lists a current cycle without an invoice, and drops it once the cycle is drafted', async () => {
    const id = await makeOrg(sql, 'Cycle fixture console');
    await seedPlan(sql, id, '2026-11-17');

    const before = await renderConsole();
    expect(before).toContain('청구서가 없는 주기');
    const list = uninvoicedCycles(before);
    expect(list).toContain(`data-uninvoiced-cycle-row="${id}"`);
    expect(list).toContain(`href="/admin/brand-workspace/organizations/${id}#billing-invoices"`);
    expect(list).toContain('Cycle fixture console');
    expect(list).toContain('11월 17일 ~ 12월 16일');
    expect(list).toContain('12월 17일');
    // The month summary says how cycle invoices are grouped.
    expect(before).toContain('주기 청구서는 주기가 시작한 달에 묶어 셉니다.');

    const drafted = await draftBrandInvoice({ sql, now: () => new Date(NOW) }, ADMIN_VIEWER, { organizationId: id, cycle: 'current' });
    if (!drafted.ok) throw new Error(drafted.code);

    const after = await renderConsole();
    expect(uninvoicedCycles(after)).not.toContain('data-uninvoiced-cycle-row=');
    expect(uninvoicedCycles(after)).toContain('지금 주기의 청구서가 모두 있습니다.');
    // The month list shows the invoice by its cycle.
    const row = billingRow(after, drafted.invoice.id);
    expect(row).toContain('data-invoice-cycle="2026-11-17"');
    expect(row).toContain('11월 17일 ~ 12월 16일');
  });

  it('the tax-invoice list no longer reads as one month', async () => {
    vi.stubEnv('BRAND_BILLING_AUTO_ISSUE', 'on');
    const html = await renderConsole();
    expect(html).toContain('id="tax-invoices"');
    expect(html).toContain('>발행할 세금계산서</h2>');
    expect(html).not.toContain('2026-11 발행할 세금계산서');
  });
});
