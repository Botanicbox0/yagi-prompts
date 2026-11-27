import { readFileSync } from 'node:fs';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { BrandProjectDetail, BrandProjectSummary, BrandWorkspace } from '@/lib/brands/workspace/types';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  CLOSED_SWITCH_FORBIDDEN_STRINGS,
  MAIN_BELL_PROP_KEYS,
  MAIN_HOME_PROP_KEYS,
  MAIN_INTAKE_WIZARD_PROP_KEYS,
  MAIN_NAV_PROP_KEYS,
  MAIN_PROJECT_DETAIL_PROP_KEYS_WITHOUT_ROOM,
  MAIN_PROJECT_DETAIL_PROP_KEYS_WITH_ROOM,
  expectedMainHomeCopySummary,
  expectedMainIntakeQueryCases,
  expectedMainReportStructure,
  expectedMainRoomShellStructure,
  expectedMainRoomsNavKeys,
} from './__fixtures__/campaign-ops-main-parity';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const OTHER = 'b0000000-0000-4000-8000-0000000000b2';
const PROJECT_ID = 'c0000000-0000-4000-8000-0000000000c3';
const REPORT_ID = 'd0000000-0000-4000-8000-0000000000d4';
const USER_ID = '00000000-0000-4000-8000-000000000001';
const SANDBOX_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;

const state = vi.hoisted(() => ({
  scope: null as unknown as BrandWorkspaceScope,
  projects: [] as BrandProjectSummary[],
  projectDetail: null as unknown as BrandProjectDetail,
  spineOpen: true,
  capturedNavProps: null as Record<string, unknown> | null,
  capturedBellProps: null as Record<string, unknown> | null,
  capturedBellChildren: null as unknown,
  capturedHomeProps: null as Record<string, unknown> | null,
  capturedDetailProps: null as Record<string, unknown> | null,
  capturedWizardProps: null as Record<string, unknown> | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers({ 'x-twings-surface': 'brand', 'x-playbook-locale': 'ko' }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand',
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/app/fonts', () => ({
  fontVariables: 'font-vars',
}));

vi.mock('@/lib/i18n/server', () => ({
  getRequestLocale: async () => 'ko' as const,
}));

vi.mock('@/lib/auth/viewer', () => ({
  getViewer: async () => ({ userId: USER_ID, isAdmin: false }),
}));

vi.mock('@/lib/auth/verified-email', () => ({
  getVerifiedEmail: async () => undefined,
}));

vi.mock('@/lib/db/connect', () => ({
  getSqlRunner: async () => ({ query: async () => ({ rows: [] }) }),
}));

vi.mock('@/components/brand-workspace/scope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/scope')>();
  return {
    ...actual,
    loadCachedBrandWorkspaceScope: async () => state.scope,
  };
});

vi.mock('@/lib/brands/workspace/service', () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandWorkspaceScope: async () => state.scope,
  loadBrandWorkspace: async (_d: unknown, _v: unknown, options: { organizationId?: string } = {}): Promise<BrandWorkspace> => {
    const choice = state.scope.choices.find((c) => c.id === options.organizationId);
    return {
      organizations:
        choice && choice.role !== 'guest' && choice.role !== 'studio'
          ? [{ id: choice.id, name: choice.name, role: choice.role }]
          : [],
      projects: state.projects.filter((p) => p.organizationId === options.organizationId),
    };
  },
  loadBrandProject: async () => state.projectDetail,
}));

vi.mock('@/lib/brands/usage/service', () => ({
  loadBrandUsage: async () => null,
}));

vi.mock('@/lib/brands/usage/runtime', () => ({
  usagePaymentsOpen: () => false,
}));

vi.mock('@/lib/brands/entitlements', () => ({
  loadFeaturePolicy: async () => ({ denied: [] as const }),
}));

vi.mock('@/lib/campaigns/collaboration/service', () => ({
  loadProjectApplicants: async () => null,
  loadProjectCollaboration: async () => null,
}));

