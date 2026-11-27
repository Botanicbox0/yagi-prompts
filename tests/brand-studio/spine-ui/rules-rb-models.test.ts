import { describe, expect, it } from 'vitest';
import {
  archiveBodyKind,
  archiveReducer,
  archiveRowCanOpenStudio,
  archiveRowCover,
  archiveRowFilesHref,
  archiveRowStudioHref,
  formatArchiveActivityDate,
  initialArchiveState,
  isFinishedArchiveRow,
  mergeArchivePage,
  parseLibraryView,
  shouldReadArchiveFirstPage,
} from '@/components/brand-studio/asset-hub-spine/archive-model';
import {
  brandArchiveHref,
  initialScopePageState,
  libraryByProjectHref,
  projectGroupFromSummary,
  scopePageReducer,
  unlistedProjectCount,
} from '@/components/brand-studio/asset-hub-spine/model';
import type {
  StudioBrandProjectArchive,
  StudioBrandProjectArchiveCard,
  StudioBrandProjectCounts,
  StudioBrandProjectFiles,
  StudioBrandProjectSummary,
} from '@/lib/brand-studio/contracts';
import { ORG, asset, id, job } from '../ui/fixtures';

const emptyCounts = (over: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...over,
});

const archiveCard = (
  projId: string,
  over: Partial<StudioBrandProjectArchiveCard> = {},
): StudioBrandProjectArchiveCard => ({
  project: {
    id: projId,
    title: `Project ${projId.slice(0, 6)}`,
    origin: 'self',
    lastActivityAt: '2026-11-26T10:00:00.000Z',
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

describe('Spine rules R-B pure UI models', () => {
  it('unlistedProjectCount returns totals[filter] - listed[filter] clamped >= 0 and 0 when absent', () => {
    expect(unlistedProjectCount(undefined, 'active')).toBe(0);
    expect(unlistedProjectCount({ totals: { active: 10, all: 15 } }, 'active')).toBe(0);
    expect(
      unlistedProjectCount({ totals: { active: 12, all: 18 }, listed: { active: 12, all: 18 } }, 'active'),
    ).toBe(0);
    expect(
      unlistedProjectCount({ totals: { active: 105, all: 130 }, listed: { active: 100, all: 100 } }, 'active'),
    ).toBe(5);
    expect(
      unlistedProjectCount({ totals: { active: 105, all: 130 }, listed: { active: 100, all: 100 } }, 'all'),
    ).toBe(30);
    expect(
      unlistedProjectCount({ totals: { active: 50, all: 112 }, listed: { active: 50, all: 100 } }, 'all'),
    ).toBe(12);
    expect(
      unlistedProjectCount({ totals: { active: 50, all: 112 }, listed: { active: 50, all: 100 } }, 'active'),
    ).toBe(0);
    expect(
      unlistedProjectCount({ totals: { active: 99, all: 99 }, listed: { active: 100, all: 100 } }, 'active'),
    ).toBe(0);
  });

  it('address helpers parse ?view=archive and build library / archive / row links cleanly', () => {
    expect(parseLibraryView(undefined)).toBeNull();
    expect(parseLibraryView('other')).toBeNull();
    expect(parseLibraryView('archive')).toBe('archive');
    expect(parseLibraryView(['  archive  '])).toBe('archive');

    expect(brandArchiveHref(ORG)).toBe(`/brand/library?organizationId=${ORG}&view=archive`);
    expect(libraryByProjectHref(ORG)).toBe(`/brand/library?organizationId=${ORG}`);

    const pid = id(0xa1);
    expect(archiveRowFilesHref(ORG, pid)).toBe(`/brand/library?organizationId=${ORG}&project=${pid}`);
    expect(archiveRowStudioHref(ORG, pid)).toBe(`/brand/studio?organizationId=${ORG}&project=${pid}`);
  });

  it('mergeArchivePage & archiveReducer deduplicate rows, clear rows/cursor on start_first, and track failedKind (first vs more)', () => {
    const P1 = id(0xb1);
    const P2 = id(0xb2);
    const P3 = id(0xb3);

    const page1: StudioBrandProjectArchive = {
      ok: true,
      projects: [archiveCard(P1), archiveCard(P2)],
      next: 'cur-1',
      total: 3,
    };
    const s1 = mergeArchivePage(initialArchiveState(), 'replace', page1);
    expect(s1.phase).toBe('ready');
    expect(s1.projects.map((p) => p.project.id)).toEqual([P1, P2]);
    expect(s1.next).toBe('cur-1');
    expect(s1.total).toBe(3);
    expect(s1.failedKind).toBeNull();

    // Starting a new/cleared search clears rows, cursor, and total immediately
    const searchStarting = archiveReducer(s1, { type: 'start_first' });
    expect(searchStarting).toEqual({
      phase: 'loading',
      projects: [],
      next: null,
      total: 0,
      errorCode: null,
      failedKind: null,
    });
    const searchFailed = archiveReducer(searchStarting, { type: 'failed', kind: 'first', code: 'failed' });
    expect(searchFailed).toEqual({
      phase: 'failed',
      projects: [],
      next: null,
      total: 0,
      errorCode: 'failed',
      failedKind: 'first',
    });

    // Concurrent project.move out caused P1 (even uppercase UUID) to re-appear on page 2 -> deduplicated cleanly
    const page2: StudioBrandProjectArchive = {
      ok: true,
      projects: [archiveCard(P1.toUpperCase()), archiveCard(P3)],
      next: null,
      total: 3,
    };
    const s1LoadingMore = archiveReducer(s1, { type: 'start_more' });
    expect(s1LoadingMore.phase).toBe('loading_more');
    const failedMore = archiveReducer(s1LoadingMore, { type: 'failed', kind: 'more', code: 'failed' });
    expect(failedMore.phase).toBe('failed');
    expect(failedMore.failedKind).toBe('more');
    expect(failedMore.projects).toHaveLength(2);
    expect(failedMore.next).toBe('cur-1');

    const s2 = archiveReducer(s1LoadingMore, { type: 'loaded', mode: 'append', page: page2 });
    expect(s2.projects.map((p) => p.project.id)).toEqual([P1, P2, P3]);
    expect(s2.next).toBeNull();
    expect(s2.failedKind).toBeNull();
  });

  it('archive row predicates (including canCreate for viewer vs editor), cover rules, body kind, and Asia/Seoul date formatting', () => {
    const openSelf = archiveCard(id(0xc1), { status: 'open', selectable: true });
    const doneSelf = archiveCard(id(0xc2), { status: 'archived', selectable: false });
    const doneTeam = archiveCard(id(0xc3), { status: 'completed', selectable: false });

    expect(isFinishedArchiveRow(openSelf)).toBe(false);
    expect(isFinishedArchiveRow(doneSelf)).toBe(true);
    expect(isFinishedArchiveRow(doneTeam)).toBe(true);

    expect(archiveRowCanOpenStudio(openSelf, true, true)).toBe(true);
    expect(archiveRowCanOpenStudio(openSelf, true, false)).toBe(false); // viewer cannot create
    expect(archiveRowCanOpenStudio(openSelf, false, true)).toBe(false);
    expect(archiveRowCanOpenStudio(doneSelf, true, true)).toBe(false);
    expect(archiveRowCanOpenStudio(doneTeam, true, true)).toBe(false);

    // Never put an mp4 url in <img>; prefer thumbUrl for image or video
    expect(archiveRowCover([])).toBeNull();
    expect(
      archiveRowCover([{ source: 'result', id: '1', kind: 'image', url: '/img.png', thumbUrl: '/img-sm.webp', width: 100, height: 100 }]),
    ).toEqual({ kind: 'image', src: '/img-sm.webp' });
    expect(
      archiveRowCover([{ source: 'result', id: '2', kind: 'video', url: '/vid.mp4', thumbUrl: '/vid-thumb.webp', width: 100, height: 100 }]),
    ).toEqual({ kind: 'image', src: '/vid-thumb.webp' });
    expect(
      archiveRowCover([{ source: 'result', id: '3', kind: 'video', url: '/vid.mp4', thumbUrl: null, width: 100, height: 100 }]),
    ).toEqual({ kind: 'video', url: '/vid.mp4' });

    // Asia/Seoul date formatting across same year & previous year
    const now = new Date('2026-11-27T02:00:00.000Z');
    const twoHoursAgo = formatArchiveActivityDate('2026-11-27T00:00:00.000Z', 'ko', now);
    expect(twoHoursAgo).toContain('2시간 전');
    // 2025-12-31T20:00:00Z is 2026-01-01 05:00 Asia/Seoul (same Seoul year 2026!) vs 2025-12-31T10:00:00Z (Seoul year 2025 -> includes year)
    const olderYear = formatArchiveActivityDate('2025-11-10T10:00:00.000Z', 'ko', now);
    expect(olderYear).toContain('2025');
    const olderYearEn = formatArchiveActivityDate('2025-11-10T10:00:00.000Z', 'en', now);
    expect(olderYearEn).toContain('2025');

    expect(archiveBodyKind({ phase: 'loading', projects: [] }, '')).toBe('loading_initial');
    expect(archiveBodyKind({ phase: 'failed', projects: [] }, '')).toBe('failed_initial');
    expect(archiveBodyKind({ phase: 'ready', projects: [] }, 'spring')).toBe('empty_search');
    expect(archiveBodyKind({ phase: 'ready', projects: [] }, '')).toBe('empty_none');
    expect(archiveBodyKind({ phase: 'failed', projects: [openSelf] }, '')).toBe('rows');

    expect(shouldReadArchiveFirstPage(null, { organizationId: ORG, query: '', refreshNonce: 0 })).toBe(true);
    expect(
      shouldReadArchiveFirstPage(
        { organizationId: ORG, query: '', refreshNonce: 0 },
        { organizationId: ORG, query: '', refreshNonce: 0 },
      ),
    ).toBe(false);
    expect(
      shouldReadArchiveFirstPage(
        { organizationId: ORG, query: '', refreshNonce: 0 },
        { organizationId: ORG, query: 'spring', refreshNonce: 0 },
      ),
    ).toBe(true);
  });

  it('ScopePageState captures page-1 project summary and preserves it across append', () => {
    const pid = id(0xd1);
    const summary: StudioBrandProjectSummary = {
      id: pid,
      title: 'Archived Beyond 100',
      origin: 'self',
      status: 'archived',
      selectable: false,
      counts: emptyCounts({ image: 3, upload: 1 }),
    };
    const p1: StudioBrandProjectFiles = {
      ok: true,
      items: [{ type: 'job', id: job(1).id }],
      jobs: [job(1, { brandProjectId: pid })],
      assets: [],
      films: [],
      next: 'cur-2',
      project: summary,
    };
    const s1 = initialScopePageState(p1);
    expect(s1.projectSummary).toEqual(summary);

    const p2: StudioBrandProjectFiles = {
      ok: true,
      items: [{ type: 'asset', id: asset(2).id }],
      jobs: [],
      assets: [asset(2, { brandProjectId: pid })],
      films: [],
      next: null,
    };
    const s2 = scopePageReducer(s1, { type: 'loaded', mode: 'append', page: p2 });
    expect(s2.projectSummary).toEqual(summary);

    const group = projectGroupFromSummary(summary);
    expect(group.project.title).toBe('Archived Beyond 100');
    expect(group.status).toBe('archived');
    expect(group.selectable).toBe(false);
    expect(group.counts).toEqual(summary.counts);
  });
});
