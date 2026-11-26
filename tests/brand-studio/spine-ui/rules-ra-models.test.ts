import { describe, expect, it } from 'vitest';
import { buildHubEntries, hubActions, hubEntryToSendRef } from '@/components/brand-studio/asset-hub-model';
import {
  finishedFilesSummary,
  finishedScopeControls,
  initialSpineTab,
  isFinishedProjectGroup,
  libraryProjectsSwitch,
  orderOverviewProjects,
  parseLibraryProjectsFilter,
  planResultDelete,
  planSpineRefresh,
  projectGroupStatusMark,
  resolveScopeDialogScope,
  resolveSingleMoveProjectId,
  resultDeleteErrorMessage,
  selectableMoveProjects,
} from '@/components/brand-studio/asset-hub-spine/model';
import { applyScopeControlsToActions, finishedScopeControlsForKey } from '@/components/brand-studio/asset-hub-spine/scope-actions';
import {
  cardHref,
  cardStatusMark,
  homeProjectsSwitch,
  isFinishedCard,
  parseProjectsFilter,
  type ProjectCardsCopy,
} from '@/components/brand-workspace/home/project-cards/model';
import type {
  StudioBrandProjectCard,
  StudioBrandProjectCounts,
  StudioBrandProjectGroup,
  StudioBrandProjectOverview,
} from '@/lib/brand-studio/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { ORG, asset, id, job, output } from '../ui/fixtures';

const P_ACTIVE_SELF = id(0x11);
const P_DONE_SELF = id(0x12);
const P_ACTIVE_TEAM = id(0x13);
const P_DONE_TEAM = id(0x14);
const P_CANCELLED_TEAM = id(0x15);

const emptyCounts = (over: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...over,
});

const cardsCopy = (locale: 'ko' | 'en'): ProjectCardsCopy => {
  const d = getDictionary(locale);
  return {
    projectHome: d.projectHome,
    projectSpine: d.projectSpine,
    libraryHub: d.studioLibrary.hub,
    roomsOverview: d.roomsShell.overview,
  };
};

const makeCard = (patch: Partial<StudioBrandProjectCard> & { id: string; origin?: 'self' | 'team' }): StudioBrandProjectCard => ({
  project: {
    id: patch.id,
    title: patch.project?.title ?? 'Project',
    origin: patch.origin ?? patch.project?.origin ?? 'self',
    lastActivityAt: patch.project?.lastActivityAt ?? '2026-11-26T00:00:00Z',
  },
  counts: patch.counts ?? emptyCounts(),
  covers: patch.covers ?? [],
  lastActivity: patch.lastActivity ?? null,
  unread: patch.unread ?? 0,
  stage: patch.stage ?? null,
  ...('status' in patch ? { status: patch.status } : {}),
  ...('selectable' in patch ? { selectable: patch.selectable } : {}),
});

const makeGroup = (patch: Partial<StudioBrandProjectGroup> & { id: string; origin?: 'self' | 'team'; title?: string }): StudioBrandProjectGroup => ({
  project: {
    id: patch.id,
    title: patch.title ?? 'Project',
    origin: patch.origin ?? 'self',
    lastActivityAt: '2026-11-26T00:00:00Z',
  },
  counts: patch.counts ?? emptyCounts(),
  covers: patch.covers ?? [],
  ...('status' in patch ? { status: patch.status } : {}),
  ...('selectable' in patch ? { selectable: patch.selectable } : {}),
});

const makeOverview = (patch: Partial<StudioBrandProjectOverview> = {}): StudioBrandProjectOverview => ({
  ok: true,
  projects: [],
  unfiled: { counts: emptyCounts(), covers: [] },
  brandMaterials: {
    count: 0,
    byRole: { product: 0, person: 0, logo: 0, style: 0, place: 0 },
    covers: [],
  },
  ...patch,
});

