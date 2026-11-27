import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendInviteTransport, SendTransport } from '@/components/brand-rooms/chat/transport';
import type { SendFileCard, SendMessage, SendPerson, SendThreadPage, SendThreadSummary } from '@/lib/brand-rooms/send-contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { buildHubEntries, hubActions, type HubActionCopy } from '@/components/brand-studio/asset-hub-model';
import { HubDetail } from '@/components/brand-studio/asset-hub-tile';
import { Viewer, type ViewerActions, type ViewerItem } from '@/components/brand-studio/viewer';
import { INVITE_LOOKUP_DEBOUNCE_MS } from '@/components/brand-send/invite-model';
import { pickSendCopy, type ViewerSendProp } from '@/components/brand-send/model';
import { SendThreadView } from '@/components/brand-send/thread-view';
import { asset, copyFor, job, output } from '../ui/fixtures';

/**
 * Inbox B Step 0 parity snapshots — captured on the untouched branch before any code edit.
 * NEVER regenerate these snapshots.
 */

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
const OUT_1 = '33333333-3333-4333-8333-333333333331';
const OUT_2 = '33333333-3333-4333-8333-333333333332';
const USER_1 = '55555555-5555-4555-8555-555555555551';
const USER_2 = '55555555-5555-4555-8555-555555555552';
const USER_3 = '55555555-5555-4555-8555-555555555553';

const KO_DICT = getDictionary('ko');
const KO = pickSendCopy(KO_DICT);

const PEOPLE: SendPerson[] = [
  { id: USER_1, name: '김서아', role: 'owner', me: true },
  { id: USER_2, name: '이하린', role: 'editor', me: false },
  { id: USER_3, name: '박도윤', role: 'viewer', me: false },
];

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

