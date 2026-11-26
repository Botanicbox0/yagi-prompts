import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import type { RailWorkspace } from '@/components/brand-workspace/rail-workspace-menu';
import { SANDBOXED_CLIENT_ORG_IDS } from '@/lib/brands/features';
import type { FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeLayout, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import type { BrandWorkspaceChoice, BrandWorkspaceScope } from '@/lib/brands/workspace/selection';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Slice 3a §2 parity snapshots — generated on the untouched branch before any other edit.
 * NEVER regenerate these snapshots: any later failure means a change broke parity without the new props.
 */
const state = vi.hoisted(() => ({ path: '/brand/home', query: '', unread: 0 }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => state.path,
  useSearchParams: () => new URLSearchParams(state.query),
}));

vi.mock('@/components/brand-workspace/rail-activity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/brand-workspace/rail-activity')>();
  return {
    ...actual,
    useStudioActivity: () => ({ summary: null, counts: { image: 0, video: 0, sound: 0 }, toasts: [], dismiss: () => {} }),
    useRoomUnread: () => state.unread,
  };
});

import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import { WorkspaceTeamHome, type TeamHomeProject } from '@/components/brand-workspace/home/team-home';
import { RailNavigation } from '@/components/brand-workspace/rail-nav';
import { WorkspaceNavigation } from '@/components/brand-workspace/navigation';

