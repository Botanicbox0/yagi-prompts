import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StrictMode, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioApi, type StudioApi } from '@/components/brand-studio/api';
import { BrandAssetHub } from '@/components/brand-studio/asset-hub';
import { ArchiveView } from '@/components/brand-studio/asset-hub-spine/archive-view';
import { ByProjectView } from '@/components/brand-studio/asset-hub-spine/by-project-view';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import type { SpineHomeProps } from '@/components/brand-workspace/home/project-cards/model';
import type {
  StudioBrandProjectArchive,
  StudioBrandProjectArchiveCard,
  StudioBrandProjectCard,
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectOverview,
} from '@/lib/brand-studio/contracts';
import { homeLayout } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { ORG, asset, id, job, output, studioState } from '../ui/fixtures';

vi.mock('@/components/brand-studio/rail/use-library', () => ({
  useStudioLibrary: () => stubLibrary(),
}));

const NOW = new Date('2026-11-26T12:00:00.000Z');
const P_OPEN = id(0xa1);
const P_DONE = id(0xa2);
const P_OVER100 = id(0xa3);
const P_TEAM_DONE = id(0xa4);

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

const sampleCard = (
  projId: string,
  over: Partial<StudioBrandProjectCard> & { title?: string } = {},
): StudioBrandProjectCard => ({
  project: {
    id: projId,
    title: over.title ?? 'Sample project',
    origin: over.project?.origin ?? 'self',
    lastActivityAt: '2026-11-26T09:00:00.000Z',
    ...(over.project ?? {}),
  },
  counts: emptyCounts(over.counts),
  covers: over.covers ?? [],
  lastActivity: over.lastActivity ?? null,
  unread: over.unread ?? 0,
  stage: over.stage ?? null,
  status: over.status ?? 'open',
  selectable: over.selectable ?? true,
});

const archiveRow = (
  projId: string,
  over: Partial<StudioBrandProjectArchiveCard> & { title?: string } = {},
): StudioBrandProjectArchiveCard => sampleCard(projId, over) as StudioBrandProjectArchiveCard;