describe('Inbox B Step 0 parity snapshots (untouched hosts)', () => {
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

  it('matches untouched Step 0 parity snapshots for SendThreadView (without stage) and both Viewer / HubDetail hosts', async () => {
    const replyImg = makeMsg({
      id: '99999999-9999-4999-8999-999999999991',
      rootId: ROOT_1,
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '네, 지금 톤이 좋아요.',
      mentions: [],
      createdAt: '2026-11-26T04:45:00.000Z',
    });
    const imageThreadSeed: SendThreadPage = {
      ok: true,
      thread: makeThread({
        rootId: ROOT_1,
        root: makeMsg({ id: ROOT_1, rootId: ROOT_1, body: '이 컷 어때요?' }),
        file: makeFile({ kind: 'image' }),
        replyCount: 1,
        lastActivityAt: replyImg.createdAt,
      }),
      replies: [replyImg],
    };

    const replyVid = makeMsg({
      id: '99999999-9999-4999-8999-999999999992',
      rootId: ROOT_2,
      parentId: ROOT_2,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '첫 컷 리듬이 좋아요.',
      mentions: [],
      createdAt: '2026-11-26T04:48:00.000Z',
    });
    const videoThreadSeed: SendThreadPage = {
      ok: true,
      thread: makeThread({
        rootId: ROOT_2,
        root: makeMsg({ id: ROOT_2, rootId: ROOT_2, body: '영상 흐름 확인해 주세요.' }),
        file: makeFile({
          ref: { kind: 'output', outputId: OUT_2 },
          kind: 'video',
          url: '/api/brand-studio/media/st/clip.mp4',
          thumbUrl: '/api/brand-studio/media/st/clip-thumb.webp',
          width: 1080,
          height: 1920,
        }),
        replyCount: 1,
        lastActivityAt: replyVid.createdAt,
      }),
      replies: [replyVid],
    };

    await expect(
      renderToStaticMarkup(
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_1}
          locale="ko"
          copy={KO}
          initialThread={imageThreadSeed}
          initialPeople={PEOPLE}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/inbox-stage-parity-thread-image.html');

    await expect(
      renderToStaticMarkup(
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_2}
          locale="ko"
          copy={KO}
          initialThread={videoThreadSeed}
          initialPeople={PEOPLE}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/inbox-stage-parity-thread-video.html');

    await expect(
      renderToStaticMarkup(
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_2}
          locale="ko"
          copy={KO}
          invite
          initialThread={videoThreadSeed}
          initialPeople={PEOPLE}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/inbox-stage-parity-thread-invite-video.html');

    await expect(
      renderToStaticMarkup(
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_1}
          locale="ko"
          copy={KO}
          invite
          initialThread={imageThreadSeed}
          initialPeople={PEOPLE}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/inbox-stage-parity-thread-invite-image.html');

    const sendProp: ViewerSendProp = { organizationId: ORG, copy: KO };
    const imgOut = output(1);
    const imgJob = job(1, { outputs: [imgOut] });
    const viewerItems: ViewerItem[] = [{ type: 'output', output: imgOut, job: imgJob }];

    await expect(
      renderToStaticMarkup(
        <Viewer
          items={viewerItems}
          index={0}
          copy={copyFor('ko')}
          locale="ko"
          organizationId={ORG}
          canCreate
          canGenerate
          busy={null}
          notice={null}
          parentOf={() => null}
          onIndex={noop}
          onClose={noop}
          actions={viewerActions}
          send={sendProp}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/inbox-stage-parity-viewer-send.html');

    const imgAsset = asset(1, { name: 'Hero Bottle', role: 'product' });
    const assetEntry = buildHubEntries([imgAsset], [], KO_DICT.studioLibrary.hub.sourceGenerated)[0]!;
    const acts = hubActions(assetEntry, {
      organizationId: ORG,
      canOpenStudio: true,
      canCreate: true,
      copy: actionCopy(),
      externalLinkLabel: KO.externalLink,
    });

    await expect(
      renderToStaticMarkup(
        <HubDetail
          entry={assetEntry}
          copy={KO_DICT.studioLibrary}
          name="Hero Bottle"
          liked={false}
          main={acts.main}
          more={acts.more}
          onLike={noop}
          onAction={noop}
          onClose={noop}
          send={sendProp}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/inbox-stage-parity-hub-detail-send.html');
  });

  it('keeps the one intended item 4 invite difference between video and image threads without changing anything else', async () => {
    const transport: SendTransport = {
      organizationId: ORG,
      post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      reply: vi.fn(async () => ({ ok: true as const, thread: makeThread(), message: makeMsg() })),
      thread: vi.fn(async () => ({ ok: true as const, thread: makeThread(), replies: [] })),
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
      inbox: vi.fn(async () => ({ ok: true as const, view: 'all' as const, threads: [], next: null, unread: 0, mentionsUnread: 0 })),
      read: vi.fn(async () => ({ ok: true as const, rootId: ROOT_1, lastReadAt: '2026-11-26T05:00:00.000Z' })),
      readAll: vi.fn(async () => ({ ok: true as const, marked: 0, more: false })),
      people: vi.fn(async () => ({ ok: true as const, people: PEOPLE })),
    };
    const inviteTransport: SendInviteTransport = {
      organizationId: ORG,
      post: vi.fn(async () => ({ ok: false as const, code: 'failed' as const })),
      reply: vi.fn(async () => ({ ok: true as const, thread: makeThread(), message: makeMsg() })),
      lookup: vi.fn(async (email: string) => ({ ok: true as const, email, status: 'invitable' as const, member: null })),
    };

    const videoSeed: SendThreadPage = {
      ok: true,
      thread: makeThread({
        rootId: ROOT_2,
        root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }),
        file: makeFile({ ref: { kind: 'output', outputId: OUT_2 }, kind: 'video', url: '/api/brand-studio/media/st/clip.mp4' }),
      }),
      replies: [],
    };
    const imageSeed: SendThreadPage = {
      ok: true,
      thread: makeThread({ rootId: ROOT_1, file: makeFile({ kind: 'image' }) }),
      replies: [],
    };

    mounted = await mountDom(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_2}
        locale="ko"
        copy={KO}
        transport={transport}
        invite
        inviteTransport={inviteTransport}
        initialThread={videoSeed}
        markSeedRead={false}
        initialPeople={PEOPLE}
      />,
    );
    const vidInput = mounted.query('[data-send-input]')!;
    await mounted.setValue(vidInput, '확인 부탁 @new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(inviteTransport.lookup).toHaveBeenCalledWith('new.person@example.com');
    expect(mounted.query('[data-send-invite-option]')).not.toBeNull();
    await mounted.keyDown('Enter', { target: vidInput });
    await mounted.keyDown('Enter', { target: vidInput });
    expect(inviteTransport.reply).toHaveBeenCalledTimes(1);

    await mounted.unmount();
    mounted = null;
    vi.mocked(inviteTransport.lookup).mockClear();
    vi.mocked(inviteTransport.reply).mockClear();

    mounted = await mountDom(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        transport={transport}
        invite
        inviteTransport={inviteTransport}
        initialThread={imageSeed}
        markSeedRead={false}
        initialPeople={PEOPLE}
      />,
    );
    const imgInput = mounted.query('[data-send-input]')!;
    await mounted.setValue(imgInput, '확인 부탁 @new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(inviteTransport.lookup).not.toHaveBeenCalled();
    expect(mounted.query('[data-send-picker]')).toBeNull();
    await mounted.keyDown('Enter', { target: imgInput });
    expect(inviteTransport.reply).not.toHaveBeenCalled();
    expect(transport.reply).toHaveBeenCalledTimes(1);
  });
});
