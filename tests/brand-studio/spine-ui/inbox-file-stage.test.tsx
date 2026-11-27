import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendInviteTransport, SendTransport } from '@/components/brand-rooms/chat/transport';
import type {
  SendFileCard,
  SendInboxPage as SendInboxPageData,
  SendMessage,
  SendPerson,
  SendThreadPage,
  SendThreadSummary,
} from '@/lib/brand-rooms/send-contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { INVITE_LOOKUP_DEBOUNCE_MS } from '@/components/brand-send/invite-model';
import { pickSendCopy } from '@/components/brand-send/model';
import { SendFileStage } from '@/components/brand-send/file-stage';
import {
  STAGE_MAX_RATIO,
  STAGE_MIN_RATIO,
  fileStageBox,
  fileStageMediaKey,
  fileStageModel,
} from '@/components/brand-send/file-stage-model';
import { SendInboxPage } from '@/components/brand-send/inbox-page';
import { SendThreadView } from '@/components/brand-send/thread-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/inbox',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/brand-workspace/bell', () => ({
  WorkspaceBell: () => <span data-mock-bell="true" />,
}));

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const PROJ = '11111111-1111-4111-8111-111111111111';
const ROOT_1 = '22222222-2222-4222-8222-222222222221';
const ROOT_2 = '22222222-2222-4222-8222-222222222222';
const ROOT_3 = '22222222-2222-4222-8222-222222222223';
const OUT_1 = '33333333-3333-4333-8333-333333333331';
const OUT_2 = '33333333-3333-4333-8333-333333333332';
const ASSET_1 = '44444444-4444-4444-8444-444444444441';
const USER_1 = '55555555-5555-4555-8555-555555555551';
const USER_2 = '55555555-5555-4555-8555-555555555552';
const USER_3 = '55555555-5555-4555-8555-555555555553';

const KO = pickSendCopy(getDictionary('ko'));
const EN = pickSendCopy(getDictionary('en'));

const PEOPLE: SendPerson[] = [
  { id: USER_1, name: '김서아', role: 'owner', me: true },
  { id: USER_2, name: '이하린', role: 'editor', me: false },
  { id: USER_3, name: '박도윤', role: 'viewer', me: false },
];

function makeFile(over: Partial<SendFileCard> = {}): SendFileCard {
  return {
    ref: { kind: 'output', outputId: OUT_1 },
    available: true,
    kind: 'image',
    name: null,
    url: '/api/brand-studio/media/st/pic.png',
    thumbUrl: '/api/brand-studio/media/st/pic-thumb.webp',
    width: 720,
    height: 1280,
    project: { id: PROJ, title: '봄 향수 론칭' },
    ...over,
  };
}

function makeMsg(over: Partial<SendMessage> = {}): SendMessage {
  return {
    id: ROOT_1,
    rootId: ROOT_1,
    parentId: null,
    authorId: USER_2,
    authorName: '이하린',
    mine: false,
    body: '@김서아 이 컷 확인 부탁드려요.',
    mentions: [{ id: USER_1, name: '김서아' }],
    createdAt: '2026-11-26T04:40:00.000Z',
    ...over,
  };
}

function makeThread(over: Partial<SendThreadSummary> = {}): SendThreadSummary {
  const root = over.root ?? makeMsg();
  return {
    rootId: root.rootId,
    root,
    file: over.file ?? makeFile(),
    replyCount: 0,
    lastActivityAt: root.createdAt,
    latest: {
      messageId: root.id,
      authorId: root.authorId,
      authorName: root.authorName,
      mine: root.mine,
      line: root.body,
      at: root.createdAt,
    },
    mentioned: true,
    unread: true,
    lastReadAt: null,
    ...over,
  };
}

function mockTransport(patch: Partial<SendTransport> = {}): SendTransport {
  return {
    organizationId: ORG,
    post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    reply: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    thread: vi.fn(async () => ({ ok: true as const, thread: makeThread(), replies: [] })),
    file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
    inbox: vi.fn(async () => ({
      ok: true as const,
      view: 'all' as const,
      threads: [],
      next: null,
      unread: 0,
      mentionsUnread: 0,
    })),
    read: vi.fn(async () => ({ ok: true as const, rootId: ROOT_1, lastReadAt: '2026-11-26T05:00:00.000Z' })),
    readAll: vi.fn(async () => ({ ok: true as const, marked: 0, more: false })),
    people: vi.fn(async () => ({ ok: true as const, people: PEOPLE })),
    ...patch,
  };
}

