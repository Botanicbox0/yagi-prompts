import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { BrandProjectDetail, BrandProjectSummary, BrandWorkspace } from '@/lib/brands/workspace/types';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';

/**
 * docs/BRAND-ROOMS.md §3 — "룸 열기" on the campaign list cards and in the project page header.
 *
 * HARDLINE: with the flag off, or for a sandboxed or generation-closed brand with the flag on, both pages
 * render exactly as before (same markup, same props). Rendered from the real pages, data layer stubbed.
 */
const A = 'a0000000-0000-4000-8000-00000000000a';
const M = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
const D = 'd0000000-0000-4000-8000-00000000000d';
const P_A = 'a1000000-0000-4000-8000-000000000001';
const P_A2 = 'a1000000-0000-4000-8000-000000000002';
const P_M = 'e1000000-0000-4000-8000-000000000001';
const P_D = 'd1000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-000000000001';

const state = vi.hoisted(() => ({
  path: '/brand',
  scope: null as unknown as BrandWorkspaceScope,
  projects: [] as BrandProjectSummary[],
  viewer: {} as { userId?: string },
  project: null as unknown as BrandProjectDetail,
  denied: [] as string[],
  unreadQueries: 0,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = getDictionary('ko');
      // Only the room unread query reaches this runner; it answers 2 unread for P_A.
      const sql = {
        query: async (text: string) => {
          if (text.includes('brand_room_messages')) {
            state.unreadQueries += 1;
            return { rows: [{ channel: P_A, unread: 2 }] };
          }
          return { rows: [] };
        },
      };
      return { viewer: state.viewer, sql, verifiedEmail: undefined, brandHost: true, locale: 'ko', dict, b: dict.brandWorkspace };
    },
  };
});
vi.mock('@/lib/brands/workspace/service', () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandWorkspaceScope: async () => state.scope,
  loadBrandWorkspace: async (_d: unknown, _v: unknown, options: { organizationId?: string } = {}): Promise<BrandWorkspace> => {
    const choice = state.scope.choices.find((c) => c.id === options.organizationId);
    return {
      organizations: choice && choice.role !== 'guest' && choice.role !== 'studio' ? [{ id: choice.id, name: choice.name, role: choice.role }] : [],
      projects: state.projects.filter((p) => p.organizationId === options.organizationId),
    };
  },
  loadBrandProject: async () => state.project,
}));
vi.mock('@/lib/brands/usage/service', () => ({ loadBrandUsage: async () => null }));
vi.mock('@/lib/brands/usage/runtime', () => ({ usagePaymentsOpen: () => false }));
vi.mock('@/lib/brands/entitlements', async (original) => ({
  ...(await original<typeof import('@/lib/brands/entitlements')>()),
  loadFeaturePolicy: async () => ({ denied: state.denied }),
}));

import BrandHome from '@/app/(brand)/brand/page';
import BrandProject from '@/app/(brand)/brand/projects/[id]/page';
import { ProjectDetail } from '@/components/brand-workspace/project-detail';
import { RoomEntry } from '@/components/brand-rooms/room/room-entry';
import { getDictionary } from '@/lib/i18n/dictionaries';

const ko = getDictionary('ko');
const summary = (id: string, organizationId: string, title: string, extra: Partial<BrandProjectSummary> = {}): BrandProjectSummary => ({
  id, organizationId, organizationName: 'x', title, objective: 'Fixture', audience: '', budgetKrw: null, budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: null, endsOn: null, productionMode: 'creator', status: 'active', revision: 1, createdAt: '2026-09-01', updatedAt: '2026-09-01',
  ...extra,
});
const choice = (id: string, name: string, role: BrandWorkspaceChoice['role'], denied: string[] = []): BrandWorkspaceChoice => ({ id, name, role, logoUrl: null, denied: denied as never });
const home = async (organizationId: string) =>
  renderToStaticMarkup((await BrandHome({ searchParams: Promise.resolve({ organizationId }) })) as ReactElement);

