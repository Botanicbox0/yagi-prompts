import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomAlertItem } from '@/components/brand-rooms/seams';
import { WorkspaceHome, type WorkspaceHomeProps } from '@/components/brand-workspace/home/home-view';
import { HomeProjectCards, NewProjectTrigger } from '@/components/brand-workspace/home/project-cards';
import type { SpineHomeProps } from '@/components/brand-workspace/home/project-cards/model';
import type {
  StudioBrandProjectCard,
  StudioBrandProjectCardCover,
  StudioBrandProjectCounts,
  StudioBrandProjectCover,
} from '@/lib/brand-studio/contracts';
import type { FirstRunChecklistState } from '@/lib/brands/workspace/home-checklist';
import { homeLayout, type HomeLayout, type HomeResult } from '@/lib/brands/workspace/home';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const NAME = 'Fern & Field';
const NOW = new Date('2026-11-26T12:00:00.000Z');
const P_SELF = '10000000-0000-4000-8000-000000000001';
const P_TEAM = '10000000-0000-4000-8000-000000000002';
const P_VID = '10000000-0000-4000-8000-000000000003';
const P_EMPTY = '10000000-0000-4000-8000-000000000004';
const P_TEAM_CLOSED = '10000000-0000-4000-8000-000000000005';

const htmlEscape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;

const copyOf = (locale: 'ko' | 'en'): Extract<WorkspaceHomeProps, { spineHome: SpineHomeProps }>['copy'] => {
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
    projectHome: d.projectHome,
    projectSpine: d.projectSpine,
    libraryHub: d.studioLibrary.hub,
    roomsOverview: d.roomsShell.overview,
  };
};

type Role = 'owner' | 'editor' | 'viewer';
const layoutOf = (role: Role, rooms = true): HomeLayout =>
  homeLayout({ choice: { id: ORG, name: NAME, role }, flagOn: true, canRequest: role !== 'viewer', rooms })!;

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
  {
    project: { id: P_TEAM_CLOSED, title: '룸 닫힌 팀 프로젝트', origin: 'team', lastActivityAt: '2026-11-26T06:00:00.000Z' },
    counts: emptyCounts(),
    covers: [],
    lastActivity: null,
    unread: 0,
    stage: null,
  },
];

const WALL: HomeResult[] = [
  {
    outputId: '00000000-0000-4000-8000-000000000011',
    kind: 'image',
    src: '/m/wall-1.webp',
    clip: null,
    play: null,
    width: 800,
    height: 1000,
    seconds: null,
    href: `/brand/studio?organizationId=${ORG}&view=o%3A00000000-0000-4000-8000-000000000011`,
  },
];

const REVIEW: RoomAlertItem = {
  id: 'alert-1',
  kind: 'review',
  projectId: P_TEAM,
  projectTitle: '겨울 립 컬렉션 필름',
  targetId: 't1',
  title: '시안 1',
  version: 1,
  openNotes: 0,
  updatedAt: '2026-11-26T00:00:00.000Z',
};

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

function renderSpineHome(opts: {
  locale?: 'ko' | 'en';
  role?: Role;
  rooms?: boolean;
  spineHome: SpineHomeProps;
  results?: HomeResult[];
  checklist?: FirstRunChecklistState | null;
}) {
  const locale = opts.locale ?? 'ko';
  const role = opts.role ?? 'owner';
  return renderToStaticMarkup(
    <WorkspaceHome
      organizationId={ORG}
      organizationName={NAME}
      locale={locale}
      layout={layoutOf(role, opts.rooms ?? true)}
      allowance={{ capKrw: 100_000, usedKrw: 20_000, resetsAt: '2026-12-01T00:00:00Z' }}
      reviews={[REVIEW]}
      results={opts.results ?? WALL}
      activeProjects={1}
      readOnly={role === 'viewer'}
      viewerNote={role === 'viewer'}
      checklist={opts.checklist ?? null}
      canOpenBilling={role === 'owner'}
      spineHome={opts.spineHome}
      copy={copyOf(locale)}
    />,
  );
}

