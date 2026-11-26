import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import type { SpineHomeProps } from '@/components/brand-workspace/home/project-cards';
import type {
  StudioBrandProjectCard,
  StudioBrandProjectCardCover,
  StudioBrandProjectCounts,
  StudioBrandProjectCover,
} from '@/lib/brand-studio/contracts';
import type { FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeLayout, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';

/**
 * Slice 3b §2 Step 0 parity snapshots — generated on the untouched branch BEFORE any other edit.
 * NEVER regenerate these snapshots: any failure proves a change broke parity when no news prop is passed.
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

type Locale = 'ko' | 'en';
type Role = 'owner' | 'editor' | 'viewer' | 'studio';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const NAME = 'Fern & Field';
const NOW = new Date('2026-11-26T12:00:00.000Z');
const ALLOWANCE = { capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' };

const P_SELF = '10000000-0000-4000-8000-000000000001';
const P_TEAM = '10000000-0000-4000-8000-000000000002';
const P_VID = '10000000-0000-4000-8000-000000000003';
const P_EMPTY = '10000000-0000-4000-8000-000000000004';

const legacyCopyOf = (locale: Locale): WorkspaceHomeProps['copy'] => {
  const d = getDictionary(locale);
  return {
    home: d.brandHome,
    shell: d.studioShell,
    roomsNav: d.roomsShell.nav,
    inbox: d.roomsChat.inbox,
    prompt: {
      label: d.brandStudio.dock.label,
      placeholder: { image: d.brandStudio.dock.placeholder, video: d.brandStudio.dock.placeholderVideo },
    },
    activeStatus: d.brandWorkspace.status.active,
    allAssets: d.studioLibrary.allAssets,
    closedRequestDraft: d.brandStudio.dock.closedRequestDraft,
    closedRequestOrgFallback: d.brandStudio.dock.closedRequestOrgFallback,
    billingCustomer: d.brandBilling.customer,
  };
};

const spineCopyOf = (locale: Locale): Extract<WorkspaceHomeProps, { spineHome: SpineHomeProps }>['copy'] => {
  const d = getDictionary(locale);
  return {
    ...legacyCopyOf(locale),
    projectHome: d.projectHome,
    projectSpine: d.projectSpine,
    libraryHub: d.studioLibrary.hub,
    roomsOverview: d.roomsShell.overview,
  };
};

const layoutOf = (role: Role, options: { rooms?: boolean; assets?: boolean } = {}): HomeLayout => {
  const layout = homeLayout({
    choice: { id: ORG, name: NAME, role },
    flagOn: true,
    canRequest: role === 'owner' || role === 'editor',
    rooms: options.rooms ?? true,
  })!;
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

const emptyCounts = (over: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...over,
});

const cover = (n: number, over: Partial<StudioBrandProjectCardCover> = {}): StudioBrandProjectCardCover => ({
  source: 'result',
  id: `cov-${n}`,
  kind: 'image',
  url: `/m/${n}.png`,
  thumbUrl: `/m/${n}-thumb.webp`,
  width: 720,
  height: 1280,
  ...over,
});

const unfiledCover = (n: number, over: Partial<StudioBrandProjectCover> = {}): StudioBrandProjectCover => ({
  outputId: `u-out-${n}`,
  jobId: `u-job-${n}`,
  kind: 'image',
  url: `/m/u-${n}.png`,
  thumbUrl: `/m/u-${n}-thumb.webp`,
  width: 720,
  height: 1280,
  createdAt: '2026-11-26T09:00:00.000Z',
  ...over,
});

const SAMPLE_CARDS: StudioBrandProjectCard[] = [
  {
    project: { id: P_SELF, title: '봄 향수 론칭', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' },
    counts: emptyCounts({ image: 24, video: 6, sound: 2 }),
    covers: [cover(1), cover(2), cover(3)],
    lastActivity: { at: '2026-11-26T10:00:00.000Z', kind: 'video', item: { type: 'job', id: 'j1' }, actorName: '김서아' },
    unread: 0,
    stage: null,
  },
  {
    project: { id: P_TEAM, title: '겨울 립 컬렉션 필름', origin: 'team', lastActivityAt: '2026-11-26T09:00:00.000Z' },
    counts: emptyCounts(),
    covers: [cover(4, { source: 'team_cover', url: '/api/brand-workspace/attachments/att-4', thumbUrl: null }), cover(5)],
    lastActivity: null,
    unread: 2,
    stage: {
      stage: 'storyboard',
      steps: [
        { stage: 'requested', state: 'done', at: '2026-11-20T00:00:00.000Z' },
        { stage: 'storyboard', state: 'current', at: '2026-11-25T00:00:00.000Z' },
        { stage: 'draft', state: 'ahead', at: null },
        { stage: 'revision', state: 'ahead', at: null },
        { stage: 'done', state: 'ahead', at: null },
      ],
    },
  },
  {
    project: { id: P_VID, title: '영상만 있는 프로젝트', origin: 'self', lastActivityAt: '2026-11-26T08:00:00.000Z' },
    counts: emptyCounts({ video: 1 }),
    covers: [cover(6, { kind: 'video', url: '/m/clip-6.mp4', thumbUrl: null })],
    lastActivity: { at: '2026-11-26T08:00:00.000Z', kind: 'film', item: { type: 'film', id: 'f6' }, actorName: null },
    unread: 0,
    stage: null,
  },
  {
    project: { id: P_EMPTY, title: '빈 프로젝트', origin: 'self', lastActivityAt: '2026-11-26T07:00:00.000Z' },
    counts: emptyCounts(),
    covers: [],
    lastActivity: null,
    unread: 0,
    stage: null,
  },
];

function renderLegacyHome(v: {
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
      copy={legacyCopyOf(locale)}
    />,
  );
}

function renderSpineHome(v: {
  locale?: Locale;
  role?: Role;
  spineHome: SpineHomeProps;
  results?: HomeResult[];
  checklist?: FirstRunChecklistState | null;
}): string {
  const locale = v.locale ?? 'ko';
  const role = v.role ?? 'owner';
  return renderToStaticMarkup(
    <WorkspaceHome
      organizationId={ORG}
      organizationName={NAME}
      locale={locale}
      layout={layoutOf(role)}
      allowance={ALLOWANCE}
      reviews={[]}
      results={v.results ?? []}
      activeProjects={1}
      readOnly={role === 'viewer' || role === 'studio'}
      viewerNote={role === 'viewer'}
      checklist={v.checklist ?? null}
      canOpenBilling={role === 'owner'}
      spineHome={v.spineHome}
      copy={spineCopyOf(locale)}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.path = '/brand/home';
  state.query = '';
  state.unread = 0;
});

afterEach(() => {
  vi.useRealTimers();
  state.path = '/brand/home';
  state.query = '';
  state.unread = 0;
});

describe('Slice 3b §2 parity snapshots (without news prop)', () => {
  it('matches legacy home snapshots (wall, empty, en, viewer, staff)', async () => {
    await expect(
      renderLegacyHome({
        role: 'owner',
        reviews: [alert(1), alert(2, { kind: 'storyboard', title: '' }), alert(3)],
        results: WALL,
        activeProjects: 2,
        checklist: CHECKLIST,
      }),
    ).toMatchFileSnapshot('./__snapshots__/home-legacy-wall.html');

    await expect(
      renderLegacyHome({ role: 'owner', reviews: [], results: [], activeProjects: 0, checklist: null }),
    ).toMatchFileSnapshot('./__snapshots__/home-legacy-empty.html');

    await expect(
      renderLegacyHome({ locale: 'en', role: 'owner', reviews: [alert(1)], results: WALL, activeProjects: 1 }),
    ).toMatchFileSnapshot('./__snapshots__/home-legacy-en.html');

    await expect(renderLegacyHome({ role: 'viewer', results: WALL })).toMatchFileSnapshot(
      './__snapshots__/home-viewer-legacy.html',
    );

    await expect(
      renderLegacyHome({ role: 'studio', results: WALL, notice: <p data-staff-notice-fixture>TWINGS team view</p> }),
    ).toMatchFileSnapshot('./__snapshots__/home-staff-legacy.html');
  });

  it('matches project-cards home snapshots (cards, no-project wall, no-project empty, viewer)', async () => {
    const cardsWithUnfiled: SpineHomeProps = {
      canCreate: true,
      roomsOpen: true,
      cards: {
        ok: true,
        projects: SAMPLE_CARDS,
        unfiled: {
          counts: emptyCounts({ image: 10, video: 2, sound: 1, upload: 1 }),
          covers: [
            unfiledCover(1),
            unfiledCover(2, { kind: 'video', url: '/m/u-2.mp4', thumbUrl: null }),
            unfiledCover(3),
          ],
        },
      },
    };

    await expect(
      renderSpineHome({ role: 'owner', spineHome: cardsWithUnfiled, results: WALL, checklist: CHECKLIST }),
    ).toMatchFileSnapshot('./__snapshots__/home-project-cards.html');

    const emptyProjects: SpineHomeProps = {
      canCreate: true,
      roomsOpen: true,
      cards: { ok: true, projects: [], unfiled: { counts: emptyCounts(), covers: [] } },
    };

    await expect(
      renderSpineHome({ role: 'owner', spineHome: emptyProjects, results: WALL, checklist: CHECKLIST }),
    ).toMatchFileSnapshot('./__snapshots__/home-no-project-wall.html');

    await expect(
      renderSpineHome({ role: 'owner', spineHome: emptyProjects, results: [], checklist: null }),
    ).toMatchFileSnapshot('./__snapshots__/home-no-project-empty.html');

    await expect(
      renderSpineHome({
        role: 'viewer',
        spineHome: { ...cardsWithUnfiled, canCreate: false },
        results: WALL,
        checklist: null,
      }),
    ).toMatchFileSnapshot('./__snapshots__/home-viewer-project-cards.html');
  });
});