describe('Spine rules R-A home project-cards/model', () => {
  it('parses ?projects parameter to active or all', () => {
    expect(parseProjectsFilter(undefined)).toBe('active');
    expect(parseProjectsFilter('')).toBe('active');
    expect(parseProjectsFilter('active')).toBe('active');
    expect(parseProjectsFilter('weird')).toBe('active');
    expect(parseProjectsFilter('all')).toBe('all');
    expect(parseProjectsFilter(['all', 'active'])).toBe('all');
    expect(parseProjectsFilter(['active', 'all'])).toBe('active');
  });

  it('draws the switch only when totals is present and active !== all, with link targets', () => {
    const ko = cardsCopy('ko').projectHome;
    expect(homeProjectsSwitch({}, 'active', ORG, ko)).toBeNull();
    expect(homeProjectsSwitch({ totals: { active: 3, all: 3 } }, 'active', ORG, ko)).toBeNull();
    expect(homeProjectsSwitch({ totals: { active: 0, all: 0 } }, 'active', ORG, ko)).toBeNull();

    const onActive = homeProjectsSwitch({ totals: { active: 2, all: 5 } }, 'active', ORG, ko)!;
    expect(onActive.active).toEqual({
      key: 'active',
      label: '진행 중',
      count: 2,
      href: `/brand/home?organizationId=${ORG}`,
      current: true,
    });
    expect(onActive.all).toEqual({
      key: 'all',
      label: '전체',
      count: 5,
      href: `/brand/home?organizationId=${ORG}&projects=all`,
      current: false,
    });

    const onAll = homeProjectsSwitch({ totals: { active: 0, all: 2 } }, 'all', ORG, cardsCopy('en').projectHome)!;
    expect(onAll.active.label).toBe('Active');
    expect(onAll.active.count).toBe(0);
    expect(onAll.active.current).toBe(false);
    expect(onAll.all.label).toBe('All');
    expect(onAll.all.count).toBe(2);
    expect(onAll.all.current).toBe(true);
  });

  it('marks finished statuses with finishedMark and keeps active/legacy cards unmarked', () => {
    const ko = cardsCopy('ko').projectHome;
    const en = cardsCopy('en').projectHome;

    expect(isFinishedCard(makeCard({ id: P_ACTIVE_SELF }))).toBe(false);
    expect(isFinishedCard(makeCard({ id: P_ACTIVE_SELF, status: 'open', selectable: true }))).toBe(false);
    expect(cardStatusMark(makeCard({ id: P_ACTIVE_SELF, status: 'open', selectable: true }), ko)).toBeNull();

    for (const status of ['archived', 'completed', 'cancelled'] as const) {
      const card = makeCard({ id: P_DONE_SELF, status, selectable: false });
      expect(isFinishedCard(card)).toBe(true);
      expect(cardStatusMark(card, ko)).toBe('끝난 프로젝트');
      expect(cardStatusMark(card, en)).toBe('Finished');
    }
  });

  it('routes finished own cards to /brand/library?project=<id>, active own cards to studio, and team cards to room/project', () => {
    const activeSelf = makeCard({ id: P_ACTIVE_SELF, origin: 'self', status: 'open', selectable: true });
    const doneSelf = makeCard({ id: P_DONE_SELF, origin: 'self', status: 'archived', selectable: false });
    const doneTeam = makeCard({ id: P_DONE_TEAM, origin: 'team', status: 'completed', selectable: false });

    expect(cardHref(activeSelf, ORG, true)).toBe(`/brand/studio?organizationId=${ORG}&project=${P_ACTIVE_SELF}`);
    expect(cardHref(doneSelf, ORG, true)).toBe(`/brand/library?organizationId=${ORG}&project=${P_DONE_SELF}`);
    expect(cardHref(doneTeam, ORG, true)).toBe(`/brand/rooms/${P_DONE_TEAM}?organizationId=${ORG}`);
    expect(cardHref(doneTeam, ORG, false)).toBe(`/brand/projects/${P_DONE_TEAM}?organizationId=${ORG}`);
  });
});

