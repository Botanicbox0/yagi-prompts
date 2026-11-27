import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendTransport } from '@/components/brand-rooms/chat/transport';
import { pickSendCopy, type ViewerSendProp } from '@/components/brand-send/model';
import { createStudioApi, type StudioApi } from '@/components/brand-studio/api';
import { BrandAssetHub, buildHubEntries, hubActions } from '@/components/brand-studio/asset-hub';
import { ByProjectView } from '@/components/brand-studio/asset-hub-spine/by-project-view';
import { finishedScopeControls, selectableMoveProjects } from '@/components/brand-studio/asset-hub-spine/model';
import { SpineResultDelete } from '@/components/brand-studio/asset-hub-spine/result-delete';
import { applyScopeControlsToActions } from '@/components/brand-studio/asset-hub-spine/scope-actions';
import { ScopeView } from '@/components/brand-studio/asset-hub-spine/scope-view';
import { HubDetail, HubTile } from '@/components/brand-studio/asset-hub-tile';
import { MoveToProjectDialog } from '@/components/brand-studio/project-chip';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import type { SpineHomeProps } from '@/components/brand-workspace/home/project-cards/model';
import type {
  StudioBrandProjectCard,
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectOverview,
  StudioState,
} from '@/lib/brand-studio/contracts';
import type { VideoProjectSummary } from '@/lib/brand-studio/video-projects/contracts';
import { homeLayout } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { ORG, asset, id, job, output, studioState } from '../ui/fixtures';

vi.mock('@/components/brand-studio/rail/use-library', () => ({
  useStudioLibrary: () => stubLibrary(),
}));

const NOW = new Date('2026-11-26T12:00:00.000Z');
const P_OPEN_SELF = id(0x81);
const P_DONE_SELF = id(0x82);
const P_DONE_TEAM = id(0x83);
const FILM_1 = id(0x84);
const P_OPEN_2 = id(0x85);

const emptyCounts = (patch: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...patch,
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

const homeCopyOf = (locale: 'ko' | 'en'): Extract<WorkspaceHomeProps, { spineHome: SpineHomeProps }>['copy'] => {
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

const sampleFilm = (projectId: string | null): VideoProjectSummary => ({
  id: FILM_1,
  organizationId: ORG,
  title: 'Archived edit',
  status: 'active',
  aspect: '9:16',
  revision: 1,
  durationSec: 12,
  clipCount: 2,
  updatedAt: '2026-11-26T00:00:00Z',
  completedAt: null,
  createdAt: '2026-11-26T00:00:00Z',
  thumbUrl: '/m/film-thumb.webp',
  brandProjectId: projectId,
});

const CARD_OPEN_SELF: StudioBrandProjectCard = {
  project: { id: P_OPEN_SELF, title: 'Active studio', origin: 'self', lastActivityAt: '2026-11-26T10:00:00Z' },
  counts: emptyCounts({ image: 2 }),
  covers: [],
  lastActivity: null,
  unread: 0,
  stage: null,
  status: 'open',
  selectable: true,
};

const CARD_DONE_TEAM: StudioBrandProjectCard = {
  project: { id: P_DONE_TEAM, title: 'Done team campaign', origin: 'team', lastActivityAt: '2026-11-26T09:00:00Z' },
  counts: emptyCounts(),
  covers: [],
  lastActivity: null,
  unread: 1,
  stage: { stage: 'done', steps: [] },
  status: 'completed',
  selectable: false,
};

const CARD_DONE_SELF: StudioBrandProjectCard = {
  project: { id: P_DONE_SELF, title: 'Done self archive', origin: 'self', lastActivityAt: '2026-11-26T08:00:00Z' },
  counts: emptyCounts({ image: 1 }),
  covers: [],
  lastActivity: null,
  unread: 0,
  stage: null,
  status: 'archived',
  selectable: false,
};

const ALL_OVERVIEW: StudioBrandProjectOverview = {
  ok: true,
  projects: [
    {
      project: { id: P_DONE_SELF, title: 'Done self archive', origin: 'self', lastActivityAt: '2026-11-26T11:00:00Z' },
      counts: emptyCounts({ image: 1, film: 1 }),
      covers: [],
      status: 'archived',
      selectable: false,
    },
    {
      project: { id: P_OPEN_SELF, title: 'Active studio', origin: 'self', lastActivityAt: '2026-11-26T10:00:00Z' },
      counts: emptyCounts({ image: 2 }),
      covers: [],
      status: 'open',
      selectable: true,
    },
    {
      project: { id: P_DONE_TEAM, title: 'Done team campaign', origin: 'team', lastActivityAt: '2026-11-26T09:00:00Z' },
      counts: emptyCounts({ video: 1 }),
      covers: [],
      status: 'completed',
      selectable: false,
    },
  ],
  unfiled: { counts: emptyCounts(), covers: [] },
  brandMaterials: {
    count: 0,
    byRole: { product: 0, person: 0, logo: 0, style: 0, place: 0 },
    covers: [],
  },
  finished: { counts: emptyCounts({ image: 1, video: 1, film: 1 }) },
  totals: { active: 1, all: 3 },
};

let mounted: MountedDom | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
});

async function mountHubDom(node: Parameters<typeof mountDom>[0]): Promise<MountedDom> {
  const dom = await mountDom(null);
  const g = globalThis as unknown as {
    Element?: { prototype: Record<string, unknown> };
    HTMLSelectElement?: { prototype: { childNodes: Array<{ tagName?: string }> } };
  };
  if (g.Element?.prototype && !g.Element.prototype.getAttributeNames) {
    g.Element.prototype.getAttributeNames = function getAttributeNames(this: { attributes?: Record<string, string> }) {
      return Object.keys(this.attributes ?? {});
    };
  }
  const SelectProto = g.HTMLSelectElement?.prototype;
  if (SelectProto && !Object.getOwnPropertyDescriptor(SelectProto, 'options')) {
    Object.defineProperty(SelectProto, 'options', {
      get() {
        return (this as { childNodes: Array<{ tagName?: string }> }).childNodes.filter(
          (c) => c.tagName === 'OPTION',
        );
      },
      configurable: true,
    });
  }
  await dom.rerender(node);
  return dom;
}

