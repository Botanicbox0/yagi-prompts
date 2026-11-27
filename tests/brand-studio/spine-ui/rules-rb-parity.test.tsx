import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { BrandAssetHub } from '@/components/brand-studio/asset-hub';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import type { SpineHomeProps } from '@/components/brand-workspace/home/project-cards/model';
import type {
  StudioBrandProjectCard,
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectOverview,
} from '@/lib/brand-studio/contracts';
import { homeLayout, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ORG, asset, id, job, output, studioState } from '../ui/fixtures';

/**
 * Spine rules R-B Batch B parity snapshots — recorded before any screen/dictionary edits.
 * NEVER regenerate these snapshots: any later diff means an existing <= 100 org or active/finished view broke parity.
 */

const NOW = new Date('2026-11-26T12:00:00.000Z');
const NAME = 'Fern & Field';
const P_SELF = id(0x91);
const P_TEAM = id(0x92);
const P_DONE_SELF = id(0x93);

const emptyCounts = (over: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...over,
});

function stubLibrary(patch: Partial<StudioLibrary> = {}): StudioLibrary {
  return {
    ready: true,
    folders: [],
    liked: new Set(),
    likedItems: [],
    folderItems: () => null,
    openFolder: () => {},
    toggleLike: async () => true,
    createFolder: async () => null,
    renameFolder: async () => true,
    deleteFolder: async () => true,
    addToFolder: async () => true,
    removeFromFolder: async () => true,
    ...patch,
  };
}

const layoutOf = (role: 'owner' | 'viewer' = 'owner'): HomeLayout =>
  homeLayout({ choice: { id: ORG, name: NAME, role }, flagOn: true, canRequest: role === 'owner', rooms: true })!;

const spineHomeCopyOf = (locale: 'ko' | 'en'): Extract<WorkspaceHomeProps, { spineHome: SpineHomeProps }>['copy'] => {
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
    projectHome: d.projectHome,
    projectSpine: d.projectSpine,
    libraryHub: d.studioLibrary.hub,
    roomsOverview: d.roomsShell.overview,
  };
};

const WALL: HomeResult[] = [
  {
    outputId: id(0x21),
    kind: 'image',
    src: '/m/wall-1.webp',
    clip: null,
    play: null,
    width: 800,
    height: 1000,
    seconds: null,
    href: `/brand/studio?organizationId=${ORG}&view=o%3A${id(0x21)}`,
  },
];

const REVIEWS: RoomAlertItem[] = [
  {
    id: 'alert-1',
    kind: 'review',
    projectId: P_TEAM,
    projectTitle: 'Winter campaign film',
    targetId: id(0x31),
    title: 'Cut 1',
    version: 1,
    openNotes: 0,
    updatedAt: '2026-11-26T00:00:00.000Z',
  },
];

