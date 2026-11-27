import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer as IdentityViewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import type { ReviewComment, ReviewDetail, ReviewItem, ReviewList } from '@/lib/brand-studio/review-contracts';
import type { SendFileCard, SendMessage, SendPerson, SendThreadSummary } from '@/lib/brand-rooms/send-contracts';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { asset, copyFor, id, job, ORG, output, studioState } from './ui/fixtures';
import { seedImageAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';
import { seedRun } from './server/revision-helpers';

/**
 * Batch 3 Step 0 parity snapshots — captured ON UNTOUCHED CODE with 보내기 closed before any Batch 3 edit.
 * NEVER regenerate these snapshots after Batch 3 edits begin.
 */

const bridgeState = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as IdentityViewer | null,
  media: null as StudioMediaStore | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/brand/studio',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (callback: () => unknown) => void callback(),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => bridgeState.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => bridgeState.viewer }));
vi.mock('@/lib/brand-studio/media-store', async (original) => {
  const actual = await original<typeof import('@/lib/brand-studio/media-store')>();
  return { ...actual, createStudioMediaStore: () => bridgeState.media ?? actual.createMemoryMediaStore() };
});
vi.mock('@/lib/brands/concierge-slack', () => ({
  notifySlackBrandConcierge: vi.fn(async () => ({ sent: false })),
}));
vi.mock('@/components/brand-workspace/bell', () => ({
  WorkspaceBell: () => createElement('span', { 'data-mock-bell': 'true' }),
}));

import { POST as shareBridgePost } from '@/app/api/brand-studio/share-bridge/route';
import { loadSharePage } from '@/lib/brand-rooms/shares';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { pickSendCopy } from '@/components/brand-send/model';
import { SendPanel } from '@/components/brand-send/send-panel';
import { BrandAssetHub } from '@/components/brand-studio/asset-hub';
import { buildHubEntries, hubActions, type HubActionCopy } from '@/components/brand-studio/asset-hub-model';
import { HubDetail, HubTile } from '@/components/brand-studio/asset-hub-tile';
import { createStudioApi } from '@/components/brand-studio/api';
import { Wall, tileMenuKeys } from '@/components/brand-studio/gallery/wall';
import { ReviewApp } from '@/components/brand-studio/review/review-app';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { ShareReviewDialog } from '@/components/brand-studio/share-review-dialog';
import { Viewer, type ViewerActions, type ViewerItem } from '@/components/brand-studio/viewer';

const KO_DICT = getDictionary('ko');
const EN_DICT = getDictionary('en');
const KO_SEND = pickSendCopy(KO_DICT);

const noop = () => {};
const baseViewerActions: ViewerActions = {
  regionEdit: async () => true,
  rerun: noop,
  toVideo: noop,
  reference: noop,
  save: noop,
  campaign: noop,
  finalize: noop,
  reuse: noop,
  remove: async () => true,
  decorate: noop,
  review: noop,
};

function stubLibrary(): StudioLibrary {
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
  };
}

function actionCopy(locale: 'ko' | 'en'): HubActionCopy {
  const dict = locale === 'ko' ? KO_DICT : EN_DICT;
  const h = dict.studioLibrary.hub;
  return {
    useImage: h.openInImage,
    decorate: dict.brandStudio.gallery.menu.decorate,
    makeVideo: h.openInVideo,
    compose: h.openInCompose,
    reverse: h.reverseVideo,
    share: h.shareReview,
    similar: h.findSimilar,
    edit: dict.studioLibrary.uploads.edit,
  };
}

function reviewItem(reviewId: string, kind: 'image' | 'video'): ReviewItem {
  return {
    id: reviewId,
    organizationId: ORG,
    title: kind === 'video' ? 'Launch film v1' : 'Still key visual',
    status: 'open',
    kind,
    thumbUrl: 'https://media.example/st/thumb.webp',
    available: true,
    commentsOpen: 1,
    commentsTotal: 1,
    lastActivityAt: '2026-11-26T01:00:00.000Z',
    createdAt: '2026-11-26T00:00:00.000Z',
    subject: { outputId: output(kind === 'image' ? 1 : 2).id },
    mediaUrl: kind === 'video' ? 'https://media.example/st/clip.mp4' : 'https://media.example/st/out-1.png',
    width: 1080,
    height: 1350,
    seconds: kind === 'video' ? 6 : null,
    createdRole: 'brand',
    statusChangedAt: null,
  };
}

const sampleNote: ReviewComment = {
  id: id(0x901),
  parentId: null,
  authorName: '서아',
  authorRole: 'brand',
  body: '구도 확인해 주세요',
  atMs: null,
  x: 0.4,
  y: 0.5,
  resolved: false,
  createdAt: '2026-11-26T00:30:00.000Z',
  deleted: false,
  mine: true,
};