vi.mock('@/lib/campaigns/funding/service', () => ({
  loadFundingProject: async () => null,
}));

vi.mock('@/lib/brands/shortlist/service', () => ({
  loadBrandShortlist: async () => null,
  loadStudioShortlist: async () => null,
}));

vi.mock('@/lib/brand-studio/brand-projects', () => ({
  memberSeesBrandProjects: () => true,
  brandProjectSpineOpen: async () => state.spineOpen,
}));

vi.mock('@/lib/brand-studio/usage', () => ({
  loadAllowance: async () => null,
}));

vi.mock('@/lib/brand-studio/repo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand-studio/repo')>();
  return {
    ...actual,
    jobsOf: async () => [],
    viewsOf: async () => [],
  };
});

vi.mock('@/lib/brand-rooms/messages', () => ({
  loadRoomSummary: async () => null,
}));

vi.mock('@/lib/brand-news/service', () => ({
  loadHomeAnnouncement: async () => null,
}));

vi.mock('@/lib/brands/workspace/home-checklist', () => ({
  loadFirstRunChecklistState: async () => null,
}));

vi.mock('@/lib/brand-rooms/members-channel', () => ({
  brandSendSwitchesOn: () => false,
  brandSendOpenFor: async () => false,
}));

vi.mock('@/lib/brand-rooms/overview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/brand-rooms/overview')>();
  return {
    ...actual,
    roomUnreadCounts: async () => ({}),
    loadRoomProject: async () => ({
      id: PROJECT_ID,
      organizationId: ORG,
      organizationName: 'Alpha fixture',
      title: 'Studio Film Fixture',
      track: 'studio_film',
      status: 'active',
      revision: 1,
      objective: 'Film brief',
      productionMode: 'studio',
      intakeBrief: null,
      clientVisible: true,
      createdAt: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T00:00:00.000Z',
    }),
    loadRoomPeople: async () => [],
    loadRoomOverview: async () => ({
      stage: 'storyboard',
      steps: [],
      todos: [],
      activity: [],
      counts: { storyboard: 0, review: 0, chat: 0 },
      empty: true,
      received: false,
    }),
    loadRoomBriefFiles: async () => [],
  };
});

vi.mock('@/components/brand-workspace/navigation', () => ({
  WorkspaceNavigation: (props: Record<string, unknown>) => {
    state.capturedNavProps = props;
    return null;
  },
}));

vi.mock('@/components/brand-workspace/identity', () => ({
  WorkspaceIdentity: () => null,
}));

vi.mock('@/components/brand-workspace/context-links', () => ({
  WorkspaceHomeLink: () => null,
  WorkspaceSupport: () => null,
}));

vi.mock('@/components/brand-workspace/language', () => ({
  WorkspaceLanguage: () => null,
}));

vi.mock('@/components/brand-workspace/error-copy', () => ({
  BrandErrorCopyProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@/components/brand-workspace/spotlight', () => ({
  WorkspaceSpotlight: () => null,
}));

vi.mock('@/components/brand-workspace/bell/provider', () => ({
  BellProvider: ({ children, ...rest }: Record<string, unknown> & { children: unknown }) => {
    state.capturedBellProps = { ...rest, children };
    state.capturedBellChildren = children;
    return children;
  },
}));

vi.mock('@/components/brand-workspace/bell', () => ({
  WorkspaceBell: () => null,
}));

vi.mock('@/components/brand-workspace/home/home-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/home/home-view')>();
  return {
    ...actual,
    WorkspaceHome: (props: Record<string, unknown>) => {
      state.capturedHomeProps = props;
      return actual.WorkspaceHome(props as unknown as Parameters<typeof actual.WorkspaceHome>[0]);
    },
  };
});

