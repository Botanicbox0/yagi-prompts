import type { ReactNode } from 'react';
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
  StudioBrandProjectOverview,
} from '@/lib/brand-studio/contracts';
import { homeLayout, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ORG, asset, id, job, output, studioState } from '../ui/fixtures';

/**
 * Spine rules R-A §1 parity snapshots — recorded on the untouched branch before any edit.
 * NEVER regenerate these snapshots: any later diff means parity broke without R-A inputs.
 */

const NOW = new Date('2026-11-26T12:00:00.000Z');
const NAME = 'Fern & Field';
const P_SELF = id(0x91);
const P_TEAM = id(0x92);

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

const homeCopyOf = (locale: 'ko' | 'en'): WorkspaceHomeProps['copy'] => {
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

const spineHomeCopyOf = (locale: 'ko' | 'en'): Extract<WorkspaceHomeProps, { spineHome: SpineHomeProps }>['copy'] => {
  const d = getDictionary(locale);
  return {
    ...homeCopyOf(locale),
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

const TODAY_CARDS: StudioBrandProjectCard[] = [
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
  },
];

const TODAY_OVERVIEW: StudioBrandProjectOverview = {
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
    },
    {
      project: { id: P_TEAM, title: 'Winter campaign film', origin: 'team', lastActivityAt: '2026-11-26T09:00:00.000Z' },
      counts: emptyCounts(),
      covers: [],
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
};

function renderHomeWithoutSpine(notice?: ReactNode): string {
  return renderToStaticMarkup(
    <WorkspaceHome
      organizationId={ORG}
      organizationName={NAME}
      locale="ko"
      layout={layoutOf('owner')}
      allowance={{ capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' }}
      reviews={REVIEWS}
      results={WALL}
      activeProjects={1}
      readOnly={false}
      viewerNote={false}
      notice={notice}
      checklist={null}
      canOpenBilling={true}
      copy={homeCopyOf('ko')}
    />,
  );
}

describe('Spine rules R-A §1 parity snapshots (untouched branch)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('snapshots the home without spine props', async () => {
    const html = renderHomeWithoutSpine();
    await expect(html).toMatchFileSnapshot('./__snapshots__/rules-ra-home-without-spine.html');
  });

  it('snapshots the assets page without spine props', async () => {
    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={dict.brandStudio}
        libraryCopy={dict.studioLibrary}
        initialState={studioState({
          assets: [
            asset(1, { name: 'Perfume flacon', role: 'product' }),
            asset(2, { kind: 'video', name: 'Runway ref', seconds: 8, url: 'https://media.example/st/ref.mp4' }),
          ],
          jobs: [job(1, { prompt: 'Morning light still', outputs: [output(1)] })],
        })}
        projectLinks={{
          self: [{ id: P_SELF, title: 'Summer lookbook', updatedAt: '2026-11-26T00:00:00Z', assetIds: [asset(2).id], outputIds: [output(1).id] }],
          team: [],
        }}
        deliverableCount={0}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot('./__snapshots__/rules-ra-assets-without-spine.html');
  });

  it('snapshots the home project cards with spine props using today data shapes', async () => {
    const html = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={{ capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' }}
        reviews={REVIEWS}
        results={WALL}
        activeProjects={1}
        readOnly={false}
        viewerNote={false}
        checklist={null}
        canOpenBilling={true}
        spineHome={{
          canCreate: true,
          roomsOpen: true,
          cards: {
            ok: true,
            projects: TODAY_CARDS,
            unfiled: {
              counts: emptyCounts({ image: 2 }),
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
          },
        }}
        copy={spineHomeCopyOf('ko')}
      />,
    );
    await expect(html).toMatchFileSnapshot('./__snapshots__/rules-ra-home-with-spine-today.html');

    const emptyHtml = renderToStaticMarkup(
      <WorkspaceHome
        organizationId={ORG}
        organizationName={NAME}
        locale="ko"
        layout={layoutOf('owner')}
        allowance={{ capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' }}
        reviews={[]}
        results={WALL}
        activeProjects={0}
        readOnly={false}
        viewerNote={false}
        checklist={null}
        canOpenBilling={true}
        spineHome={{
          canCreate: true,
          roomsOpen: true,
          cards: {
            ok: true,
            projects: [],
            unfiled: { counts: emptyCounts(), covers: [] },
          },
        }}
        copy={spineHomeCopyOf('ko')}
      />,
    );
    await expect(emptyHtml).toMatchFileSnapshot('./__snapshots__/rules-ra-home-empty-with-spine-today.html');
  });

  it('snapshots the assets by-project view with spine props using today data shapes', async () => {
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
          overview: TODAY_OVERVIEW,
          canMove: true,
          copy: dict.projectSpine,
          filmMeta: dict.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
      />,
    );
    await expect(html).toMatchFileSnapshot('./__snapshots__/rules-ra-assets-with-spine-today.html');
  });
});
