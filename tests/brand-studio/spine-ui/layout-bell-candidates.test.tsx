import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { resetSpineProbe } from '@/lib/brands/project-origin';

const ctx = vi.hoisted(() => ({
  path: '/brand/studio',
  query: '',
  viewer: { userId: 'user-1' as string | null, isAdmin: false, tier: 'free', email: 'a@test.com', locale: 'ko' },
  scope: { choices: [], projectOrganizations: {} } as BrandWorkspaceScope,
  pending: 0,
  sqlCalls: [] as string[],
  columnsCount: 4,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => ctx.path,
  useSearchParams: () => new URLSearchParams(ctx.query),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/app/fonts', () => ({ fontVariables: '' }));
vi.mock('@/lib/i18n/server', () => ({ getRequestLocale: async () => 'ko' }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ctx.viewer }));
vi.mock('@/lib/auth/verified-email', () => ({ getVerifiedEmail: async () => 'a@test.com' }));
vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () => ({
    query: async (sqlText: string) => {
      ctx.sqlCalls.push(sqlText);
      if (sqlText.includes('information_schema.columns')) {
        return { rows: [{ n: ctx.columnsCount }] };
      }
      return { rows: [] };
    },
  }),
}));
vi.mock('@/lib/brands/workspace/service', () => ({
  loadBrandWorkspaceScope: async () => ctx.scope,
  countPendingSharedCampaigns: async () => ctx.pending,
}));
vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({ summary: null, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
    useRoomUnread: () => 0,
  };
});

import BrandLayout from '@/app/(brand)/layout';

const OPEN_ORG = 'a0000000-0000-4000-8000-0000000000a1';
const CLOSED_ORG = 'b0000000-0000-4000-8000-0000000000b2';

async function renderLayout() {
  return renderToStaticMarkup(await BrandLayout({ children: <div data-test-child="ok" /> }));
}

describe('BrandLayout bellCandidates (Decision Q5)', () => {
  beforeEach(() => {
    resetSpineProbe();
    ctx.sqlCalls = [];
    ctx.columnsCount = 4;
    ctx.path = '/brand/studio';
    ctx.query = '';
    ctx.viewer = { userId: 'user-1', isAdmin: false, tier: 'free', email: 'a@test.com', locale: 'ko' };
    ctx.scope = { choices: [], projectOrganizations: {} };
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
    vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', OPEN_ORG);
  });

  it('adds zero SQL statements and omits bell row when spine switch is off or org is not listed', async () => {
    ctx.scope = { choices: [{ id: CLOSED_ORG, name: 'Closed', role: 'owner', logoUrl: null }], projectOrganizations: {} };
    const unlisted = await renderLayout();
    expect(ctx.sqlCalls).toEqual([]);
    expect(unlisted).not.toContain('data-rail-inbox');

    vi.stubEnv('BRAND_PROJECT_SPINE', 'off');
    ctx.scope = { choices: [{ id: OPEN_ORG, name: 'Open', role: 'owner', logoUrl: null }], projectOrganizations: {} };
    const switchOff = await renderLayout();
    expect(ctx.sqlCalls).toEqual([]);
    expect(switchOff).not.toContain('data-rail-inbox');
  });

  it('excludes staff and project guests from bellCandidates with zero spine queries', async () => {
    ctx.scope = {
      choices: [
        { id: OPEN_ORG, name: 'Open Guest', role: 'guest', logoUrl: null },
        { id: OPEN_ORG, name: 'Open Staff', role: 'studio', logoUrl: null },
      ],
      projectOrganizations: {},
    };
    const html = await renderLayout();
    expect(ctx.sqlCalls).toEqual([]);
    expect(html).not.toContain('data-rail-inbox');
  });

  it('activates bell only for eligible member orgs in 직접 만들기 and keeps 야기 팀과 untouched', async () => {
    ctx.scope = {
      choices: [
        { id: OPEN_ORG, name: 'Open', role: 'owner', logoUrl: null },
        { id: CLOSED_ORG, name: 'Closed', role: 'owner', logoUrl: null },
      ],
      projectOrganizations: {},
    };

    // Open org + /brand/studio -> active (renders data-rail-inbox in lower band)
    ctx.path = '/brand/studio';
    ctx.query = `organizationId=${OPEN_ORG}`;
    const makeOpen = await renderLayout();
    expect(makeOpen).toContain('data-rail-inbox');
    expect(ctx.sqlCalls.length).toBeGreaterThan(0);

    // Closed org + /brand/studio -> BellProvider is inactive for CLOSED_ORG
    ctx.query = `organizationId=${CLOSED_ORG}`;
    const makeClosed = await renderLayout();
    expect(makeClosed).not.toContain('data-rail-inbox');

    // Open org + /brand (야기 팀과) -> BellProvider is inactive in team mode
    ctx.path = '/brand';
    ctx.query = `organizationId=${OPEN_ORG}`;
    const teamOpen = await renderLayout();
    expect(teamOpen).not.toContain('data-rail-inbox');
  });
});