describe('WorkspaceHome with spineHome (projects present)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the top row, prompt bar, project cards block, 미분류 line, and checklist in order while removing old home blocks', () => {
    const ko = getDictionary('ko');
    const markup = renderSpineHome({
      spineHome: {
        canCreate: true,
        roomsOpen: true,
        cards: {
          ok: true,
          projects: SAMPLE_CARDS,
          unfiled: {
            counts: { image: 10, video: 2, sound: 1, upload: 1, film: 0 },
            covers: [
              unfiledCover(1),
              unfiledCover(2, { kind: 'video', url: '/m/u-2.mp4', thumbUrl: null }),
              unfiledCover(3),
              unfiledCover(4),
              unfiledCover(5),
              unfiledCover(6),
              unfiledCover(7),
            ],
          },
        },
      },
      checklist: CHECKLIST,
    });

    // Top row and section markers
    expect(markup).toContain('data-home-top-row');
    expect(markup).toContain('data-home-prompt');
    expect(markup).toContain('data-home-projects');
    expect(markup).toContain('data-home-cards');
    expect(markup).toContain(`data-home-unfiled="14"`);
    expect(markup).toContain('data-home-first-run');

    // Order: top-row -> prompt -> projects -> unfiled -> first-run checklist
    expect(markup.indexOf('data-home-top-row')).toBeLessThan(markup.indexOf('data-home-prompt'));
    expect(markup.indexOf('data-home-prompt')).toBeLessThan(markup.indexOf('data-home-projects'));
    expect(markup.indexOf('data-home-projects')).toBeLessThan(markup.indexOf('data-home-unfiled'));
    expect(markup.indexOf('data-home-unfiled')).toBeLessThan(markup.indexOf('data-home-first-run'));

    // Removed blocks when projects exist
    expect(markup).not.toContain('data-home-lines');
    expect(markup).not.toContain('data-home-reviews');
    expect(markup).not.toContain('data-home-team');
    expect(markup).not.toContain('data-home-wall');
    expect(markup).not.toContain('data-home-results');
    expect(markup).not.toContain('data-home-starters');
    expect(markup).not.toContain('data-home-no-projects');

    // Only one filled button on the page (the prompt bar)
    expect(count(markup, /data-variant="solid"/g)).toBe(1);

    // Header actions: 야기 팀에 의뢰하기 + 새 프로젝트 만들기
    expect(markup).toContain(`href="/brand/projects/new?organizationId=${ORG}"`);
    expect(markup).toContain(ko.projectHome.requestTeam);
    expect(markup).toContain('data-home-new-project');
    expect(markup).toContain(ko.projectSpine.newProject);

    // Cards content and links
    expect(markup).toContain(`data-home-project="${P_SELF}"`);
    expect(markup).toContain(`data-origin="self"`);
    expect(markup).toContain(`href="/brand/studio?organizationId=${ORG}&amp;project=${P_SELF}"`);
    expect(markup).toContain('이미지 24 · 영상 6 · 사운드 2');
    expect(markup).toContain('김서아 님이 영상을 추가했어요');

    expect(markup).toContain(`data-home-project="${P_TEAM}"`);
    expect(markup).toContain(`data-origin="team"`);
    expect(markup).toContain(`href="/brand/rooms/${P_TEAM}?organizationId=${ORG}"`);
    expect(markup).toContain('data-home-project-unread="2"');
    expect(markup).toContain('<span aria-hidden="true">2</span><span class="bw-sr-only">새 메시지 2</span>');
    expect(markup).not.toContain('aria-label="새 메시지 2"');
    expect(markup).toContain('야기 팀과 · 지금 단계 · 스토리보드');
    expect(markup).toContain('/api/brand-workspace/attachments/att-4');

    // Every <img> in the cards and 미분류 line carries a sizing class, lazy/async decoding, and explicit dimensions where present.
    const unfiledSection = /<div class="[^"]*" data-home-unfiled="14">([\s\S]*?)<\/div>\s*<section/.exec(markup)?.[1] ?? markup;
    const unfiledImgs = [...unfiledSection.matchAll(/<img\b[^>]*u-\d[^>]*>/g)].map((m) => m[0]);
    expect(unfiledImgs.length).toBe(5);
    for (const img of unfiledImgs) {
      expect(img).toMatch(/class="[^"]*unfiledThumb/);
      expect(img).toContain('width="44"');
      expect(img).toContain('height="44"');
      expect(img).toContain('loading="lazy"');
      expect(img).toContain('decoding="async"');
    }
    const cardImgs = [...markup.matchAll(/<img\b[^>]*src="\/m\/\d-thumb\.webp"[^>]*>/g)].map((m) => m[0]);
    expect(cardImgs.length).toBeGreaterThan(0);
    for (const img of cardImgs) {
      expect(img).toMatch(/class="[^"]*coverImage/);
      expect(img).toContain('width="720"');
      expect(img).toContain('height="1280"');
      expect(img).toContain('srcSet="');
      expect(img).toContain('sizes="');
      expect(img).toContain('loading="lazy"');
      expect(img).toContain('decoding="async"');
    }

    expect(markup).toContain('편집본이 만들어졌어요');
    expect(markup).toContain(ko.projectHome.cardEmpty);
    expect(markup).toContain('야기 팀과');

    // Cover layouts & strict no-<video> rule
    expect(markup).toContain('data-cover-layout="three"');
    expect(markup).toContain('data-cover-layout="two"');
    expect(markup).toContain('data-cover-layout="one"');
    expect(markup).toContain('data-cover-layout="empty"');
    expect(markup).not.toMatch(/<video[\s>]/i);

    // Unfiled row: 6 thumbnails max, count 14, move link
    expect(markup).toContain(ko.projectSpine.unfiled);
    expect(markup).toContain('프로젝트 없이 만든 파일 14개');
    expect(markup).toContain('data-home-unfiled-move');
    expect(markup).toContain(`href="/brand/library?organizationId=${ORG}"`);
    expect(markup).toContain(ko.projectSpine.move);
    expect(markup).not.toContain('u-7-thumb.webp');
    expect(markup).not.toContain('data-home-projects-more');
  });

  it('caps rendered cards at 24 and shows "모두 보기" link when more than 24 projects exist', () => {
    const ko = getDictionary('ko');
    const twentyFive = Array.from({ length: 25 }, (_, i) => ({
      ...SAMPLE_CARDS[0]!,
      project: { ...SAMPLE_CARDS[0]!.project, id: `p-${i}`, title: `프로젝트 ${i + 1}` },
    }));
    const markup = renderSpineHome({
      spineHome: {
        canCreate: true,
        roomsOpen: true,
        cards: { ok: true, projects: twentyFive, unfiled: { counts: emptyCounts(), covers: [] } },
      },
    });
    expect(count(markup, /data-home-project="/g)).toBe(24);
    expect(markup).not.toContain('프로젝트 25');
    expect(markup).toContain('data-home-projects-more');
    expect(markup).toContain(`href="/brand/library?organizationId=${ORG}"`);
    expect(markup).toContain(ko.studioLibrary.hub.projects.seeAll);
    // Unfiled hidden when sum is 0
    expect(markup).not.toContain('data-home-unfiled');
  });

  it('links team project cards to /brand/projects/<id> when roomsOpen is false', () => {
    const markup = renderSpineHome({
      rooms: false,
      spineHome: {
        canCreate: true,
        roomsOpen: false,
        cards: { ok: true, projects: [SAMPLE_CARDS[1]!], unfiled: { counts: emptyCounts(), covers: [] } },
      },
    });
    expect(markup).toContain(`href="/brand/projects/${P_TEAM}?organizationId=${ORG}"`);
    expect(markup).not.toContain(`/brand/rooms/${P_TEAM}`);
  });

  it('hides create/request/move actions for viewers while keeping cards and unfiled count', () => {
    const ko = getDictionary('ko');
    const markup = renderSpineHome({
      role: 'viewer',
      spineHome: {
        canCreate: false,
        roomsOpen: true,
        cards: {
          ok: true,
          projects: [SAMPLE_CARDS[0]!],
          unfiled: { counts: emptyCounts({ image: 3 }), covers: [unfiledCover(1)] },
        },
      },
    });
    expect(markup).not.toContain('data-home-prompt');
    expect(markup).not.toContain('data-home-new-project');
    expect(markup).not.toContain('/brand/projects/new');
    expect(markup).not.toContain(ko.projectHome.requestTeam);
    expect(markup).not.toContain('data-home-unfiled-move');
    expect(markup).toContain('data-home-viewer-note');
    expect(markup).toContain(`data-home-project="${P_SELF}"`);
    expect(markup).toContain('data-home-unfiled="3"');
  });

  it('renders English strings cleanly when locale is en', () => {
    const en = getDictionary('en');
    const markup = renderSpineHome({
      locale: 'en',
      spineHome: {
        canCreate: true,
        roomsOpen: true,
        cards: {
          ok: true,
          projects: [SAMPLE_CARDS[0]!, SAMPLE_CARDS[1]!],
          unfiled: { counts: emptyCounts({ image: 2 }), covers: [unfiledCover(1)] },
        },
      },
    });
    expect(markup).toContain(en.projectHome.blockTitle);
    expect(markup).toContain(en.projectHome.requestTeam);
    expect(markup).toContain(en.projectSpine.newProject);
    expect(markup).toContain('Images 24 · Videos 6 · Sound 2');
    expect(markup).toContain('김서아 added a video');
    expect(markup).not.toContain(htmlEscape(getDictionary('ko').projectHome.blockTitle));
    expect(markup).toContain('2 files created without a project');
    expect(markup).toContain(en.projectSpine.move);
  });
});

