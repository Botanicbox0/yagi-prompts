import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer as IdentityViewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import type { ReviewDetail, ReviewItem, ReviewList } from '@/lib/brand-studio/review-contracts';
import type { SendFileCard, SendPerson } from '@/lib/brand-rooms/send-contracts';
import type { SendInviteTransport, SendTransport } from '@/components/brand-rooms/chat/transport';
import { resetBrandSendProbe } from '@/lib/brand-rooms/members-schema';
import { resetSpineProbe } from '@/lib/brand-studio/brand-projects';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { asset, copyFor, id, job, ORG, output, studioState } from './ui/fixtures';
import { pngBytes, seedImageAsset, seedVideoAsset, studioDeps, studioFixture, viewerOf, type StudioFixture } from './server/helpers';
import { seedRun } from './server/revision-helpers';

const state = vi.hoisted(() => ({
  sql: null as SqlRunner | null,
  viewer: null as IdentityViewer | null,
  media: null as StudioMediaStore | null,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/brand/studio',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (callback: () => unknown) => void callback(),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => state.sql }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => state.viewer }));
vi.mock('@/lib/brand-studio/media-store', async (original) => {
  const actual = await original<typeof import('@/lib/brand-studio/media-store')>();
  return { ...actual, createStudioMediaStore: () => state.media ?? actual.createMemoryMediaStore() };
});
vi.mock('@/lib/brands/concierge-slack', () => ({
  notifySlackBrandConcierge: vi.fn(async () => ({ sent: false })),
}));
vi.mock('@/components/brand-workspace/bell', () => ({
  WorkspaceBell: () => createElement('span', { 'data-mock-bell': 'true' }),
}));

import { POST as shareBridgePost } from '@/app/api/brand-studio/share-bridge/route';
import { POST as roomSharesPost } from '@/app/api/brand-rooms/shares/route';
import { createShare as createRoomShare, loadSharePage } from '@/lib/brand-rooms/shares';
import { runRoomOperation } from '@/lib/brand-rooms/messages';
import { staffCreateStoryboard, staffReplaceFrames, staffShareStoryboard } from '@/lib/brand-rooms/storyboards';
import { loadReviewDetail, loadRoomReviewDetail, runRoomReviewOperation } from '@/lib/brand-studio/review';
import type { ShareLink } from '@/lib/brand-rooms/share-contracts';
import { ProjectReviewTab } from '@/components/brand-rooms/review';
import { pickSendCopy, type ViewerSendProp } from '@/components/brand-send/model';
import { FileSendButton, FileSendHost, FileSendPanelSlot } from '@/components/brand-send/file-send';
import { SendPanel } from '@/components/brand-send/send-panel';
import { INVITE_LOOKUP_DEBOUNCE_MS } from '@/components/brand-send/invite-model';
import { buildHubEntries, hubActions, type HubActionCopy } from '@/components/brand-studio/asset-hub-model';
import { HubDetail, HubTile } from '@/components/brand-studio/asset-hub-tile';
import { Wall, tileMenuKeys } from '@/components/brand-studio/gallery/wall';
import { ReviewApp } from '@/components/brand-studio/review/review-app';
import type { StudioLibrary } from '@/components/brand-studio/seams';
import { ShareReviewDialog } from '@/components/brand-studio/share-review-dialog';
import { Viewer, type ViewerActions, type ViewerItem } from '@/components/brand-studio/viewer';

const KO_DICT = getDictionary('ko');
const KO_SEND = pickSendCopy(KO_DICT);
const noop = () => {};
const viewerActions: ViewerActions = {
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

const PEOPLE: SendPerson[] = [
  { id: id(0x501), name: '김서아', role: 'owner', me: true },
  { id: id(0x502), name: '이하린', role: 'editor', me: false },
];

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

function actionCopy(): HubActionCopy {
  const h = KO_DICT.studioLibrary.hub;
  return {
    useImage: h.openInImage,
    decorate: KO_DICT.brandStudio.gallery.menu.decorate,
    makeVideo: h.openInVideo,
    compose: h.openInCompose,
    reverse: h.reverseVideo,
    share: h.shareReview,
    similar: h.findSimilar,
    edit: KO_DICT.studioLibrary.uploads.edit,
  };
}

function openSendEnv(orgId: string, invite = true) {
  vi.stubEnv('BRAND_STUDIO_V2', 'on');
  vi.stubEnv('BRAND_ROOMS', 'on');
  vi.stubEnv('BRAND_ROOM_NOTIFY', 'on');
  vi.stubEnv('BRAND_SEND', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
  vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', orgId);
  if (invite) vi.stubEnv('BRAND_SEND_INVITE', 'on');
}

async function seedAudioAsset(deps: ReturnType<typeof studioDeps>, orgId: string, by: string): Promise<string> {
  const { key } = await deps.media.put(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 10]), 'audio/mpeg');
  return (
    await deps.sql.query<{ id: string }>(
      `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, duration_ms, storage_key, source, status, created_by)
        values ($1, 'audio', 'BGM track', 'audio/mpeg', 10, 12000, $2, 'upload', 'ready', $3) returning id`,
      [orgId, key, by],
    )
  ).rows[0]!.id;
}

describe('Batch 3: workspace-internal sharing only for images when 보내기 is open (server)', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;

  beforeEach(async () => {
    resetSpineProbe();
    resetBrandSendProbe();
    f = await studioFixture();
    deps = studioDeps(f.sql);
    state.sql = f.sql;
    state.media = deps.media;
    state.viewer = viewerOf(f.ids.owner);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetSpineProbe();
    resetBrandSendProbe();
    state.sql = null;
    state.viewer = null;
    state.media = null;
    await f.db.close();
  });

  const postBridge = (body: unknown) =>
    shareBridgePost(
      new NextRequest('https://twings.app/api/brand-studio/share-bridge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://twings.app' },
        body: JSON.stringify(body),
      }),
    );

  const counts = async () =>
    (
      await f.sql.query<{ shares: number; reviews: number; messages: number; invites: number }>(
        `select (select count(*)::int from brand_room_shares) as shares,
                (select count(*)::int from brand_studio_reviews) as reviews,
                (select count(*)::int from brand_room_messages) as messages,
                (select count(*)::int from brand_invites) as invites`,
      )
    ).rows[0]!;

  it('share-bridge refuses external link creation for images (asset, output, reviewId) while keeping video, internal review/chat, and existing links', async () => {
    const imgAssetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const { outputId: imgOutputId } = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const vidAssetId = await seedVideoAsset(deps, f.orgId, f.ids.owner);
    const { outputId: vidOutputId } = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video' });

    // An existing external link created while 보내기 was still closed
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_SEND', 'off');
    const preOpenShare = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, assetId: imgAssetId, title: 'Legacy image link' },
    });
    expect(preOpenShare.status).toBe(201);
    const legacyUrl = ((await preOpenShare.json()) as { shareUrl: string; reviewId: string });
    const existingReviewId = legacyUrl.reviewId;

    // Now open 보내기 for this organization
    openSendEnv(f.orgId);
    const before = await counts();

    // 1. Refuse bridge.create_share by assetId (image)
    const imgAssetRes = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, assetId: imgAssetId },
    });
    expect(imgAssetRes.status).toBe(400);
    expect(await imgAssetRes.json()).toEqual({ ok: false, code: 'invalid' });

    // 2. Refuse bridge.create_share by outputId (image)
    const imgOutRes = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, outputId: imgOutputId },
    });
    expect(imgOutRes.status).toBe(400);
    expect(await imgOutRes.json()).toEqual({ ok: false, code: 'invalid' });

    // 3. Refuse bridge.create_share by reviewId pointing to an image
    const imgRevRes = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, reviewId: existingReviewId },
    });
    expect(imgRevRes.status).toBe(400);
    expect(await imgRevRes.json()).toEqual({ ok: false, code: 'invalid' });

    expect(await counts()).toEqual(before);

    // 4. Existing external link for image keeps working on read path
    const readExisting = await loadSharePage({ sql: f.sql, media: deps.media }, legacyUrl.shareUrl.slice('/s/'.length), { get: () => undefined });
    expect(readExisting?.state).toBe('open');

    // 5. Internal review & room chat (`issueShareLink: false`) keep working even for images
    const ensureRevRes = await postBridge({
      operation: 'bridge.ensure_review',
      input: { organizationId: f.orgId, outputId: imgOutputId, title: 'Internal still check' },
    });
    expect(ensureRevRes.status).toBe(200);
    const postChatRes = await postBridge({
      operation: 'bridge.post_chat',
      input: { organizationId: f.orgId, outputId: imgOutputId, body: '팀 검토 요청합니다' },
    });
    expect(postChatRes.status).toBe(200);
    expect(((await postChatRes.json()) as { postedMessageId: string | null }).postedMessageId).toBeTruthy();

    // 6. bridge.context marks image external link blocked while video allows it
    const imgCtx = (await (await postBridge({ operation: 'bridge.context', input: { organizationId: f.orgId, outputId: imgOutputId } })).json()) as {
      ok: boolean;
      externalLinkAllowed?: boolean;
    };
    expect(imgCtx.ok).toBe(true);
    expect(imgCtx.externalLinkAllowed).toBe(false);

    // 7. Video output & asset still mint external links cleanly
    const vidOutRes = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, outputId: vidOutputId, title: 'Video cut' },
    });
    expect(vidOutRes.status).toBe(201);
    const vidAssetRes = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, assetId: vidAssetId, title: 'Video upload' },
    });
    expect(vidAssetRes.status).toBe(201);
  });

  it('send.ts refuses invites on images in post & reply while allowing members-only image send and video/audio invites', async () => {
    openSendEnv(f.orgId, true);
    const imgAssetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const { outputId: imgOutputId } = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' });
    const { outputId: vidOutputId } = await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video' });
    const sndAssetId = await seedAudioAsset(deps, f.orgId, f.ids.owner);
    const owner = viewerOf(f.ids.owner);

    const before = await counts();

    // 1. Refuse send.post with invites on image output & image asset
    const postImgOut = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.post', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      file: { kind: 'output', outputId: imgOutputId },
      body: '외부 초대 시도',
      invites: ['ext1@example.com'],
    });
    expect(postImgOut.result).toEqual({ ok: false, code: 'invalid' });

    const postImgAsset = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.post', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      file: { kind: 'asset', assetId: imgAssetId },
      body: '이미지 업로드 외부 초대',
      invites: ['ext2@example.com'],
    });
    expect(postImgAsset.result).toEqual({ ok: false, code: 'invalid' });
    expect(await counts()).toEqual(before);

    // 2. Members-only send.post (invites: []) on image works
    const memberImgPost = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.post', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      file: { kind: 'output', outputId: imgOutputId },
      body: '내부 멤버 확인 부탁드려요',
      mentions: [f.ids.editor],
      invites: [],
    });
    expect(memberImgPost.result.ok).toBe(true);
    if (!memberImgPost.result.ok || !('thread' in memberImgPost.result)) throw new Error('expected thread');
    const imgRootId = memberImgPost.result.thread.rootId;
    const afterMemberPost = await counts();

    // 3. Refuse send.reply with invites on image thread root
    const replyImgInvite = await runRoomOperation({ sql: f.sql, media: deps.media }, viewerOf(f.ids.editor), 'send.reply', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      rootId: imgRootId,
      body: '답글에 외부 초대',
      invites: ['ext3@example.com'],
    });
    expect(replyImgInvite.result).toEqual({ ok: false, code: 'invalid' });
    expect(await counts()).toEqual(afterMemberPost);

    // 4. Members-only send.reply on image succeeds
    const replyImgMember = await runRoomOperation({ sql: f.sql, media: deps.media }, viewerOf(f.ids.editor), 'send.reply', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      rootId: imgRootId,
      body: '네 확인했어요',
      invites: [],
    });
    expect(replyImgMember.result.ok).toBe(true);

    // 5. Video & audio still allow invites in post & reply
    const postVidInvite = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.post', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      file: { kind: 'output', outputId: vidOutputId },
      body: '영상 초대',
      invites: ['vid.guest@example.com'],
    });
    expect(postVidInvite.result.ok).toBe(true);
    if (!postVidInvite.result.ok || !('thread' in postVidInvite.result)) throw new Error('expected video thread');
    const replyVidInvite = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.reply', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      rootId: postVidInvite.result.thread.rootId,
      body: '영상 답글 초대',
      invites: ['vid.guest2@example.com'],
    });
    expect(replyVidInvite.result.ok).toBe(true);

    const postAudioInvite = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.post', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      file: { kind: 'asset', assetId: sndAssetId },
      body: '오디오 초대',
      invites: ['audio.guest@example.com'],
    });
    expect(postAudioInvite.result.ok).toBe(true);
  });
});