describe('Spine rules R-A assets asset-hub-spine/model', () => {
  it('parses filter, builds library switch, orders active groups before finished groups on all', () => {
    const d = getDictionary('ko');
    const spineCopy = d.studioLibrary.hub.spine;

    expect(parseLibraryProjectsFilter(undefined)).toBe('active');
    expect(parseLibraryProjectsFilter('all')).toBe('all');
    expect(parseLibraryProjectsFilter('other')).toBe('active');

    const noDiff = makeOverview({ totals: { active: 2, all: 2 } });
    expect(libraryProjectsSwitch(noDiff, 'active', ORG, { active: spineCopy.viewActive, all: spineCopy.viewAll })).toBeNull();

    const withFinished = makeOverview({ totals: { active: 2, all: 4 } });
    const sw = libraryProjectsSwitch(withFinished, 'all', ORG, { active: spineCopy.viewActive, all: spineCopy.viewAll })!;
    expect(sw.active.href).toBe(`/brand/library?organizationId=${ORG}`);
    expect(sw.active.count).toBe(2);
    expect(sw.active.current).toBe(false);
    expect(sw.all.href).toBe(`/brand/library?organizationId=${ORG}&projects=all`);
    expect(sw.all.count).toBe(4);
    expect(sw.all.current).toBe(true);

    const gFinishedNewer = makeGroup({ id: P_DONE_SELF, title: 'Winter', origin: 'self', status: 'archived', selectable: false });
    const gActive1 = makeGroup({ id: P_ACTIVE_SELF, title: 'Summer', origin: 'self', status: 'open', selectable: true });
    const gCancelledTeam = makeGroup({ id: P_CANCELLED_TEAM, title: 'Spring', origin: 'team', status: 'cancelled', selectable: false });
    const gActive2 = makeGroup({ id: P_ACTIVE_TEAM, title: 'Autumn', origin: 'team', status: 'open', selectable: true });

    const mixed = [gFinishedNewer, gActive1, gCancelledTeam, gActive2];
    expect(orderOverviewProjects(mixed, 'all').map((g) => g.project.id)).toEqual([
      P_ACTIVE_SELF,
      P_ACTIVE_TEAM,
      P_DONE_SELF,
      P_CANCELLED_TEAM,
    ]);
    expect(orderOverviewProjects(mixed, 'active').map((g) => g.project.id)).toEqual([
      P_DONE_SELF,
      P_ACTIVE_SELF,
      P_CANCELLED_TEAM,
      P_ACTIVE_TEAM,
    ]);
    expect(isFinishedProjectGroup(gFinishedNewer)).toBe(true);
    expect(projectGroupStatusMark(gFinishedNewer, spineCopy.finishedMark)).toBe('끝난 프로젝트');
    expect(projectGroupStatusMark(gActive1, spineCopy.finishedMark)).toBeNull();
    expect(selectableMoveProjects(mixed).map((p) => p.id)).toEqual([P_ACTIVE_SELF, P_ACTIVE_TEAM]);
  });

  it('computes finishedFilesSummary only on active when finished counts sum > 0 and opens by_project when finished projects exist', () => {
    const ov = makeOverview({
      finished: { counts: emptyCounts({ image: 2, film: 1 }) },
      totals: { active: 0, all: 1 },
    });
    expect(finishedFilesSummary(ov, 'active', ORG)).toEqual({
      count: 3,
      href: `/brand/library?organizationId=${ORG}&projects=all`,
    });
    expect(finishedFilesSummary(ov, 'all', ORG)).toBeNull();
    expect(finishedFilesSummary(makeOverview({ finished: { counts: emptyCounts() } }), 'active', ORG)).toBeNull();
    expect(initialSpineTab(ov, false)).toBe('by_project');
    expect(initialSpineTab(makeOverview(), false)).toBe('all');
  });

  it('returns finishedScopeControls, result delete plan, and result_delete refresh plan cleanly', () => {
    const ko = getDictionary('ko').brandStudio;
    expect(finishedScopeControls(true)).toEqual({
      showFinishedHint: true,
      canAddWork: false,
      canView: true,
      canDownload: true,
      canSend: true,
      canMoveOut: true,
    });
    expect(finishedScopeControls(false).showFinishedHint).toBe(false);
    expect(finishedScopeControls(false).canAddWork).toBe(true);

    const pairedCopy = asset(1, { source: 'generation', sourceOutputId: output(1).id });
    const dedupedUpload = asset(1, { source: 'upload' });
    const otherCopy = asset(1, { source: 'generation', sourceOutputId: output(9).id });

    // Paired saved copy (savedAssetId + sourceOutputId === output.id) -> line + flag
    expect(planResultDelete({ id: output(1).id, savedAssetId: asset(1).id }, [pairedCopy])).toEqual({
      outputId: output(1).id,
      withSavedCopy: true,
      showDeleteBothLine: true,
    });
    // Genuine upload pointing via savedAssetId (no sourceOutputId) -> no line, no flag
    expect(planResultDelete({ id: output(1).id, savedAssetId: asset(1).id }, [dedupedUpload])).toEqual({
      outputId: output(1).id,
      withSavedCopy: false,
      showDeleteBothLine: false,
    });
    // Another output's saved copy -> no line, no flag
    expect(planResultDelete({ id: output(1).id, savedAssetId: asset(1).id }, [otherCopy])).toEqual({
      outputId: output(1).id,
      withSavedCopy: false,
      showDeleteBothLine: false,
    });
    // Missing loaded studio state -> no line, no flag
    expect(planResultDelete({ id: output(1).id, savedAssetId: asset(1).id }, [])).toEqual({
      outputId: output(1).id,
      withSavedCopy: false,
      showDeleteBothLine: false,
    });
    // No savedAssetId -> no line, no flag
    expect(planResultDelete({ id: output(2).id, savedAssetId: null }, [pairedCopy])).toEqual({
      outputId: output(2).id,
      withSavedCopy: false,
      showDeleteBothLine: false,
    });

    expect(resultDeleteErrorMessage('conflict', ko)).toBe(ko.viewer.deleteBusy);
    expect(resultDeleteErrorMessage('forbidden', ko)).toBe(ko.errors.forbidden);

    expect(planSpineRefresh('result_delete', true)).toEqual({
      reloadOverview: true,
      reloadStudioState: true,
      restartOpenScope: true,
    });
  });

  it('keeps one tile per saved result and maps 보내기 to the result reference { kind: output, outputId }', () => {
    const ko = getDictionary('ko');
    const out = output(1, { savedAssetId: asset(1).id });
    const run = job(1, { kind: 'image', prompt: 'Hero bottle still', outputs: [out] });
    const savedCopy = asset(1, {
      name: 'Hero bottle still',
      source: 'generation',
      sourceOutputId: out.id,
      brandProjectId: P_ACTIVE_SELF,
    });

    const entries = buildHubEntries([savedCopy], [run], ko.studioLibrary.hub.sourceGenerated);
    expect(entries.map((e) => e.key)).toEqual([`o:${out.id}`]);
    expect(hubEntryToSendRef(entries[0], run)).toEqual({ kind: 'output', outputId: out.id });
  });

  it('filters studio/edit/share/similar actions per tile kind via finishedScopeControls and leaves active actions identical', () => {
    const d = getDictionary('ko');
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
    const outImg = output(11, { kind: 'image' });
    const outVid = output(12, { kind: 'video' });
    const outSnd = output(13, { kind: 'audio' });
    const run = job(11, { outputs: [outImg, outVid, outSnd] });
    const upImg = asset(21, { kind: 'image' });
    const upVid = asset(22, { kind: 'video' });
    const upAud = asset(23, { kind: 'audio' });
    const allEntries = buildHubEntries([upImg, upVid, upAud], [run], h.sourceGenerated);

    const active = finishedScopeControls(false);
    const finished = finishedScopeControls(true);

    for (const entry of allEntries) {
      const raw = hubActions(entry, {
        organizationId: ORG,
        canOpenStudio: true,
        canCreate: true,
        copy: actionCopy,
        moveProjectLabel: d.projectSpine.move,
      });
      // Active scope preserves exact reference/shape
      expect(applyScopeControlsToActions(raw, active)).toBe(raw);

      // Finished scope keeps ONLY projectMove in more and drops main + all studio/edit/share/similar keys
      const restricted = applyScopeControlsToActions(raw, finished);
      expect(restricted.main).toBeNull();
      expect(restricted.more.map((a) => a.key)).toEqual(['projectMove']);
    }

    const overview = makeOverview({
      projects: [
        makeGroup({ id: P_ACTIVE_SELF, origin: 'self', status: 'open', selectable: true }),
        makeGroup({ id: P_DONE_SELF, origin: 'self', status: 'archived', selectable: false }),
      ],
    });
    expect(finishedScopeControlsForKey(`project:${P_DONE_SELF.toUpperCase()}`, overview).canAddWork).toBe(false);
    expect(finishedScopeControlsForKey(`project:${P_ACTIVE_SELF}`, overview).canAddWork).toBe(true);
    expect(finishedScopeControlsForKey('all', overview).canAddWork).toBe(true);
  });

  it('resolves MoveDialog current project from openedScope, overview covers, or unknown when finished files exist', () => {
    const outDone = output(31, { kind: 'image' });
    const runDone = job(31, { outputs: [outDone], brandProjectId: null });
    const uploadDone = asset(32, { brandProjectId: null });
    const outUnfiled = output(33, { kind: 'image' });
    const runUnfiled = job(33, { outputs: [outUnfiled], brandProjectId: null });

    const doneEntries = buildHubEntries([uploadDone], [runDone, runUnfiled], 'Generated');
    const eDoneRun = doneEntries.find((e) => e.output?.id === outDone.id)!;
    const eDoneUpload = doneEntries.find((e) => e.asset?.id === uploadDone.id)!;
    const eUnfiledRun = doneEntries.find((e) => e.output?.id === outUnfiled.id)!;

    const overviewWithDoneAndActiveCover = makeOverview({
      projects: [
        makeGroup({
          id: P_ACTIVE_SELF,
          status: 'open',
          selectable: true,
        }),
        makeGroup({
          id: P_DONE_SELF,
          status: 'archived',
          selectable: false,
          covers: [
            {
              outputId: outDone.id,
              jobId: runDone.id,
              kind: 'image',
              url: outDone.url,
              thumbUrl: outDone.thumbUrl,
              width: 1600,
              height: 1200,
              createdAt: outDone.createdAt,
            },
          ],
        }),
      ],
      unfiled: {
        counts: emptyCounts({ image: 1 }),
        covers: [
          {
            outputId: outUnfiled.id,
            jobId: runUnfiled.id,
            kind: 'image',
            url: outUnfiled.url,
            thumbUrl: outUnfiled.thumbUrl,
            width: 1600,
            height: 1200,
            createdAt: outUnfiled.createdAt,
          },
        ],
      },
      finished: { counts: emptyCounts({ image: 1, upload: 1 }) },
      totals: { active: 1, all: 2 },
    });

    // Inside opened active project scope -> returns active selectable project id
    expect(
      resolveSingleMoveProjectId(eDoneUpload, null, {
        activeTab: 'by_project',
        openedScope: { kind: 'project', brandProjectId: P_ACTIVE_SELF },
        overview: overviewWithDoneAndActiveCover,
      }),
    ).toBe(P_ACTIVE_SELF);

    // Inside opened finished project scope -> returns undefined ({ kind: 'unknown' }) so MoveToProjectDialog sends 0 previews on open
    expect(
      resolveSingleMoveProjectId(eDoneUpload, null, {
        activeTab: 'by_project',
        openedScope: { kind: 'project', brandProjectId: P_DONE_SELF },
        overview: overviewWithDoneAndActiveCover,
      }),
    ).toBeUndefined();

    // On 모든 파일: finished project's cover resolves to undefined ({ kind: 'unknown' }), NEVER finished project id and NEVER unfiled null
    expect(
      resolveSingleMoveProjectId(eDoneRun, null, {
        activeTab: 'all',
        openedScope: null,
        overview: overviewWithDoneAndActiveCover,
      }),
    ).toBeUndefined();

    // On 모든 파일: active reportedProjectId still resolves to active project id
    expect(
      resolveSingleMoveProjectId(eDoneRun, P_ACTIVE_SELF, {
        activeTab: 'all',
        openedScope: null,
        overview: overviewWithDoneAndActiveCover,
      }),
    ).toBe(P_ACTIVE_SELF);

    // On 모든 파일: confirmed unfiled cover keeps null (unfiled)
    expect(
      resolveSingleMoveProjectId(eUnfiledRun, null, {
        activeTab: 'all',
        openedScope: null,
        overview: overviewWithDoneAndActiveCover,
      }),
    ).toBeNull();

    // On 모든 파일: non-cover upload while finished files exist -> undefined (unknown) instead of false 미분류
    expect(
      resolveSingleMoveProjectId(eDoneUpload, null, {
        activeTab: 'all',
        openedScope: null,
        overview: overviewWithDoneAndActiveCover,
      }),
    ).toBeUndefined();

    // On 모든 파일 with zero finished files -> keeps null (unfiled)
    expect(
      resolveSingleMoveProjectId(eDoneUpload, null, {
        activeTab: 'all',
        openedScope: null,
        overview: makeOverview({ finished: { counts: emptyCounts() }, totals: { active: 1, all: 1 } }),
      }),
    ).toBeNull();
  });

  it('resolveScopeDialogScope returns unknown for finished or non-selectable projects and keeps active/unfiled/materials intact', () => {
    const selectable = selectableMoveProjects([
      makeGroup({ id: P_ACTIVE_SELF, status: 'open', selectable: true }),
      makeGroup({ id: P_DONE_SELF, status: 'archived', selectable: false }),
    ]);

    expect(resolveScopeDialogScope('project', P_ACTIVE_SELF, false, selectable)).toEqual({
      kind: 'project',
      id: P_ACTIVE_SELF,
    });
    expect(resolveScopeDialogScope('project', P_ACTIVE_SELF.toUpperCase(), false, selectable)).toEqual({
      kind: 'project',
      id: P_ACTIVE_SELF,
    });
    expect(resolveScopeDialogScope('project', P_DONE_SELF, true, selectable)).toEqual({ kind: 'unknown' });
    expect(resolveScopeDialogScope('project', P_DONE_SELF, false, selectable)).toEqual({ kind: 'unknown' });
    expect(resolveScopeDialogScope('unfiled', '', false, selectable)).toEqual({ kind: 'unfiled' });
    expect(resolveScopeDialogScope('brand_materials', '', false, selectable)).toEqual({ kind: 'brand_materials' });
  });
});