const BASE_OVERVIEW: StudioBrandProjectOverview = {
  ok: true,
  projects: [
    {
      project: { id: P_OPEN, title: 'Open Top', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' },
      counts: emptyCounts({ image: 2 }),
      covers: [],
      status: 'open',
      selectable: true,
    },
  ],
  unfiled: { counts: emptyCounts(), covers: [] },
  brandMaterials: { count: 0, byRole: { product: 0, person: 0, logo: 0, style: 0, place: 0 }, covers: [] },
  finished: { counts: emptyCounts() },
  totals: { active: 105, all: 130 },
  listed: { active: 100, all: 100 },
};

function deferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

let mounted: MountedDom | null = null;
const HAD_SELF = 'self' in globalThis;
const PREV_SELF = (globalThis as Record<string, unknown>).self;

beforeEach(() => {
  (globalThis as Record<string, unknown>).self = globalThis;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.useRealTimers();
  if (HAD_SELF) (globalThis as Record<string, unknown>).self = PREV_SELF;
  else delete (globalThis as Record<string, unknown>).self;
});

describe('Spine rules R-B screen markup: archiveLink and ArchiveView', () => {
  it.each(['ko', 'en'] as const)('renders archiveLink on Home and ByProjectView ONLY when unlisted n > 0 (%s)', (locale) => {
    const d = getDictionary(locale);
    const layout = homeLayout({ choice: { id: ORG, name: 'Fern', role: 'owner' }, flagOn: true, canRequest: true, rooms: true })!;
    const card1 = sampleCard(P_OPEN, { title: 'Lookbook' });

    const renderHome = (listed?: { active: number; all: number }, filter: 'active' | 'all' = 'active') =>
      renderToStaticMarkup(
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
            filter,
            cards: {
              ok: true,
              projects: [card1],
              unfiled: { counts: emptyCounts(), covers: [] },
              totals: { active: 105, all: 130 },
              ...(listed ? { listed } : {}),
            },
          }}
          copy={homeCopyOf(locale)}
        />,
      );

    // 1. No `listed` or `listed === totals` -> NO archiveLink
    expect(renderHome(undefined)).not.toContain('data-home-projects-archive');
    expect(renderHome({ active: 105, all: 130 })).not.toContain('data-home-projects-archive');

    // 2. Unlisted active = 5; unlisted all = 30
    const expected5 =
      locale === 'ko'
        ? '프로젝트가 5개 더 있어요 · 전체 프로젝트 보기'
        : '5 more projects · View all projects';
    const expected30 =
      locale === 'ko'
        ? '프로젝트가 30개 더 있어요 · 전체 프로젝트 보기'
        : '30 more projects · View all projects';
    const homeActiveHtml = renderHome({ active: 100, all: 100 }, 'active');
    expect(homeActiveHtml).toContain('data-home-projects-archive="5"');
    expect(homeActiveHtml).toContain(`href="/brand/library?organizationId=${ORG}&amp;view=archive"`);
    expect(homeActiveHtml).toContain(d.projectHome.archiveLink.replace('{n}', '5'));
    expect(homeActiveHtml).toContain(expected5);
    expect(homeActiveHtml).not.toContain(locale === 'ko' ? '아카이브' : 'View archive');

    const homeAllHtml = renderHome({ active: 100, all: 100 }, 'all');
    expect(homeAllHtml).toContain('data-home-projects-archive="30"');
    expect(homeAllHtml).toContain(d.projectHome.archiveLink.replace('{n}', '30'));
    expect(homeAllHtml).toContain(expected30);

    // 3. ByProjectView on Assets
    const renderByProject = (listed?: { active: number; all: number }, filter: 'active' | 'all' = 'active') =>
      renderToStaticMarkup(
        <ByProjectView
          organizationId={ORG}
          filter={filter}
          overview={{
            ...BASE_OVERVIEW,
            ...(listed ? { listed } : { listed: undefined }),
          }}
          libraryCopy={d.studioLibrary}
          projectSpineCopy={d.projectSpine}
          state={studioState()}
          deliverables={[]}
          canMove={true}
          query=""
          onOpenMaterials={() => {}}
          onOpenProject={() => {}}
          onOpenUnfiled={() => {}}
          onMoveUnfiled={() => {}}
        />,
      );

    expect(renderByProject(undefined)).not.toContain('data-asset-hub-archive-link');
    expect(renderByProject({ active: 105, all: 130 })).not.toContain('data-asset-hub-archive-link');

    const bpActive = renderByProject({ active: 100, all: 100 }, 'active');
    expect(bpActive).toContain('data-asset-hub-archive-count="5"');
    expect(bpActive).toContain(`href="/brand/library?organizationId=${ORG}&amp;view=archive"`);
    expect(bpActive).toContain(d.studioLibrary.hub.spine.archiveLink.replace('{n}', '5'));
    expect(bpActive).toContain(expected5);
    expect(bpActive).not.toContain(locale === 'ko' ? '아카이브' : 'View archive');

    const bpAll = renderByProject({ active: 100, all: 100 }, 'all');
    expect(bpAll).toContain('data-asset-hub-archive-count="30"');
    expect(bpAll).toContain(d.studioLibrary.hub.spine.archiveLink.replace('{n}', '30'));
    expect(bpAll).toContain(expected30);
  });

  it('renders ArchiveView rows (active vs finished, openStudio conditional, covers, counts, Seoul dates, empty & failed states)', () => {
    const d = getDictionary('ko');
    const sc = d.studioLibrary.hub.spine;
    const api = createStudioApi({ organizationId: ORG });

    const seed: StudioBrandProjectArchive = {
      ok: true,
      total: 130,
      next: 'cur-next',
      projects: [
        archiveRow(P_OPEN, {
          title: 'Active Beyond Cut',
          project: { id: P_OPEN, title: 'Active Beyond Cut', origin: 'self', lastActivityAt: '2026-08-15T05:00:00.000Z' },
          status: 'open',
          selectable: true,
          counts: emptyCounts({ image: 4, film: 1 }),
          covers: [{ source: 'result', id: 'c1', kind: 'image', url: '/m/a.png', thumbUrl: '/m/a-sm.webp', width: 400, height: 500 }],
          // Newer upload file added 10m ago — Archive row date MUST still show project's ranking time (8월 15일), NOT 10분 전!
          lastActivity: { at: '2026-11-26T11:50:00.000Z', kind: 'upload', item: { type: 'asset', id: id(1) }, actorName: null },
        }),
        archiveRow(P_DONE, {
          title: 'Finished Self Archive',
          status: 'archived',
          selectable: false,
          counts: emptyCounts({ video: 2 }),
          covers: [{ source: 'result', id: 'c2', kind: 'video', url: '/m/b.mp4', thumbUrl: null, width: 400, height: 500 }],
        }),
        archiveRow(P_TEAM_DONE, {
          title: 'Finished Team Older Year',
          project: { id: P_TEAM_DONE, title: 'Finished Team Older Year', origin: 'team', lastActivityAt: '2025-10-05T08:00:00.000Z' },
          status: 'completed',
          selectable: false,
        }),
      ],
    };

    const html = renderToStaticMarkup(
      <ArchiveView
        organizationId={ORG}
        locale="ko"
        libraryCopy={d.studioLibrary}
        projectSpineCopy={d.projectSpine}
        canOpenStudio={true}
        canCreate={true}
        api={api}
        initialArchive={seed}
      />,
    );

    expect(html).toContain(sc.archiveTitle);
    expect(html).toContain('전체 프로젝트');
    expect(html).not.toContain('아카이브');
    expect(html).toContain(sc.archiveHint);

    const enDict = getDictionary('en');
    const enHtml = renderToStaticMarkup(
      <ArchiveView
        organizationId={ORG}
        locale="en"
        libraryCopy={enDict.studioLibrary}
        projectSpineCopy={enDict.projectSpine}
        canOpenStudio={true}
        canCreate={true}
        api={api}
        initialArchive={seed}
      />,
    );
    expect(enHtml).toContain('All projects');
    expect(enHtml).not.toContain('>Archive<');
    expect(html).toContain(sc.archiveBack);
    expect(html).toContain(`placeholder="${sc.archiveSearch}"`);
    expect(html).toContain(`aria-label="${sc.archiveSearch}"`);
    expect(html).toContain('130개');

    // Fix 2: Exact hrefs on real links (`archiveBack`, `archiveOpenFiles` with NO view param, `archiveOpenStudio`)
    expect(html).toContain(`href="/brand/library?organizationId=${ORG}"`);
    expect(html).toContain(`href="/brand/library?organizationId=${ORG}&amp;project=${P_OPEN}"`);
    expect(html).toContain(`href="/brand/studio?organizationId=${ORG}&amp;project=${P_OPEN}"`);
    expect(html).not.toMatch(/href="[^"]*view=archive[^"]*project=|href="[^"]*project=[^"]*view=archive"/);

    // Fix 3: Date uses project.lastActivityAt (ranking order), NOT newer file's lastActivity.at
    expect(html).toContain('dateTime="2026-08-15T05:00:00.000Z"');
    expect(html).toContain('8월 15일');
    expect(html).not.toContain('10분 전');

    // Open row has BOTH archiveOpenFiles and archiveOpenStudio (when canCreate & canOpenStudio)
    expect(html).toContain(`data-asset-hub-archive-open-files="${P_OPEN}"`);
    expect(html).toContain(`data-asset-hub-archive-open-studio="${P_OPEN}"`);
    expect(html).toContain(sc.archiveOpenFiles);
    expect(html).toContain(sc.archiveOpenStudio);

    // Finished rows NEVER show archiveOpenStudio and carry finishedMark
    expect(html).not.toContain(`data-asset-hub-archive-open-studio="${P_DONE}"`);
    expect(html).not.toContain(`data-asset-hub-archive-open-studio="${P_TEAM_DONE}"`);
    expect(html).toContain(sc.finishedMark);

    // Video without thumb uses LazyVideoCover, never <img src="...mp4">
    expect(html).not.toContain('<img src="/m/b.mp4"');
    expect(html).toContain('/m/a-sm.webp');
    // Older year date formatted with Asia/Seoul year 2025
    expect(html).toContain('2025');
    // Load more button present when next !== null
    expect(html).toContain('data-asset-hub-archive-more');
    expect(html).toContain(sc.archiveMore);

    // Fix 4: Viewer (canCreate: false) sees '파일 보기' ONLY — never '스튜디오에서 열기' even when selectable & canOpenStudio
    const viewerHtml = renderToStaticMarkup(
      <ArchiveView
        organizationId={ORG}
        locale="ko"
        libraryCopy={d.studioLibrary}
        projectSpineCopy={d.projectSpine}
        canOpenStudio={true}
        canCreate={false}
        api={api}
        initialArchive={seed}
      />,
    );
    expect(viewerHtml).toContain(`data-asset-hub-archive-open-files="${P_OPEN}"`);
    expect(viewerHtml).not.toContain('data-asset-hub-archive-open-studio');

    // canOpenStudio: false hides openStudio even when canCreate is true
    const noStudioHtml = renderToStaticMarkup(
      <ArchiveView
        organizationId={ORG}
        locale="ko"
        libraryCopy={d.studioLibrary}
        projectSpineCopy={d.projectSpine}
        canOpenStudio={false}
        canCreate={true}
        api={api}
        initialArchive={seed}
      />,
    );
    expect(noStudioHtml).not.toContain('data-asset-hub-archive-open-studio');

    // Fix 5: Empty search result shows archiveEmpty ONLY when query is active; zero projects without search shows NO false search-miss line
    const emptySearchHtml = renderToStaticMarkup(
      <ArchiveView
        organizationId={ORG}
        locale="ko"
        libraryCopy={d.studioLibrary}
        projectSpineCopy={d.projectSpine}
        canOpenStudio={true}
        canCreate={true}
        api={api}
        initialArchive={{ ok: true, total: 0, next: null, projects: [] }}
        initialQuery="nonexistent"
      />,
    );
    expect(emptySearchHtml).toContain(sc.archiveEmpty);
    expect(emptySearchHtml).not.toContain('data-asset-hub-archive-more');

    const emptyNoProjectsHtml = renderToStaticMarkup(
      <ArchiveView
        organizationId={ORG}
        locale="ko"
        libraryCopy={d.studioLibrary}
        projectSpineCopy={d.projectSpine}
        canOpenStudio={true}
        canCreate={true}
        api={api}
        initialArchive={{ ok: true, total: 0, next: null, projects: [] }}
        initialQuery=""
      />,
    );
    expect(emptyNoProjectsHtml).not.toContain(sc.archiveEmpty);
  });

  it('address wins: BrandAssetHub without view=archive NEVER shows Archive, with view=archive overrides in-memory openedScope', async () => {
    const d = getDictionary('ko');
    const api = createStudioApi({ organizationId: ORG });

    const renderHub = (initialSpine?: { tab: 'by_project'; archive?: boolean; openedScope?: { kind: 'project'; brandProjectId: string } | null; page?: StudioBrandProjectFiles }) => (
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={studioState({ canCreate: false })}
        spine={{
          overview: BASE_OVERVIEW,
          filter: 'active',
          canMove: false,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        initialSpine={initialSpine}
        injectedLibrary={stubLibrary()}
        api={api}
      />
    );

    expect(renderToStaticMarkup(renderHub(undefined))).not.toContain('data-asset-hub-archive=""');
    expect(renderToStaticMarkup(renderHub({ tab: 'by_project' }))).not.toContain('data-asset-hub-archive=""');
    expect(renderToStaticMarkup(renderHub({ tab: 'by_project', archive: true }))).toContain('data-asset-hub-archive=""');

    // Fix 4 through full BrandAssetHub tree: viewer (canCreate: false) sees 파일 보기 only; editor (canCreate: true) sees 스튜디오에서 열기 too
    const renderRoleHub = (canCreate: boolean) =>
      renderToStaticMarkup(
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={d.brandStudio}
          libraryCopy={d.studioLibrary}
          initialState={studioState({ canCreate })}
          spine={{
            overview: BASE_OVERVIEW,
            filter: 'active',
            canMove: canCreate,
            copy: d.projectSpine,
            filmMeta: d.studioVideo.workspace.projects.meta,
          }}
          initialSpine={{
            tab: 'by_project',
            archive: true,
            archiveSeed: { ok: true, total: 1, next: null, projects: [archiveRow(P_OPEN, { status: 'open', selectable: true })] },
          }}
          injectedLibrary={stubLibrary()}
          api={api}
        />,
      );
    expect(renderRoleHub(false)).toContain(`data-asset-hub-archive-open-files="${P_OPEN}"`);
    expect(renderRoleHub(false)).not.toContain('data-asset-hub-archive-open-studio');
    expect(renderRoleHub(true)).toContain(`data-asset-hub-archive-open-studio="${P_OPEN}"`);
  });
});

describe('Spine rules R-B DOM harness (<StrictMode>)', () => {
  it('archiveView: 1 request on open, 0 across 3 equal-props re-renders, search clears rows/cursor & Retry repeats failed query without cursor, failed loadMore Retry repeats exact cursor, cleared search after fail', async () => {
    const d = getDictionary('ko');
    const sc = d.studioLibrary.hub.spine;

    const page1: StudioBrandProjectArchive = {
      ok: true,
      total: 3,
      next: 'cur-1',
      projects: [
        archiveRow(P_OPEN, { title: 'Row One', status: 'open', selectable: true }),
        archiveRow(P_OVER100, { title: 'Row Beyond 100 Finished', status: 'archived', selectable: false, counts: emptyCounts({ image: 2 }) }),
      ],
    };
    const page2Duplicate: StudioBrandProjectArchive = {
      ok: true,
      total: 3,
      next: null,
      // Simulates P_OPEN's activity decreasing after project.move out -> duplicate P_OPEN + new P_DONE
      projects: [
        archiveRow(P_OPEN, { title: 'Row One', status: 'open', selectable: true }),
        archiveRow(P_DONE, { title: 'Row Three', status: 'completed', selectable: false }),
      ],
    };

    const calls: Array<{ cursor?: string; query?: string } | undefined> = [];
    let archiveImpl = async (opts?: { cursor?: string; query?: string }): Promise<StudioBrandProjectArchive | { ok: false; code: 'failed' }> => {
      calls.push(opts);
      if (opts?.cursor === 'cur-1') return page2Duplicate;
      return page1;
    };

    const fakeApi: StudioApi = {
      ...createStudioApi({ organizationId: ORG }),
      loadBrandProjectOverview: vi.fn(async () => BASE_OVERVIEW),
      loadBrandProjectArchive: vi.fn((opts) => archiveImpl(opts)),
    };

    const renderHubArchive = (canCreate = true) => (
      <StrictMode>
        <BrandAssetHub
          organizationId={ORG}
          studioCopy={d.brandStudio}
          libraryCopy={d.studioLibrary}
          initialState={studioState({ canCreate })}
          spine={{
            overview: BASE_OVERVIEW,
            filter: 'active',
            canMove: canCreate,
            copy: d.projectSpine,
            filmMeta: d.studioVideo.workspace.projects.meta,
          }}
          initialSpine={{ tab: 'by_project', archive: true }}
          injectedLibrary={stubLibrary()}
          api={fakeApi}
        />
      </StrictMode>
    );

    mounted = await mountDom(renderHubArchive(true));
    await flush();

    // 1. Exactly 1 archive request on open even under <StrictMode>
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeUndefined();
    expect(mounted.container.querySelectorAll('[data-asset-hub-archive-row]')).toHaveLength(2);
    expect(mounted.query(`[data-asset-hub-archive-open-studio="${P_OPEN}"]`)).not.toBeNull();

    // 2. Three equal-props re-renders send ZERO extra requests
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(renderHubArchive(true));
      await flush();
    }
    expect(calls).toHaveLength(1);

    // 3. Failed '더 보기' -> keeps page 1 rows -> Retry repeats EXACT cursor ('cur-1') and deduplicates P_OPEN
    let failMoreOnce = true;
    archiveImpl = async (opts) => {
      calls.push(opts);
      if (failMoreOnce) {
        failMoreOnce = false;
        return { ok: false, code: 'failed' };
      }
      return page2Duplicate;
    };
    await mounted.click('[data-asset-hub-archive-more]');
    await flush();
    expect(calls[1]).toEqual({ cursor: 'cur-1' });
    expect(mounted.container.textContent).toContain(sc.archiveFailed);
    expect(mounted.container.querySelectorAll('[data-asset-hub-archive-row]')).toHaveLength(2);

    await mounted.click('[data-asset-hub-archive-retry]');
    await flush();
    expect(calls[2]).toEqual({ cursor: 'cur-1' }); // repeats the exact same cursor
    const rowIds = Array.from(mounted.container.querySelectorAll('[data-asset-hub-archive-row]')).map((el) =>
      el.getAttribute('data-asset-hub-archive-row'),
    );
    expect(rowIds).toEqual([P_OPEN, P_OVER100, P_DONE]);
    expect(mounted.query('[data-asset-hub-archive-more]')).toBeNull();

    // 4. Fix 1 critical scenario: full list page 1 with next cursor -> search 'spring' starts (clears old rows/cursor) & FAILS ->
    //    old rows + '더 보기' MUST NOT stay under error -> Retry sends { query: 'spring' } with NO cursor & shows ONLY matches!
    archiveImpl = async (opts) => {
      calls.push(opts);
      return page1; // has next: 'cur-1'
    };
    await mounted.setValue('[data-asset-hub-archive-search]', 'reset');
    await mounted.submit('[data-asset-hub-archive-search-form]');
    await flush();
    expect(mounted.query('[data-asset-hub-archive-more]')).not.toBeNull();

    const springOnly: StudioBrandProjectArchive = {
      ok: true,
      total: 1,
      next: null,
      projects: [archiveRow(P_DONE, { title: 'Spring Only Match', status: 'archived', selectable: false })],
    };
    const pendingSearch = deferred<StudioBrandProjectArchive>();
    let rejectOrFail = true;
    archiveImpl = async (opts) => {
      calls.push(opts);
      if (rejectOrFail) return pendingSearch.promise;
      return springOnly;
    };

    await mounted.setValue('[data-asset-hub-archive-search]', 'spring');
    await mounted.submit('[data-asset-hub-archive-search-form]');
    // Immediately while loading: old rows and '더 보기' are cleared!
    expect(mounted.container.querySelectorAll('[data-asset-hub-archive-row]')).toHaveLength(0);
    expect(mounted.query('[data-asset-hub-archive-more]')).toBeNull();
    expect(mounted.query('[data-asset-hub-archive-loading]')).not.toBeNull();

    pendingSearch.resolve({ ok: false, code: 'failed' } as unknown as StudioBrandProjectArchive);
    await flush();
    expect(mounted.container.querySelectorAll('[data-asset-hub-archive-row]')).toHaveLength(0);
    expect(mounted.query('[data-asset-hub-archive-more]')).toBeNull();
    expect(mounted.container.textContent).toContain(sc.archiveFailed);

    // Retry repeats first page of 'spring' with NO cursor!
    rejectOrFail = false;
    await mounted.click('[data-asset-hub-archive-retry]');
    await flush();
    const retryCall = calls[calls.length - 1];
    expect(retryCall).toEqual({ query: 'spring' });
    expect('cursor' in (retryCall ?? {})).toBe(false);
    expect(mounted.container.querySelectorAll('[data-asset-hub-archive-row]')).toHaveLength(1);
    expect(mounted.container.textContent).toContain('Spring Only Match');
    expect(mounted.container.textContent).not.toContain('Row Beyond 100 Finished');

    // 5. Stale search response dropped: submit "alpha" (slow), then "beta" (fast) -> "beta" wins cleanly
    const slowAlpha = deferred<StudioBrandProjectArchive>();
    const betaRes: StudioBrandProjectArchive = {
      ok: true,
      total: 1,
      next: null,
      projects: [archiveRow(P_DONE, { title: 'Beta Winner', status: 'archived', selectable: false })],
    };
    archiveImpl = async (opts) => {
      calls.push(opts);
      if (opts?.query === 'alpha') return slowAlpha.promise;
      return betaRes;
    };

    await mounted.setValue('[data-asset-hub-archive-search]', 'alpha');
    await mounted.submit('[data-asset-hub-archive-search-form]');
    await mounted.setValue('[data-asset-hub-archive-search]', 'beta');
    await mounted.submit('[data-asset-hub-archive-search-form]');
    await flush();

    expect(mounted.container.textContent).toContain('Beta Winner');
    slowAlpha.resolve({
      ok: true,
      total: 1,
      next: null,
      projects: [archiveRow(P_OPEN, { title: 'Stale Alpha Should Drop' })],
    });
    await flush();
    expect(mounted.container.textContent).toContain('Beta Winner');
    expect(mounted.container.textContent).not.toContain('Stale Alpha Should Drop');

    // 6. Search fails -> Clear button clears search and loads unfiltered list without cursor -> error recovers on Retry
    archiveImpl = async (opts) => {
      calls.push(opts);
      if (opts?.query === 'doomed') return { ok: false, code: 'failed' };
      return page1;
    };
    await mounted.setValue('[data-asset-hub-archive-search]', 'doomed');
    await mounted.submit('[data-asset-hub-archive-search-form]');
    await flush();
    expect(mounted.container.textContent).toContain(sc.archiveFailed);

    await mounted.click('[data-asset-hub-archive-clear]');
    await flush();
    const afterClearCall = calls[calls.length - 1];
    expect(afterClearCall).toBeUndefined(); // full unfiltered list, no query, no cursor!
    expect(mounted.container.querySelectorAll('[data-asset-hub-archive-row]')).toHaveLength(2);
  });

  it('address wins in DOM: navigating to view=archive or back clears in-memory openedScope and never keeps archive open without view=archive', async () => {
    const d = getDictionary('ko');
    const sc = d.studioLibrary.hub.spine;
    const beyond100Page: StudioBrandProjectFiles = {
      ok: true,
      items: [{ type: 'job', id: job(1).id }],
      jobs: [job(1, { prompt: 'Deep Still', outputs: [output(1)], brandProjectId: P_OPEN })],
      assets: [],
      films: [],
      next: null,
      project: {
        id: P_OPEN,
        title: 'Open Top',
        origin: 'self',
        status: 'open',
        selectable: true,
        counts: emptyCounts({ image: 2 }),
      },
    };
    const fakeApi: StudioApi = {
      ...createStudioApi({ organizationId: ORG }),
      loadBrandProjectArchive: vi.fn(async () => ({
        ok: true as const,
        projects: [archiveRow(P_OPEN, { title: 'Open Top' })],
        next: null,
        total: 1,
      })),
      listBrandProjectFiles: vi.fn(async () => beyond100Page),
    };

    const renderWithInitial = (initialSpine?: { tab: 'by_project'; archive?: boolean; openedScope?: { kind: 'project'; brandProjectId: string } | null; page?: StudioBrandProjectFiles }) => (
      <BrandAssetHub
        organizationId={ORG}
        studioCopy={d.brandStudio}
        libraryCopy={d.studioLibrary}
        initialState={studioState({ canCreate: false })}
        spine={{
          overview: BASE_OVERVIEW,
          filter: 'active',
          canMove: false,
          copy: d.projectSpine,
          filmMeta: d.studioVideo.workspace.projects.meta,
        }}
        initialSpine={initialSpine}
        injectedLibrary={stubLibrary()}
        api={fakeApi}
      />
    );

    // 1. Start at ByProjectView, open a project in-memory (via group button)
    mounted = await mountDom(renderWithInitial(undefined));
    await flush();
    await mounted.click('[data-asset-hub-group-see-all]');
    await flush();
    expect(mounted.query(`[data-asset-hub-scope="project:${P_OPEN}"]`)).not.toBeNull();

    // 2. Navigate via address to ?view=archive -> address overrides in-memory openedScope!
    await mounted.rerender(renderWithInitial({ tab: 'by_project', archive: true }));
    await flush();
    expect(mounted.query('[data-asset-hub-archive]')).not.toBeNull();
    expect(mounted.query(`[data-asset-hub-scope="project:${P_OPEN}"]`)).toBeNull();
    // Viewer (canCreate: false): '파일 보기' exists, '스튜디오에서 열기' hidden
    expect(mounted.query(`[data-asset-hub-archive-open-files="${P_OPEN}"]`)).not.toBeNull();
    expect(mounted.query('[data-asset-hub-archive-open-studio]')).toBeNull();
    // Scope title rendered cleanly in Ko
    expect(mounted.container.textContent).toContain(sc.archiveTitle);

    // 3. Navigate back to plain /brand/library (no view=archive, no project) -> Archive closes and ByProjectView shows!
    await mounted.rerender(renderWithInitial(undefined));
    await flush();
    expect(mounted.query('[data-asset-hub-archive]')).toBeNull();
    expect(mounted.query('[data-asset-hub-archive-link]')).not.toBeNull();

    // 4. Open project via address (?project=P_OPEN), then Browser Back to ?view=archive -> ScopeView closes, Archive opens!
    await mounted.rerender(renderWithInitial({ tab: 'by_project', openedScope: { kind: 'project', brandProjectId: P_OPEN }, page: beyond100Page }));
    await flush();
    expect(mounted.query(`[data-asset-hub-scope="project:${P_OPEN}"]`)).not.toBeNull();
    await mounted.rerender(renderWithInitial({ tab: 'by_project', archive: true }));
    await flush();
    expect(mounted.query('[data-asset-hub-archive]')).not.toBeNull();
    expect(mounted.query(`[data-asset-hub-scope="project:${P_OPEN}"]`)).toBeNull();
  });
});

describe('Spine rules R-B Batch B source guards', () => {
  it('archive UI files use real next/link without e.preventDefault hijacks, no timers, no language guess, no hardcoded strings', () => {
    const ROOT = process.cwd();
    const archiveFiles = [
      'components/brand-studio/asset-hub-spine/archive-model.ts',
      'components/brand-studio/asset-hub-spine/archive-view.tsx',
    ];
    for (const rel of archiveFiles) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      expect(src, `${rel} no timers`).not.toMatch(/\b(setTimeout|setInterval)\b/);
      expect(src, `${rel} no raw brand_projects`).not.toContain('brand_projects');
      expect(src, `${rel} no VISIBLE_PROJECTS`).not.toContain('VISIBLE_PROJECTS');
      expect(src, `${rel} no hardcoded Hangul strings`).not.toMatch(/["'`][^"'`]*[가-힣]+[^"'`]*["'`]/);
    }

    const viewSrc = readFileSync(join(ROOT, 'components/brand-studio/asset-hub-spine/archive-view.tsx'), 'utf8');
    expect(viewSrc).toContain('from "next/link"');
    expect(viewSrc).not.toContain('label === "Assets"');
    expect(viewSrc).not.toContain('onBack');
    expect(viewSrc).not.toContain('onOpenProject');
    expect(viewSrc).not.toMatch(/=\s*\[\s*\]/);
    expect(viewSrc).not.toMatch(/=\s*\{\s*\}/);
    expect(viewSrc).not.toMatch(/use(?:Effect|Memo|Callback)\([\s\S]*?,\s*\[[^\]]*[\{\[][^\]]*\]\s*\)/);

    const byProjectSrc = readFileSync(join(ROOT, 'components/brand-studio/asset-hub-spine/by-project-view.tsx'), 'utf8');
    expect(byProjectSrc).toContain('from "next/link"');
    expect(byProjectSrc).not.toContain('onOpenArchive');

    const homeCardsSrc = readFileSync(join(ROOT, 'components/brand-workspace/home/project-cards/index.tsx'), 'utf8');
    expect(homeCardsSrc).toContain("from 'next/link'");

    const spineIndexSrc = readFileSync(join(ROOT, 'components/brand-studio/asset-hub-spine/index.tsx'), 'utf8');
    const syncMatch = spineIndexSrc.match(/prevAddressKeyRef\.current = addressKey;[\s\S]*?\},\s*\[([^\]]*)\]\s*\)/);
    expect(syncMatch).not.toBeNull();
    expect(syncMatch![1]).not.toContain('initialOpenedScope');
    expect(syncMatch![1]).not.toMatch(/[\{\[]/);
  });
});