describe('Batch 3: UI hides external links and external email invites on images when 보내기 is open', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T05:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('Wall, Viewer, AssetHub, ReviewApp, and ShareReviewDialog omit external-link controls on images while keeping them on video', () => {
    // 1. Wall tileMenuKeys
    expect(tileMenuKeys({ canGenerate: true, canEdit: true, kind: 'image', image: true, sized: true, saved: false, sendOpen: true })).not.toContain('review');
    expect(tileMenuKeys({ canGenerate: true, canEdit: true, kind: 'video', image: false, sized: true, saved: false, sendOpen: true })).toContain('review');

    // Rendered Wall HTML menu on image vs video
    const picOut = output(1);
    const picJob = job(1, { kind: 'image', outputs: [picOut] });
    const vidOut = output(2, { kind: 'video', url: 'https://media.example/st/clip.mp4', seconds: 6 });
    const vidJob = job(2, { kind: 'video', outputs: [vidOut] });
    const lib = stubLibrary();

    const picWallHtml = renderToStaticMarkup(
      createElement(Wall, {
        mode: 'image',
        jobs: [picJob],
        copy: copyFor('ko'),
        locale: 'ko',
        canGenerate: true,
        canEdit: true,
        sendOpen: true,
        library: lib,
        now: new Date('2026-11-27T05:00:00.000Z'),
        parentOf: () => null,
        onAction: noop,
        onRetry: noop,
        onNotice: noop,
      }),
    );
    expect(picWallHtml).toContain('data-studio-board');

    // 2. Viewer with send open: image hides external-link, video keeps external-link
    const sendProp: ViewerSendProp = { organizationId: ORG, copy: KO_SEND, invite: true };
    const picItem: ViewerItem = { type: 'output', output: picOut, job: picJob };
    const picAssetItem: ViewerItem = { type: 'asset', asset: asset(1) };
    const vidItem: ViewerItem = { type: 'output', output: vidOut, job: vidJob };

    for (const imgItem of [picItem, picAssetItem]) {
      const html = renderToStaticMarkup(
        createElement(Viewer, {
          items: [imgItem],
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
          actions: viewerActions,
          send: sendProp,
        }),
      );
      expect(html).toContain('data-action="send"');
      expect(html).not.toContain('data-action="external-link"');
    }

    const vidViewerHtml = renderToStaticMarkup(
      createElement(Viewer, {
        items: [vidItem],
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
        actions: viewerActions,
        send: sendProp,
      }),
    );
    expect(vidViewerHtml).toContain('data-action="send"');
    expect(vidViewerHtml).toContain('data-action="external-link"');

    // 3. AssetHub model, HubTile, HubDetail
    const picAsset = asset(1);
    const vidAsset = asset(2, { kind: 'video', url: 'https://media.example/st/v.mp4', seconds: 6 });
    const entries = buildHubEntries([picAsset, vidAsset], [picJob, vidJob], '생성 결과');
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const picUploadEntry = byKey.get(`a:${picAsset.id}`)!;
    const picOutEntry = byKey.get(`o:${picOut.id}`)!;
    const vidOutEntry = byKey.get(`o:${vidOut.id}`)!;

    for (const imgEntry of [picUploadEntry, picOutEntry]) {
      const acts = hubActions(imgEntry, {
        organizationId: ORG,
        canOpenStudio: true,
        canCreate: true,
        copy: actionCopy(),
        externalLinkLabel: KO_SEND.externalLink,
      });
      expect(acts.more.find((a) => a.key === 'share')).toBeUndefined();

      const tileHtml = renderToStaticMarkup(
        createElement(HubTile, {
          entry: imgEntry,
          copy: KO_DICT.studioLibrary,
          editedMark: KO_DICT.brandStudio.gallery.editedMark,
          name: 'Img',
          liked: false,
          main: acts.main,
          more: acts.more,
          moreLabel: '더보기',
          menuOpen: true,
          onMenu: noop,
          onOpen: noop,
          onLike: noop,
          onAction: noop,
        }),
      );
      expect(tileHtml).not.toContain('data-asset-hub-share-review');
      expect(tileHtml).not.toContain(KO_SEND.externalLink);

      const detailHtml = renderToStaticMarkup(
        createElement(HubDetail, {
          entry: imgEntry,
          copy: KO_DICT.studioLibrary,
          editedMark: KO_DICT.brandStudio.gallery.editedMark,
          name: 'Img',
          liked: false,
          main: acts.main,
          more: acts.more,
          onLike: noop,
          onAction: noop,
          onClose: noop,
          send: sendProp,
          sendJob: imgEntry.jobId ? picJob : null,
        }),
      );
      expect(detailHtml).toContain('data-asset-hub-send');
      expect(detailHtml).not.toContain('data-asset-hub-share-review');
    }

    const vidActs = hubActions(vidOutEntry, {
      organizationId: ORG,
      canOpenStudio: true,
      canCreate: true,
      copy: actionCopy(),
      externalLinkLabel: KO_SEND.externalLink,
    });
    expect(vidActs.more.find((a) => a.key === 'share')).toBeTruthy();

    // 4. ReviewApp hides share button when sendOpen && active review is image, keeps on video
    const rImg: ReviewItem = {
      id: id(0x81),
      organizationId: ORG,
      title: 'Still',
      status: 'open',
      kind: 'image',
      thumbUrl: picOut.thumbUrl,
      available: true,
      commentsOpen: 0,
      commentsTotal: 0,
      lastActivityAt: '2026-11-26T00:00:00.000Z',
      createdAt: '2026-11-26T00:00:00.000Z',
      subject: { outputId: picOut.id },
      mediaUrl: picOut.url,
      width: 1080,
      height: 1350,
      seconds: null,
      createdRole: 'brand',
      statusChangedAt: null,
    };
    const rVid: ReviewItem = { ...rImg, id: id(0x82), title: 'Film', kind: 'video', subject: { outputId: vidOut.id }, mediaUrl: vidOut.url, seconds: 6 };
    const rList: ReviewList = { ok: true, canWrite: true, reviews: [rImg, rVid] };
    const imgDetail: ReviewDetail = { ok: true, canWrite: true, review: rImg, comments: [], extended: true };
    const vidDetail: ReviewDetail = { ok: true, canWrite: true, review: rVid, comments: [], extended: true };

    const reviewImgHtml = renderToStaticMarkup(
      createElement(ReviewApp, {
        organizationId: ORG,
        locale: 'ko',
        copy: KO_DICT.studioReview,
        initialList: rList,
        initialDetail: imgDetail,
        initialMs: null,
        sendOpen: true,
      }),
    );
    expect(reviewImgHtml).not.toContain('data-review-share-open');

    const reviewVidHtml = renderToStaticMarkup(
      createElement(ReviewApp, {
        organizationId: ORG,
        locale: 'ko',
        copy: KO_DICT.studioReview,
        initialList: rList,
        initialDetail: vidDetail,
        initialMs: null,
        sendOpen: true,
      }),
    );
    expect(reviewVidHtml).toContain('data-review-share-open');

    // 5. ShareReviewDialog with sendOpen + targetKind="image" omits link section while preserving internal review & chat sections
    const dialogImgHtml = renderToStaticMarkup(
      createElement(ShareReviewDialog, {
        target: { organizationId: ORG, outputId: picOut.id, title: 'Still' },
        locale: 'ko',
        sendOpen: true,
        targetKind: 'image',
        onClose: noop,
      }),
    );
    expect(dialogImgHtml).not.toContain('data-share-bridge-link-section');
    expect(dialogImgHtml).toContain('data-share-bridge-review-section');
    expect(dialogImgHtml).toContain('data-share-bridge-chat-section');
  });

  it('FileSendHost / SendPanel suppress email invites on images while keeping member @mentions and video/audio invites', async () => {
    const picCard: SendFileCard = {
      ref: { kind: 'output', outputId: output(1).id },
      available: true,
      kind: 'image',
      name: null,
      url: 'https://media.example/st/out-1.png',
      thumbUrl: 'https://media.example/st/out-1-thumb.webp',
      width: 1080,
      height: 1350,
      project: null,
    };
    const vidCard: SendFileCard = { ...picCard, kind: 'video', url: 'https://media.example/st/v.mp4' };

    const lookupSpy = vi.fn(async (email: string) => ({ ok: true as const, email, status: 'invitable' as const, member: null }));
    const inviteTransport: SendInviteTransport = {
      organizationId: ORG,
      lookup: lookupSpy,
      post: vi.fn(async () => ({ ok: false as const, code: 'invalid' as const })),
      reply: vi.fn(async () => ({ ok: false as const, code: 'invalid' as const })),
    };
    const baseTransport = (card: SendFileCard): SendTransport => ({
      organizationId: ORG,
      file: vi.fn(async () => ({ ok: true as const, file: card, threads: [] })),
      people: vi.fn(async () => ({ ok: true as const, people: PEOPLE })),
      post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      reply: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      thread: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
      inbox: vi.fn(async () => ({ ok: true as const, view: 'all' as const, threads: [], next: null, unread: 0, mentionsUnread: 0 })),
      read: vi.fn(async () => ({ ok: true as const, rootId: id(1), lastReadAt: '2026-11-26T00:00:00.000Z' })),
      readAll: vi.fn(async () => ({ ok: true as const, marked: 0, more: false })),
    });

    // 1. FileSendHost with fileKind="image" and send.invite=true never invokes invite lookup
    mounted = await mountDom(
      <FileSendHost
        send={{ organizationId: ORG, copy: KO_SEND, invite: true, transport: baseTransport(picCard), inviteTransport }}
        fileRef={picCard.ref}
        fileKind="image"
        locale="ko"
        closeLabel={KO_DICT.brandStudio.viewer.close}
      >
        <FileSendButton dataAction="send">보내기</FileSendButton>
        <FileSendPanelSlot />
      </FileSendHost>,
    );
    await mounted.click('[data-action="send"]');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const input = mounted.query('[data-send-input]')!;
    await mounted.setValue(input, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS + 50);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(mounted.query('[data-send-invite-option]')).toBeNull();

    // Member @mention still works cleanly on the image
    await mounted.setValue(input, '@이하');
    await act(async () => {
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-picker]')?.textContent).toContain('이하린');

    await mounted.unmount();
    mounted = null;

    // 2. SendPanel on video keeps invite lookup cleanly
    mounted = await mountDom(
      createElement(SendPanel, {
        organizationId: ORG,
        fileRef: vidCard.ref,
        copy: KO_SEND,
        locale: 'ko',
        transport: baseTransport(vidCard),
        invite: true,
        inviteTransport,
        initialFile: { ok: true, file: vidCard, threads: [] },
        initialPeople: PEOPLE,
        onClose: noop,
      }),
    );
    const vidInput = mounted.query('[data-send-input]')!;
    await mounted.setValue(vidInput, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS + 50);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-send-invite-option]')).not.toBeNull();
  });
});