describe('WorkspaceHome with spineHome (no project at all)', () => {
  it('renders the guide line with both actions and keeps today’s recent-work wall when results exist', () => {
    const ko = getDictionary('ko');
    const markup = renderSpineHome({
      spineHome: {
        canCreate: true,
        roomsOpen: true,
        cards: { ok: true, projects: [], unfiled: { counts: emptyCounts({ image: 1 }), covers: [unfiledCover(1)] } },
      },
      results: WALL,
      checklist: CHECKLIST,
    });
    expect(markup).toContain('data-home-no-projects');
    expect(markup).toContain(ko.projectHome.guideNoProject);
    expect(markup).toContain(`href="/brand/projects/new?organizationId=${ORG}"`);
    expect(markup).toContain(ko.projectHome.requestTeam);
    expect(markup).toContain('data-home-new-project');
    expect(markup).not.toContain('data-home-projects');
    expect(markup).not.toContain('data-home-unfiled');
    expect(markup).not.toContain('data-home-lines');
    expect(markup).toContain('data-home-wall');
    expect(markup).toContain('data-home-results="1"');
    expect(markup).toContain('data-home-first-run');
    expect(markup.indexOf('data-home-no-projects')).toBeLessThan(markup.indexOf('data-home-first-run'));
    expect(markup.indexOf('data-home-first-run')).toBeLessThan(markup.indexOf('data-home-wall'));
  });

  it('renders the guide line and today’s three starters when nothing has been made yet', () => {
    const markup = renderSpineHome({
      spineHome: {
        canCreate: true,
        roomsOpen: true,
        cards: { ok: true, projects: [], unfiled: { counts: emptyCounts(), covers: [] } },
      },
      results: [],
    });
    expect(markup).toContain('data-home-no-projects');
    expect(markup).toContain('data-home-starters');
    expect(markup).not.toContain('data-home-wall');
    expect(markup).not.toContain('data-home-projects');
  });

  it('omits the two create/request buttons in the guide line for viewers', () => {
    const markup = renderSpineHome({
      role: 'viewer',
      spineHome: {
        canCreate: false,
        roomsOpen: true,
        cards: { ok: true, projects: [], unfiled: { counts: emptyCounts(), covers: [] } },
      },
      results: [],
    });
    expect(markup).toContain('data-home-no-projects');
    expect(markup).not.toContain('data-home-new-project');
    expect(markup).not.toContain('/brand/projects/new');
  });
});