function mockInviteTransport(patch: Partial<SendInviteTransport> = {}): SendInviteTransport {
  return {
    organizationId: ORG,
    post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    reply: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    lookup: vi.fn(async (email: string) => ({ ok: true as const, email, status: 'invitable' as const, member: null })),
    ...patch,
  };
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (/\.(ts|tsx|css)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('file-stage-model pure model', () => {
  it('selects the right stage variant and media address for every file kind and unavailable state', () => {
    const imgBoth = fileStageModel(makeFile({ kind: 'image', url: '/full.png', thumbUrl: '/thumb.webp' }), KO);
    expect(imgBoth.variant).toBe('image');
    expect(imgBoth.src).toBe('/full.png');
    expect(imgBoth.poster).toBeNull();
    expect(imgBoth.label).toBe(KO.kindImage);

    const imgNamed = fileStageModel(makeFile({ kind: 'image', name: 'hero-cut.png', url: '/full.png' }), KO);
    expect(imgNamed.label).toBe('hero-cut.png');

    const imgFallback = fileStageModel(makeFile({ kind: 'image', url: null, thumbUrl: '/thumb.webp' }), KO);
    expect(imgFallback.variant).toBe('image');
    expect(imgFallback.src).toBe('/thumb.webp');

    const imgEmpty = fileStageModel(makeFile({ kind: 'image', url: '   ', thumbUrl: null }), KO);
    expect(imgEmpty.variant).toBe('unavailable');
    expect(imgEmpty.src).toBeNull();
    expect(imgEmpty.unavailableText).toBe(KO.fileGone);

    const vid = fileStageModel(
      makeFile({ kind: 'video', url: '/clip.mp4', thumbUrl: '/clip-poster.webp', width: 1080, height: 1920 }),
      KO,
    );
    expect(vid.variant).toBe('video');
    expect(vid.src).toBe('/clip.mp4');
    expect(vid.poster).toBe('/clip-poster.webp');

    const vidNoPoster = fileStageModel(makeFile({ kind: 'video', url: '/clip.mp4', thumbUrl: null }), KO);
    expect(vidNoPoster.variant).toBe('video');
    expect(vidNoPoster.src).toBe('/clip.mp4');
    expect(vidNoPoster.poster).toBeNull();

    const vidNoUrl = fileStageModel(makeFile({ kind: 'video', url: null, thumbUrl: '/clip-poster.webp' }), KO);
    expect(vidNoUrl.variant).toBe('unavailable');
    expect(vidNoUrl.src).toBeNull();

    const audNamed = fileStageModel(
      makeFile({ ref: { kind: 'asset', assetId: ASSET_1 }, kind: 'audio', name: 'BGM Master.mp3', url: '/bgm.mp3', thumbUrl: null, width: null, height: null }),
      KO,
    );
    expect(audNamed.variant).toBe('audio');
    expect(audNamed.src).toBe('/bgm.mp3');
    expect(audNamed.label).toBe('BGM Master.mp3');

    const audUntitledKo = fileStageModel(makeFile({ kind: 'audio', name: null, url: '/bgm.mp3', thumbUrl: null }), KO);
    expect(audUntitledKo.variant).toBe('audio');
    expect(audUntitledKo.label).toBe(KO.kindSound);

    const audUntitledEn = fileStageModel(makeFile({ kind: 'audio', name: '  ', url: '/bgm.mp3', thumbUrl: null }), EN);
    expect(audUntitledEn.variant).toBe('audio');
    expect(audUntitledEn.label).toBe(EN.kindSound);

    const audNoUrl = fileStageModel(makeFile({ kind: 'audio', url: null }), KO);
    expect(audNoUrl.variant).toBe('unavailable');

    const gone = fileStageModel(
      makeFile({ available: false, kind: 'image', url: '/full.png', thumbUrl: '/thumb.webp' }),
      EN,
    );
    expect(gone.variant).toBe('unavailable');
    expect(gone.src).toBeNull();
    expect(gone.unavailableText).toBe(EN.fileGone);

    const nullKind = fileStageModel(makeFile({ available: true, kind: null, url: '/unknown.bin' }), KO);
    expect(nullKind.variant).toBe('unavailable');
  });

  it('computes stage box ratio from width/height with clamped extremes and sane fallbacks', () => {
    expect(fileStageBox(720, 1280, 'image')).toEqual({
      width: 720,
      height: 1280,
      ratio: 720 / 1280,
      aspectRatio: '720 / 1280',
    });
    expect(fileStageBox(1920, 1080, 'video')).toEqual({
      width: 1920,
      height: 1080,
      ratio: 1920 / 1080,
      aspectRatio: '1920 / 1080',
    });

    const tooWide = fileStageBox(10_000, 10, 'image');
    expect(tooWide.ratio).toBe(STAGE_MAX_RATIO);
    expect(tooWide.aspectRatio).toBe('4000 / 1000');

    const tooTall = fileStageBox(10, 10_000, 'image');
    expect(tooTall.ratio).toBe(STAGE_MIN_RATIO);
    expect(tooTall.aspectRatio).toBe('250 / 1000');

    expect(fileStageBox(null, null, 'video')).toEqual({
      width: null,
      height: null,
      ratio: 16 / 9,
      aspectRatio: '16 / 9',
    });
    expect(fileStageBox(0, 100, 'image')).toEqual({
      width: null,
      height: null,
      ratio: 4 / 3,
      aspectRatio: '4 / 3',
    });
    expect(fileStageBox(Number.NaN, Number.POSITIVE_INFINITY, 'audio')).toEqual({
      width: null,
      height: null,
      ratio: 4 / 3,
      aspectRatio: '4 / 3',
    });
  });

  it('keys the stage media element by normalized thread id, file ref, and variant', () => {
    const f1 = makeFile({ ref: { kind: 'output', outputId: OUT_1.toUpperCase() } });
    const f2 = makeFile({ ref: { kind: 'output', outputId: OUT_2 } });
    const fAsset = makeFile({ ref: { kind: 'asset', assetId: ASSET_1 } });

    const k1 = fileStageMediaKey(ROOT_1.toUpperCase(), f1, 'image');
    const k1Lower = fileStageMediaKey(ROOT_1.toLowerCase(), makeFile({ ref: { kind: 'output', outputId: OUT_1 } }), 'image');
    expect(k1).toBe(k1Lower);
    expect(k1).not.toBe(fileStageMediaKey(ROOT_2, f1, 'image'));
    expect(k1).not.toBe(fileStageMediaKey(ROOT_1, f2, 'image'));
    expect(k1).not.toBe(fileStageMediaKey(ROOT_1, fAsset, 'image'));
    expect(k1).not.toBe(fileStageMediaKey(ROOT_1, f1, 'video'));
  });
});

describe('inbox thread file stage SSR markup', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders image, video, audio, and unavailable stages in SendInboxPage / staged SendThreadView while dropping the root file card and keeping header open link', () => {
    const imgSeed: SendThreadPage = {
      ok: true,
      thread: makeThread({ file: makeFile({ kind: 'image', url: '/api/brand-studio/media/st/full.png', thumbUrl: '/api/brand-studio/media/st/thumb.webp', width: 720, height: 1280 }) }),
      replies: [],
    };
    const inboxSeed: SendInboxPageData = {
      ok: true,
      view: 'all',
      threads: [imgSeed.thread],
      next: null,
      unread: 1,
      mentionsUnread: 1,
    };

    const imgInboxHtml = renderToStaticMarkup(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        locale="ko"
        copy={KO}
        initialInbox={inboxSeed}
        initialThread={imgSeed}
      />,
    );
    expect(imgInboxHtml).toContain('data-send-stage="true"');
    expect(imgInboxHtml).toContain('data-send-thread-split="true"');
    expect(imgInboxHtml).toContain('data-send-file-stage="image"');
    expect(imgInboxHtml).toContain('src="/api/brand-studio/media/st/full.png"');
    expect(imgInboxHtml).toContain(`alt="${KO.kindImage}"`);
    expect(imgInboxHtml).toContain('width="720"');
    expect(imgInboxHtml).toContain('height="1280"');
    expect(imgInboxHtml).toContain('data-send-head-open="true"');
    expect(imgInboxHtml).toContain(`>${KO.openFile}</a>`);
    expect(imgInboxHtml).not.toContain('data-send-file-card');

    // Named image upload uses file name as alt and falls back to thumbUrl when url is null
    const imgFallbackHtml = renderToStaticMarkup(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        stage
        initialThread={{
          ok: true,
          thread: makeThread({
            file: makeFile({
              ref: { kind: 'asset', assetId: ASSET_1 },
              kind: 'image',
              name: '시안 컷.png',
              url: null,
              thumbUrl: '/api/brand-studio/media/st/fallback.webp',
            }),
          }),
          replies: [],
        }}
      />,
    );
    expect(imgFallbackHtml).toContain('src="/api/brand-studio/media/st/fallback.webp"');
    expect(imgFallbackHtml).toContain('alt="시안 컷.png"');
    expect(imgFallbackHtml).not.toContain('data-send-file-card');

    // Video thread: native video player with controls playsInline preload="metadata", poster, no autoplay, no root card
    const vidHtml = renderToStaticMarkup(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        stage
        initialThread={{
          ok: true,
          thread: makeThread({
            file: makeFile({
              kind: 'video',
              url: '/api/brand-studio/media/st/clip.mp4',
              thumbUrl: '/api/brand-studio/media/st/clip-poster.webp',
              width: 1080,
              height: 1920,
            }),
          }),
          replies: [],
        }}
      />,
    );
    expect(vidHtml).toContain('data-send-file-stage="video"');
    expect(vidHtml).toMatch(/<video\b[^>]*src="\/api\/brand-studio\/media\/st\/clip\.mp4"/);
    expect(vidHtml).toMatch(/<video\b[^>]*poster="\/api\/brand-studio\/media\/st\/clip-poster\.webp"/);
    expect(vidHtml).toMatch(/<video\b[^>]*controls=""/);
    expect(vidHtml).toMatch(/<video\b[^>]*playsInline=""/);
    expect(vidHtml).toMatch(/<video\b[^>]*preload="metadata"/);
    expect(vidHtml).not.toMatch(/<video\b[^>]*autoPlay/i);
    expect(vidHtml).toContain('data-send-head-open="true"');
    expect(vidHtml).not.toContain('data-send-file-card');

    // Audio thread: centered audio player with file name, no <img> in stage, no root card
    const audHtml = renderToStaticMarkup(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        stage
        initialThread={{
          ok: true,
          thread: makeThread({
            file: makeFile({
              ref: { kind: 'asset', assetId: ASSET_1 },
              kind: 'audio',
              name: 'Spring Theme.mp3',
              url: '/api/brand-studio/media/st/theme.mp3',
              thumbUrl: null,
              width: null,
              height: null,
            }),
          }),
          replies: [],
        }}
      />,
    );
    expect(audHtml).toContain('data-send-file-stage="audio"');
    expect(audHtml).toContain('Spring Theme.mp3');
    expect(audHtml).toMatch(/<audio\b[^>]*src="\/api\/brand-studio\/media\/st\/theme\.mp3"/);
    expect(audHtml).toMatch(/<audio\b[^>]*controls=""/);
    expect(audHtml).toMatch(/<audio\b[^>]*preload="metadata"/);
    const audStageSlice = /<figure\b[\s\S]*?<\/figure>/.exec(audHtml)?.[0] ?? '';
    expect(audStageSlice).not.toContain('<img');
    expect(audHtml).not.toContain('data-send-file-card');

    // Unavailable thread (!available and available with missing url): centered copy.fileGone, no <img> in stage, no root card
    for (const badFile of [
      makeFile({ available: false, kind: null, name: null, url: null, thumbUrl: null, project: null }),
      makeFile({ available: true, kind: 'video', url: null, thumbUrl: '/orphan-poster.webp' }),
    ]) {
      const unavailHtml = renderToStaticMarkup(
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_1}
          locale="en"
          copy={EN}
          stage
          initialThread={{ ok: true, thread: makeThread({ file: badFile }), replies: [] }}
        />,
      );
      expect(unavailHtml).toContain('data-send-file-stage="unavailable"');
      expect(unavailHtml).toContain(EN.fileGone);
      const unavailStageSlice = /<figure\b[\s\S]*?<\/figure>/.exec(unavailHtml)?.[0] ?? '';
      expect(unavailStageSlice).not.toContain('<img');
      expect(unavailHtml).not.toContain('data-send-file-card');
    }

    // Without stage: first-message file card stays present and no file stage renders
    const plainHtml = renderToStaticMarkup(
      <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} initialThread={imgSeed} />,
    );
    expect(plainHtml).toContain('data-send-file-card');
    expect(plainHtml).not.toContain('data-send-file-stage');
    expect(plainHtml).not.toContain('data-send-thread-split');
  });
});

