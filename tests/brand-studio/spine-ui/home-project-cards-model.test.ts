import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatRelativeTime, projectSecondLine } from '@/components/brand-studio/project-chip/model';
import type {
  StudioBrandProjectCard,
  StudioBrandProjectCardCover,
  StudioBrandProjectCounts,
  StudioBrandProjectCover,
} from '@/lib/brand-studio/contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  canCloseNewProjectDialog,
  canOpenNewProjectTrigger,
  cardCoverLayout,
  cardHref,
  cardSecondLine,
  cardThirdLine,
  cardUnreadBadge,
  newProjectTriggerReducer,
  projectCardsSlice,
  studioProjectHref,
  unfiledCoverSlots,
  unfiledTotal,
  type ProjectCardsCopy,
} from '@/components/brand-workspace/home/project-cards/model';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const P1 = 'p0000000-0000-4000-8000-000000000001';
const P2 = 'p0000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-26T12:00:00.000Z');

const copyOf = (locale: 'ko' | 'en'): ProjectCardsCopy => {
  const d = getDictionary(locale);
  return {
    projectHome: d.projectHome,
    projectSpine: d.projectSpine,
    libraryHub: d.studioLibrary.hub,
    roomsOverview: d.roomsShell.overview,
  };
};

const emptyCounts = (over: Partial<StudioBrandProjectCounts> = {}): StudioBrandProjectCounts => ({
  image: 0,
  video: 0,
  sound: 0,
  upload: 0,
  film: 0,
  ...over,
});

const card = (over: Partial<StudioBrandProjectCard> = {}): StudioBrandProjectCard => ({
  project: {
    id: P1,
    title: '봄 향수 론칭',
    origin: 'self',
    lastActivityAt: '2026-11-26T10:00:00.000Z',
    ...(over.project ?? {}),
  },
  counts: over.counts ?? emptyCounts({ image: 2, video: 1 }),
  covers: over.covers ?? [],
  lastActivity: over.lastActivity === undefined ? null : over.lastActivity,
  unread: over.unread ?? 0,
  stage: over.stage === undefined ? null : over.stage,
});

const cardCover = (
  n: number,
  over: Partial<StudioBrandProjectCardCover> = {},
): StudioBrandProjectCardCover => ({
  source: 'result',
  id: `cov-${n}`,
  kind: 'image',
  url: `/api/brand-studio/media/st/${n}.png`,
  thumbUrl: `/api/brand-studio/media/st/${n}-thumb.webp`,
  width: 720,
  height: 1280,
  ...over,
});

const unfiledCover = (
  n: number,
  over: Partial<StudioBrandProjectCover> = {},
): StudioBrandProjectCover => ({
  outputId: `out-${n}`,
  jobId: `job-${n}`,
  kind: 'image',
  url: `/api/brand-studio/media/st/u-${n}.png`,
  thumbUrl: `/api/brand-studio/media/st/u-${n}-thumb.webp`,
  width: 720,
  height: 1280,
  createdAt: '2026-11-26T09:00:00.000Z',
  ...over,
});