describe('LazyVideoCover integration on home cards and unfiled thumbs (fix round 4 item 1)', () => {
  let mounted: MountedDom | null = null;
  const origIO = globalThis.IntersectionObserver;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    if (origIO) globalThis.IntersectionObserver = origIO;
    else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  it('mounts zero <video> before intersection and one preload=metadata <video> per video cover on viewport entry', async () => {
    const observed: Array<{ el: Element; trigger: () => void }> = [];
    class FakeIO {
      private readonly cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        observed.push({
          el,
          trigger: () =>
            this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
        });
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      readonly root = null;
      readonly rootMargin = '200px';
      readonly thresholds = [0];
    }
    globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver;

    const spineHome: SpineHomeProps = {
      canCreate: false,
      roomsOpen: true,
      cards: {
        ok: true,
        projects: [SAMPLE_CARDS[2]!],
        unfiled: {
          counts: emptyCounts({ video: 1 }),
          covers: [unfiledCover(2, { kind: 'video', url: '/m/u-2.mp4', thumbUrl: null })],
        },
      },
    };

    const ssrMarkup = renderSpineHome({ spineHome });
    expect(ssrMarkup).not.toMatch(/<video[\s>]/i);

    mounted = await mountDom(
      <HomeProjectCards
        organizationId={ORG}
        locale="ko"
        spineHome={spineHome}
        requestHref={null}
        copy={copyOf('ko')}
      />,
    );

    expect(mounted.queryAll('video')).toHaveLength(0);
    expect(observed).toHaveLength(2);

    await act(async () => {
      for (const entry of observed) entry.trigger();
    });

    const videos = mounted.queryAll('video');
    expect(videos).toHaveLength(2);
    expect(videos.map((v) => v.getAttribute('src'))).toEqual(['/m/clip-6.mp4#t=0.1', '/m/u-2.mp4#t=0.1']);
    for (const v of videos) {
      expect(v.getAttribute('preload')).toBe('metadata');
      expect(v.getAttribute('tabindex')).toBe('-1');
      expect((v as unknown as { muted?: boolean }).muted).toBe(true);
      expect(
        v.hasAttribute('playsInline') ||
          v.hasAttribute('playsinline') ||
          (v as unknown as { playsInline?: boolean }).playsInline === true,
      ).toBe(true);
      expect(v.hasAttribute('autoplay')).toBe(false);
      expect((v as unknown as { autoPlay?: boolean }).autoPlay).not.toBe(true);
      expect(v.hasAttribute('controls')).toBe(false);
    }
  });
});