beforeEach(() => {
  state.path = '/brand';
  state.viewer = { userId: USER };
  state.unreadQueries = 0;
  state.denied = [];
  state.scope = {
    choices: [choice(A, 'Alpha fixture', 'owner'), choice(M, 'Client brand', 'owner'), choice(D, 'Policy brand', 'owner', ['generative_media'])],
    projectOrganizations: { [P_A]: A, [P_A2]: A, [P_M]: M, [P_D]: D },
  };
  state.projects = [
    summary(P_A, A, 'Alpha campaign'),
    summary(P_A2, A, 'Alpha prepared', { clientVisible: false }),
    summary(P_M, M, 'Sandboxed campaign'),
    summary(P_D, D, 'Closed campaign'),
  ];
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('campaign list cards', () => {
  it.each([
    ['sandboxed by id', M],
    ['generation closed by policy', D],
  ])('render exactly as before with rooms on for a %s brand', async (_label, org) => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const before = await home(org);
    vi.stubEnv('BRAND_ROOMS', 'on');
    const after = await home(org);
    expect(after).toBe(before);
    expect(after).not.toContain('data-room-entry');
    expect(after).not.toContain('/brand/rooms');
    expect(after).not.toContain(ko.roomsShell.entry.open);
    expect(state.unreadQueries).toBe(0);
  });

  it('render exactly as before with the flag off for an ordinary brand', async () => {
    vi.stubEnv('BRAND_ROOMS', 'off');
    const html = await home(A);
    expect(html).not.toContain('data-room-entry');
    expect(state.unreadQueries).toBe(0);
    vi.stubEnv('BRAND_ROOMS', '');
    expect(await home(A)).toBe(html);
  });

  it('carry "룸 열기" with the brand and the unread count while rooms are open', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    const html = await home(A);
    expect(html).toContain(`href="/brand/rooms/${P_A}?organizationId=${A}" class="brr-entry" data-room-entry="card" data-room-unread="2"`);
    expect(html).toContain(ko.roomsShell.entry.open);
    expect(html).toContain('안 읽은 메시지 2개');
    // A campaign the team has not shared yet has no room to open.
    expect(html).not.toContain(`/brand/rooms/${P_A2}`);
    expect(state.unreadQueries).toBe(1);
  });

  it('are not offered in the TWINGS team view', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    state.scope = { choices: [choice(A, 'Alpha fixture', 'studio')], projectOrganizations: { [P_A]: A } };
    const html = await home(A);
    expect(html).not.toContain('data-room-entry');
  });
});

/* ---------------------------------------------------------------- the project page header */

const detail = (organizationId: string, organizationName: string, extra: Partial<BrandProjectDetail> = {}): BrandProjectDetail => ({
  id: P_A, organizationId, organizationName, title: 'Fixture campaign', objective: 'Fixture objective',
  audience: '', budgetKrw: null, budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: '2026-09-19', endsOn: '2026-10-02', productionMode: 'creator', status: 'active', revision: 1,
  createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z', role: 'editor', canComment: true, referenceLinks: [],
  contents: [], decisions: [], messages: [], posts: [], attachments: [], reports: [], contracts: [], contractUploads: [],
  ...extra,
} as BrandProjectDetail);
const projectPage = async () =>
  (await BrandProject({ params: Promise.resolve({ id: P_A }), searchParams: Promise.resolve({}) })) as ReactElement<Record<string, unknown>>;

describe('the project page header', () => {
  beforeEach(() => {
    // No signed-in id: the page's other loaders stay idle and the unread count reads as zero.
    state.viewer = {};
  });

  it.each([
    ['sandboxed by id', () => detail(M, 'Client brand'), []],
    ['named "Morphic"', () => detail(D, 'Morphic Korea'), []],
    ['generation closed by policy', () => detail(D, 'Policy brand'), ['generative_media']],
  ])('passes the same props with rooms on as with rooms off for a %s brand', async (_label, make, denied) => {
    state.project = make();
    state.denied = denied as string[];
    vi.stubEnv('BRAND_ROOMS', 'off');
    const off = await projectPage();
    vi.stubEnv('BRAND_ROOMS', 'on');
    const on = await projectPage();
    expect('roomEntry' in on.props).toBe(false);
    expect(on.props).toEqual(off.props);
  });

  it('adds "룸 열기" only while rooms are open, the project is shared and the viewer is not the team view', async () => {
    state.project = detail(A, 'Alpha fixture');
    vi.stubEnv('BRAND_ROOMS', 'off');
    expect('roomEntry' in (await projectPage()).props).toBe(false);
    vi.stubEnv('BRAND_ROOMS', 'on');
    const entry = (await projectPage()).props.roomEntry as ReactElement<{ href: string; variant: string }>;
    expect(entry.props.href).toBe(`/brand/rooms/${P_A}?organizationId=${A}`);
    expect(entry.props.variant).toBe('header');
    state.project = detail(A, 'Alpha fixture', { clientVisible: false });
    expect('roomEntry' in (await projectPage()).props).toBe(false);
    state.project = detail(A, 'Alpha fixture', { role: 'studio' });
    expect('roomEntry' in (await projectPage()).props).toBe(false);
  });

  it('draws the entry beside the status, and nothing new without it', () => {
    const b = ko.brandWorkspace;
    const project = detail(A, 'Alpha fixture');
    const plain = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" />);
    expect(renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" roomEntry={null} />)).toBe(plain);
    expect(plain).not.toContain('brr-');
    const withEntry = renderToStaticMarkup(
      <ProjectDetail
        project={project}
        b={b}
        locale="ko"
        roomEntry={<RoomEntry href={`/brand/rooms/${P_A}?organizationId=${A}`} unread={3} copy={ko.roomsShell.entry} variant="header" />}
      />,
    );
    expect(withEntry).toContain('data-project-room-entry');
    expect(withEntry).toContain(`<a href="/brand/rooms/${P_A}?organizationId=${A}" class="brr-entry" data-room-entry="header" data-room-unread="3">`);
    expect(withEntry).toContain('안 읽은 메시지 3개');
  });
});