async function flush(rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe('Spine rules R-A markup tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it.each(['ko', 'en'] as const)(
    'renders Home on active and all states with links, counts, marks, and hrefs (%s)',
    (locale) => {
      const copy = homeCopyOf(locale);
      const layout = homeLayout({ choice: { id: ORG, name: 'Fern', role: 'owner' }, flagOn: true, canRequest: true, rooms: true })!;

      const activeHtml = renderToStaticMarkup(
        <WorkspaceHome
          organizationId={ORG}
          organizationName="Fern"
          locale={locale}
          layout={layout}
          allowance={{ capKrw: 100_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          reviews={[]}
          results={[]}
          activeProjects={1}
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
              projects: [CARD_OPEN_SELF],
              unfiled: { counts: emptyCounts(), covers: [] },
              totals: { active: 1, all: 3 },
            },
          }}
          copy={copy}
        />,
      );
      expect(activeHtml).toContain('data-home-projects-switch');
      expect(activeHtml).toContain(`${copy.projectHome.viewActive}</span>`);
      expect(activeHtml).toContain(`${copy.projectHome.viewAll}</span>`);
      expect(activeHtml).toContain(`href="/brand/home?organizationId=${ORG}"`);
      expect(activeHtml).toContain(`href="/brand/home?organizationId=${ORG}&amp;projects=all"`);
      expect(activeHtml).not.toContain('data-home-project-status');

      const allHtml = renderToStaticMarkup(
        <WorkspaceHome
          organizationId={ORG}
          organizationName="Fern"
          locale={locale}
          layout={layout}
          allowance={{ capKrw: 100_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          reviews={[]}
          results={[]}
          activeProjects={1}
          readOnly={false}
          viewerNote={false}
          checklist={null}
          canOpenBilling={true}
          spineHome={{
            canCreate: true,
            roomsOpen: true,
            filter: 'all',
            cards: {
              ok: true,
              projects: [CARD_OPEN_SELF, CARD_DONE_TEAM, CARD_DONE_SELF],
              unfiled: { counts: emptyCounts(), covers: [] },
              totals: { active: 1, all: 3 },
            },
          }}
          copy={copy}
        />,
      );
      expect(allHtml).toContain(copy.projectHome.finishedMark);
      expect(allHtml).toContain(`href="/brand/rooms/${P_DONE_TEAM}?organizationId=${ORG}"`);
      expect(allHtml).toContain(`href="/brand/library?organizationId=${ORG}&amp;project=${P_DONE_SELF}"`);
      expect(allHtml).toContain(`href="/brand/studio?organizationId=${ORG}&amp;project=${P_OPEN_SELF}"`);

      // Switch hidden when active === all
      const noFinishedHtml = renderToStaticMarkup(
        <WorkspaceHome
          organizationId={ORG}
          organizationName="Fern"
          locale={locale}
          layout={layout}
          allowance={{ capKrw: 100_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          reviews={[]}
          results={[]}
          activeProjects={1}
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
              projects: [CARD_OPEN_SELF],
              unfiled: { counts: emptyCounts(), covers: [] },
              totals: { active: 1, all: 1 },
            },
          }}
          copy={copy}
        />,
      );
      expect(noFinishedHtml).not.toContain('data-home-projects-switch');

      // 0 active + >0 finished still renders switch
      const zeroActiveHtml = renderToStaticMarkup(
        <WorkspaceHome
          organizationId={ORG}
          organizationName="Fern"
          locale={locale}
          layout={layout}
          allowance={{ capKrw: 100_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          reviews={[]}
          results={[]}
          activeProjects={0}
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
              projects: [],
              unfiled: { counts: emptyCounts(), covers: [] },
              totals: { active: 0, all: 2 },
            },
          }}
          copy={copy}
        />,
      );
      expect(zeroActiveHtml).toContain('data-home-projects-switch');
      expect(zeroActiveHtml).toContain('data-home-no-projects');
    },
  );

  it('renders Assets by-project on active (switch + finishedFiles) and all (finished groups after active with mark)', () => {
    const d = getDictionary('ko');
    const activeOverview: StudioBrandProjectOverview = {
      ...ALL_OVERVIEW,
      projects: ALL_OVERVIEW.projects.filter((g) => g.selectable !== false),
    };

    const activeHub = renderToStaticMarkup(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={studioState({ canCreate: true })}
        spine={{
          overview: activeOverview,
          filter: 'active',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
      />,
    );
    expect(activeHub).toContain('data-asset-hub-projects-switch');
    expect(activeHub).toContain('data-asset-hub-finished-files="3"');
    expect(activeHub).toContain('끝난 프로젝트에 파일이 3개 있어요');
    expect(activeHub).toContain(`href="/brand/library?organizationId=${ORG}&amp;projects=all"`);

    const allHtml = renderToStaticMarkup(
      <ByProjectView
        organizationId={ORG}
        filter="all"
        overview={ALL_OVERVIEW}
        libraryCopy={d.studioLibrary}
        projectSpineCopy={d.projectSpine}
        state={studioState({ canCreate: true })}
        deliverables={[]}
        canMove={true}
        query=""
        onOpenMaterials={() => {}}
        onOpenProject={() => {}}
        onOpenUnfiled={() => {}}
        onMoveUnfiled={() => {}}
      />,
    );
    const activeIdx = allHtml.indexOf(`data-asset-hub-group="${P_OPEN_SELF}"`);
    const doneSelfIdx = allHtml.indexOf(`data-asset-hub-group="${P_DONE_SELF}"`);
    const doneTeamIdx = allHtml.indexOf(`data-asset-hub-group="${P_DONE_TEAM}"`);
    expect(activeIdx).toBeGreaterThan(-1);
    expect(doneSelfIdx).toBeGreaterThan(activeIdx);
    expect(doneTeamIdx).toBeGreaterThan(activeIdx);
    expect(allHtml).toContain(d.studioLibrary.hub.spine.finishedMark);
    expect(allHtml).not.toContain('data-asset-hub-finished-files');
  });

  it('shows finishedHint, finishedMark, keeps move-out open, and hides film edit link on a finished project ScopeView', () => {
    const d = getDictionary('ko');
    const out = output(1, { kind: 'image' });
    const run = job(1, { outputs: [out], brandProjectId: P_DONE_SELF });
    const film = sampleFilm(P_DONE_SELF);

    const html = renderToStaticMarkup(
      <ScopeView
        organizationId={ORG}
        scope={{ kind: 'project', brandProjectId: P_DONE_SELF }}
        overview={{
          ...ALL_OVERVIEW,
          projects: ALL_OVERVIEW.projects.filter((g) => g.selectable !== false),
        }}
        fallbackProjectGroup={ALL_OVERVIEW.projects[0]}
        libraryCopy={d.studioLibrary}
        projectSpineCopy={d.projectSpine}
        studioCopy={d.brandStudio}
        filmMeta={d.studioVideo.workspace.projects.meta}
        canOpenStudio={true}
        canMove={true}
        api={createStudioApi({ organizationId: ORG })}
        query=""
        onQueryChange={() => {}}
        likedKeys={new Set()}
        onScopeGone={() => {}}
        renderTile={(entry) => (
          <HubTile
            key={entry.key}
            entry={entry}
            copy={d.studioLibrary}
            editedMark={d.brandStudio.gallery.editedMark}
            name="img"
            liked={false}
            {...hubActions(entry, {
              organizationId: ORG,
              canOpenStudio: true,
              canCreate: true,
              copy: {
                useImage: d.studioLibrary.hub.openInImage,
                decorate: d.brandStudio.gallery.menu.decorate,
                makeVideo: d.studioLibrary.hub.openInVideo,
                compose: d.studioLibrary.hub.openInCompose,
                reverse: d.studioLibrary.hub.reverseVideo,
                share: d.studioLibrary.hub.shareReview,
                similar: d.studioLibrary.hub.findSimilar,
                edit: d.studioLibrary.uploads.edit,
              },
              moveProjectLabel: d.projectSpine.move,
            })}
            moreLabel={d.studioLibrary.uploads.more}
            menuOpen={false}
            onMenu={() => {}}
            onOpen={() => {}}
            onLike={() => {}}
            onAction={() => {}}
          />
        )}
        initialPage={{
          ok: true,
          items: [
            { type: 'film', id: film.id },
            { type: 'job', id: run.id },
          ],
          assets: [],
          jobs: [run],
          films: [film],
          next: null,
        }}
      />,
    );
    expect(html).toContain('data-asset-hub-finished-hint');
    expect(html).toContain(d.studioLibrary.hub.spine.finishedHint);
    expect(html).toContain('data-asset-hub-scope-status="archived"');
    expect(html).toContain('data-asset-hub-select');
    expect(html).not.toContain(`film=${FILM_1}`);
  });

  it('hides all studio/edit/share/similar actions per tile kind in finished ScopeView & HubDetail while keeping active scope byte-identical', () => {
    const d = getDictionary('ko');
    const sendProp: ViewerSendProp = { organizationId: ORG, copy: pickSendCopy(d) };
    const outImg = output(21, { kind: 'image' });
    const outVid = output(22, { kind: 'video' });
    const outSnd = output(23, { kind: 'audio' });
    const run = job(21, { kind: 'image', prompt: 'Catalog items', outputs: [outImg, outVid, outSnd] });
    const upImg = asset(24, { kind: 'image', name: 'Shot.png' });
    const upVid = asset(25, { kind: 'video', name: 'Clip.mp4' });
    const upAud = asset(26, { kind: 'audio', name: 'Bed.mp3' });
    const film = sampleFilm(P_DONE_SELF);
    const items = [
      { type: 'job' as const, id: run.id },
      { type: 'asset' as const, id: upImg.id },
      { type: 'asset' as const, id: upVid.id },
      { type: 'asset' as const, id: upAud.id },
      { type: 'film' as const, id: film.id },
    ];
    const pageData = {
      ok: true as const,
      items,
      assets: [upImg, upVid, upAud],
      jobs: [run],
      films: [film],
      next: null,
    };

    const hiddenMarkers = [
      'data-asset-hub-use-image',
      'data-asset-hub-open-canvas',
      'data-asset-hub-use-video',
      'data-asset-hub-open-compose',
      'data-asset-hub-reverse',
      'data-asset-hub-share-review',
      'data-asset-hub-similar',
      'data-asset-hub-edit',
      `film=${FILM_1}`,
    ];

    // 1. Finished project scope via BrandAssetHub across all tile kinds (result, film, upload, sound) + HubDetail
    const renderFinishedScope = (detailKey?: string, menuKey?: string) =>
      renderToStaticMarkup(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={d.brandStudio}
          libraryCopy={d.studioLibrary}
          initialState={studioState({ canCreate: true, assets: [upImg, upVid, upAud], jobs: [run] })}
          spine={{
            overview: ALL_OVERVIEW,
            filter: 'all',
            canMove: true,
            copy: d.projectSpine,
            filmMeta: d.studioVideo.workspace.projects.meta,
          }}
          initialSpine={{
            tab: 'by_project',
            openedScope: { kind: 'project', brandProjectId: P_DONE_SELF },
            page: pageData,
            ...(detailKey ? { detailKey } : {}),
            ...(menuKey ? { menuKey } : {}),
          }}
          injectedLibrary={stubLibrary()}
          send={sendProp}
        />,
      );

    const finishedScopeHtml = renderFinishedScope();
    for (const marker of hiddenMarkers) {
      expect(finishedScopeHtml, `finished scope should hide ${marker}`).not.toContain(marker);
    }
    expect(finishedScopeHtml).toContain(`data-asset-hub-card="o:${outImg.id}"`);
    expect(finishedScopeHtml).toContain(`data-asset-hub-card="o:${outVid.id}"`);
    expect(finishedScopeHtml).toContain(`data-asset-hub-card="o:${outSnd.id}"`);
    expect(finishedScopeHtml).toContain(`data-asset-hub-card="a:${upImg.id}"`);
    expect(finishedScopeHtml).toContain(`data-asset-hub-card="a:${upVid.id}"`);
    expect(finishedScopeHtml).toContain(`data-asset-hub-card="a:${upAud.id}"`);
    expect(finishedScopeHtml).toContain(`data-asset-hub-film="${FILM_1}"`);
    expect(finishedScopeHtml).toContain('data-asset-hub-sound');
    expect(finishedScopeHtml).toContain('data-asset-hub-open');
    expect(finishedScopeHtml).toContain('data-asset-hub-select');

    // Opened HubDetail in finished scope for every result/upload kind keeps open/send/move and hides all making/edit/share/similar actions
    for (const key of [
      `o:${outImg.id}`,
      `o:${outVid.id}`,
      `o:${outSnd.id}`,
      `a:${upImg.id}`,
      `a:${upVid.id}`,
      `a:${upAud.id}`,
    ]) {
      const detailHtml = renderFinishedScope(key);
      expect(detailHtml, `detail ${key} keeps data-asset-hub-detail`).toContain(`data-asset-hub-detail="${key}"`);
      expect(detailHtml, `detail ${key} keeps send`).toContain('data-asset-hub-send');
      expect(detailHtml, `detail ${key} keeps move`).toContain('data-project-move');
      for (const marker of hiddenMarkers) {
        expect(detailHtml, `detail ${key} hides ${marker}`).not.toContain(marker);
      }
    }

    // 2. Active project scope: all action markers present (grid pills + HubDetail sheets) and active ScopeView controls match byte-identically
    const renderActiveScope = (detailKey?: string) =>
      renderToStaticMarkup(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={d.brandStudio}
          libraryCopy={d.studioLibrary}
          initialState={studioState({ canCreate: true, assets: [upImg, upVid, upAud], jobs: [run] })}
          spine={{
            overview: ALL_OVERVIEW,
            filter: 'all',
            canMove: true,
            copy: d.projectSpine,
            filmMeta: d.studioVideo.workspace.projects.meta,
          }}
          initialSpine={{
            tab: 'by_project',
            openedScope: { kind: 'project', brandProjectId: P_OPEN_SELF },
            page: pageData,
            ...(detailKey ? { detailKey } : {}),
          }}
          injectedLibrary={stubLibrary()}
          send={sendProp}
        />,
      );
    const activeHubCombined = [
      renderActiveScope(),
      renderActiveScope(`a:${upImg.id}`),
      renderActiveScope(`a:${upVid.id}`),
    ].join('\n');
    for (const marker of hiddenMarkers) {
      expect(activeHubCombined, `active scope keeps ${marker}`).toContain(marker);
    }

    const h = d.studioLibrary.hub;
    const actionCopy = {
      useImage: h.openInImage,
      decorate: d.brandStudio.gallery.menu.decorate,
      makeVideo: h.openInVideo,
      compose: h.openInCompose,
      reverse: h.reverseVideo,
      share: h.shareReview,
      similar: h.findSimilar,
      edit: d.studioLibrary.uploads.edit,
    };
    const renderActiveTileCompare = (withPolicy: boolean) =>
      renderToStaticMarkup(
        <ScopeView
          organizationId={ORG}
          scope={{ kind: 'project', brandProjectId: P_OPEN_SELF }}
          overview={ALL_OVERVIEW}
          libraryCopy={d.studioLibrary}
          projectSpineCopy={d.projectSpine}
          studioCopy={d.brandStudio}
          filmMeta={d.studioVideo.workspace.projects.meta}
          canOpenStudio={true}
          canMove={true}
          api={createStudioApi({ organizationId: ORG })}
          query=""
          onQueryChange={() => {}}
          likedKeys={new Set()}
          onScopeGone={() => {}}
          renderTile={(entry, _scopeKey, _selectOpts, controls) => {
            const raw = hubActions(entry, {
              organizationId: ORG,
              canOpenStudio: true,
              canCreate: true,
              copy: actionCopy,
              moveProjectLabel: d.projectSpine.move,
            });
            const effective = withPolicy ? applyScopeControlsToActions(raw, controls ?? finishedScopeControls(false)) : raw;
            return (
              <HubTile
                key={entry.key}
                entry={entry}
                copy={d.studioLibrary}
                editedMark={d.brandStudio.gallery.editedMark}
                name={entry.label ?? d.studioLibrary.item[entry.kind]}
                liked={false}
                {...effective}
                moreLabel={d.studioLibrary.uploads.more}
                menuOpen={false}
                onMenu={() => {}}
                onOpen={() => {}}
                onLike={() => {}}
                onAction={() => {}}
              />
            );
          }}
          initialPage={pageData}
        />,
      );
    expect(renderActiveTileCompare(true)).toBe(renderActiveTileCompare(false));
  });

  it('renders SpineResultDelete confirmation with deleteBoth iff savedAssetId is present, and preserves 보내기 on single tile', () => {
    const d = getDictionary('ko');
    const api = createStudioApi({ organizationId: ORG });

    const out1 = output(1, { savedAssetId: asset(1).id });
    const pairedCopy = asset(1, { source: 'generation', sourceOutputId: out1.id });
    const withCopyHtml = renderToStaticMarkup(
      <SpineResultDelete
        output={out1}
        assets={[pairedCopy]}
        api={api}
        studioCopy={d.brandStudio}
        spineCopy={d.studioLibrary.hub.spine}
        onDeleted={() => {}}
        initialConfirming={true}
      />,
    );
    expect(withCopyHtml).toContain(d.brandStudio.viewer.deleteConfirm);
    expect(withCopyHtml).toContain(d.studioLibrary.hub.spine.deleteBoth);

    // Deduplicated genuine upload pointed to by savedAssetId (no sourceOutputId) -> NO deleteBoth
    const dedupedUpload = asset(1, { source: 'upload' });
    const withDedupedUploadHtml = renderToStaticMarkup(
      <SpineResultDelete
        output={out1}
        assets={[dedupedUpload]}
        api={api}
        studioCopy={d.brandStudio}
        spineCopy={d.studioLibrary.hub.spine}
        onDeleted={() => {}}
        initialConfirming={true}
      />,
    );
    expect(withDedupedUploadHtml).toContain(d.brandStudio.viewer.deleteConfirm);
    expect(withDedupedUploadHtml).not.toContain(d.studioLibrary.hub.spine.deleteBoth);

    const withoutCopyHtml = renderToStaticMarkup(
      <SpineResultDelete
        output={output(2, { savedAssetId: null })}
        assets={[pairedCopy]}
        api={api}
        studioCopy={d.brandStudio}
        spineCopy={d.studioLibrary.hub.spine}
        onDeleted={() => {}}
        initialConfirming={true}
      />,
    );
    expect(withoutCopyHtml).toContain(d.brandStudio.viewer.deleteConfirm);
    expect(withoutCopyHtml).not.toContain(d.studioLibrary.hub.spine.deleteBoth);

    // Non-spine HubDetail has no resultDelete
    const out = output(3, { savedAssetId: asset(3).id });
    const run = job(3, { outputs: [out] });
    const singleEntry = buildHubEntries(
      [asset(3, { source: 'generation', sourceOutputId: out.id })],
      [run],
      d.studioLibrary.hub.sourceGenerated,
    )[0]!;
    const sendProp: ViewerSendProp = { organizationId: ORG, copy: pickSendCopy(d) };
    const noSpineDetail = renderToStaticMarkup(
      <HubDetail
        entry={singleEntry}
        copy={d.studioLibrary}
        editedMark={d.brandStudio.gallery.editedMark}
        name="Result"
        liked={false}
        main={null}
        more={[]}
        onLike={() => {}}
        onAction={() => {}}
        onClose={() => {}}
        send={sendProp}
        sendJob={run}
      />,
    );
    expect(noSpineDetail).toContain('data-asset-hub-send');
    expect(noSpineDetail).not.toContain('data-asset-hub-result-delete');
  });
});