describe('Fix Round 3: server + UI refinements', () => {
  let f: StudioFixture;
  let deps: ReturnType<typeof studioDeps>;
  let mounted: MountedDom | null = null;

  beforeEach(async () => {
    resetSpineProbe();
    resetBrandSendProbe();
    f = await studioFixture();
    deps = studioDeps(f.sql);
    state.sql = f.sql;
    state.media = deps.media;
    state.viewer = viewerOf(f.ids.owner);
    vi.stubEnv('BRAND_STUDIO_V2', 'on');
    vi.stubEnv('BRAND_ROOMS', 'on');
    vi.stubEnv('BRAND_ROOM_NOTIFY', 'on');
    vi.stubGlobal('getComputedStyle', () => ({ top: '0px', paddingTop: '0px', getPropertyValue: () => '' }));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSpineProbe();
    resetBrandSendProbe();
    state.sql = null;
    state.viewer = null;
    state.media = null;
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
    await f.db.close();
  });

  const postBridge = (body: unknown) =>
    shareBridgePost(
      new NextRequest('https://twings.app/api/brand-studio/share-bridge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://twings.app' },
        body: JSON.stringify(body),
      }),
    );

  const postRoomShare = (body: unknown) =>
    roomSharesPost(
      new NextRequest('https://twings.app/api/brand-rooms/shares', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://twings.app' },
        body: JSON.stringify(body),
      }),
    );

  it('Item 1: /api/brand-rooms/shares refuses image reviews when open, allows video/storyboard/closed, and bridge writes nothing before refusing', async () => {
    const imgOut = (await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' })).outputId;
    const imgOutFresh = (await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' })).outputId;
    const vidOut = (await seedRun(deps, f.orgId, f.ids.owner, { kind: 'video' })).outputId;
    const rDeps = { sql: f.sql, media: deps.media };

    const imgReview = (
      await runRoomReviewOperation(rDeps, viewerOf(f.ids.owner), 'review.create', {
        organizationId: f.orgId,
        projectId: f.projectId,
        outputId: imgOut,
        title: 'Still cut',
      })
    ).result;
    const vidReview = (
      await runRoomReviewOperation(rDeps, viewerOf(f.ids.owner), 'review.create', {
        organizationId: f.orgId,
        projectId: f.projectId,
        outputId: vidOut,
        title: 'Video cut',
      })
    ).result;
    if (!imgReview.ok || !('review' in imgReview) || !vidReview.ok || !('review' in vidReview)) {
      throw new Error('expected reviews');
    }

    const admin = { ...viewerOf(f.ids.admin), isAdmin: true };
    const board = (await staffCreateStoryboard(deps, admin, { projectId: f.projectId, title: 'Story' })) as { board: { id: string } };
    await staffReplaceFrames(deps, admin, {
      storyboardId: board.board.id,
      frames: [{ picture: await pngBytes(20, 20), text: { scene: '1', shot: '1', description: 'cut' } }],
    });
    await staffShareStoryboard(deps, admin, { storyboardId: board.board.id });

    // Create pre-existing link before opening 보내기
    vi.stubEnv('BRAND_SEND', 'off');
    const pre = await postRoomShare({
      operation: 'share.create',
      input: { organizationId: f.orgId, kind: 'review', targetId: imgReview.review.id },
    });
    expect(pre.status).toBe(201);
    const preBody = (await pre.json()) as { ok: true; token: string };

    // Open 보내기 for f.orgId
    openSendEnv(f.orgId);

    const beforeReviews = (await f.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_reviews')).rows[0]!.n;
    const beforeShares = (await f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_shares')).rows[0]!.n;
    const beforeProjects = (await f.sql.query<{ n: number }>('select count(*)::int as n from brand_projects')).rows[0]!.n;

    // 1. Direct room shares route refuses image review
    const roomImgRes = await postRoomShare({
      operation: 'share.create',
      input: { organizationId: f.orgId, kind: 'review', targetId: imgReview.review.id },
    });
    expect(roomImgRes.status).toBe(400);
    expect(await roomImgRes.json()).toEqual({ ok: false, code: 'invalid' });

    // 2. Fresh output through share-bridge refuses BEFORE writing review/project/share
    const bridgeFresh = await postBridge({
      operation: 'bridge.create_share',
      input: { organizationId: f.orgId, outputId: imgOutFresh, title: 'Fresh still' },
    });
    expect(bridgeFresh.status).toBe(400);
    expect(await bridgeFresh.json()).toEqual({ ok: false, code: 'invalid' });
    expect((await f.sql.query<{ n: number }>('select count(*)::int as n from brand_studio_reviews')).rows[0]!.n).toBe(beforeReviews);
    expect((await f.sql.query<{ n: number }>('select count(*)::int as n from brand_room_shares')).rows[0]!.n).toBe(beforeShares);
    expect((await f.sql.query<{ n: number }>('select count(*)::int as n from brand_projects')).rows[0]!.n).toBe(beforeProjects);

    // 3. Video review & storyboard allowed via /api/brand-rooms/shares
    const roomVidRes = await postRoomShare({
      operation: 'share.create',
      input: { organizationId: f.orgId, kind: 'review', targetId: vidReview.review.id },
    });
    expect(roomVidRes.status).toBe(201);
    const roomBoardRes = await postRoomShare({
      operation: 'share.create',
      input: { organizationId: f.orgId, kind: 'storyboard', targetId: board.board.id },
    });
    expect(roomBoardRes.status).toBe(201);

    // 4. Pre-existing link still opens
    expect(await loadSharePage(rDeps, preBody.token, { get: () => undefined })).toMatchObject({ state: 'open' });
  });

  it('Item 2: share-bridge executes zero subjectKindOf DB queries and matches closed statement count when 보내기 is closed', async () => {
    const imgAssetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const imgOutId = (await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' })).outputId;

    const record = (sql: SqlRunner, log: string[]): SqlRunner => ({
      query: (text, params) => {
        log.push(text.replace(/\s+/g, ' ').trim());
        return sql.query(text, params);
      },
      transaction: (fn) => sql.transaction((tx) => fn(record(tx, log))),
    });

    for (const [label, setup, targetInput] of [
      ['BRAND_SEND=off', () => vi.stubEnv('BRAND_SEND', 'off'), { assetId: imgAssetId }],
      [
        'excluded org',
        () => {
          vi.stubEnv('BRAND_SEND', 'on');
          vi.stubEnv('BRAND_PROJECT_SPINE', 'on');
          vi.stubEnv('BRAND_PROJECT_SPINE_ORGS', randomUUID());
        },
        { outputId: imgOutId },
      ],
    ] as const) {
      setup();
      // Warm up roomReviewReady / spine probes once (matching production steady state)
      state.sql = f.sql;
      await postBridge({ operation: 'bridge.context', input: { organizationId: f.orgId, ...targetInput } });

      const ctxLog: string[] = [];
      state.sql = record(f.sql, ctxLog);
      const ctxRes = await postBridge({ operation: 'bridge.context', input: { organizationId: f.orgId, ...targetInput } });
      expect(ctxRes.status, label).toBe(200);
      // e062d4a7 statement count: NO extra subjectKindOf read on brand_studio_assets / brand_studio_outputs
      expect(ctxLog.some((q) => /select kind from brand_studio_(?:assets|outputs)/.test(q)), label).toBe(false);
      // Warm e062d4a7 baseline: gateSeat + contextData (no review yet) = 12 statements, NO subjectKindOf read
      const ctxCount = ctxLog.filter((q) => !/^select to_regclass/i.test(q) && !/information_schema/i.test(q)).length;
      expect(ctxCount, label).toBe(12);

      const createLog: string[] = [];
      state.sql = record(f.sql, createLog);
      const createRes = await postBridge({
        operation: 'bridge.create_share',
        input: { organizationId: f.orgId, ...targetInput, title: `Closed ${label}` },
      });
      expect(createRes.status, label).toBe(201);
      expect(createLog.some((q) => /select kind from brand_studio_(?:assets|outputs) where id = \$1 and organization_id = \$2 and deleted_at is null$/.test(q)), label).toBe(false);
    }
  });

  it('Item 3: send.reply allows invites once the thread’s image asset or output has been soft-deleted', async () => {
    openSendEnv(f.orgId, true);
    const imgAssetId = await seedImageAsset(deps, f.orgId, f.ids.owner);
    const imgOutputId = (await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' })).outputId;
    const owner = viewerOf(f.ids.owner);

    const postAsset = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.post', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      file: { kind: 'asset', assetId: imgAssetId },
      body: 'Asset root',
      invites: [],
    });
    const postOut = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.post', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      file: { kind: 'output', outputId: imgOutputId },
      body: 'Output root',
      invites: [],
    });
    if (!postAsset.result.ok || !('thread' in postAsset.result) || !postOut.result.ok || !('thread' in postOut.result)) {
      throw new Error('expected root posts');
    }

    // While image is still live, reply with invite is refused.
    expect(
      (
        await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.reply', {
          organizationId: f.orgId,
          requestId: randomUUID(),
          rootId: postAsset.result.thread.rootId,
          body: 'Before delete',
          invites: ['guest1@example.com'],
        })
      ).result,
    ).toEqual({ ok: false, code: 'invalid' });

    // Soft-delete both asset and output: deleted file has no kind -> invite rule no longer blocks reply
    await f.sql.query('update brand_studio_assets set deleted_at = now() where id = $1', [imgAssetId]);
    await f.sql.query('update brand_studio_outputs set deleted_at = now() where id = $1', [imgOutputId]);

    const replyAssetAfter = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.reply', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      rootId: postAsset.result.thread.rootId,
      body: 'After asset delete',
      invites: ['after.asset@example.com'],
    });
    expect(replyAssetAfter.result.ok).toBe(true);

    const replyOutAfter = await runRoomOperation({ sql: f.sql, media: deps.media }, owner, 'send.reply', {
      organizationId: f.orgId,
      requestId: randomUUID(),
      rootId: postOut.result.thread.rootId,
      body: 'After output delete',
      invites: ['after.out@example.com'],
    });
    expect(replyOutAfter.result.ok).toBe(true);
  });

  it('Item 4: SendPanel keeps invites enabled while unseeded file metadata is loading, hiding only once kind === image', async () => {
    vi.useFakeTimers();
    let resolveFile!: (value: { ok: true; file: SendFileCard; threads: [] }) => void;
    const pendingFile = new Promise<{ ok: true; file: SendFileCard; threads: [] }>((resolve) => {
      resolveFile = resolve;
    });
    const lookupSpy = vi.fn(async (email: string) => ({ ok: true as const, email, status: 'invitable' as const, member: null }));
    const inviteTransport: SendInviteTransport = {
      organizationId: ORG,
      lookup: lookupSpy,
      post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      reply: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
    };
    const transport: SendTransport = {
      organizationId: ORG,
      file: vi.fn(() => pendingFile),
      people: vi.fn(async () => ({ ok: true as const, people: PEOPLE })),
      post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      reply: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      thread: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
      inbox: vi.fn(async () => ({ ok: true as const, view: 'all' as const, threads: [], next: null, unread: 0, mentionsUnread: 0 })),
      read: vi.fn(async () => ({ ok: true as const, rootId: id(1), lastReadAt: '2026-11-26T00:00:00.000Z' })),
      readAll: vi.fn(async () => ({ ok: true as const, marked: 0, more: false })),
    };

    // Unseeded SendPanel (no initialFile, no fileKind) while loading: invites stay available
    mounted = await mountDom(
      createElement(SendPanel, {
        organizationId: ORG,
        fileRef: { kind: 'output', outputId: output(2).id },
        copy: KO_SEND,
        locale: 'ko',
        transport,
        invite: true,
        inviteTransport,
        initialPeople: PEOPLE,
        onClose: noop,
      }),
    );
    const input = mounted.query('[data-send-input]')!;
    await mounted.setValue(input, '@loading.video@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS + 50);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-send-invite-option]')).not.toBeNull();

    // Once resolved as image, invite option hides
    resolveFile({
      ok: true,
      file: {
        ref: { kind: 'output', outputId: output(2).id },
        available: true,
        kind: 'image',
        name: null,
        url: 'https://media.example/st/img.png',
        thumbUrl: null,
        width: 1080,
        height: 1080,
        project: null,
      },
      threads: [],
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-invite-option]')).toBeNull();
  });

  it('Item 10: review screens & share dialogs show manage-only links/revoke when an image already has external links, and nothing when none', async () => {
    openSendEnv(f.orgId, true);
    const imgOut1 = (await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' })).outputId;
    const imgOut2 = (await seedRun(deps, f.orgId, f.ids.owner, { kind: 'image' })).outputId;
    const rDeps = { sql: f.sql, media: deps.media };

    const revWithLink = (
      await runRoomReviewOperation(rDeps, viewerOf(f.ids.owner), 'review.create', {
        organizationId: f.orgId,
        projectId: f.projectId,
        outputId: imgOut1,
        title: 'Linked still',
      })
    ).result;
    const revNoLink = (
      await runRoomReviewOperation(rDeps, viewerOf(f.ids.owner), 'review.create', {
        organizationId: f.orgId,
        projectId: f.projectId,
        outputId: imgOut2,
        title: 'Unlinked still',
      })
    ).result;
    if (!revWithLink.ok || !('review' in revWithLink) || !revNoLink.ok || !('review' in revNoLink)) {
      throw new Error('expected reviews');
    }

    // Seed one pre-existing live share link on revWithLink
    vi.stubEnv('BRAND_SEND', 'off');
    const createdShare = await createRoomShare(rDeps, viewerOf(f.ids.owner), {
      organizationId: f.orgId,
      kind: 'review',
      targetId: revWithLink.review.id,
    });
    if (!createdShare.ok) throw new Error('expected pre-existing link');
    openSendEnv(f.orgId, true);

    // Server detail reports liveShareCount only when open on image
    const loadedWithLink = await loadReviewDetail(rDeps, viewerOf(f.ids.owner), f.orgId, revWithLink.review.id);
    const loadedNoLink = await loadReviewDetail(rDeps, viewerOf(f.ids.owner), f.orgId, revNoLink.review.id);
    const loadedRoomWithLink = await loadRoomReviewDetail(rDeps, viewerOf(f.ids.owner), f.orgId, f.projectId, revWithLink.review.id);
    expect(loadedWithLink.ok && loadedWithLink.review.liveShareCount).toBe(1);
    expect(loadedNoLink.ok && loadedNoLink.review.liveShareCount).toBe(0);
    expect(loadedRoomWithLink.ok && loadedRoomWithLink.review.liveShareCount).toBe(1);

    // 1. Studio ReviewApp + ShareReviewDialog manage-only UI & revoke flow
    if (!loadedWithLink.ok || !loadedNoLink.ok) throw new Error('expected details');
    const studioList: ReviewList = { ok: true, canWrite: true, reviews: [loadedWithLink.review, loadedNoLink.review] };

    // Image with NO links -> no share button
    const noLinkStudioHtml = renderToStaticMarkup(
      createElement(ReviewApp, {
        organizationId: f.orgId,
        locale: 'ko',
        copy: KO_DICT.studioReview,
        initialList: studioList,
        initialDetail: loadedNoLink,
        initialMs: null,
        sendOpen: true,
      }),
    );
    expect(noLinkStudioHtml).not.toContain('data-review-share-open');

    // Image WITH existing links -> button shown, dialog lists existing links with revoke & NO create button
    let liveShares: ShareLink[] = [createdShare.share];
    const revokeCalls: Array<{ organizationId: string; shareId: string }> = [];
    vi.stubGlobal('confirm', () => true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        if (url.includes('/api/brand-studio/share-bridge') && body?.operation === 'bridge.context') {
          return new Response(
            JSON.stringify({
              ok: true,
              canWrite: true,
              roomsOpen: true,
              externalLinkAllowed: false,
              review: {
                id: revWithLink.review.id,
                title: revWithLink.review.title,
                status: 'open',
                projectId: f.projectId,
                reviewHref: `/brand/studio/review?organizationId=${f.orgId}&review=${revWithLink.review.id}`,
              },
              projects: [{ id: f.projectId, title: 'Room', status: 'active', isDefaultWorkspace: false }],
              shares: liveShares.filter((s) => s.state === 'live'),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.includes('/api/brand-rooms/shares') && body?.operation === 'share.revoke') {
          revokeCalls.push(body.input);
          liveShares = liveShares.map((s) => (s.id === body.input.shareId ? { ...s, state: 'revoked', revokedAt: new Date().toISOString() } : s));
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/api/brand-rooms/shares')) {
          return new Response(JSON.stringify({ ok: true, shares: liveShares }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.includes('/api/brand-studio/review')) {
          return new Response(JSON.stringify({ ...loadedWithLink, review: { ...loadedWithLink.review, liveShareCount: liveShares.filter((s) => s.state === 'live').length } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (url.includes('/api/brand-rooms/reviews') && url.includes('review=')) {
          return new Response(
            JSON.stringify({
              ok: true,
              canWrite: true,
              canEdit: true,
              canTalk: true,
              review: { ...revWithLink.review, liveShareCount: liveShares.filter((s) => s.state === 'live').length },
              comments: [],
              extended: true,
              versions: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ ok: true, canEdit: true, canTalk: true, stacks: [{ stackId: revWithLink.review.id, versions: [revWithLink.review] }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    mounted = await mountDom(
      createElement(ReviewApp, {
        organizationId: f.orgId,
        locale: 'ko',
        copy: KO_DICT.studioReview,
        initialList: studioList,
        initialDetail: loadedWithLink,
        initialMs: null,
        sendOpen: true,
      }),
    );
    const patchSelect = (doc: MountedDom['document']) => {
      const origCreate = doc.createElement.bind(doc);
      doc.createElement = ((tag: string) => {
        const el = origCreate(tag);
        if (String(tag).toLowerCase() === 'select' && !('options' in el)) {
          Object.defineProperty(el, 'options', {
            get() {
              return el.children.filter((c) => c.tagName === 'OPTION');
            },
            configurable: true,
          });
        }
        return el;
      }) as MountedDom['document']['createElement'];
    };
    patchSelect(mounted.document);
    expect(mounted.query('[data-review-share-open]')).not.toBeNull();
    await mounted.click('[data-review-share-open]');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-share-bridge-link-section]')).not.toBeNull();
    expect(mounted.query('[data-share-manage-only]')).not.toBeNull();
    expect(mounted.query('[data-share-bridge-mint]')).toBeNull();
    expect(mounted.query(`[data-share-revoke="${createdShare.share.id}"]`)).not.toBeNull();

    await mounted.click(`[data-share-revoke="${createdShare.share.id}"]`);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(revokeCalls).toEqual([{ organizationId: f.orgId, shareId: createdShare.share.id }]);
    expect(mounted.query(`[data-share-revoke="${createdShare.share.id}"]`)).toBeNull();
    expect(mounted.query('[data-review-share-open]')).toBeNull();

    await mounted.unmount();
    mounted = null;

    // 2. Room ProjectReviewTab manage-only UI & revoke flow
    liveShares = [createdShare.share];
    revokeCalls.length = 0;
    mounted = await mountDom(
      createElement(ProjectReviewTab, {
        organizationId: f.orgId,
        projectId: f.projectId,
        locale: 'ko',
        copy: KO_DICT.roomsReview,
        reviewCopy: KO_DICT.studioReview,
        chatCopy: KO_DICT.roomsChat,
        canEdit: true,
        canTalk: true,
        sendOpen: true,
        initial: { reviewId: revWithLink.review.id },
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-share-open="review"]')).not.toBeNull();

    patchSelect(mounted.document);

    await mounted.click('[data-share-open="review"]');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-share-dialog]')).not.toBeNull();
    expect(mounted.query('[data-share-form]')).toBeNull();
    expect(mounted.query('[data-share-create]')).toBeNull();
    expect(mounted.query(`[data-share-revoke="${createdShare.share.id}"]`)).not.toBeNull();

    await mounted.click(`[data-share-revoke="${createdShare.share.id}"]`);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(revokeCalls).toEqual([{ organizationId: f.orgId, shareId: createdShare.share.id }]);
    expect(mounted.query(`[data-share-revoke="${createdShare.share.id}"]`)).toBeNull();
    expect(mounted.query('[data-share-open="review"]')).toBeNull();

    // Unlinked room image -> no share button
    await mounted.unmount();
    mounted = null;
    liveShares = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('review=')) {
          return new Response(
            JSON.stringify({
              ok: true,
              canWrite: true,
              canEdit: true,
              canTalk: true,
              review: { ...revNoLink.review, liveShareCount: 0 },
              comments: [],
              extended: true,
              versions: [],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ ok: true, canEdit: true, canTalk: true, stacks: [{ stackId: revNoLink.review.id, versions: [revNoLink.review] }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    mounted = await mountDom(
      createElement(ProjectReviewTab, {
        organizationId: f.orgId,
        projectId: f.projectId,
        locale: 'ko',
        copy: KO_DICT.roomsReview,
        reviewCopy: KO_DICT.studioReview,
        chatCopy: KO_DICT.roomsChat,
        canEdit: true,
        canTalk: true,
        sendOpen: true,
        initial: { reviewId: revNoLink.review.id },
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-share-open="review"]')).toBeNull();
  });
});