vi.mock('@/components/brand-workspace/project-detail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/project-detail')>();
  return {
    ...actual,
    ProjectDetail: (props: Record<string, unknown>) => {
      state.capturedDetailProps = props;
      return actual.ProjectDetail(props as unknown as Parameters<typeof actual.ProjectDetail>[0]);
    },
  };
});

vi.mock('@/components/brand-workspace/project-intake-wizard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/project-intake-wizard')>();
  return {
    ...actual,
    ProjectIntakeWizard: (props: Record<string, unknown>) => {
      state.capturedWizardProps = props;
      return actual.ProjectIntakeWizard(props as unknown as Parameters<typeof actual.ProjectIntakeWizard>[0]);
    },
  };
});

import BrandLayout from '@/app/(brand)/layout';
import BrandWorkspaceHome from '@/app/(brand)/brand/home/page';
import BrandHome from '@/app/(brand)/brand/page';
import ProjectRoomPage from '@/app/(brand)/brand/rooms/[projectId]/page';
import BrandProject from '@/app/(brand)/brand/projects/[id]/page';
import BrandReportPage from '@/app/(brand)/brand/projects/[id]/reports/[reportId]/page';
import NewBrandProject from '@/app/(brand)/brand/projects/new/page';
import { WorkspaceHome } from '@/components/brand-workspace/home/home-view';
import { ProjectDetail } from '@/components/brand-workspace/project-detail';
import { homeLayout } from '@/lib/brands/workspace/home';

function componentLabel(type: unknown): string {
  if (typeof type === 'string') return type;
  if (typeof type === 'symbol') return type === Symbol.for('react.fragment') ? 'Fragment' : type.toString();
  if (typeof type === 'function') {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || 'Component';
  }
  return 'Unknown';
}

const MAIN_KO_BRAND_WORKSPACE = getDictionary('ko').brandWorkspace;

function serializeElementTree(node: unknown, depth = 0): unknown {
  if (depth > 8) return '[MaxDepth]';
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'string' || typeof node === 'number') {
    return node;
  }
  // Exact main (b27eb51f) brandWorkspace dictionary reference already had unrelated dashboard.studioTitle; verify exact identity cleanly.
  if (node === MAIN_KO_BRAND_WORKSPACE) return '[main:dict.brandWorkspace]';
  if (Array.isArray(node)) return node.map((item) => serializeElementTree(item, depth + 1));
  if (isValidElement(node)) {
    const el = node as ReactElement<Record<string, unknown>>;
    const rawProps = el.props ?? {};
    const propsOut: Record<string, unknown> = {};
    for (const k of Object.keys(rawProps).sort()) {
      if (k === 'children') continue;
      const v = rawProps[k];
      propsOut[k] = typeof v === 'function' ? `[fn:${v.name || 'anonymous'}]` : serializeElementTree(v, depth + 1);
    }
    const children =
      rawProps.children === undefined
        ? undefined
        : Array.isArray(rawProps.children)
          ? rawProps.children.map((c) => serializeElementTree(c, depth + 1))
          : [serializeElementTree(rawProps.children, depth + 1)];
    return {
      type: componentLabel(el.type),
      props: propsOut,
      ...(children !== undefined ? { children } : {}),
    };
  }
  if (typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node as Record<string, unknown>).sort()) {
      const v = (node as Record<string, unknown>)[k];
      out[k] = typeof v === 'function' ? `[fn:${v.name || 'anonymous'}]` : serializeElementTree(v, depth + 1);
    }
    return out;
  }
  return String(node);
}

function assertNoClosedSwitchLeaks(label: string, payload: unknown) {
  const serialized = typeof payload === 'string' ? payload : JSON.stringify(serializeElementTree(payload));
  for (const forbidden of CLOSED_SWITCH_FORBIDDEN_STRINGS) {
    expect(serialized, `${label} leaked ${forbidden}`).not.toContain(forbidden);
  }
}