describe('Spine rules R-A DOM harness', () => {
  it('switch links fire zero client requests on click or 3 equal-prop re-renders', async () => {
    const d = getDictionary('ko');
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 200 }));
    const api = createStudioApi({ organizationId: ORG, fetch: fetchSpy });

    const activeOverview: StudioBrandProjectOverview = {
      ...ALL_OVERVIEW,
      projects: ALL_OVERVIEW.projects.filter((g) => g.selectable !== false),
    };

    const node = (
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={studioState({ canCreate: true })}
        spine={{
          overview: activeOverview,
          filter: 'active',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
        api={api}
      />
    );

    mounted = await mountDom(node);
    await flush();

    const links = mounted.queryAll('[data-asset-hub-projects-switch] a');
    expect(links).toHaveLength(2);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    expect(links[1]!.getAttribute('href')).toBe(`/brand/library?organizationId=${ORG}&projects=all`);

    // Click link element inside DOM harness -> zero fetch requests
    await mounted.click(links[1]!);
    await mounted.rerender(node);
    await mounted.rerender(node);
    await mounted.rerender(node);
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it('sends ONE output.delete with withSavedCopy: true when savedAssetId exists, omits it otherwise, and stops cleanly on conflict', async () => {
    const d = getDictionary('ko');
    const outWithCopy = output(1, { savedAssetId: asset(1).id });
    const outAlone = output(2, { savedAssetId: null });
    const savedCopy = asset(1, { source: 'generation', sourceOutputId: outWithCopy.id, brandProjectId: P_OPEN_SELF });
    const run = job(1, { kind: 'image', prompt: 'Hero cut', outputs: [outWithCopy, outAlone], brandProjectId: P_OPEN_SELF });

    let deleteReply: { ok: true; savedCopyId?: string } | { ok: false; code: 'conflict' } = {
      ok: true,
      savedCopyId: asset(1).id,
    };
    const deleteCalls: Array<Record<string, unknown>> = [];
    const overviewCalls: Array<unknown> = [];
    const stateCalls: Array<unknown> = [];

    const state0 = studioState({ canCreate: true, assets: [savedCopy], jobs: [run] });
    const fakeApi: StudioApi = {
      ...createStudioApi({ organizationId: ORG }),
      loadState: vi.fn(async (opts) => {
        stateCalls.push(opts ?? null);
        return state0;
      }),
      loadBrandProjectOverview: vi.fn(async (opts) => {
        overviewCalls.push(opts ?? null);
        return ALL_OVERVIEW;
      }),
      deleteResultWithSavedCopy: vi.fn(async (outputId) => {
        deleteCalls.push({ organizationId: ORG, outputId, withSavedCopy: true });
        return deleteReply as never;
      }),
      call: vi.fn(async (operation, input) => {
        if (operation === 'output.delete') {
          deleteCalls.push(input as Record<string, unknown>);
          return deleteReply as never;
        }
        return { ok: false, code: 'failed' } as never;
      }) as StudioApi['call'],
    };

    const element = (
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={state0}
        initialAllView="all"
        initialSpine={{ tab: 'all' }}
        spine={{
          overview: ALL_OVERVIEW,
          filter: 'all',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
        api={fakeApi}
      />
    );

    mounted = await mountHubDom(element);
    await flush();

    // 3 equal-prop re-renders send zero API requests
    await mounted.rerender(element);
    await mounted.rerender(element);
    await mounted.rerender(element);
    await flush();
    expect(deleteCalls).toHaveLength(0);
    expect(overviewCalls).toHaveLength(0);

    // 1. Open result with savedAssetId on 모든 파일 -> delete -> conflict -> nothing deleted, error shown
    deleteReply = { ok: false, code: 'conflict' };
    await mounted.click(`[data-asset-hub-card="o:${outWithCopy.id}"] [data-asset-hub-open]`);
    await flush();
    await mounted.click('[data-asset-hub-result-delete]');
    expect(mounted.query('[data-asset-hub-delete-both]')).not.toBeNull();
    await mounted.click('[data-asset-hub-result-delete-yes]');
    await flush();
    expect(deleteCalls).toEqual([{ organizationId: ORG, outputId: outWithCopy.id, withSavedCopy: true }]);
    expect(mounted.query('[data-asset-hub-detail]')).not.toBeNull();
    expect(mounted.query('[data-asset-hub-result-delete-error]')?.textContent).toBe(d.brandStudio.viewer.deleteBusy);
    expect(overviewCalls).toHaveLength(0);
    expect(stateCalls).toHaveLength(0);

    // 2. Confirm again when server succeeds -> ONE call, closes detail, triggers reload
    deleteReply = { ok: true, savedCopyId: asset(1).id };
    await mounted.click('[data-asset-hub-result-delete-yes]');
    await flush();
    expect(deleteCalls).toHaveLength(2);
    expect(mounted.query('[data-asset-hub-detail]')).toBeNull();
    expect(overviewCalls).toEqual([{ filter: 'all' }]);
    expect(stateCalls).toHaveLength(1);

    // 3. Result with savedAssetId pointing at a genuine deduplicated UPLOAD (no sourceOutputId) -> plain output.delete + NO deleteBoth
    deleteReply = { ok: true };
    const outDedupedUpload = output(4, { savedAssetId: asset(4).id });
    const genuineUpload = asset(4, { name: 'Genuine upload', source: 'upload', brandProjectId: P_OPEN_SELF });
    const runMix = job(1, { kind: 'image', prompt: 'Hero mix', outputs: [outWithCopy, outDedupedUpload, outAlone], brandProjectId: P_OPEN_SELF });
    const mixState = studioState({ canCreate: true, assets: [savedCopy, genuineUpload], jobs: [runMix] });
    const mixHub = (
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={mixState}
        initialAllView="all"
        initialSpine={{ tab: 'all' }}
        spine={{
          overview: ALL_OVERVIEW,
          filter: 'all',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
        api={fakeApi}
      />
    );
    await mounted.unmount();
    mounted = await mountDom(mixHub);
    await flush();

    await mounted.click(`[data-asset-hub-card="o:${outDedupedUpload.id}"] [data-asset-hub-open]`);
    await flush();
    await mounted.click('[data-asset-hub-result-delete]');
    expect(mounted.query('[data-asset-hub-delete-both]')).toBeNull();
    await mounted.click('[data-asset-hub-result-delete-yes]');
    await flush();
    expect(deleteCalls[2]).toEqual({ organizationId: ORG, outputId: outDedupedUpload.id });

    // 4. Result without savedAssetId -> calls output.delete WITHOUT withSavedCopy and hides deleteBoth
    await mounted.click(`[data-asset-hub-card="o:${outAlone.id}"] [data-asset-hub-open]`);
    await flush();
    await mounted.click('[data-asset-hub-result-delete]');
    expect(mounted.query('[data-asset-hub-delete-both]')).toBeNull();
    await mounted.click('[data-asset-hub-result-delete-yes]');
    await flush();
    expect(deleteCalls[3]).toEqual({ organizationId: ORG, outputId: outAlone.id });
  });

  it('MoveToProjectDialog from finished ScopeView offers only selectable projects and 미분류 (never finished projects)', async () => {
    const d = getDictionary('ko');
    const up = asset(5, { name: 'Archived still', brandProjectId: P_DONE_SELF });
    const state0: StudioState = studioState({ canCreate: true, assets: [up] });
    const fakeApi: StudioApi = {
      ...createStudioApi({ organizationId: ORG }),
      loadBrandProjectOverview: vi.fn(async () => ALL_OVERVIEW),
      listBrandProjectFiles: vi.fn(async () => ({
        ok: true as const,
        items: [{ type: 'asset' as const, id: up.id }],
        assets: [up],
        jobs: [],
        films: [],
        next: null,
      })),
    };

    mounted = await mountDom(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={state0}
        spine={{
          overview: ALL_OVERVIEW,
          filter: 'all',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        initialSpine={{
          tab: 'by_project',
          openedScope: { kind: 'project', brandProjectId: P_DONE_SELF },
          page: {
            ok: true,
            items: [{ type: 'asset', id: up.id }],
            assets: [up],
            jobs: [],
            films: [],
            next: null,
          },
        }}
        injectedLibrary={stubLibrary()}
        api={fakeApi}
      />,
    );
    await flush();

    expect(mounted.query('[data-asset-hub-finished-hint]')).not.toBeNull();
    await mounted.click('[data-asset-hub-select]');
    await mounted.click(`[data-asset-hub-card="a:${up.id}"] [data-asset-hub-open]`);
    await mounted.click('[data-asset-hub-move]');
    await flush();

    const dialogText = mounted.query('[data-project-move-dialog]')?.textContent ?? '';
    expect(dialogText).toContain('Active studio');
    expect(dialogText).toContain(d.projectSpine.unfiled);
    expect(dialogText).not.toContain('Done self archive');
    expect(dialogText).not.toContain('Done team campaign');
    expect(mounted.query('[data-project-move-option="unfiled"][data-current="true"]')).toBeNull();
  });

  it('MoveToProjectDialog on 모든 파일 does not label a finished project file as 미분류 and keeps 미분류 movable', async () => {
    const d = getDictionary('ko');
    const outDoneCover = output(41, { kind: 'image' });
    const runDoneCover = job(41, { kind: 'image', prompt: 'Done cover', outputs: [outDoneCover], brandProjectId: null });
    const upDoneOther = asset(42, { name: 'Done unshown upload', brandProjectId: null });
    const overviewWithDoneCover: StudioBrandProjectOverview = {
      ...ALL_OVERVIEW,
      projects: ALL_OVERVIEW.projects.map((g) =>
        g.project.id === P_DONE_SELF
          ? {
              ...g,
              covers: [
                {
                  outputId: outDoneCover.id,
                  jobId: runDoneCover.id,
                  kind: 'image',
                  url: outDoneCover.url,
                  thumbUrl: outDoneCover.thumbUrl,
                  width: 1600,
                  height: 1200,
                  createdAt: outDoneCover.createdAt,
                },
              ],
            }
          : g,
      ),
    };
    const state0 = studioState({ canCreate: true, assets: [upDoneOther], jobs: [runDoneCover] });
    const moveCalls: unknown[] = [];
    const fakeApi: StudioApi = {
      ...createStudioApi({ organizationId: ORG }),
      moveToBrandProject: vi.fn(async (input) => {
        moveCalls.push(input);
        return { ok: true as const, projectId: input.projectId, jobIds: [...(input.jobIds ?? [])], assetIds: [...(input.assetIds ?? [])], filmIds: [...(input.filmIds ?? [])] };
      }),
      loadBrandProjectOverview: vi.fn(async () => overviewWithDoneCover),
    };

    mounted = await mountDom(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={state0}
        initialAllView="all"
        initialSpine={{ tab: 'all' }}
        spine={{
          overview: overviewWithDoneCover,
          filter: 'all',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
        api={fakeApi}
      />,
    );
    await flush();

    // Cover of finished project on 모든 파일 (studio state brandProjectId=null): overview resolves current project so 미분류 is not current & can move to 미분류
    await mounted.click(`[data-asset-hub-card="o:${outDoneCover.id}"] [aria-haspopup="menu"]`);
    await mounted.click('[data-project-move]');
    await flush();
    expect(mounted.query('[data-project-move-option="unfiled"][data-current="true"]')).toBeNull();
    const unfiledRadio1 = mounted.query('[data-project-move-option="unfiled"] input');
    if (!unfiledRadio1) throw new Error('Expected unfiled radio input');
    unfiledRadio1.checked = true;
    await mounted.click(unfiledRadio1);
    await mounted.submit('[data-project-move-dialog] form');
    await flush();
    expect(moveCalls.some((c) => !(c as { preview?: boolean }).preview && (c as { projectId: null }).projectId === null)).toBe(true);

    // Non-cover upload while finished files exist: currentScope is unknown -> 미분류 is not data-current="true" and stays selectable
    await mounted.click(`[data-asset-hub-card="a:${upDoneOther.id}"] [aria-haspopup="menu"]`);
    await mounted.click('[data-project-move]');
    await flush();
    expect(mounted.query('[data-project-move-option="unfiled"][data-current="true"]')).toBeNull();
    const unfiledRadio2 = mounted.query('[data-project-move-option="unfiled"] input');
    expect(unfiledRadio2).not.toBeNull();
  });

  it('finished ScopeView tile menus in DOM expose ONLY move across image/video/sound results and uploads', async () => {
    const d = getDictionary('ko');
    const outImg = output(51, { kind: 'image' });
    const outVid = output(52, { kind: 'video' });
    const outSnd = output(53, { kind: 'audio' });
    const run = job(51, { kind: 'image', prompt: 'Menu audit', outputs: [outImg, outVid, outSnd] });
    const upImg = asset(54, { kind: 'image', name: 'MenuShot.png' });
    const upVid = asset(55, { kind: 'video', name: 'MenuClip.mp4' });
    const upAud = asset(56, { kind: 'audio', name: 'MenuBed.mp3' });
    const pageData = {
      ok: true as const,
      items: [
        { type: 'job' as const, id: run.id },
        { type: 'asset' as const, id: upImg.id },
        { type: 'asset' as const, id: upVid.id },
        { type: 'asset' as const, id: upAud.id },
      ],
      assets: [upImg, upVid, upAud],
      jobs: [run],
      films: [],
      next: null,
    };
    const fakeApi: StudioApi = {
      ...createStudioApi({ organizationId: ORG }),
      loadBrandProjectOverview: vi.fn(async () => ALL_OVERVIEW),
      listBrandProjectFiles: vi.fn(async () => pageData),
    };
    mounted = await mountDom(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={studioState({ canCreate: true, assets: [upImg, upVid, upAud], jobs: [run] })}
        spine={{
          overview: ALL_OVERVIEW,
          filter: 'all',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        initialSpine={{
          tab: 'by_project',
          openedScope: { kind: 'project', brandProjectId: P_DONE_SELF },
          page: pageData,
        }}
        injectedLibrary={stubLibrary()}
        api={fakeApi}
      />,
    );
    await flush();

    for (const tileKey of [`o:${outImg.id}`, `o:${outVid.id}`, `o:${outSnd.id}`, `a:${upImg.id}`, `a:${upVid.id}`, `a:${upAud.id}`]) {
      await mounted.click(`[data-asset-hub-card="${tileKey}"] [aria-haspopup="menu"]`);
      await flush();
      const menu = mounted.query('[role="menu"]');
      expect(menu, `menu exists for ${tileKey}`).not.toBeNull();
      const items = menu!.querySelectorAll('[role="menuitem"]');
      expect(items, `only move menuitem for ${tileKey}`).toHaveLength(1);
      expect(items[0]!.hasAttribute('data-project-move')).toBe(true);
    }
  });

  it('Home switch links trigger zero requests and single-tile 보내기 sends result ref { kind: output, outputId }', async () => {
    const d = getDictionary('ko');
    const layout = homeLayout({ choice: { id: ORG, name: 'Fern', role: 'owner' }, flagOn: true, canRequest: true, rooms: true })!;
    const fetchSpy = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 200 }));
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      const homeNode = (
        <WorkspaceHome
          organizationId={ORG}
          organizationName="Fern"
          locale="ko"
          layout={layout}
          allowance={{ capKrw: 100_000, usedKrw: 0, resetsAt: '2026-12-01T00:00:00Z' }}
          reviews={[]}
          results={[]}
          activeProjects={1}
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
              projects: [CARD_OPEN_SELF],
              unfiled: { counts: emptyCounts(), covers: [] },
              totals: { active: 1, all: 3 },
            },
          }}
          copy={homeCopyOf('ko')}
        />
      );
      mounted = await mountDom(homeNode);
      await flush();
      const homeLinks = mounted.queryAll('[data-home-projects-switch] a');
      expect(homeLinks).toHaveLength(2);
      expect(homeLinks[1]!.getAttribute('href')).toBe(`/brand/home?organizationId=${ORG}&projects=all`);
      await mounted.click(homeLinks[1]!);
      await mounted.rerender(homeNode);
      await mounted.rerender(homeNode);
      await mounted.rerender(homeNode);
      await flush();
      expect(fetchSpy).toHaveBeenCalledTimes(0);
      await mounted.unmount();
      mounted = null;
    } finally {
      globalThis.fetch = prevFetch;
    }

    const out = output(9, { savedAssetId: asset(9).id });
    const run = job(9, { kind: 'image', prompt: 'Single tile', outputs: [out], brandProjectId: P_OPEN_SELF });
    const copy = asset(9, { source: 'generation', sourceOutputId: out.id, brandProjectId: P_OPEN_SELF });
    const sendFileSpy = vi.fn(async (ref) => ({
      ok: true as const,
      file: {
        ref,
        available: true,
        kind: 'image' as const,
        name: null,
        url: out.url,
        thumbUrl: out.thumbUrl,
        width: 720,
        height: 1280,
        project: { id: P_OPEN_SELF, title: 'Active studio' },
      },
      threads: [],
    }));
    const transport: SendTransport = {
      organizationId: ORG,
      file: sendFileSpy,
      inbox: vi.fn(async () => ({ ok: true as const, view: 'all' as const, threads: [], next: null, unread: 0, mentionsUnread: 0 })),
      thread: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
      people: vi.fn(async () => ({ ok: true as const, people: [] })),
      post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      reply: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      read: vi.fn(async () => ({ ok: true as const, rootId: id(0x21), lastReadAt: '2026-11-26T00:00:00Z' })),
      readAll: vi.fn(async () => ({ ok: true as const, marked: 0, more: false })),
    };

    const state0 = studioState({ canCreate: true, assets: [copy], jobs: [run] });
    mounted = await mountHubDom(
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={state0}
        initialSpine={{ tab: 'all' }}
        spine={{
          overview: ALL_OVERVIEW,
          filter: 'all',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        injectedLibrary={stubLibrary()}
        send={{ organizationId: ORG, copy: pickSendCopy(d), transport }}
      />,
    );
    await flush();
    expect(mounted.queryAll('[data-asset-hub-card]')).toHaveLength(1);
    await mounted.click(`[data-asset-hub-card="o:${out.id}"] [data-asset-hub-open]`);
    await flush();
    await mounted.click('[data-asset-hub-send]');
    await flush();
    expect(sendFileSpy).toHaveBeenCalledTimes(1);
    expect(sendFileSpy).toHaveBeenCalledWith({ kind: 'output', outputId: out.id });
  });
});

describe('Spine rules R-A source guards', () => {
  const ROOT = process.cwd();
  const editedComponents = [
    'components/brand-workspace/home/project-cards/index.tsx',
    'components/brand-studio/asset-hub-spine/index.tsx',
    'components/brand-studio/asset-hub-spine/by-project-view.tsx',
    'components/brand-studio/asset-hub-spine/scope-view.tsx',
    'components/brand-studio/asset-hub-spine/result-delete.tsx',
  ];

  it('has no inline object or array literals in effect/memo/callback deps and no new timers', () => {
    for (const rel of editedComponents) {
      const src = readFileSync(join(ROOT, rel), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      expect(src, `${rel} setInterval`).not.toMatch(/\bsetInterval\b/);
      expect(src, `${rel} setTimeout`).not.toMatch(/\bsetTimeout\b/);
      const depArrays = [...src.matchAll(/\buse(?:Effect|LayoutEffect|Memo|Callback)\([\s\S]*?,\s*(\[[^\]]*\])\s*\)/g)];
      for (const m of depArrays) {
        expect(m[1], `${rel} deps ${m[1]}`).not.toMatch(/\{|\[.*\[/);
      }
    }
  });

  it('has no hardcoded customer wording in the R-A component additions', () => {
    for (const rel of editedComponents) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src).not.toMatch(/끝난 프로젝트|에셋에 저장한 파일|진행 중/);
    }
  });

  it('keeps existing snapshot files outside this test file clean and asset-hub edits minimal', () => {
    const snapDir = join(ROOT, 'tests', 'brand-studio', 'spine-ui', '__snapshots__');
    const files = readdirSync(snapDir);
    expect(files.some((f) => f.startsWith('rules-ra-'))).toBe(true);
    expect(files.filter((f) => f.startsWith('send-')).length).toBeGreaterThanOrEqual(26);
    expect(statSync(join(ROOT, 'components/brand-studio/asset-hub-tile.tsx')).size).toBeGreaterThan(0);
  });
});

describe('Spine rules R-A Fix round 2: MoveToProjectDialog on finished vs active scope', () => {
  type RecordedMoveReq = {
    preview: boolean;
    projectId: string | null;
    jobIds: string[];
    assetIds: string[];
    filmIds: string[];
  };

  const TWO_OPEN_OVERVIEW: StudioBrandProjectOverview = {
    ...ALL_OVERVIEW,
    projects: [
      ...ALL_OVERVIEW.projects,
      {
        project: { id: P_OPEN_2, title: 'Active backup', origin: 'self', lastActivityAt: '2026-11-26T09:30:00Z' },
        counts: emptyCounts({ image: 1 }),
        covers: [],
        status: 'open',
        selectable: true,
      },
    ],
    totals: { active: 2, all: 4 },
  };

  const createTrackedMoveApi = (
    overview: StudioBrandProjectOverview,
    pageFiles?: Partial<StudioBrandProjectFiles>,
  ): { api: StudioApi; requests: RecordedMoveReq[] } => {
    const requests: RecordedMoveReq[] = [];
    const api: StudioApi = {
      ...createStudioApi({ organizationId: ORG }),
      loadBrandProjectOverview: vi.fn(async () => overview),
      listBrandProjectFiles: vi.fn(async () => ({
        ok: true as const,
        items: [],
        assets: [],
        jobs: [],
        films: [],
        next: null,
        ...pageFiles,
      })),
      moveToBrandProject: vi.fn(async (input) => {
        requests.push({
          preview: Boolean(input.preview),
          projectId: input.projectId,
          jobIds: [...(input.jobIds ?? [])],
          assetIds: [...(input.assetIds ?? [])],
          filmIds: [...(input.filmIds ?? [])],
        });
        if (input.projectId === P_DONE_SELF || input.projectId === P_DONE_TEAM) {
          return { ok: false as const, code: 'not_found' as const };
        }
        return {
          ok: true as const,
          projectId: input.projectId,
          jobIds: [...(input.jobIds ?? [])],
          assetIds: [...(input.assetIds ?? [])],
          filmIds: [...(input.filmIds ?? [])],
        };
      }),
    };
    return { api, requests };
  };

  const pickTargetOption = async (dom: MountedDom, optionKey: string) => {
    const radio = dom.query(`[data-project-move-option="${optionKey}"] input`);
    if (!radio) throw new Error(`Expected radio option ${optionKey}`);
    radio.checked = true;
    await dom.click(radio);
    await flush();
  };

  it('finished ScopeView bulk move (StrictMode) sends 0 requests on open + 3 re-renders, 1 preview on pick, 1 move on confirm', async () => {
    const d = getDictionary('ko');
    const outDone = output(71, { kind: 'image' });
    const runDone = job(71, { kind: 'image', prompt: 'Done bulk run', outputs: [outDone], brandProjectId: P_DONE_SELF });
    const state0 = studioState({ canCreate: true, jobs: [runDone] });
    const { api, requests } = createTrackedMoveApi(TWO_OPEN_OVERVIEW, {
      items: [{ type: 'job', id: runDone.id }],
      jobs: [runDone],
    });

    const renderElement = () => (
      <StrictMode>
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={d.brandStudio}
          libraryCopy={d.studioLibrary}
          initialState={state0}
          spine={{
            overview: TWO_OPEN_OVERVIEW,
            filter: 'all',
            canMove: true,
            copy: d.projectSpine,
            filmMeta: d.studioVideo.workspace.projects.meta,
          }}
          initialSpine={{
            tab: 'by_project',
            openedScope: { kind: 'project', brandProjectId: P_DONE_SELF },
            page: {
              ok: true,
              items: [{ type: 'job', id: runDone.id }],
              assets: [],
              jobs: [runDone],
              films: [],
              next: null,
            },
          }}
          injectedLibrary={stubLibrary()}
          api={api}
        />
      </StrictMode>
    );

    mounted = await mountHubDom(renderElement());
    await flush();
    await mounted.click('[data-asset-hub-select]');
    await mounted.click(`[data-asset-hub-card="o:${outDone.id}"] [data-asset-hub-open]`);
    await mounted.click('[data-asset-hub-move]');
    await flush();

    expect(mounted.query('[data-project-move-dialog]')).not.toBeNull();
    expect(requests).toEqual([]);

    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderElement());
      await flush();
    }
    expect(requests).toEqual([]);

    await pickTargetOption(mounted, P_OPEN_SELF);
    expect(requests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runDone.id], assetIds: [], filmIds: [] },
    ]);

    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderElement());
      await flush();
    }
    expect(requests).toHaveLength(1);

    await mounted.submit('[data-project-move-dialog] form');
    await flush();
    expect(requests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runDone.id], assetIds: [], filmIds: [] },
      { preview: false, projectId: P_OPEN_SELF, jobIds: [runDone.id], assetIds: [], filmIds: [] },
    ]);
  });

  it('finished ScopeView single tile menu -> move (StrictMode) sends 0 requests on open + 3 re-renders, 1 preview on pick, 1 move on confirm', async () => {
    const d = getDictionary('ko');
    const outDone = output(72, { kind: 'image' });
    const runDone = job(72, { kind: 'image', prompt: 'Done single run', outputs: [outDone], brandProjectId: P_DONE_SELF });
    const state0 = studioState({ canCreate: true, jobs: [runDone] });
    const { api, requests } = createTrackedMoveApi(TWO_OPEN_OVERVIEW, {
      items: [{ type: 'job', id: runDone.id }],
      jobs: [runDone],
    });

    const renderElement = () => (
      <StrictMode>
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={d.brandStudio}
          libraryCopy={d.studioLibrary}
          initialState={state0}
          spine={{
            overview: TWO_OPEN_OVERVIEW,
            filter: 'all',
            canMove: true,
            copy: d.projectSpine,
            filmMeta: d.studioVideo.workspace.projects.meta,
          }}
          initialSpine={{
            tab: 'by_project',
            openedScope: { kind: 'project', brandProjectId: P_DONE_SELF },
            page: {
              ok: true,
              items: [{ type: 'job', id: runDone.id }],
              assets: [],
              jobs: [runDone],
              films: [],
              next: null,
            },
          }}
          injectedLibrary={stubLibrary()}
          api={api}
        />
      </StrictMode>
    );

    mounted = await mountHubDom(renderElement());
    await flush();
    await mounted.click(`[data-asset-hub-card="o:${outDone.id}"] [aria-haspopup="menu"]`);
    await mounted.click('[data-project-move]');
    await flush();

    expect(mounted.query('[data-project-move-dialog]')).not.toBeNull();
    expect(requests).toEqual([]);

    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderElement());
      await flush();
    }
    expect(requests).toEqual([]);

    await pickTargetOption(mounted, P_OPEN_SELF);
    expect(requests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runDone.id], assetIds: [], filmIds: [] },
    ]);

    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderElement());
      await flush();
    }
    expect(requests).toHaveLength(1);

    await mounted.submit('[data-project-move-dialog] form');
    await flush();
    expect(requests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runDone.id], assetIds: [], filmIds: [] },
      { preview: false, projectId: P_OPEN_SELF, jobIds: [runDone.id], assetIds: [], filmIds: [] },
    ]);
  });

  it('모든 파일 finished cover tile menu -> move (StrictMode) sends 0 requests on open + 3 re-renders, 1 preview on pick, 1 move on confirm', async () => {
    const d = getDictionary('ko');
    const outDoneCover = output(73, { kind: 'image' });
    const runDoneCover = job(73, { kind: 'image', prompt: 'All tab finished cover', outputs: [outDoneCover], brandProjectId: null });
    const overviewWithDoneCover: StudioBrandProjectOverview = {
      ...TWO_OPEN_OVERVIEW,
      projects: TWO_OPEN_OVERVIEW.projects.map((g) =>
        g.project.id === P_DONE_SELF
          ? {
              ...g,
              covers: [
                {
                  outputId: outDoneCover.id,
                  jobId: runDoneCover.id,
                  kind: 'image',
                  url: outDoneCover.url,
                  thumbUrl: outDoneCover.thumbUrl,
                  width: 1600,
                  height: 1200,
                  createdAt: outDoneCover.createdAt,
                },
              ],
            }
          : g,
      ),
    };
    const state0 = studioState({ canCreate: true, jobs: [runDoneCover] });
    const { api, requests } = createTrackedMoveApi(overviewWithDoneCover);

    const renderElement = () => (
      <StrictMode>
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={d.brandStudio}
          libraryCopy={d.studioLibrary}
          initialState={state0}
          initialAllView="all"
          initialSpine={{ tab: 'all' }}
          spine={{
            overview: overviewWithDoneCover,
            filter: 'all',
            canMove: true,
            copy: d.projectSpine,
            filmMeta: d.studioVideo.workspace.projects.meta,
          }}
          injectedLibrary={stubLibrary()}
          api={api}
        />
      </StrictMode>
    );

    mounted = await mountHubDom(renderElement());
    await flush();
    await mounted.click(`[data-asset-hub-card="o:${outDoneCover.id}"] [aria-haspopup="menu"]`);
    await mounted.click('[data-project-move]');
    await flush();

    expect(mounted.query('[data-project-move-dialog]')).not.toBeNull();
    expect(mounted.query('[data-project-move-option="unfiled"][data-current="true"]')).toBeNull();
    expect(requests).toEqual([]);

    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderElement());
      await flush();
    }
    expect(requests).toEqual([]);

    await pickTargetOption(mounted, P_OPEN_SELF);
    expect(requests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runDoneCover.id], assetIds: [], filmIds: [] },
    ]);

    await mounted.submit('[data-project-move-dialog] form');
    await flush();
    expect(requests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runDoneCover.id], assetIds: [], filmIds: [] },
      { preview: false, projectId: P_OPEN_SELF, jobIds: [runDoneCover.id], assetIds: [], filmIds: [] },
    ]);
  });

  it('active project ScopeView bulk and single moves emit the exact same request sequence as standalone base MoveToProjectDialog', async () => {
    const d = getDictionary('ko');
    const outActive = output(74, { kind: 'image' });
    const runActive = job(74, { kind: 'image', prompt: 'Active run', outputs: [outActive], brandProjectId: P_OPEN_SELF });
    const state0 = studioState({ canCreate: true, jobs: [runActive] });
    const selectableProjects = selectableMoveProjects(TWO_OPEN_OVERVIEW.projects);
    const noop = () => {};

    // 1. Standalone base MoveToProjectDialog reference sequence: open -> 3 re-renders -> pick P_OPEN_2 -> 3 re-renders -> confirm
    const { api: baseApi, requests: baseRequests } = createTrackedMoveApi(TWO_OPEN_OVERVIEW);
    const renderBaseDialog = () => (
      <MoveToProjectDialog
        projects={selectableProjects}
        currentScope={{ kind: 'project', id: P_OPEN_SELF }}
        jobIds={[runActive.id]}
        assetIds={[]}
        filmIds={[]}
        locale="ko"
        copy={d.projectSpine}
        onMove={baseApi.moveToBrandProject}
        onMoved={noop}
        onClose={noop}
      />
    );
    mounted = await mountHubDom(renderBaseDialog());
    await flush();
    expect(baseRequests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runActive.id], assetIds: [], filmIds: [] },
    ]);
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderBaseDialog());
      await flush();
    }
    expect(baseRequests).toHaveLength(1);
    await pickTargetOption(mounted, P_OPEN_2);
    expect(baseRequests).toHaveLength(2);
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderBaseDialog());
      await flush();
    }
    expect(baseRequests).toHaveLength(2);
    await mounted.submit('[data-project-move-dialog] form');
    await flush();
    expect(baseRequests).toEqual([
      { preview: true, projectId: P_OPEN_SELF, jobIds: [runActive.id], assetIds: [], filmIds: [] },
      { preview: true, projectId: P_OPEN_2, jobIds: [runActive.id], assetIds: [], filmIds: [] },
      { preview: false, projectId: P_OPEN_2, jobIds: [runActive.id], assetIds: [], filmIds: [] },
    ]);
    await mounted.unmount();
    mounted = null;

    // 2. Active ScopeView bulk move (select -> move -> 3 re-renders -> pick P_OPEN_2 -> 3 re-renders -> confirm)
    const { api: bulkApi, requests: bulkRequests } = createTrackedMoveApi(TWO_OPEN_OVERVIEW, {
      items: [{ type: 'job', id: runActive.id }],
      jobs: [runActive],
    });
    const renderActiveHub = (apiInstance: StudioApi) => (
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={state0}
        spine={{
          overview: TWO_OPEN_OVERVIEW,
          filter: 'all',
          canMove: true,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        initialSpine={{
          tab: 'by_project',
          openedScope: { kind: 'project', brandProjectId: P_OPEN_SELF },
          page: {
            ok: true,
            items: [{ type: 'job', id: runActive.id }],
            assets: [],
            jobs: [runActive],
            films: [],
            next: null,
          },
        }}
        injectedLibrary={stubLibrary()}
        api={apiInstance}
      />
    );
    mounted = await mountHubDom(renderActiveHub(bulkApi));
    await flush();
    await mounted.click('[data-asset-hub-select]');
    await mounted.click(`[data-asset-hub-card="o:${outActive.id}"] [data-asset-hub-open]`);
    await mounted.click('[data-asset-hub-move]');
    await flush();
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderActiveHub(bulkApi));
      await flush();
    }
    await pickTargetOption(mounted, P_OPEN_2);
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderActiveHub(bulkApi));
      await flush();
    }
    await mounted.submit('[data-project-move-dialog] form');
    await flush();
    expect(bulkRequests).toEqual(baseRequests);
    await mounted.unmount();
    mounted = null;

    // 3. Active ScopeView single tile menu -> move -> 3 re-renders -> pick P_OPEN_2 -> 3 re-renders -> confirm
    const { api: singleApi, requests: singleRequests } = createTrackedMoveApi(TWO_OPEN_OVERVIEW, {
      items: [{ type: 'job', id: runActive.id }],
      jobs: [runActive],
    });
    mounted = await mountHubDom(renderActiveHub(singleApi));
    await flush();
    await mounted.click(`[data-asset-hub-card="o:${outActive.id}"] [aria-haspopup="menu"]`);
    await mounted.click('[data-project-move]');
    await flush();
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderActiveHub(singleApi));
      await flush();
    }
    await pickTargetOption(mounted, P_OPEN_2);
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderActiveHub(singleApi));
      await flush();
    }
    await mounted.submit('[data-project-move-dialog] form');
    await flush();
    expect(singleRequests).toEqual(baseRequests);
  });
});