describe('projectCardsSlice (cap 24)', () => {
  it('preserves server order, caps at 24, and sets hasMore beyond 24', () => {
    const twentyFour = Array.from({ length: 24 }, (_, i) =>
      card({ project: { id: `p-${i}`, title: `P${i}`, origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' } }),
    );
    const exact = projectCardsSlice(twentyFour);
    expect(exact.shown).toHaveLength(24);
    expect(exact.hasMore).toBe(false);
    expect(exact.shown.map((c) => c.project.id)).toEqual(twentyFour.map((c) => c.project.id));

    const twentyFive = [
      ...twentyFour,
      card({ project: { id: 'p-24', title: 'P24', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' } }),
    ];
    const over = projectCardsSlice(twentyFive);
    expect(over.shown).toHaveLength(24);
    expect(over.hasMore).toBe(true);
    expect(over.shown.map((c) => c.project.id)).not.toContain('p-24');
  });
});

describe('cardCoverLayout & unfiledCoverSlots (0–3 covers, no video)', () => {
  it('lays out 0, 1, 2, and 3 covers, includes width/height, sizes, and reuses tileSources srcSet', () => {
    expect(cardCoverLayout([])).toEqual({ mode: 'empty', slots: [] });

    const single = cardCoverLayout([cardCover(1)]);
    expect(single.mode).toBe('one');
    expect(single.slots[0]).toMatchObject({
      kind: 'image',
      id: 'cov-1',
      src: '/api/brand-studio/media/st/1-thumb.webp',
      srcSet: '/api/brand-studio/media/st/1-thumb.webp 288w, /api/brand-studio/media/st/1.png 720w',
      sizes: '(min-width: 1800px) 22vw, 30vw',
      width: 720,
      height: 1280,
    });

    const two = cardCoverLayout([cardCover(1, { thumbUrl: null }), cardCover(2)]);
    expect(two.mode).toBe('two');
    expect(two.slots[0]).toMatchObject({
      kind: 'image',
      id: 'cov-1',
      src: '/api/brand-studio/media/st/1.png',
      sizes: '(min-width: 1800px) 11vw, 15vw',
      width: 720,
      height: 1280,
    });
    expect(two.slots[0]).not.toHaveProperty('srcSet');
    expect(two.slots[1]).toMatchObject({
      kind: 'image',
      id: 'cov-2',
      src: '/api/brand-studio/media/st/2-thumb.webp',
      sizes: '(min-width: 1800px) 11vw, 15vw',
    });

    const three = cardCoverLayout([cardCover(1), cardCover(2), cardCover(3), cardCover(4)]);
    expect(three.mode).toBe('three');
    expect(three.slots).toHaveLength(3);
    expect(three.slots.map((s) => s.id)).toEqual(['cov-1', 'cov-2', 'cov-3']);
    expect(three.slots[0]).toMatchObject({ sizes: '(min-width: 1800px) 15vw, 20vw' });
    expect(three.slots[1]).toMatchObject({ sizes: '(min-width: 1800px) 8vw, 10vw' });
  });

  it('uses thumbUrl for video when present and video (LazyVideoCover src) when thumbUrl is null; falls back to video_placeholder only without url; accepts team_cover image url without dimensions', () => {
    const mixed = cardCoverLayout([
      cardCover(1, { kind: 'video', url: '/m/clip-1.mp4', thumbUrl: null }),
      cardCover(2, { kind: 'video', url: '/m/clip-2.mp4', thumbUrl: '/m/poster-2.webp' }),
      cardCover(3, {
        source: 'team_cover',
        kind: 'image',
        url: '/api/brand-workspace/attachments/att-3',
        thumbUrl: null,
        width: null,
        height: null,
      }),
    ]);
    expect(mixed.mode).toBe('three');
    expect(mixed.slots[0]).toEqual({ kind: 'video', id: 'cov-1', url: '/m/clip-1.mp4' });
    expect(mixed.slots[1]).toMatchObject({ kind: 'image', id: 'cov-2', src: '/m/poster-2.webp', width: 720, height: 1280 });
    expect(mixed.slots[2]).toMatchObject({
      kind: 'image',
      id: 'cov-3',
      src: '/api/brand-workspace/attachments/att-3',
      sizes: '(min-width: 1800px) 8vw, 10vw',
    });
    expect(mixed.slots[2]).not.toHaveProperty('width');

    const noUrlVideo = cardCoverLayout([cardCover(4, { kind: 'video', url: '', thumbUrl: null })]);
    expect(noUrlVideo.slots[0]).toEqual({ kind: 'video_placeholder', id: 'cov-4' });
  });

  it('caps unfiled thumbs at 6 with 44x44 dims and uses video url when thumbUrl is null', () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      unfiledCover(i + 1, i === 1 ? { kind: 'video', url: '/m/v.mp4', thumbUrl: null } : {}),
    );
    const slots = unfiledCoverSlots(items);
    expect(slots).toHaveLength(6);
    expect(slots[0]).toMatchObject({
      kind: 'image',
      id: 'out-1',
      src: '/api/brand-studio/media/st/u-1-thumb.webp',
      width: 44,
      height: 44,
      sizes: '44px',
    });
    expect(slots[1]).toEqual({ kind: 'video', id: 'out-2', url: '/m/v.mp4' });
  });
});

describe('unfiledTotal', () => {
  it('sums all five count fields (never from cover list length)', () => {
    expect(unfiledTotal(emptyCounts())).toBe(0);
    expect(unfiledTotal({ image: 4, video: 2, sound: 1, upload: 5, film: 2 })).toBe(14);
    expect(unfiledTotal({ image: -1, video: Number.NaN, sound: 2.9, upload: 0, film: 1 })).toBe(3);
  });
});

describe('cardSecondLine', () => {
  it('renders positive own-project counts in order image, video, sound, upload, film', () => {
    const ko = copyOf('ko');
    const en = copyOf('en');
    const full = card({ counts: { image: 24, video: 6, sound: 2, upload: 3, film: 1 } });
    expect(cardSecondLine(full, ko)).toBe('이미지 24 · 영상 6 · 사운드 2 · 올린 파일 3 · 편집본 1');
    expect(cardSecondLine(full, en)).toBe('Images 24 · Videos 6 · Sound 2 · Uploaded 3 · Edit 1');

    const partial = card({ counts: { image: 0, video: 3, sound: 0, upload: 1, film: 0 } });
    expect(cardSecondLine(partial, ko)).toBe('영상 3 · 올린 파일 1');
  });

  it('returns cardEmpty when all counts on an own project are zero', () => {
    expect(cardSecondLine(card({ counts: emptyCounts() }), copyOf('ko'))).toBe('파일이 없습니다');
    expect(cardSecondLine(card({ counts: emptyCounts() }), copyOf('en'))).toBe('No files');
  });

  it('renders team project origin + current stage for every stage, or origin alone when stage is null', () => {
    const ko = copyOf('ko');
    const en = copyOf('en');
    const expectedKo: Record<'requested' | 'storyboard' | 'draft' | 'revision' | 'done', string> = {
      requested: '야기 팀과 · 지금 단계 · 의뢰 접수',
      storyboard: '야기 팀과 · 지금 단계 · 스토리보드',
      draft: '야기 팀과 · 지금 단계 · 시안',
      revision: '야기 팀과 · 지금 단계 · 수정',
      done: '야기 팀과 · 지금 단계 · 완료',
    };
    for (const st of ['requested', 'storyboard', 'draft', 'revision', 'done'] as const) {
      const team = card({
        project: { id: P2, title: 'Spring launch', origin: 'team', lastActivityAt: '2026-11-26T10:00:00.000Z' },
        stage: { stage: st, steps: [] },
      });
      expect(cardSecondLine(team, ko)).toBe(expectedKo[st]);
      expect(cardSecondLine(team, en)).toBe(`With the YAGI team · Current step · ${en.roomsOverview.stages[st]}`);
    }

    const roomsClosed = card({
      project: { id: P2, title: 'Spring launch', origin: 'team', lastActivityAt: '2026-11-26T10:00:00.000Z' },
      stage: null,
    });
    expect(cardSecondLine(roomsClosed, ko)).toBe('야기 팀과');
    expect(cardSecondLine(roomsClosed, en)).toBe('With the YAGI team');
  });
});

describe('cardThirdLine', () => {
  it('formats named and unnamed lastActivity across all 5 kinds using project-chip formatRelativeTime', () => {
    const ko = copyOf('ko');
    const en = copyOf('en');
    const at = '2026-11-26T10:00:00.000Z';
    const relKo = formatRelativeTime(at, 'ko', NOW);
    const relEn = formatRelativeTime(at, 'en', NOW);

    const kinds = [
      { kind: 'image' as const, koNamed: '김서아 님이 이미지를 추가했습니다', koAnon: '이미지가 추가됐습니다', enNamed: 'Kim added an image', enAnon: 'An image was added' },
      { kind: 'video' as const, koNamed: '김서아 님이 영상을 추가했습니다', koAnon: '영상이 추가됐습니다', enNamed: 'Kim added a video', enAnon: 'A video was added' },
      { kind: 'sound' as const, koNamed: '김서아 님이 사운드를 추가했습니다', koAnon: '사운드가 추가됐습니다', enNamed: 'Kim added sound', enAnon: 'Sound was added' },
      { kind: 'upload' as const, koNamed: '김서아 님이 파일을 올렸습니다', koAnon: '파일이 올라왔습니다', enNamed: 'Kim uploaded a file', enAnon: 'A file was uploaded' },
      { kind: 'film' as const, koNamed: '김서아 님이 편집본을 만들었습니다', koAnon: '편집본이 만들어졌습니다', enNamed: 'Kim created an edit', enAnon: 'An edit was created' },
    ];

    for (const row of kinds) {
      const named = card({
        lastActivity: { at, kind: row.kind, item: { type: 'job', id: 'x' }, actorName: '  김서아  ' },
      });
      expect(cardThirdLine(named, ko, 'ko', NOW)).toBe(`${row.koNamed} · ${relKo}`);

      const namedEn = card({
        lastActivity: { at, kind: row.kind, item: { type: 'job', id: 'x' }, actorName: 'Kim' },
      });
      expect(cardThirdLine(namedEn, en, 'en', NOW)).toBe(`${row.enNamed} · ${relEn}`);

      for (const blank of [null, '', '   ']) {
        const anon = card({
          lastActivity: { at, kind: row.kind, item: { type: 'job', id: 'x' }, actorName: blank },
        });
        expect(cardThirdLine(anon, ko, 'ko', NOW)).toBe(`${row.koAnon} · ${relKo}`);
        expect(cardThirdLine(anon, en, 'en', NOW)).toBe(`${row.enAnon} · ${relEn}`);
      }
    }
  });

  it('falls back to pickerLast from project.lastActivityAt when lastActivity is null', () => {
    const ko = copyOf('ko');
    const en = copyOf('en');
    const relKo = formatRelativeTime('2026-11-26T10:00:00.000Z', 'ko', NOW);
    const relEn = formatRelativeTime('2026-11-26T10:00:00.000Z', 'en', NOW);
    expect(cardThirdLine(card({ lastActivity: null }), ko, 'ko', NOW)).toBe(`마지막 작업 ${relKo}`);
    expect(cardThirdLine(card({ lastActivity: null }), en, 'en', NOW)).toBe(`Last activity ${relEn}`);
  });

  it('matches slice 1b picker relative time output ("지금"/"now" under 60s, 1 minute at 61s) in ko and en (fix round 4 item 3)', () => {
    const ko = copyOf('ko');
    const en = copyOf('en');

    for (const ms of [5_000, 59_000]) {
      const subMinuteAt = new Date(NOW.getTime() - ms).toISOString();
      const subCard = card({
        project: { id: P1, title: 'T', origin: 'self', lastActivityAt: subMinuteAt },
        lastActivity: null,
      });
      expect(cardThirdLine(subCard, ko, 'ko', NOW)).toBe('마지막 작업 지금');
      expect(cardThirdLine(subCard, en, 'en', NOW)).toBe('Last activity now');
      expect(cardThirdLine(subCard, ko, 'ko', NOW)).toBe(projectSecondLine(subCard.project, ko.projectSpine, 'ko', NOW));
      expect(cardThirdLine(subCard, en, 'en', NOW)).toBe(projectSecondLine(subCard.project, en.projectSpine, 'en', NOW));
    }

    const overMinuteAt = new Date(NOW.getTime() - 61_000).toISOString();
    const overCard = card({
      project: { id: P1, title: 'T', origin: 'self', lastActivityAt: overMinuteAt },
      lastActivity: null,
    });
    expect(cardThirdLine(overCard, ko, 'ko', NOW)).toBe('마지막 작업 1분 전');
    expect(cardThirdLine(overCard, en, 'en', NOW)).toBe('Last activity 1 minute ago');
    expect(cardThirdLine(overCard, ko, 'ko', NOW)).toBe(projectSecondLine(overCard.project, ko.projectSpine, 'ko', NOW));
    expect(cardThirdLine(overCard, en, 'en', NOW)).toBe(projectSecondLine(overCard.project, en.projectSpine, 'en', NOW));
  });

  it('reuses formatRelativeTime from project-chip instead of implementing its own', () => {
    const src = readFileSync(path.join(process.cwd(), 'components/brand-workspace/home/project-cards/model.ts'), 'utf8');
    expect(src).toContain("from '@/components/brand-studio/project-chip/model'");
    expect(src).not.toContain('RelativeTimeFormat');
  });
});

describe('cardHref, studioProjectHref, cardUnreadBadge & trigger state', () => {
  it('links own projects to image studio with ?project= and team projects to their room or project page per roomsOpen', () => {
    expect(studioProjectHref(ORG, P1)).toBe(`/brand/studio?organizationId=${ORG}&project=${P1}`);
    const own = card({ project: { id: P1, title: 'Own', origin: 'self', lastActivityAt: '2026-11-26T10:00:00.000Z' } });
    const team = card({ project: { id: P2, title: 'Team', origin: 'team', lastActivityAt: '2026-11-26T10:00:00.000Z' } });
    expect(cardHref(own, ORG, true)).toBe(`/brand/studio?organizationId=${ORG}&project=${P1}`);
    expect(cardHref(own, ORG, false)).toBe(`/brand/studio?organizationId=${ORG}&project=${P1}`);
    expect(cardHref(team, ORG, true)).toBe(`/brand/rooms/${P2}?organizationId=${ORG}`);
    expect(cardHref(team, ORG, false)).toBe(`/brand/projects/${P2}?organizationId=${ORG}`);
  });

  it('controls new-project trigger opening & dialog closing across idle, open, submitting, and created', () => {
    expect(canOpenNewProjectTrigger('idle')).toBe(true);
    expect(canOpenNewProjectTrigger('open')).toBe(false);
    expect(canOpenNewProjectTrigger('submitting')).toBe(false);
    expect(canOpenNewProjectTrigger('created')).toBe(false);

    expect(canCloseNewProjectDialog('open')).toBe(true);
    expect(canCloseNewProjectDialog('submitting')).toBe(false);
    expect(canCloseNewProjectDialog('created')).toBe(false);

    let state = newProjectTriggerReducer('idle', 'open');
    expect(state).toBe('open');
    state = newProjectTriggerReducer(state, 'submit');
    expect(state).toBe('submitting');
    // Failed submit returns to open so the user can retry.
    expect(newProjectTriggerReducer(state, 'fail')).toBe('open');
    // Closing is ignored once submitting or created.
    expect(newProjectTriggerReducer(state, 'close')).toBe('submitting');
    state = newProjectTriggerReducer(state, 'succeed');
    expect(state).toBe('created');
    expect(canOpenNewProjectTrigger(state)).toBe(false);
    expect(newProjectTriggerReducer(state, 'open')).toBe('created');
    expect(newProjectTriggerReducer(state, 'close')).toBe('created');
  });

  it('returns unread badge data only when unread > 0', () => {
    const ko = getDictionary('ko').projectHome;
    const en = getDictionary('en').projectHome;
    expect(cardUnreadBadge(0, ko)).toBeNull();
    expect(cardUnreadBadge(-2, ko)).toBeNull();
    expect(cardUnreadBadge(2, ko)).toEqual({ display: '2', label: '새 메시지 2' });
    expect(cardUnreadBadge(3, en)).toEqual({ display: '3', label: '3 new messages' });
  });
});