describe('inbox thread item 4 invite gating & DOM stage switching', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('offers email invite on video and audio threads, and blocks it on image threads in both staged and unstaged SendThreadView', async () => {
    for (const stage of [false, true]) {
      for (const fileKind of ['video', 'audio', 'image'] as const) {
        const transport = mockTransport({
          reply: vi.fn(async () => ({ ok: true as const, thread: makeThread(), message: makeMsg() })),
        });
        const inviteTransport = mockInviteTransport({
          reply: vi.fn(async () => ({ ok: true as const, thread: makeThread(), message: makeMsg() })),
        });
        const file =
          fileKind === 'video'
            ? makeFile({ kind: 'video', url: '/v.mp4' })
            : fileKind === 'audio'
              ? makeFile({ kind: 'audio', url: '/a.mp3', thumbUrl: null, width: null, height: null })
              : makeFile({ kind: 'image', url: '/img.png' });

        mounted = await mountDom(
          <SendThreadView
            organizationId={ORG}
            rootId={ROOT_1}
            locale="ko"
            copy={KO}
            stage={stage}
            transport={transport}
            invite
            inviteTransport={inviteTransport}
            initialThread={{ ok: true, thread: makeThread({ file }), replies: [] }}
            markSeedRead={false}
            initialPeople={PEOPLE}
          />,
        );

        const textarea = mounted.query('[data-send-input]')!;
        await mounted.setValue(textarea, '@new.person@example.com');
        await act(async () => {
          vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
          await Promise.resolve();
          await Promise.resolve();
        });

        if (fileKind === 'image') {
          expect(inviteTransport.lookup, `stage=${stage} image lookup`).not.toHaveBeenCalled();
          expect(mounted.query('[data-send-picker]'), `stage=${stage} image picker`).toBeNull();
          await mounted.keyDown('Enter', { target: textarea });
          expect(transport.reply).toHaveBeenCalledTimes(1);
          expect(inviteTransport.reply).not.toHaveBeenCalled();
        } else {
          expect(inviteTransport.lookup, `stage=${stage} ${fileKind} lookup`).toHaveBeenCalledWith(
            'new.person@example.com',
          );
          expect(mounted.query('[data-send-invite-option]'), `stage=${stage} ${fileKind} option`).not.toBeNull();
        }

        await mounted.unmount();
        mounted = null;
      }
    }
  });

  it('keeps the same video element across 3 equal-prop re-renders, pauses & replaces media on thread switch without leaking previous file or sending requests', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const file1 = makeFile({ ref: { kind: 'output', outputId: OUT_1 }, kind: 'video', url: '/clip-1.mp4', thumbUrl: '/p1.webp' });
    const file2 = makeFile({ ref: { kind: 'output', outputId: OUT_2 }, kind: 'video', url: '/clip-2.mp4', thumbUrl: '/p2.webp' });

    const seed1 = (): SendThreadPage => ({
      ok: true,
      thread: makeThread({ rootId: ROOT_1, root: makeMsg({ id: ROOT_1, rootId: ROOT_1 }), file: { ...file1 } }),
      replies: [],
    });
    const seed2 = (): SendThreadPage => ({
      ok: true,
      thread: makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }), file: { ...file2 } }),
      replies: [],
    });

    let resolvePendingThread!: (val: SendThreadPage) => void;
    const threadSpy = vi.fn(
      () =>
        new Promise<SendThreadPage>((resolve) => {
          resolvePendingThread = resolve;
        }),
    );
    const transport = mockTransport({ thread: threadSpy });

    mounted = await mountDom(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        stage
        transport={transport}
        initialThread={seed1()}
        markSeedRead={false}
        initialPeople={PEOPLE}
      />,
    );

    const video1 = mounted.query('[data-send-stage-media="video"]')!;
    expect(video1).not.toBeNull();
    expect(video1.getAttribute('src')).toBe('/clip-1.mp4');
    await video1.play();
    expect(video1.paused).toBe(false);

    // Three re-renders with equal props (new wrapper objects) keep the exact same DOM video node playing
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_1}
          locale="ko"
          copy={KO}
          stage
          transport={transport}
          initialThread={seed1()}
          markSeedRead={false}
          initialPeople={PEOPLE}
        />,
      );
      expect(mounted.query('[data-send-stage-media="video"]')).toBe(video1);
      expect(video1.paused).toBe(false);
    }
    expect(threadSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Switch to seeded ROOT_2: stops video1, mounts a new keyed video element for clip-2.mp4, sends zero requests
    await mounted.rerender(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_2}
        locale="ko"
        copy={KO}
        stage
        transport={transport}
        initialThread={seed2()}
        markSeedRead={false}
        initialPeople={PEOPLE}
      />,
    );

    expect(video1.paused).toBe(true);
    const video2 = mounted.query('[data-send-stage-media="video"]')!;
    expect(video2).not.toBeNull();
    expect(video2).not.toBe(video1);
    expect(video2.getAttribute('src')).toBe('/clip-2.mp4');
    expect(mounted.container.textContent).not.toContain('/clip-1.mp4');
    expect(threadSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    // Switch to unseeded ROOT_3 (loading): immediately stops video2 and unmounts previous file during load
    await video2.play();
    expect(video2.paused).toBe(false);
    await mounted.rerender(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_3}
        locale="ko"
        copy={KO}
        stage
        transport={transport}
        initialThread={null}
        markSeedRead={false}
        initialPeople={PEOPLE}
      />,
    );
    expect(video2.paused).toBe(true);
    expect(mounted.query('[data-send-stage-media="video"]')).toBeNull();
    expect(mounted.query('[data-send-file-stage]')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    resolvePendingThread({
      ok: true,
      thread: makeThread({ rootId: ROOT_3, root: makeMsg({ id: ROOT_3, rootId: ROOT_3 }), file: makeFile({ kind: 'image', url: '/img-3.png' }) }),
      replies: [],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-stage-media="image"]')?.getAttribute('src')).toBe('/img-3.png');
  });
});