type Locale = 'ko' | 'en';
const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const NAME = 'Fern & Field';
const ALLOWANCE = { capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' };

const homeCopyOf = (locale: Locale): WorkspaceHomeProps['copy'] => {
  const d = getDictionary(locale);
  return {
    home: d.brandHome,
    shell: d.studioShell,
    roomsNav: d.roomsShell.nav,
    inbox: d.roomsChat.inbox,
    prompt: { label: d.brandStudio.dock.label, placeholder: { image: d.brandStudio.dock.placeholder, video: d.brandStudio.dock.placeholderVideo } },
    activeStatus: d.brandWorkspace.status.active,
    allAssets: d.studioLibrary.allAssets,
    closedRequestDraft: d.brandStudio.dock.closedRequestDraft,
    closedRequestOrgFallback: d.brandStudio.dock.closedRequestOrgFallback,
    billingCustomer: d.brandBilling.customer,
  };
};

type Role = 'owner' | 'editor' | 'viewer' | 'studio';
const layoutOf = (role: Role, options: { rooms?: boolean; assets?: boolean } = {}): HomeLayout => {
  const layout = homeLayout({ choice: { id: ORG, name: NAME, role }, flagOn: true, canRequest: role === 'owner' || role === 'editor', rooms: options.rooms ?? true })!;
  return options.assets === false ? { ...layout, tools: layout.tools.filter((tool) => tool.key !== 'assets') } : layout;
};

const alert = (n: number, over: Partial<RoomAlertItem> = {}): RoomAlertItem => ({
  id: `alert-${n}`,
  kind: 'review',
  projectId: `p0000000-0000-4000-8000-00000000000${n}`,
  projectTitle: `Spring launch ${n}`,
  targetId: `t0000000-0000-4000-8000-00000000000${n}`,
  title: `Cut ${n}`,
  version: n,
  openNotes: 0,
  updatedAt: '2026-11-24T00:00:00Z',
  ...over,
});

const oid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const wallResult = (n: number, kind: 'image' | 'video', over: Partial<HomeResult> = {}): HomeResult => ({
  outputId: oid(n),
  kind,
  src: kind === 'image' ? `/m/still-${n}.webp` : `/m/poster-${n}.jpg`,
  clip: null,
  play: kind === 'video' ? `/m/film-${n}.mp4` : null,
  width: kind === 'image' ? 800 : 1920,
  height: kind === 'image' ? 1000 : 1080,
  seconds: kind === 'video' ? 6.2 : null,
  href: `/brand/studio${kind === 'video' ? '/video' : ''}?organizationId=${ORG}&view=o%3A${oid(n)}`,
  ...over,
});

const WALL: HomeResult[] = [
  wallResult(1, 'video'),
  wallResult(2, 'image'),
  wallResult(3, 'image', { width: 1080, height: 1920 }),
  wallResult(4, 'video', { src: null, clip: '/m/film-4.mp4', play: '/m/film-4.mp4', width: null, height: null, seconds: null }),
  wallResult(5, 'image', { width: 2400, height: 1000 }),
  wallResult(6, 'image', { width: null, height: null }),
  wallResult(7, 'video', { width: 1080, height: 1920, seconds: 14 }),
];

const CHECKLIST: FirstRunChecklistState = {
  show: true,
  hasTeammate: false,
  hasLogo: false,
  hasUploads: false,
  usageApproved: false,
  usageRequestSent: false,
  usageState: 'not_requested',
  hasFirstImage: false,
};

function renderHome(v: {
  locale?: Locale;
  role?: Role;
  reviews?: RoomAlertItem[];
  results?: HomeResult[];
  activeProjects?: number;
  checklist?: FirstRunChecklistState | null;
  notice?: ReactNode;
} = {}): string {
  const locale = v.locale ?? 'ko';
  const role = v.role ?? 'owner';
  return renderToStaticMarkup(
    <WorkspaceHome
      organizationId={ORG}
      organizationName={NAME}
      locale={locale}
      layout={layoutOf(role)}
      allowance={ALLOWANCE}
      reviews={v.reviews ?? []}
      results={v.results ?? []}
      activeProjects={v.activeProjects ?? 0}
      readOnly={role === 'viewer' || role === 'studio'}
      viewerNote={role === 'viewer'}
      notice={v.notice}
      checklist={v.checklist ?? null}
      canOpenBilling={role === 'owner'}
      copy={homeCopyOf(locale)}
    />,
  );
}

const ko = getDictionary('ko');
const teamCopy = {
  home: ko.brandHome,
  nav: ko.roomsShell.nav,
  space: ko.roomsShell.space,
  overview: ko.roomsShell.overview,
  inbox: ko.roomsChat.inbox,
};
const TEAM_PROJECTS: TeamHomeProject[] = [
  {
    id: 'p0000000-0000-4000-8000-000000000001',
    title: 'Spring launch',
    stage: 'storyboard',
    steps: [
      { stage: 'requested', state: 'done', at: '2026-11-20T01:00:00.000Z' },
      { stage: 'storyboard', state: 'current', at: '2026-11-25T05:00:00.000Z' },
      { stage: 'draft', state: 'ahead', at: null },
      { stage: 'revision', state: 'ahead', at: null },
      { stage: 'done', state: 'ahead', at: null },
    ],
    unread: 2,
  },
  {
    id: 'p0000000-0000-4000-8000-000000000002',
    title: 'Winter lip film',
    stage: 'draft',
    steps: [
      { stage: 'requested', state: 'done', at: '2026-11-18T01:00:00.000Z' },
      { stage: 'storyboard', state: 'done', at: '2026-11-20T01:00:00.000Z' },
      { stage: 'draft', state: 'current', at: '2026-11-24T01:00:00.000Z' },
      { stage: 'revision', state: 'ahead', at: null },
      { stage: 'done', state: 'ahead', at: null },
    ],
    unread: 0,
  },
];

const shell = ko.studioShell;
const roomsNav = ko.roomsShell.nav;
const b = ko.brandWorkspace;
const railWorkspace: RailWorkspace = {
  currentId: ORG,
  emptyLabel: b.identity.none,
  brands: [{ id: ORG, name: NAME, logoUrl: null, role: b.roles.owner, href: `/brand/home?organizationId=${ORG}`, staff: false }],
  locale: 'ko',
  copy: {
    current: b.identity.current,
    switch: b.identity.switch,
    staffGroup: b.identity.staffGroup,
    language: ko.nav.localeToggle,
    signOut: b.signOut,
  },
};

const navLabels = {
  home: b.home,
  members: b.members,
  settings: b.managed.settings,
  library: b.managed.library,
  studio: b.productionStudio.title,
  identity: b.identityLayer.nav,
  creators: b.creatorPool.nav,
};
const workspaceMenu = { identity: b.identity, roles: b.roles, language: ko.nav.localeToggle, signOut: b.signOut };
const scopeOf = (choice: BrandWorkspaceChoice): BrandWorkspaceScope => ({ choices: [choice], projectOrganizations: {} });

beforeEach(() => {
  state.path = '/brand/home';
  state.query = '';
  state.unread = 0;
});

afterEach(() => {
  state.path = '/brand/home';
  state.query = '';
  state.unread = 0;
});

describe('Slice 3a parity snapshots (without new props)', () => {
  it('matches the making home snapshots', async () => {
    await expect(
      renderHome({
        role: 'owner',
        reviews: [alert(1), alert(2, { kind: 'storyboard', title: '' }), alert(3)],
        results: WALL,
        activeProjects: 2,
        checklist: CHECKLIST,
      }),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-make-home-owner-wall.html');

    await expect(renderHome({ role: 'owner', reviews: [], results: [], activeProjects: 0, checklist: null })).toMatchFileSnapshot(
      './__snapshots__/home-rail-make-home-owner-empty.html',
    );

    await expect(renderHome({ role: 'viewer', results: WALL })).toMatchFileSnapshot('./__snapshots__/home-rail-make-home-viewer.html');

    await expect(
      renderHome({ role: 'studio', results: WALL, notice: <p data-staff-notice-fixture>TWINGS team view</p> }),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-make-home-staff.html');

    await expect(
      renderHome({ locale: 'en', role: 'owner', reviews: [alert(1)], results: WALL, activeProjects: 1 }),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-make-home-en.html');
  });

  it('matches the team home snapshots', async () => {
    await expect(
      renderToStaticMarkup(
        <WorkspaceTeamHome
          organizationId={ORG}
          organizationName={NAME}
          projects={TEAM_PROJECTS}
          totalProjects={2}
          reviews={[alert(1)]}
          canRequest
          copy={teamCopy}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-team-home-projects.html');

    await expect(
      renderToStaticMarkup(
        <WorkspaceTeamHome
          organizationId={ORG}
          organizationName={NAME}
          projects={[]}
          totalProjects={0}
          reviews={[]}
          canRequest
          copy={teamCopy}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-team-home-empty.html');

    await expect(
      renderToStaticMarkup(
        <WorkspaceTeamHome
          organizationId={ORG}
          organizationName={NAME}
          projects={[TEAM_PROJECTS[0]!]}
          totalProjects={1}
          reviews={[]}
          canRequest={false}
          viewerNote
          copy={teamCopy}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-team-home-viewer.html');
  });

  it('matches the rail snapshots across modes, expanded/collapsed, and unread states', async () => {
    const renderRail = (opts: { path: string; expanded: boolean; unread: number; rooms: boolean }) => {
      state.path = opts.path;
      state.unread = opts.unread;
      return renderToStaticMarkup(
        <RailNavigation
          organizationId={ORG}
          studio
          creators={false}
          sound
          identity={false}
          team
          billing
          settings
          canCreate
          copy={shell}
          locale="ko"
          initialExpanded={opts.expanded}
          scope={(p) => `${p}?organizationId=${ORG}`}
          rooms={opts.rooms}
          roomsCopy={opts.rooms ? roomsNav : undefined}
          home={ko.brandHome.nav.home}
          workspace={railWorkspace}
        />,
      );
    };

    await expect(renderRail({ path: '/brand/studio', expanded: true, unread: 0, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-make-expanded-unread0.html',
    );
    await expect(renderRail({ path: '/brand/studio', expanded: true, unread: 3, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-make-expanded-unread3.html',
    );
    await expect(renderRail({ path: '/brand/studio', expanded: false, unread: 0, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-make-collapsed-unread0.html',
    );
    await expect(renderRail({ path: '/brand/studio', expanded: false, unread: 3, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-make-collapsed-unread3.html',
    );

    await expect(renderRail({ path: '/brand', expanded: true, unread: 0, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-team-expanded-unread0.html',
    );
    await expect(renderRail({ path: '/brand', expanded: true, unread: 3, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-team-expanded-unread3.html',
    );
    await expect(renderRail({ path: '/brand', expanded: false, unread: 0, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-team-collapsed-unread0.html',
    );
    await expect(renderRail({ path: '/brand', expanded: false, unread: 3, rooms: true })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-team-collapsed-unread3.html',
    );

    await expect(renderRail({ path: '/brand/studio', expanded: true, unread: 0, rooms: false })).toMatchFileSnapshot(
      './__snapshots__/home-rail-rail-no-rooms.html',
    );
  });

  it('matches the navigation snapshots for sandboxed, guest, and staff scopes', async () => {
    const renderNav = (path: string, choice: BrandWorkspaceChoice) => {
      state.path = path;
      return renderToStaticMarkup(
        <WorkspaceNavigation
          {...navLabels}
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

    const sandboxId = [...SANDBOXED_CLIENT_ORG_IDS][0]!;
    await expect(
      renderNav('/brand', { id: sandboxId, name: 'Morphic Korea', role: 'owner', logoUrl: null }),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-rail-sandboxed.html');

    await expect(
      renderNav('/brand/library', { id: ORG, name: NAME, role: 'guest', logoUrl: null }),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-rail-guest.html');

    await expect(
      renderNav('/brand', { id: ORG, name: NAME, role: 'studio', logoUrl: null }),
    ).toMatchFileSnapshot('./__snapshots__/home-rail-rail-staff.html');
  });
});
