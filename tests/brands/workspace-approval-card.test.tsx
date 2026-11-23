import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { prerender } from 'react-dom/static';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysInYearMonth, kstDayOf, kstMonthOf } from '@/lib/brands/billing/math';
import { approveWorkspace } from '@/lib/brands/billing/workspace-approval';
import { createStudioOrganization } from '@/lib/brands/workspace/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { pre0184Db } from '@/tests/brands/helpers/workspace-approval-parity';
import { ADMIN_VIEWER, adminHarness, type AdminHarness } from '@/tests/helpers/admin';
import { seedProfile } from '@/tests/helpers/billing';
import { runner } from '@/tests/helpers/pglite';

/** B1b fix round 1, B: the "워크스페이스 승인" card on the admin organization page, rendered through the real page. */
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

async function renderOrg(id: string): Promise<string> {
  const OrgDetailPage = (await import('@/app/(admin)/admin/brand-workspace/organizations/[id]/page')).default;
  return new Response(
    (await prerender(await OrgDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }), { signal: AbortSignal.timeout(5000) }))
      .prelude,
  ).text();
}

async function makeOrg(runnerSql: SqlRunner, name: string): Promise<string> {
  const res = await createStudioOrganization({ sql: runnerSql }, ADMIN_VIEWER, { name, requestId: randomUUID() });
  if (!res.ok) throw new Error(res.code);
  return res.id;
}

beforeEach(async () => {
  vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'on');
  vi.stubEnv('BRAND_PLAN_GRACE_DAYS', '14');
  h = await adminHarness();
  sql = runner(h.db);
  ssrMocks.sql = sql;
  await seedProfile(sql, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await h.db.close();
});

describe('admin organization page: workspace approval card', () => {
  it('not approved: 미승인 and the approve form with its confirm check', async () => {
    const id = await makeOrg(sql, 'Card fixture new');
    const html = await renderOrg(id);
    expect(html).toContain('data-org-workspace-approval');
    expect(html).toContain('data-approval-state="not_approved"');
    expect(html).toContain('워크스페이스 승인');
    expect(html).toContain('미승인');
    expect(html).toContain('value="brandWorkspace.approve"');
    expect(html).toContain('name="_confirm"');
    expect(html).toContain('체험 크레딧 400개를 지급합니다');
    expect(html).not.toContain('data-org-trial');
  });

  it('approved: 승인됨, date and approver, the trial grant with its month and usable-through date, no form', async () => {
    const id = await makeOrg(sql, 'Card fixture approved');
    const approved = await approveWorkspace({ sql }, ADMIN_VIEWER, { organizationId: id, note: 'checked' });
    expect(approved).toMatchObject({ ok: true, created: true });
    const html = await renderOrg(id);
    const month = kstMonthOf(new Date());
    const [y, m] = month.split('-').map(Number) as [number, number];
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    expect(html).toContain('data-approval-state="approved"');
    expect(html).toContain('승인됨');
    expect(html).toContain(ADMIN_VIEWER.email!);
    expect(html).toContain('checked');
    expect(html).toContain('data-trial-original');
    expect(html).toContain(`${month} · 400크레딧`);
    expect(html).toContain(`data-trial-usable-through="${next}-${String(daysInYearMonth(next)).padStart(2, '0')}"`);
    expect(html).not.toContain('value="brandWorkspace.approve"');
  });

  it('sandboxed organization: approval is not available, no form', async () => {
    const id = randomUUID();
    await sql.query('insert into brand_organizations (id, name, created_by, request_id) values ($1, $2, $3, $4)', [id, 'Morphic card fixture', ADMIN_VIEWER.userId, randomUUID()]);
    const html = await renderOrg(id);
    expect(html).toContain('data-org-approval-sandboxed');
    expect(html).toContain('이 조직은 승인할 수 없습니다.');
    expect(html).not.toContain('value="brandWorkspace.approve"');
  });

  it('flag off: no card at all', async () => {
    vi.stubEnv('BRAND_WORKSPACE_APPROVAL', 'off');
    const id = await makeOrg(sql, 'Card fixture flag off');
    const html = await renderOrg(id);
    expect(html).not.toContain('data-org-workspace-approval');
    expect(html).not.toContain('billing-workspace-approval');
    expect(html).not.toContain('brandWorkspace.approve');
  });

  it('schema not ready (before 0184): the neutral "not migrated" line only', async () => {
    const db: PGlite = await pre0184Db();
    try {
      const old = runner(db);
      ssrMocks.sql = old;
      await seedProfile(old, { id: ADMIN_VIEWER.userId!, isAdmin: true, email: ADMIN_VIEWER.email! });
      const id = await makeOrg(old, 'Card fixture pre-0184');
      const html = await renderOrg(id);
      expect(html).toContain('data-org-approval-unmigrated');
      expect(html).toContain('워크스페이스 승인 테이블(0184)이 아직 적용되지 않았습니다.');
      expect(html).not.toContain('value="brandWorkspace.approve"');
    } finally {
      await db.close();
    }
  });

  it('the plan-allowance panel states a first-month proration', async () => {
    const id = await makeOrg(sql, 'Card fixture proration');
    const today = kstDayOf(new Date());
    const month = today.slice(0, 7);
    await sql.query("insert into brand_plan_allowance_defaults (plan_id, monthly_cap_krw) values ('b2b_29', 270000)");
    await sql.query(
      "insert into brand_plan_assignments (organization_id, plan_id, billing_mode, started_on, ends_on, revision) values ($1, 'b2b_29', 'invoice', $2, null, 1)",
      [id, today],
    );
    const html = await renderOrg(id);
    const day = Number(today.slice(8, 10));
    if (day === 1) {
      expect(html).not.toContain('data-plan-proration');
    } else {
      const periodDays = daysInYearMonth(month);
      expect(html).toContain('data-plan-proration');
      expect(html).toContain(`이번 달은 시작일 기준 ${periodDays - day + 1}/${periodDays}일 한도`);
    }
  });
});