describe('inbox stage source & CSS module guards', () => {
  const root = process.cwd();
  const sendDir = path.join(root, 'components/brand-send');

  it('calls every exported runtime function from file-stage-model.ts and enforces zero text/timer/literal-dep/lib-import leaks', () => {
    const modelSrc = readFileSync(path.join(sendDir, 'file-stage-model.ts'), 'utf8');
    const stageSrc = readFileSync(path.join(sendDir, 'file-stage.tsx'), 'utf8');
    const threadSrc = readFileSync(path.join(sendDir, 'thread-view.tsx'), 'utf8');
    const inboxSrc = readFileSync(path.join(sendDir, 'inbox-page.tsx'), 'utf8');

    const runtimeExports = [...modelSrc.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    expect(runtimeExports.length).toBeGreaterThan(0);
    const componentBundle = [stageSrc, threadSrc, inboxSrc].join('\n');
    for (const sym of runtimeExports) {
      expect(componentBundle, `${sym} from file-stage-model.ts must be used`).toMatch(new RegExp(`\\b${sym}\\b`));
    }

    for (const [name, src] of [
      ['file-stage-model.ts', modelSrc],
      ['file-stage.tsx', stageSrc],
    ] as const) {
      expect(src, `${name} must contain zero hardcoded Korean copy`).not.toMatch(/[\uAC00-\uD7A3]/);
      expect(src, `${name} must add zero timers`).not.toMatch(/\b(setTimeout|setInterval)\b/);
      for (const imp of src.matchAll(/^import\s+([^;]*?)\s+from\s+['"](@\/lib\/[^'"]+)['"];?/gm)) {
        expect(imp[1]!.trim(), `${name} may only type-import lib/**`).toMatch(/^type\s+/);
      }
    }

    // Zero hardcoded visible text rendered across all 4 stage variants (every rendered text node comes from copy or file.name)
    const sentinelCopy = {
      kindImage: '__KIND_IMG__',
      kindVideo: '__KIND_VID__',
      kindSound: '__KIND_SND__',
      fileGone: '__FILE_GONE__',
    };
    for (const [sample, allowed] of [
      [makeFile({ kind: 'image', url: '/a.png' }), []],
      [makeFile({ kind: 'video', url: '/a.mp4', thumbUrl: '/p.webp' }), []],
      [makeFile({ kind: 'audio', name: '__AUDIO_NAME__', url: '/a.mp3', thumbUrl: null }), ['__AUDIO_NAME__']],
      [makeFile({ kind: 'audio', name: null, url: '/a.mp3', thumbUrl: null }), ['__KIND_SND__']],
      [makeFile({ available: false, kind: null, url: null, thumbUrl: null }), ['__FILE_GONE__']],
    ] as const) {
      const html = renderToStaticMarkup(<SendFileStage rootId={ROOT_1} file={sample} copy={sentinelCopy} />);
      const texts = html
        .replace(/<[^>]+>/g, '\u0000')
        .split('\u0000')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(texts).toEqual([...allowed]);
    }

    for (const [name, src] of [
      ['file-stage.tsx', stageSrc],
      ['thread-view.tsx', threadSrc],
      ['inbox-page.tsx', inboxSrc],
    ] as const) {
      expect(src, name).not.toMatch(/use(?:Effect|Memo|Callback|LayoutEffect)\([^)]*,\s*\[[^\]]*(?:\{\s*[^}]*\}|\[\s*[^\]]*\])[^\]]*\]/s);
      expect(src, name).not.toMatch(/<(?:SendFileStage|SendThreadView|SendComposer|SendFileCardView)\b[^>]*=\{\s*[\[{]/);
    }

    // Never import corsMediaUrl for plain stage display
    for (const file of collectFiles(sendDir)) {
      expect(readFileSync(file, 'utf8'), path.basename(file)).not.toContain('corsMediaUrl');
    }
  });

  it('keeps file-stage.module.css and thread-view.module.css token-only, local-selector-scoped, reduced-motion ready, and stage-split sized', () => {
    const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '');
    const splitCommaOutsideParens = (header: string): string[] => {
      const parts: string[] = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < header.length; i += 1) {
        const ch = header[i];
        if (ch === '(') depth += 1;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (ch === ',' && depth === 0) {
          parts.push(header.slice(start, i).trim());
          start = i + 1;
        }
      }
      parts.push(header.slice(start).trim());
      return parts.filter(Boolean);
    };
    const stripGlobalCalls = (selector: string): string => {
      let out = '';
      let i = 0;
      while (i < selector.length) {
        if (selector.startsWith(':global(', i)) {
          let depth = 1;
          i += ':global('.length;
          while (i < selector.length && depth > 0) {
            if (selector[i] === '(') depth += 1;
            else if (selector[i] === ')') depth -= 1;
            i += 1;
          }
          continue;
        }
        out += selector[i];
        i += 1;
      }
      return out;
    };
    const extractSelectorHeaders = (cssText: string): string[] => {
      const headers: string[] = [];
      let i = 0;
      let chunkStart = 0;
      while (i < cssText.length) {
        if (cssText[i] !== '{') {
          i += 1;
          continue;
        }
        const header = cssText.slice(chunkStart, i).trim();
        let depth = 1;
        const bodyStart = i + 1;
        i += 1;
        while (i < cssText.length && depth > 0) {
          if (cssText[i] === '{') depth += 1;
          else if (cssText[i] === '}') depth -= 1;
          i += 1;
        }
        const body = cssText.slice(bodyStart, i - 1);
        chunkStart = i;
        if (header.startsWith('@media') || header.startsWith('@container')) {
          headers.push(...extractSelectorHeaders(body));
        } else if (header && !header.startsWith('@')) {
          headers.push(header);
        }
      }
      return headers;
    };

    for (const cssName of ['file-stage.module.css', 'thread-view.module.css']) {
      const css = stripComments(readFileSync(path.join(sendDir, cssName), 'utf8'));
      expect(css, cssName).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/);
      expect(css, cssName).not.toContain('--ys-accent');
      expect(css, cssName).toContain('prefers-reduced-motion: reduce');
      const headers = extractSelectorHeaders(css);
      expect(headers.length, cssName).toBeGreaterThan(0);
      for (const header of headers) {
        for (const selector of splitCommaOutsideParens(header)) {
          const localRemainder = stripGlobalCalls(selector);
          expect(localRemainder, `${cssName}: selector "${selector}" must include a local class`).toMatch(/[.#][A-Za-z_-]/);
        }
      }
    }

    const threadCss = readFileSync(path.join(sendDir, 'thread-view.module.css'), 'utf8');
    const stageCss = readFileSync(path.join(sendDir, 'file-stage.module.css'), 'utf8');
    const composerCss = readFileSync(path.join(sendDir, 'composer.module.css'), 'utf8');
    expect(threadCss).toContain('minmax(480px, 3fr) clamp(340px, 40%, 560px)');
    expect(threadCss).toContain('@container (max-width: 819px)');
    expect(threadCss).toContain('44vh');
    expect(threadCss).toMatch(/\.stageBody\s*\{[^}]*height:\s*100%;/s);
    expect(threadCss).toMatch(/\.stagePane\s*\{[^}]*height:\s*100%;/s);
    expect(stageCss).toMatch(/\.stage\s*\{[^}]*height:\s*100%;/s);
    expect(composerCss).toMatch(/\.sendBtn\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(composerCss).toMatch(/\.controls\s*\{[^}]*flex:\s*none;/s);
    expect(composerCss).toMatch(/\.hints\s*\{[^}]*min-width:\s*0;/s);
  });

  it('keeps SendFileStage deterministic across clocks with zero render-time Date, window, document, or useId reads', () => {
    const modelSrc = readFileSync(path.join(sendDir, 'file-stage-model.ts'), 'utf8');
    const stageSrc = readFileSync(path.join(sendDir, 'file-stage.tsx'), 'utf8');
    for (const [name, src] of [
      ['file-stage-model.ts', modelSrc],
      ['file-stage.tsx', stageSrc],
    ] as const) {
      expect(src, name).not.toMatch(/\b(Date\.now|new Date|window|document|useId)\b/);
    }

    vi.useFakeTimers();
    try {
      const sample = makeFile({ kind: 'image', url: '/a.png' });
      vi.setSystemTime(new Date('2026-11-26T05:00:59.950Z'));
      const ssrHtml = renderToStaticMarkup(<SendFileStage rootId={ROOT_1} file={sample} copy={KO} />);
      vi.setSystemTime(new Date('2026-11-26T05:01:00.050Z'));
      const hydrateHtml = renderToStaticMarkup(<SendFileStage rootId={ROOT_1} file={sample} copy={KO} />);
      expect(hydrateHtml).toBe(ssrHtml);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('inbox first render reads relative times against the server instant', () => {
  // Before: `threadRowWords` and `formatThreadDay` read `new Date()` during render, so a page rendered on the
  // server at 13:00:58 and hydrated at 13:01:03 printed "지금" and then "1분 전": a hydration error on a
  // minute boundary, and a wrong "오늘"/"어제" divider across Seoul midnight.
  const RENDERED_AT = '2026-11-26T04:41:10.000Z'; // 70 s after the fixture's last activity (04:40:00Z)
  const LATER = new Date('2026-11-26T15:05:00.000Z'); // the browser's clock at hydration: past Seoul midnight

  function seeds(): { inbox: SendInboxPageData; thread: SendThreadPage } {
    const thread: SendThreadPage = { ok: true, thread: makeThread(), replies: [] };
    return {
      thread,
      inbox: { ok: true, view: 'all', threads: [thread.thread], next: null, unread: 0, mentionsUnread: 0 },
    };
  }

  function markup(renderedAt: string | null): string {
    const { inbox, thread } = seeds();
    return renderToStaticMarkup(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        locale="ko"
        copy={KO}
        initialInbox={inbox}
        initialThread={thread}
        renderedAt={renderedAt}
      />,
    );
  }

  it('prints the same markup whatever the clock says, as long as the server instant is passed', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(RENDERED_AT));
      const onServer = markup(RENDERED_AT);
      vi.setSystemTime(LATER);
      const atHydration = markup(RENDERED_AT);
      expect(atHydration).toBe(onServer);
      expect(onServer).toContain(KO.today);
      // Without the instant the two renders differ: this is the mismatch the prop removes.
      const live = markup(null);
      expect(live).not.toBe(onServer);
      expect(live).not.toContain(`>${KO.today}<`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an unreadable instant and falls back to the live clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(RENDERED_AT));
      expect(markup('not a date')).toBe(markup(null));
    } finally {
      vi.useRealTimers();
    }
  });

  it('switches to the live clock after mount', async () => {
    vi.useFakeTimers();
    let dom: MountedDom | null = null;
    try {
      vi.setSystemTime(LATER);
      const { inbox, thread } = seeds();
      const transport = {
        inbox: vi.fn(async () => inbox),
        thread: vi.fn(async () => thread),
        people: vi.fn(async () => ({ ok: true as const, people: PEOPLE })),
      } as unknown as SendTransport;
      dom = await mountDom(
        <SendInboxPage
          send={{ organizationId: ORG }}
          initialThreadId={ROOT_1}
          locale="ko"
          copy={KO}
          transport={transport}
          initialInbox={inbox}
          initialThread={thread}
          renderedAt={RENDERED_AT}
        />,
      );
      await act(async () => {});
      // After mount the divider is read against the browser's clock (the next Seoul day): no longer "오늘".
      const text = dom.container.textContent ?? '';
      expect(text).toContain(KO.yesterday);
      expect(text).not.toContain(KO.today);
    } finally {
      dom?.unmount();
      vi.useRealTimers();
    }
  });
});