describe('NewProjectTrigger modal dialog wrapping slice 1b NewProjectForm', () => {
  let mounted: MountedDom | null = null;

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
  });

  it('renders native bs-dialog with NewProjectForm untouched when open', () => {
    const ko = getDictionary('ko').projectSpine;
    const markup = renderToStaticMarkup(
      <NewProjectTrigger
        organizationId={ORG}
        copy={ko}
        initialOpen
        initialCreateError={ko.createLimit}
      />,
    );
    expect(markup).toContain('<dialog class="bs-dialog"');
    expect(markup).toContain('data-home-new-project-dialog');
    expect(markup).toContain('data-project-new-form');
    expect(markup).toContain('maxLength="120"');
    expect(markup).toContain(ko.createLabel);
    expect(markup).toContain(ko.createSubmit);
    expect(markup).toContain(ko.createLimit);
  });

  it('keeps the trigger disabled and dialog in submitting state after creation succeeds before navigation', async () => {
    const ko = getDictionary('ko').projectSpine;
    const onCreateProject = vi.fn().mockResolvedValue({
      ok: true,
      project: { id: 'p-new', title: 'New Project', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' },
    });
    const onNavigate = vi.fn();

    mounted = await mountDom(
      <NewProjectTrigger
        organizationId={ORG}
        copy={ko}
        onCreateProject={onCreateProject}
        onNavigate={onNavigate}
      />,
    );

    const trigger = mounted.query('[data-home-new-project]')!;
    expect(trigger.getAttribute('disabled')).toBeNull();

    await mounted.click(trigger);
    expect(mounted.query('[data-home-new-project-dialog]')).not.toBeNull();
    expect(mounted.query('[data-home-new-project]')?.getAttribute('disabled')).not.toBeNull();

    const input = mounted.query('[data-project-new-form] input')!;
    await mounted.setValue(input, 'My Campaign');
    await mounted.submit('[data-project-new-form]');

    expect(onCreateProject).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(`/brand/studio?organizationId=${ORG}&project=p-new`);
    // Even after navigate callback was invoked, trigger stays disabled and dialog stays open & busy until page unloads.
    expect(mounted.query('[data-home-new-project]')?.getAttribute('disabled')).not.toBeNull();
    const dialog = mounted.query('[data-home-new-project-dialog]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-busy')).toBe('true');

    // Escape/cancel cannot close dialog once created; clicking trigger cannot open a second form.
    await mounted.keyDown('Escape', { target: dialog });
    expect(mounted.query('[data-home-new-project-dialog]')).not.toBeNull();
    await mounted.click(mounted.query('[data-home-new-project]')!);
    expect(onCreateProject).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the name field when creation fails and state moves from submitting back to open', async () => {
    const ko = getDictionary('ko').projectSpine;
    let resolvePending: ((res: { ok: false; code: 'failed' }) => void) | null = null;
    const onCreateProject = vi.fn().mockImplementation(
      () =>
        new Promise<{ ok: false; code: 'failed' }>((resolve) => {
          resolvePending = resolve;
        }),
    );

    mounted = await mountDom(
      <NewProjectTrigger organizationId={ORG} copy={ko} onCreateProject={onCreateProject} />,
    );

    await mounted.click('[data-home-new-project]');
    const input = mounted.query('[data-project-new-form] input')!;
    await mounted.setValue(input, 'Retry Name');
    input.focus();
    expect(mounted.document.activeElement).toBe(input);

    // Submit enters submitting state; simulate fieldset[disabled] taking focus away while submitting.
    await mounted.submit('[data-project-new-form]');
    expect(mounted.query('[data-home-new-project-dialog]')?.getAttribute('aria-busy')).toBe('true');
    input.blur();
    expect(mounted.document.activeElement).not.toBe(input);

    // Resolve failure -> state returns from submitting -> open, restoring focus to the name field.
    await act(async () => {
      resolvePending?.({ ok: false, code: 'failed' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-home-new-project-dialog]')?.getAttribute('aria-busy')).toBeNull();
    expect(mounted.document.activeElement).toBe(mounted.query('[data-project-new-form] input'));
  });
});

describe('Slice 3a §6 & fix-round-1 source guards', () => {
  const ROOT = process.cwd();
  const under = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      return statSync(path.join(ROOT, rel)).isDirectory() ? under(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : [];
    });

  it('home-view.tsx has no getDictionary fallback and no test-only now prop', () => {
    const homeViewSrc = readFileSync(path.join(ROOT, 'components/brand-workspace/home/home-view.tsx'), 'utf8');
    expect(homeViewSrc).not.toContain('getDictionary');
    expect(homeViewSrc).not.toMatch(/\bnow\?:\s*Date/);
  });

  it('every exported runtime decision symbol in project-cards/model.ts is imported by a component', () => {
    const modelSrc = readFileSync(path.join(ROOT, 'components/brand-workspace/home/project-cards/model.ts'), 'utf8');
    const exports = [
      ...modelSrc.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm),
      ...modelSrc.matchAll(/^export\s+const\s+(\w+)/gm),
    ].map((m) => m[1]!);
    expect(exports.length).toBeGreaterThan(0);

    const consumers = [
      ...under('components/brand-workspace/home/project-cards').filter((f) => !f.endsWith('/model.ts')),
      'components/brand-workspace/home/home-view.tsx',
    ].map((f) => readFileSync(path.join(ROOT, f), 'utf8'));

    for (const sym of exports) {
      expect(consumers.some((src) => new RegExp(`\\b${sym}\\b`).test(src)), `unused export ${sym}`).toBe(true);
    }
  });

  it('has no <video, setInterval, setTimeout, or loadBrandProjectCards under project-cards', () => {
    for (const file of under('components/brand-workspace/home/project-cards')) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      expect(src, `${file} <video`).not.toMatch(/<video/i);
      expect(src, `${file} setInterval`).not.toMatch(/\bsetInterval\b/);
      expect(src, `${file} setTimeout`).not.toMatch(/\bsetTimeout\b/);
      expect(src, `${file} loadBrandProjectCards`).not.toMatch(/\bloadBrandProjectCards\b/);
    }
  });

  it('app/(brand)/brand/home/page.tsx is the only file under app/ and components/ naming loadProjectCards, and only api.ts names loadBrandProjectCards', () => {
    const files = [...under('app'), ...under('components')];
    expect(files.filter((f) => /\bloadProjectCards\b/.test(readFileSync(path.join(ROOT, f), 'utf8')))).toEqual([
      'app/(brand)/brand/home/page.tsx',
    ]);
    expect(files.filter((f) => /\bloadBrandProjectCards\b/.test(readFileSync(path.join(ROOT, f), 'utf8')))).toEqual([
      'components/brand-studio/api.ts',
    ]);
  });

  it('passes stable props (no inline object/array literals) to NewProjectForm and useModal in new-project-trigger.tsx, and resolves the name field via label[for]', () => {
    const src = readFileSync(path.join(ROOT, 'components/brand-workspace/home/project-cards/new-project-trigger.tsx'), 'utf8');
    expect(src).toContain("from '@/components/brand-studio/project-chip/new-project-form'");
    expect(src).toMatch(/useModal\(\s*\)/);
    expect(src).toMatch(/<NewProjectForm[\s\S]*copy=\{copy\}/);
    expect(src).toMatch(/<NewProjectForm[\s\S]*onCreate=\{handleCreate\}/);
    expect(src).toMatch(/<NewProjectForm[\s\S]*onCreated=\{handleCreated\}/);
    expect(src).toMatch(/<NewProjectForm[\s\S]*onCancel=\{onClose\}/);
    expect(src).toContain("label[for]");
    expect(src).not.toMatch(/querySelector[^)]*\[\s*data-project-new-form\s*\]\s+input['"]/);

    const indexSrc = readFileSync(path.join(ROOT, 'components/brand-workspace/home/project-cards/index.tsx'), 'utf8');
    expect(indexSrc).toContain("from '@/components/brand-studio/asset-hub-spine/lazy-video-cover'");
  });

  it('keeps empty no-picture cards as plain dark blocks without hairline outline on rest or hover (fix round 3 item 5)', () => {
    const css = readFileSync(
      path.join(ROOT, 'components/brand-workspace/home/project-cards/project-cards.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.cover:not\(\[data-cover-layout='empty'\]\)::after\s*\{/);
    expect(css).toMatch(/\.card:hover \.cover:not\(\[data-cover-layout='empty'\]\)::after\s*\{/);
    expect(css).not.toMatch(/^\s*\.cover::after\s*\{/m);
    expect(css).not.toMatch(/^\s*\.card:hover \.cover::after\s*\{/m);
  });

  it('keeps card hover monochrome (--ys-ink, beating .bw-main a:hover) with zero accent/pink tokens or colour literals (fix round 5 item 1)', () => {
    const css = readFileSync(
      path.join(ROOT, 'components/brand-workspace/home/project-cards/project-cards.module.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/accent|pink|\bred\b|#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
    expect(css).toContain(':global(.bw-main) a.card.card:hover');
    expect(css).toContain(':global(.bw-main) a.card:hover .cardTitle');
    expect(css).toContain(':global(.bw-main) a.textAction.textAction:hover');
    expect(css).toMatch(/:global\(\.bw-main\) a\.card:hover \.cardTitle[\s\S]*?color:\s*var\(--ys-ink\)/);
  });

  it('centres LazyVideoCover video inside .coverVideo (and .unfiledVideo) with object-fit: cover and object-position: center (fix round 5 item 2)', () => {
    const css = readFileSync(
      path.join(ROOT, 'components/brand-workspace/home/project-cards/project-cards.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.coverVideo\s+video\s*\{[^}]*object-fit:\s*cover;[^}]*object-position:\s*center;/);
    expect(css).toMatch(/\.unfiledVideo\s+video\s*\{[^}]*object-fit:\s*cover;[^}]*object-position:\s*center;/);
  });
});