const CARDS_ACTIVE: StudioBrandProjectCard[] = [
  {
    project: { id: P_SELF, title: 'Summer lookbook', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' },
    counts: emptyCounts({ image: 3, video: 1 }),
    covers: [
      {
        source: 'result',
        id: 'cov-1',
        kind: 'image',
        url: '/m/1.png',
        thumbUrl: '/m/1-thumb.webp',
        width: 720,
        height: 1280,
      },
    ],
    lastActivity: { at: '2026-11-26T10:00:00.000Z', kind: 'image', item: { type: 'job', id: id(0x41) }, actorName: null },
    unread: 0,
    stage: null,
    status: 'open',
    selectable: true,
  },
  {
    project: { id: P_TEAM, title: 'Winter campaign film', origin: 'team', lastActivityAt: '2026-11-26T09:00:00.000Z' },
    counts: emptyCounts(),
    covers: [],
    lastActivity: null,
    unread: 1,
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
    status: 'open',
    selectable: true,
  },
];

const OVERVIEW_ALL: StudioBrandProjectOverview = {
  ok: true,
  projects: [
    {
      project: { id: P_SELF, title: 'Summer lookbook', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' },
      counts: emptyCounts({ image: 2, upload: 1 }),
      covers: [
        {
          outputId: output(1).id,
          jobId: job(1).id,
          kind: 'image',
          url: output(1).url,
          thumbUrl: output(1).thumbUrl,
          width: 720,
          height: 1280,
          createdAt: '2026-11-26T10:00:00.000Z',
        },
      ],
      status: 'open',
      selectable: true,
    },
    {
      project: { id: P_TEAM, title: 'Winter campaign film', origin: 'team', lastActivityAt: '2026-11-26T09:00:00.000Z' },
      counts: emptyCounts(),
      covers: [],
      status: 'open',
      selectable: true,
    },
    {
      project: { id: P_DONE_SELF, title: 'Spring archive', origin: 'self', lastActivityAt: '2026-11-24T09:00:00.000Z' },
      counts: emptyCounts({ image: 1 }),
      covers: [],
      status: 'archived',
      selectable: false,
    },
  ],
  unfiled: {
    counts: emptyCounts({ image: 1 }),
    covers: [
      {
        outputId: output(2).id,
        jobId: job(2).id,
        kind: 'image',
        url: output(2).url,
        thumbUrl: output(2).thumbUrl,
        width: 720,
        height: 1280,
        createdAt: '2026-11-26T08:00:00.000Z',
      },
    ],
  },
  brandMaterials: {
    count: 1,
    byRole: { product: 1, person: 0, logo: 0, style: 0, place: 0 },
    covers: [asset(1, { name: 'Perfume flacon', role: 'product', brandProjectId: null })],
  },
  finished: { counts: emptyCounts({ image: 1 }) },
  totals: { active: 2, all: 3 },
};

const ACTIVE_SCOPE_PAGE: StudioBrandProjectFiles = {
  ok: true,
  items: [
    { type: 'job', id: job(1).id },
    { type: 'asset', id: asset(2).id },
  ],
  jobs: [job(1, { prompt: 'Morning light still', outputs: [output(1)], brandProjectId: P_SELF })],
  assets: [asset(2, { name: 'Studio shot', brandProjectId: P_SELF })],
  films: [],
  next: null,
};

const FINISHED_SCOPE_PAGE: StudioBrandProjectFiles = {
  ok: true,
  items: [{ type: 'job', id: job(3).id }],
  jobs: [job(3, { prompt: 'Archived still', outputs: [output(3)], brandProjectId: P_DONE_SELF })],
  assets: [],
  films: [],
  next: null,
};

describe('Spine rules R-B Batch B parity snapshots (before screen edits)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('snapshots the home project cards with <= 100 projects (no archiveLink)', async () => {
    const html = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={{ capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' }}
        reviews={REVIEWS}
        results={WALL}
        activeProjects={2}
        readOnly={false}
        viewerNote={false}
        checklist={null}
        canOpenBilling={true}
        spineHome={{
          canCreate: true,
          roomsOpen: true,
          filter: 'active',
          cards: {
            ok: true,
            projects: CARDS_ACTIVE,
            unfiled: { counts: emptyCounts(), covers: [] },
            totals: { active: 2, all: 3 },
          },
        }}
        copy={spineHomeCopyOf('ko')}
      />,
    );
    await expect(html).toMatchFileSnapshot('./__snapshots__/rules-rb-home-with-filter.html');
  });

  it('snapshots the assets by-project view with <= 100 projects (no archiveLink)', async () => {
    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({
          canCreate: true,
          assets: [asset(1, { name: 'Perfume flacon', role: 'product', brandProjectId: null })],
          jobs: [job(1, { prompt: 'Morning light still', outputs: [output(1)], brandProjectId: P_SELF })],
        })}
        spine={{
          overview: OVERVIEW_ALL,
          filter: 'all',
          canMove: true,
          copy: dict.projectSpine,
          filmMeta: dict.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot('./__snapshots__/rules-rb-assets-by-project-all.html');
  });

  it('snapshots the assets ScopeView (active project and finished project)', async () => {
    const dict = getDictionary('ko');
    const activeHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({
          canCreate: true,
          assets: [asset(2, { name: 'Studio shot', brandProjectId: P_SELF })],
          jobs: [job(1, { prompt: 'Morning light still', outputs: [output(1)], brandProjectId: P_SELF })],
        })}
        spine={{
          overview: OVERVIEW_ALL,
          filter: 'all',
          canMove: true,
          copy: dict.projectSpine,
          filmMeta: dict.studioVideo.workspace.projects.meta,
        }}
        initialSpine={{
          tab: 'by_project',
          openedScope: { kind: 'project', brandProjectId: P_SELF },
          page: ACTIVE_SCOPE_PAGE,
        }}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(activeHtml).toMatchFileSnapshot('./__snapshots__/rules-rb-assets-scope-active.html');

    const finishedHtml = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({
          canCreate: true,
          assets: [],
          jobs: [job(3, { prompt: 'Archived still', outputs: [output(3)], brandProjectId: P_DONE_SELF })],
        })}
        spine={{
          overview: OVERVIEW_ALL,
          filter: 'all',
          canMove: true,
          copy: dict.projectSpine,
          filmMeta: dict.studioVideo.workspace.projects.meta,
        }}
        initialSpine={{
          tab: 'by_project',
          openedScope: { kind: 'project', brandProjectId: P_DONE_SELF },
          page: FINISHED_SCOPE_PAGE,
        }}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(finishedHtml).toMatchFileSnapshot('./__snapshots__/rules-rb-assets-scope-finished.html');
  });
});
