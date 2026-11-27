import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandProjectSummary, BrandWorkspace } from '@/lib/brands/workspace/types';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Campaign ops C1 Step 0 parity snapshots — captured on the untouched branch before any edit.
 * NEVER regenerate these snapshots: any later diff when the new switch is closed is a regression.
 */
const state = vi.hoisted(() => ({
  path: '/brand',
  scope: null as unknown as BrandWorkspaceScope,
  projects: [] as BrandProjectSummary[],
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({ summary: null, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
    useRoomUnread: () => 0,
  };
});

vi.mock('@/components/brand-workspace/context', async () => {
  const { getDictionary: loadDict } = await import('@/lib/i18n/dictionaries');
  return {
    brandContext: async () => {
      const dict = loadDict('ko');
      return {
        viewer: { userId: '00000000-0000-4000-8000-000000000001', isAdmin: false },
        sql: { query: async () => ({ rows: [] }) },
        verifiedEmail: undefined,
        brandHost: true,
        locale: 'ko',
        dict,
        b: dict.brandWorkspace,
      };
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
}));

import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';
import { WorkspaceTeamHome, type TeamHomeProject } from '@/components/brand-workspace/home/team-home';
import BrandHome from '@/app/(brand)/brand/page';

const ko = getDictionary('ko');
const b = ko.brandWorkspace;
const shell = ko.studioShell;
const roomsNav = ko.roomsShell.nav;

const ORG_STUDIO = 'a0000000-0000-4000-8000-0000000000a1';
const ORG_PROJECT_ONLY = 'b0000000-0000-4000-8000-0000000000b2';
const ORG_GUEST = 'c0000000-0000-4000-8000-0000000000c3';
const ORG_STAFF = 'd0000000-0000-4000-8000-0000000000d4';
const ORG_SANDBOX_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
const ORG_SANDBOX_NAME = 'e0000000-0000-4000-8000-0000000000e5';
const ORG_DENIED = 'f0000000-0000-4000-8000-0000000000f6';

const labels = {
  home: b.home,
  members: b.members,
  settings: b.managed.settings,
  billing: ko.brandBilling.customer.pageTitle,
  library: b.managed.library,
  studio: b.productionStudio.title,
  identity: b.identityLayer.nav,
  creators: b.creatorPool.nav,
};

const workspaceMenu = {
  identity: b.identity,
  roles: b.roles,
  language: ko.nav.localeToggle,
  signOut: b.signOut,
};

const scopeOf = (choice: BrandWorkspaceChoice): BrandWorkspaceScope => ({
  choices: [choice],
  projectOrganizations: {},
});

const renderNav = (choice: BrandWorkspaceChoice, path: string) => {
  state.path = path;
  return renderToStaticMarkup(
    <WorkspaceNavigation
      {...labels}
      scope={scopeOf(choice)}
      studioV2
      shell={shell}
      locale="ko"
      rooms
      roomsCopy={roomsNav}
      homeLabel={ko.brandHome.nav.home}
      workspaceMenu={workspaceMenu}
    />,
  );
};

const project = (id: string, organizationId: string, productionMode: 'creator' | 'studio', title: string): BrandProjectSummary => ({
  id,
  organizationId,
  organizationName: 'Alpha fixture',
  title,
  objective: 'Fixture objective',
  audience: '',
  budgetKrw: null,
  budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: '2026-11-15',
  endsOn: '2026-11-30',
  productionMode,
  status: 'active',
  revision: 1,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
});

const TEAM_PROJECTS: TeamHomeProject[] = [
  {
    id: 'p0000000-0000-4000-8000-000000000001',
    title: 'Spring launch',
    stage: 'storyboard',
    steps: [
      { stage: 'requested', state: 'done', at: '2026-11-15T00:00:00.000Z' },
      { stage: 'storyboard', state: 'current', at: '2026-11-16T00:00:00.000Z' },
      { stage: 'draft', state: 'ahead', at: null },
      { stage: 'revision', state: 'ahead', at: null },
      { stage: 'done', state: 'ahead', at: null },
    ],
    unread: 2,
  },
  {
    id: 'p0000000-0000-4000-8000-000000000002',
    title: 'Winter film',
    stage: 'draft',
    steps: [
      { stage: 'requested', state: 'done', at: '2026-11-15T00:00:00.000Z' },
      { stage: 'storyboard', state: 'done', at: '2026-11-16T00:00:00.000Z' },
      { stage: 'draft', state: 'current', at: '2026-11-17T00:00:00.000Z' },
      { stage: 'revision', state: 'ahead', at: null },
      { stage: 'done', state: 'ahead', at: null },
    ],
    unread: 0,
  },
];

const ALERT: RoomAlertItem = {
  id: 'alert-1',
  kind: 'review',
  projectId: 'p0000000-0000-4000-8000-000000000001',
  projectTitle: 'Spring launch',
  targetId: 't0000000-0000-4000-8000-000000000001',
  title: 'Cut 1',
  version: 1,
  openNotes: 1,
  updatedAt: '2026-11-15T00:00:00.000Z',
};

const teamCopy = {
  home: ko.brandHome,
  nav: ko.roomsShell.nav,
  space: ko.roomsShell.space,
  overview: ko.roomsShell.overview,
  inbox: ko.roomsChat.inbox,
};

beforeEach(() => {
  state.path = '/brand';
  state.scope = {
    choices: [{ id: ORG_STUDIO, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] }],
    projectOrganizations: {},
  };
  state.projects = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Campaign ops C1 closed-switch parity baseline', () => {
  it('matches untouched WorkspaceNavigation rail and mode labels across roles and sandboxed orgs', () => {
    const studioChoice: BrandWorkspaceChoice = { id: ORG_STUDIO, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };
    const projectOnlyChoice: BrandWorkspaceChoice = { id: ORG_PROJECT_ONLY, name: 'Project only fixture', role: 'owner', logoUrl: null, denied: ['self_studio'] };
    const guestChoice: BrandWorkspaceChoice = { id: ORG_GUEST, name: 'Guest fixture', role: 'guest', logoUrl: null, denied: [] };
    const staffChoice: BrandWorkspaceChoice = { id: ORG_STAFF, name: 'Staff view fixture', role: 'studio', logoUrl: null, denied: [] };
    const sandboxIdChoice: BrandWorkspaceChoice = { id: ORG_SANDBOX_ID, name: 'Sandboxed id fixture', role: 'owner', logoUrl: null };
    const sandboxNameChoice: BrandWorkspaceChoice = { id: ORG_SANDBOX_NAME, name: 'Morphic Korea', role: 'owner', logoUrl: null };
    const deniedChoice: BrandWorkspaceChoice = { id: ORG_DENIED, name: 'Denied fixture', role: 'owner', logoUrl: null, denied: ['generative_media'] };

    expect(renderNav(studioChoice, '/brand/studio')).toMatchSnapshot('nav-studio-make');
    expect(renderNav(studioChoice, '/brand')).toMatchSnapshot('nav-studio-team');
    expect(renderNav(projectOnlyChoice, '/brand/library')).toMatchSnapshot('nav-project-only-team');
    expect(renderNav(projectOnlyChoice, '/brand/studio')).toMatchSnapshot('nav-project-only-make');
    expect(renderNav(guestChoice, '/brand/library')).toMatchSnapshot('nav-guest');
    expect(renderNav(staffChoice, '/brand')).toMatchSnapshot('nav-staff');
    expect(renderNav(sandboxIdChoice, '/brand')).toMatchSnapshot('nav-sandbox-id');
    expect(renderNav(sandboxNameChoice, '/brand')).toMatchSnapshot('nav-sandbox-name');
    expect(renderNav(deniedChoice, '/brand')).toMatchSnapshot('nav-generative-denied');
  });

  it('matches untouched /brand markup with rooms and studio v2 open', async () => {
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_STUDIO_V2', 'on');

    const emptyHtml = renderToStaticMarkup(
      (await BrandHome({ searchParams: Promise.resolve({ organizationId: ORG_STUDIO }) })) as ReactElement,
    );
    expect(emptyHtml).toMatchSnapshot('brand-page-empty');

    state.projects = [
      project('11111111-1111-4111-8111-111111111111', ORG_STUDIO, 'creator', 'Creator Campaign Alpha'),
      project('22222222-2222-4222-8222-222222222222', ORG_STUDIO, 'studio', 'Studio Film Beta'),
    ];
    const listHtml = renderToStaticMarkup(
      (await BrandHome({ searchParams: Promise.resolve({ organizationId: ORG_STUDIO }) })) as ReactElement,
    );
    expect(listHtml).toMatchSnapshot('brand-page-list');
  });

  it('matches untouched WorkspaceTeamHome markup', () => {
    const freshHtml = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG_STUDIO}
        organizationName="Alpha fixture"
        projects={[]}
        totalProjects={0}
        reviews={[]}
        canRequest
        copy={teamCopy}
      />,
    );
    expect(freshHtml).toMatchSnapshot('team-home-fresh');

    const activeHtml = renderToStaticMarkup(
      <WorkspaceTeamHome
        organizationId={ORG_STUDIO}
        organizationName="Alpha fixture"
        projects={TEAM_PROJECTS}
        totalProjects={2}
        reviews={[ALERT]}
        canRequest
        copy={teamCopy}
      />,
    );
    expect(activeHtml).toMatchSnapshot('team-home-active');
  });
});