const makeProjectDetail = (role: BrandProjectDetail['role'] = 'owner'): BrandProjectDetail => ({
  id: PROJECT_ID,
  organizationId: ORG,
  organizationName: 'Alpha fixture',
  title: 'Studio Film Fixture',
  objective: 'Film brief',
  audience: '',
  budgetKrw: null,
  budgetTaxBasis: 'unspecified',
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: 'views', targetValue: null },
  startsOn: '2026-11-15',
  endsOn: '2026-11-30',
  productionMode: 'studio',
  status: 'active',
  revision: 1,
  createdAt: '2026-11-15T00:00:00.000Z',
  updatedAt: '2026-11-15T00:00:00.000Z',
  role,
  canComment: true,
  clientVisible: true,
  coverUrl: null,
  campaignTerms: null,
  referenceLinks: [],
  contents: [],
  decisions: [],
  messages: [],
  attachments: [],
  posts: [],
  contracts: [],
  reports: [
    {
      id: REPORT_ID,
      version: 1,
      summary: 'Summary fixture',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-20',
      snapshot: {
        totalPosts: 0,
        measuredPosts: 0,
        viewsTotal: null,
        viewsTotalApproximate: false,
        metricDefinition: 'sum_of_latest_post_views',
        posts: [],
      },
      createdAt: '2026-11-20T00:00:00.000Z',
    },
  ],
  intakeBrief: null,
});

const owner: BrandWorkspaceChoice = { id: ORG, name: 'Alpha fixture', role: 'owner', logoUrl: null, denied: [] };