const PEOPLE: SendPerson[] = [
  { id: id(0x501), name: '김서아', role: 'owner', me: true },
  { id: id(0x502), name: '이하린', role: 'editor', me: false },
];

describe('Batch 3 Step 0 parity baseline (보내기 closed / UI untouched)', () => {
  const fixedNow = new Date('2026-11-27T05:00:00.000Z');
  let f: StudioFixture;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    resetSpineProbe();
    resetBrandSendProbe();
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_SEND', 'off');
    vi.stubEnv('BRAND_SEND_INVITE', 'off');
    f = await studioFixture();
    const deps = studioDeps(f.sql);
    bridgeState.sql = f.sql;
    bridgeState.media = deps.media;
    bridgeState.viewer = viewerOf(f.ids.owner);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    resetSpineProbe();
    resetBrandSendProbe();
    bridgeState.sql = null;
    bridgeState.viewer = null;
    bridgeState.media = null;
    await f.db.close();
  });

  it('UI renders byte-identically across Wall, Viewer, AssetHub, ReviewApp, ShareReviewDialog, and SendPanel without invite', async () => {
    const picOut = output(1);
    const picJob = job(1, { kind: 'image', outputs: [picOut] });
    const vidOut = output(2, { kind: 'video', url: 'https://media.example/st/out-2.mp4', seconds: 6, width: 720, height: 1280 });
    const vidJob = job(2, { kind: 'video', aspect: '9:16', resolution: '720p', seconds: 6, outputs: [vidOut] });
    const picAsset = asset(1, { name: 'Studio flacon', role: 'product' });
    const vidAsset = asset(2, { kind: 'video', name: 'Ref cut', url: 'https://media.example/st/ref.mp4', seconds: 6 });
    const sndAsset = asset(3, { kind: 'audio', name: 'Track', url: 'https://media.example/st/track.mp3', width: null, height: null, thumbUrl: null, seconds: 12 });

    expect(tileMenuKeys({ canGenerate: true, canEdit: true, kind: 'image', image: true, sized: true, saved: false })).toMatchInlineSnapshot(`
      [
        "open",
        "rerun",
        "reuse",
        "region",
        "decorate",
        "to-video",
        "folder",
        "review",
        "campaign",
        "save",
        "download",
        "delete",
      ]
    `);
    expect(tileMenuKeys({ canGenerate: true, canEdit: true, kind: 'video', image: false, sized: true, saved: false })).toMatchInlineSnapshot(`
      [
        "open",
        "rerun",
        "reuse",
        "folder",
        "review",
        "campaign",
        "save",
        "download",
        "delete",
      ]
    `);

    const lib = stubLibrary();
    const imageWallHtml = renderToStaticMarkup(
      createElement(Wall, {
        mode: 'image',
        jobs: [picJob],
        copy: copyFor('ko'),
        locale: 'ko',
        canGenerate: true,
        canEdit: true,
        library: lib,
        now: fixedNow,
        parentOf: () => null,
        onAction: noop,
        onRetry: noop,
        onNotice: noop,
      }),
    );
    await expect(imageWallHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/wall-image.html');

    const videoWallHtml = renderToStaticMarkup(
      createElement(Wall, {
        mode: 'video',
        jobs: [vidJob],
        copy: copyFor('ko'),
        locale: 'ko',
        canGenerate: true,
        canEdit: true,
        library: lib,
        now: fixedNow,
        parentOf: () => null,
        onAction: noop,
        onRetry: noop,
        onNotice: noop,
      }),
    );
    await expect(videoWallHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/wall-video.html');

    const viewerImageOutHtml = renderToStaticMarkup(
      createElement(Viewer, {
        items: [{ type: 'output', output: picOut, job: picJob }],
        index: 0,
        copy: copyFor('ko'),
        locale: 'ko',
        canCreate: true,
        canGenerate: true,
        busy: null,
        notice: null,
        parentOf: () => null,
        onIndex: noop,
        onClose: noop,
        actions: baseViewerActions,
      }),
    );
    await expect(viewerImageOutHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/viewer-image-output.html');

    const viewerImageAssetHtml = renderToStaticMarkup(
      createElement(Viewer, {
        items: [{ type: 'asset', asset: picAsset }],
        index: 0,
        copy: copyFor('ko'),
        locale: 'ko',
        canCreate: true,
        canGenerate: true,
        busy: null,
        notice: null,
        parentOf: () => null,
        onIndex: noop,
        onClose: noop,
        actions: baseViewerActions,
      }),
    );
    await expect(viewerImageAssetHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/viewer-image-asset.html');

    const viewerVideoOutHtml = renderToStaticMarkup(
      createElement(Viewer, {
        items: [{ type: 'output', output: vidOut, job: vidJob }],
        index: 0,
        copy: copyFor('ko'),
        locale: 'ko',
        canCreate: true,
        canGenerate: true,
        busy: null,
        notice: null,
        parentOf: () => null,
        onIndex: noop,
        onClose: noop,
        actions: baseViewerActions,
      }),
    );
    await expect(viewerVideoOutHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/viewer-video-output.html');

    const hubEntries = buildHubEntries([picAsset, vidAsset, sndAsset], [picJob, vidJob], '생성 결과');
    const byKey = new Map(hubEntries.map((e) => [e.key, e]));
    const picUploadEntry = byKey.get(`a:${picAsset.id}`)!;
    const picOutEntry = byKey.get(`o:${picOut.id}`)!;
    const vidOutEntry = byKey.get(`o:${vidOut.id}`)!;
    const ac = actionCopy('ko');

    expect(
      hubActions(picUploadEntry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: ac }),
    ).toMatchInlineSnapshot(`
      {
        "main": {
          "href": "/brand/studio?organizationId=000000a0-0000-4000-8000-0000000000a0&ref=a%3A00003001-0000-4000-8000-000000003001",
          "key": "useImage",
          "label": "이미지 스튜디오로",
          "marker": "data-asset-hub-use-image",
        },
        "more": [
          {
            "href": "/brand/studio?organizationId=000000a0-0000-4000-8000-0000000000a0&canvas=a%3A00003001-0000-4000-8000-000000003001",
            "key": "decorate",
            "label": "디테일 편집",
            "marker": "data-asset-hub-open-canvas",
          },
          {
            "href": "/brand/studio/video?organizationId=000000a0-0000-4000-8000-0000000000a0&from=a%3A00003001-0000-4000-8000-000000003001",
            "key": "makeVideo",
            "label": "영상 만들기",
            "marker": "data-asset-hub-use-video",
          },
          {
            "key": "share",
            "label": "검수 · 공유",
            "marker": "data-asset-hub-share-review",
          },
          {
            "key": "similar",
            "label": "비슷한 항목",
            "marker": "data-asset-hub-similar",
          },
          {
            "key": "edit",
            "label": "정보 고치기",
            "marker": "data-asset-hub-edit",
          },
        ],
      }
    `);

    const picUploadActs = hubActions(picUploadEntry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: ac });
    const picTileHtml = renderToStaticMarkup(
      createElement(HubTile, {
        entry: picUploadEntry,
        copy: KO_DICT.studioLibrary,
        editedMark: KO_DICT.brandStudio.gallery.editedMark,
        name: picAsset.name,
        liked: false,
        main: picUploadActs.main,
        more: picUploadActs.more,
        moreLabel: `${picAsset.name} 더보기`,
        menuOpen: true,
        onMenu: noop,
        onOpen: noop,
        onLike: noop,
        onAction: noop,
      }),
    );
    await expect(picTileHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/hub-tile-image-menu.html');

    const picDetailActs = hubActions(picOutEntry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: ac });
    const picDetailHtml = renderToStaticMarkup(
      createElement(HubDetail, {
        entry: picOutEntry,
        copy: KO_DICT.studioLibrary,
        editedMark: KO_DICT.brandStudio.gallery.editedMark,
        name: 'Output pic',
        liked: false,
        main: picDetailActs.main,
        more: picDetailActs.more,
        onLike: noop,
        onAction: noop,
        onClose: noop,
      }),
    );
    await expect(picDetailHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/hub-detail-image.html');

    const vidDetailActs = hubActions(vidOutEntry, { organizationId: ORG, canOpenStudio: true, canCreate: true, copy: ac });
    const vidDetailHtml = renderToStaticMarkup(
      createElement(HubDetail, {
        entry: vidOutEntry,
        copy: KO_DICT.studioLibrary,
        editedMark: KO_DICT.brandStudio.gallery.editedMark,
        name: 'Output vid',
        liked: false,
        main: vidDetailActs.main,
        more: vidDetailActs.more,
        onLike: noop,
        onAction: noop,
        onClose: noop,
      }),
    );
    await expect(vidDetailHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/hub-detail-video.html');

    const seededHubState = studioState({ assets: [picAsset, vidAsset, sndAsset], jobs: [picJob, vidJob] });
    const hubHtml = renderToStaticMarkup(
      createElement(BrandAssetHub, {
        organizationId: ORG,
        studioCopy: KO_DICT.brandStudio,
        libraryCopy: KO_DICT.studioLibrary,
        initialState: seededHubState,
        initialAllView: 'all',
        injectedLibrary: lib,
        api: {
          ...createStudioApi({ organizationId: ORG }),
          loadState: async () => seededHubState,
        },
      }),
    );
    await expect(hubHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/asset-hub-all.html');

    const rImgId = id(0x801);
    const rVidId = id(0x802);
    const rImgItem = reviewItem(rImgId, 'image');
    const rVidItem = reviewItem(rVidId, 'video');
    const list: ReviewList = { ok: true, canWrite: true, reviews: [rImgItem, rVidItem] };
    const imgDetail: ReviewDetail = { ok: true, canWrite: true, review: rImgItem, comments: [sampleNote], extended: true };
    const reviewImgHtml = renderToStaticMarkup(
      createElement(ReviewApp, {
        organizationId: ORG,
        locale: 'ko',
        copy: KO_DICT.studioReview,
        initialList: list,
        initialDetail: imgDetail,
        initialMs: null,
      }),
    );
    await expect(reviewImgHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/review-app-image.html');

    const dialogHtml = renderToStaticMarkup(
      createElement(ShareReviewDialog, {
        target: { organizationId: ORG, outputId: picOut.id, title: 'Still check' },
        locale: 'ko',
        onClose: noop,
      }),
    );
    await expect(dialogHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/share-review-dialog.html');

    const fileCard: SendFileCard = {
      ref: { kind: 'output', outputId: picOut.id },
      available: true,
      kind: 'image',
      name: null,
      url: picOut.url,
      thumbUrl: picOut.thumbUrl,
      width: picOut.width,
      height: picOut.height,
      project: null,
    };
    const msg: SendMessage = {
      id: id(0x701),
      rootId: id(0x701),
      parentId: null,
      authorId: PEOPLE[0]!.id,
      authorName: '김서아',
      mine: true,
      body: '확인해 주세요',
      mentions: [],
      createdAt: '2026-11-26T04:40:00.000Z',
    };
    const thread: SendThreadSummary = {
      rootId: msg.id,
      root: msg,
      file: fileCard,
      replyCount: 0,
      lastActivityAt: msg.createdAt,
      latest: { messageId: msg.id, authorId: msg.authorId, authorName: msg.authorName, mine: true, line: msg.body, at: msg.createdAt },
      mentioned: false,
      unread: false,
      lastReadAt: null,
    };
    const sendPanelNoInviteHtml = renderToStaticMarkup(
      createElement(SendPanel, {
        organizationId: ORG,
        fileRef: fileCard.ref,
        copy: KO_SEND,
        locale: 'ko',
        initialFile: { ok: true, file: fileCard, threads: [thread] },
        initialPeople: PEOPLE,
        onClose: noop,
      }),
    );
    await expect(sendPanelNoInviteHtml).toMatchFileSnapshot('./__snapshots__/send-image-closed/send-panel-no-invite.html');
  });

  it('Server share-bridge and send.ts keep closed-보내기 behavior verbatim on images', async () => {
    const deps = studioDeps(f.sql);
    bridgeState.media = deps.media;
    const assetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const { outputId } = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });

    const postBridge = (body: unknown) =>
      shareBridgePost(
        new NextRequest('https://twings.app/api/brand-studio/share-bridge', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://twings.app' },
          body: JSON.stringify(body),
        }),
      );

    // Closed 보내기: share-bridge still creates external links on image asset & image output
    const resAsset = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, assetId, title: 'Img asset share' },
    });
    expect(resAsset.status).toBe(201);
    const jsonAsset = (await resAsset.json()) as { ok: boolean; reviewId: string; shareUrl: string; share: { allowComments: boolean } };
    expect(jsonAsset.ok).toBe(true);
    expect(jsonAsset.shareUrl).toMatch(/^\/s\/[A-Za-z0-9_-]{20,}$/);

    const loaded = await loadSharePage({ sql: f.sql, media: deps.media }, jsonAsset.shareUrl.slice('/s/'.length), { get: () => undefined });
    expect(loaded?.state).toBe('open');

    const resOut = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, outputId, title: 'Img output share' },
    });
    expect(resOut.status).toBe(201);
    const jsonOut = (await resOut.json()) as { ok: boolean; reviewId: string; shareUrl: string };
    expect(jsonOut.ok).toBe(true);
    expect(jsonOut.shareUrl).toMatch(/^\/s\/[A-Za-z0-9_-]{20,}$/);

    const ctxRes = await postBridge({ operation: 'bridge.context', input: { organizationId: f.orgId, assetId } });
    expect(ctxRes.status).toBe(200);
    const ctxJson = (await ctxRes.json()) as Record<string, unknown>;
    expect(Object.keys(ctxJson).sort()).toEqual(['canWrite', 'ok', 'projects', 'review', 'roomsOpen', 'shares']);

    // Closed 보내기: send.post & send.reply still answer invalid
    const postClosed = await runRoomOperation(
      { sql: f.sql, media: deps.media },
      viewerOf(f.ids.owner),
      'send.post',
      { organizationId: f.orgId, requestId: randomUUID(), file: { kind: 'output', outputId }, body: 'hi', invites: ['a@b.com'] },
    );
    expect(postClosed.result).toEqual({ ok: false, code: 'invalid' });
  });
});