beforeEach(() => {
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_CAMPAIGN_OPS', 'off');
  state.scope = { choices: [owner], projectOrganizations: {} };
  state.projects = [];
  state.projectDetail = makeProjectDetail('owner');
  state.spineOpen = true;
  state.capturedNavProps = null;
  state.capturedBellProps = null;
  state.capturedBellChildren = null;
  state.capturedHomeProps = null;
  state.capturedDetailProps = null;
  state.capturedWizardProps = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Campaign ops C1 SF3 & X1: main (b27eb51f) closed-switch & excluded page-data parity', () => {
  it('keeps messages/rooms-shell.ts and messages/studio-shell.ts free of campaign-ops keys', () => {
    for (const locale of ['ko', 'en'] as const) {
      const d = getDictionary(locale);
      expect(Object.keys(d.roomsShell.nav).sort()).toEqual(expectedMainRoomsNavKeys());
      expect('groupCampaignOps' in d.roomsShell.nav).toBe(false);
      expect('opsCampaigns' in d.studioShell.rail).toBe(false);
      expect('production' in d.studioShell.rail).toBe(false);
    }
    expect(readFileSync('messages/rooms-shell.ts', 'utf8')).not.toContain('campaign-ops');
    expect(readFileSync('messages/studio-shell.ts', 'utf8')).not.toContain('campaign-ops');
  });

  it('matches main BrandLayout props to BOTH WorkspaceNavigation and BellProvider without CampaignOpsTrackProvider', async () => {
    const captureLayout = async (choice: BrandWorkspaceChoice) => {
      state.scope = { choices: [choice], projectOrganizations: {} };
      state.capturedNavProps = null;
      state.capturedBellProps = null;
      state.capturedBellChildren = null;
      const html = renderToStaticMarkup((await BrandLayout({ children: null })) as ReactElement);
      return { html, navProps: state.capturedNavProps!, bellProps: state.capturedBellProps!, bellChild: state.capturedBellChildren };
    };

    const closed = await captureLayout(owner);
    expect(Object.keys(closed.navProps).sort()).toEqual([...MAIN_NAV_PROP_KEYS]);
    expect(Object.keys(closed.bellProps).sort()).toEqual([...MAIN_BELL_PROP_KEYS]);
    expect(componentLabel((closed.bellChild as ReactElement).type)).toBe('div');
    assertNoClosedSwitchLeaks('BrandLayout closed navProps', closed.navProps);
    assertNoClosedSwitchLeaks('BrandLayout closed bellProps', closed.bellProps);
    assertNoClosedSwitchLeaks('BrandLayout closed html', closed.html);

    // Excluded seats/orgs with BRAND_CAMPAIGN_OPS=on & ORGS=* must also match main identically.
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', OTHER);
    const unlisted = await captureLayout(owner);
    expect(Object.keys(unlisted.navProps).sort()).toEqual([...MAIN_NAV_PROP_KEYS]);
    expect(Object.keys(unlisted.bellProps).sort()).toEqual([...MAIN_BELL_PROP_KEYS]);
    assertNoClosedSwitchLeaks('BrandLayout unlisted', { nav: unlisted.navProps, bell: unlisted.bellProps });

    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', '*');
    for (const excluded of [
      { id: ORG, name: 'Alpha fixture', role: 'guest', logoUrl: null } as BrandWorkspaceChoice,
      { id: SANDBOX_ID, name: 'Client', role: 'owner', logoUrl: null } as BrandWorkspaceChoice,
    ]) {
      state.spineOpen = false;
      const res = await captureLayout(excluded);
      expect('campaignOpsOrgs' in res.navProps).toBe(false);
      expect('campaignOpsCopy' in res.navProps).toBe(false);
      assertNoClosedSwitchLeaks(`BrandLayout excluded ${excluded.id}`, res.navProps);
    }

    // Open switch passes campaignOpsOrgs + campaignOpsCopy to nav AND campaignOpsOrgs to BellProvider.
    state.spineOpen = true;
    const opened = await captureLayout(owner);
    expect(opened.navProps.campaignOpsOrgs).toEqual([ORG]);
    expect(opened.navProps.campaignOpsCopy).toEqual({
      modeLabel: getDictionary('ko').campaignOps.mode.label,
      campaigns: getDictionary('ko').campaignOps.rail.campaigns,
      production: getDictionary('ko').campaignOps.rail.production,
    });
    expect(opened.bellProps.campaignOpsOrgs).toEqual([ORG]);
    expect(componentLabel((opened.bellChild as ReactElement).type)).toBe('CampaignOpsTrackProvider');
  });

  it('matches main /brand/home (WorkspaceHome props) and /brand with switch closed', async () => {
    const ko = getDictionary('ko');
    state.spineOpen = false;

    const homeTree = (await BrandWorkspaceHome({
      searchParams: Promise.resolve({ organizationId: ORG }),
    })) as ReactElement;
    const homeHtml = renderToStaticMarkup(homeTree);
    expect(Object.keys(state.capturedHomeProps!).sort()).toEqual([...MAIN_HOME_PROP_KEYS]);
    expect('teamModeLabel' in state.capturedHomeProps!).toBe(false);
    expect((state.capturedHomeProps!.copy as Record<string, unknown>).roomsNav).toEqual(
      expectedMainHomeCopySummary(ko).roomsNav,
    );
    expect(homeHtml).toContain(`>${ko.roomsShell.nav.groupTeam}<`);
    assertNoClosedSwitchLeaks('BrandWorkspaceHome closed tree', homeTree);
    assertNoClosedSwitchLeaks('BrandWorkspaceHome closed html', homeHtml);

    const brandTree = (await BrandHome({
      searchParams: Promise.resolve({ organizationId: ORG }),
    })) as ReactElement;
    const brandHtml = renderToStaticMarkup(brandTree);
    assertNoClosedSwitchLeaks('/brand closed tree', brandTree);
    assertNoClosedSwitchLeaks('/brand closed html', brandHtml);

    // Open check on WorkspaceHome (regression check for Answer 1).
    const layout = homeLayout({ choice: { id: ORG, role: 'owner', denied: [] }, flagOn: true, canRequest: true, rooms: true })!;
    const openHomeHtml = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName="Alpha fixture"
        locale="ko"
        layout={layout}
        allowance={null}
        reviews={[]}
        results={[]}
        activeProjects={0}
        readOnly={false}
        teamModeLabel={ko.campaignOps.mode.label}
        copy={{
          home: ko.brandHome,
          shell: ko.studioShell,
          roomsNav: ko.roomsShell.nav,
          inbox: ko.roomsChat.inbox,
          prompt: { label: ko.brandStudio.dock.label, placeholder: { image: ko.brandStudio.dock.placeholder, video: ko.brandStudio.dock.placeholderVideo } },
          activeStatus: ko.brandWorkspace.status.active,
          allAssets: ko.studioLibrary.allAssets,
        }}
      />,
    );
    expect(openHomeHtml).toContain(`>${ko.campaignOps.mode.label}<`);
    expect(openHomeHtml).not.toContain(`>${ko.roomsShell.nav.groupTeam}<`);
  });

  it('X1 & SF3: /brand/rooms/[id], /brand/projects/[id], and reports/[reportId] match main trees and omit CampaignOpsTrackMarker when closed or excluded', async () => {
    const ko = getDictionary('ko');
    const assertClosedPages = async (label: string) => {
      // 1. Room page: exact 1 direct div.brr-room child, zero CampaignOpsTrackMarker.
      const roomEl = (await ProjectRoomPage({
        params: Promise.resolve({ projectId: PROJECT_ID }),
        searchParams: Promise.resolve({ organizationId: ORG }),
      })) as ReactElement<{ children?: ReactElement | ReactElement[] }>;
      const expectedRoom = expectedMainRoomShellStructure(PROJECT_ID);
      expect(componentLabel(roomEl.type), `${label} room provider`).toBe(expectedRoom.providerName);
      expect(Array.isArray(roomEl.props.children), `${label} room single child`).toBe(false);
      const roomDiv = roomEl.props.children as ReactElement<{ className?: string; children?: ReactNode }>;
      expect(roomDiv.type).toBe(expectedRoom.childTag);
      expect(roomDiv.props.className).toBe(expectedRoom.rootClass);
      const roomHtml = renderToStaticMarkup(roomEl);
      assertNoClosedSwitchLeaks(`${label} room tree`, roomEl);
      assertNoClosedSwitchLeaks(`${label} room html`, roomHtml);

      // 2. Project detail page: exact ProjectDetail props without opsTrack, no marker/null child hole inside div.
      state.capturedDetailProps = null;
      const projectEl = (await BrandProject({
        params: Promise.resolve({ id: PROJECT_ID }),
        searchParams: Promise.resolve({}),
      })) as ReactElement;
      const projectHtml = renderToStaticMarkup(projectEl);
      expect(Object.keys(state.capturedDetailProps!).sort()).toEqual([...MAIN_PROJECT_DETAIL_PROP_KEYS_WITH_ROOM]);
      expect('opsTrack' in state.capturedDetailProps!).toBe(false);
      assertNoClosedSwitchLeaks(`${label} project el`, projectEl);
      assertNoClosedSwitchLeaks(`${label} project html`, projectHtml);

      const directDetailEl = ProjectDetail({
        project: makeProjectDetail('owner'),
        b: ko.brandWorkspace,
        locale: 'ko',
      }) as ReactElement<{ children?: ReactElement[] }>;
      expect(componentLabel(directDetailEl.props.children![0]!.type)).toBe('Masthead');

      // 3. Report page: exact 2-child Fragment (a + ReportResult), zero CampaignOpsTrackMarker.
      const reportEl = (await BrandReportPage({
        params: Promise.resolve({ id: PROJECT_ID, reportId: REPORT_ID }),
      })) as ReactElement<{ children?: ReactElement[] }>;
      const expectedReport = expectedMainReportStructure(PROJECT_ID, ko.brandWorkspace.back);
      expect(componentLabel(reportEl.type)).toBe(expectedReport.rootType);
      expect(reportEl.props.children).toHaveLength(expectedReport.childCount);
      const [backLink, reportComp] = reportEl.props.children as [
        ReactElement<{ href?: string }>,
        ReactElement,
      ];
      expect(backLink!.type).toBe(expectedReport.firstChild.tag);
      expect(backLink!.props.href).toBe(expectedReport.firstChild.href);
      expect(componentLabel(reportComp!.type)).toBe(expectedReport.secondChildComponent);
      const reportHtml = renderToStaticMarkup(reportEl);
      assertNoClosedSwitchLeaks(`${label} report el`, reportEl);
      assertNoClosedSwitchLeaks(`${label} report html`, reportHtml);
    };

    await assertClosedPages('BRAND_CAMPAIGN_OPS=off');

    // Also excluded org (e.g. Morphic) even with BRAND_CAMPAIGN_OPS=on & ORGS=*
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', OTHER);
    await assertClosedPages('unlisted org');

    // Also project detail with BRAND_ROOMS=off (exact main prop keys without roomEntry).
    vi.stubEnv('BRAND_ROOMS', 'off');
    state.capturedDetailProps = null;
    const noRoomsDetail = (await BrandProject({
      params: Promise.resolve({ id: PROJECT_ID }),
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    renderToStaticMarkup(noRoomsDetail);
    expect(Object.keys(state.capturedDetailProps!).sort()).toEqual([...MAIN_PROJECT_DETAIL_PROP_KEYS_WITHOUT_ROOM]);
    assertNoClosedSwitchLeaks('project detail rooms=off', noRoomsDetail);

    // Open switch DOES emit CampaignOpsTrackMarker on all 3 pages.
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    vi.stubEnv('BRAND_CAMPAIGN_OPS_ORGS', ORG);
    const openRoom = (await ProjectRoomPage({
      params: Promise.resolve({ projectId: PROJECT_ID }),
      searchParams: Promise.resolve({ organizationId: ORG }),
    })) as ReactElement<{ children?: ReactNode }>;
    expect(JSON.stringify(serializeElementTree(openRoom))).toContain('CampaignOpsTrackMarker');

    state.capturedDetailProps = null;
    const openProject = (await BrandProject({
      params: Promise.resolve({ id: PROJECT_ID }),
      searchParams: Promise.resolve({}),
    })) as ReactElement;
    expect(state.capturedDetailProps).toBeNull();
    expect((openProject.props as Record<string, unknown>).opsTrack).toBe('studio_film');
    renderToStaticMarkup(openProject);
    const openCaptured = state.capturedDetailProps as Record<string, unknown> | null;
    expect(openCaptured?.opsTrack).toBe('studio_film');

    const openReport = (await BrandReportPage({
      params: Promise.resolve({ id: PROJECT_ID, reportId: REPORT_ID }),
    })) as ReactElement<{ children?: ReactElement[] }>;
    expect(componentLabel(openReport.props.children![0]!.type)).toBe('CampaignOpsTrackMarker');
  });

  it('SF3: /brand/projects/new matches main across valid, unknown, and start=ops queries with switch closed', async () => {
    for (const c of expectedMainIntakeQueryCases()) {
      state.capturedWizardProps = null;
      const newEl = (await NewBrandProject({
        searchParams: Promise.resolve({ organizationId: ORG, ...c.query }),
      })) as ReactElement<{ children?: ReactNode }>;
      const html = renderToStaticMarkup(newEl);
      expect(Object.keys(state.capturedWizardProps!).sort(), JSON.stringify(c.query)).toEqual([
        ...MAIN_INTAKE_WIZARD_PROP_KEYS,
      ]);
      expect(state.capturedWizardProps!.initialTrack, JSON.stringify(c.query)).toBe(c.initialTrack);
      expect('opsStart' in state.capturedWizardProps!).toBe(false);
      assertNoClosedSwitchLeaks(`intake closed ${JSON.stringify(c.query)} el`, newEl);
      assertNoClosedSwitchLeaks(`intake closed ${JSON.stringify(c.query)} html`, html);
    }
  });
});
