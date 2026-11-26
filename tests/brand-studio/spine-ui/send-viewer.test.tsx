import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendTransport } from '@/components/brand-rooms/chat/transport';
import type {
  SendFileCard,
  SendFileRef,
  SendFileThreads,
  SendMessage,
  SendPerson,
  SendThreadSummary,
} from '@/lib/brand-rooms/send-contracts';
import type { Viewer as IdentityViewer } from '@/lib/auth/identity';
import type { BrandWorkspaceChoice } from '@/lib/brands/workspace/selection';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { getDictionary } from '@/lib/i18n/dictionaries';
import type { StudioSpineProps } from '@/lib/brand-studio/open-project';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { ORG, asset, copyFor, id, job, output, studioState } from '../ui/fixtures';
import { pickSendCopy, type ViewerSendProp } from '@/components/brand-send/model';
import { SendPageScope } from '@/components/brand-send/file-send';
import { SendPanel } from '@/components/brand-send/send-panel';
import { Viewer, type ViewerActions, type ViewerItem } from '@/components/brand-studio/viewer';

const PROJ = id(0x61);

const OUT_1 = output(1).id;
const ASSET_1 = asset(1).id;
const ROOT_1 = id(0x21);
const ROOT_2 = id(0x22);
const USER_1 = id(0x31);
const USER_2 = id(0x32);
const USER_3 = id(0x33);

const KO_DICT = getDictionary('ko');
const EN_DICT = getDictionary('en');
const KO = pickSendCopy(KO_DICT);
const EN = pickSendCopy(EN_DICT);

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
    body: '@김서아 립 컬러는 이 컷이 제일 자연스러워요.',
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

const hostMocks = vi.hoisted(() => ({
  orgId: '',
  userId: '',
  sendSwitchesOn: true,
  sendOpenFor: true,
  spine: null as StudioSpineProps | null,
  role: 'owner' as 'owner' | 'editor' | 'viewer' | 'guest' | 'studio',
  staff: false,
  studioAppProps: null as Record<string, unknown> | null,
  videoWorkspaceProps: null as Record<string, unknown> | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/brand/studio',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags');
  return {
    ...actual,
    brandStudioV2Open: () => true,
    brandRoomsOpen: () => true,
    brandRoomNotifyOpen: () => true,
    brandStudioProjectsOpen: () => true,
  };
});

vi.mock('@/lib/brand-rooms/members-channel', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-rooms/members-channel')>(
    '@/lib/brand-rooms/members-channel',
  );
  return {
    ...actual,
    brandSendSwitchesOn: () => hostMocks.sendSwitchesOn,
    brandSendOpenFor: vi.fn(async () => hostMocks.sendOpenFor),
  };
});

vi.mock('@/lib/brand-studio/open-project-server', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/open-project-server')>(
    '@/lib/brand-studio/open-project-server',
  );
  return {
    ...actual,
    loadStudioSpine: vi.fn(async (input: Parameters<typeof actual.loadStudioSpine>[0]) => {
      if (input.seat.staff || input.seat.role === 'guest') return null;
      return hostMocks.spine;
    }),
  };
});

vi.mock('@/lib/brand-studio/runtime', () => ({
  studioRuntimeDeps: vi.fn(async (sql: SqlRunner) => ({ sql })),
}));

vi.mock('@/lib/brand-studio/service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/service')>('@/lib/brand-studio/service');
  return {
    ...actual,
    loadStudioState: vi.fn(async () => studioState()),
  };
});

vi.mock('@/lib/brand-studio/video-projects', async () => {
  const actual = await vi.importActual<typeof import('@/lib/brand-studio/video-projects')>(
    '@/lib/brand-studio/video-projects',
  );
  return {
    ...actual,
    loadVideoProjects: vi.fn(async () => ({ ok: true, projects: [], project: null })),
  };
});

vi.mock('@/components/brand-studio/video/contracts-link', () => ({
  hasProductionContracts: vi.fn(async () => false),
}));

vi.mock('@/components/brand-studio/route-context', async () => {
  const { getDictionary: getDict } = await import('@/lib/i18n/dictionaries');
  return {
    studioRouteOrShowroom: vi.fn(async () => ({
      kind: 'studio' as const,
      choice: {
        id: hostMocks.orgId,
        name: 'Lumiere',
        role: hostMocks.role,
        logoUrl: null,
      },
      access: {
        hasOrganization: true,
        isOwner: hostMocks.role === 'owner',
        staff: hostMocks.staff,
        canRequest: hostMocks.role !== 'viewer',
        fresh: false,
      },
      viewer: { userId: hostMocks.userId, isAdmin: hostMocks.staff },
      locale: 'ko' as const,
      dict: getDict('ko'),
      deps: { sql: {} as SqlRunner, verifiedEmail: 'owner@lumiere.test' },
    })),
  };
});

vi.mock('@/components/brand-studio/studio-app', async () => {
  const actual = await vi.importActual<typeof import('@/components/brand-studio/studio-app')>(
    '@/components/brand-studio/studio-app',
  );
  return {
    ...actual,
    StudioApp: (props: Record<string, unknown>) => {
      hostMocks.studioAppProps = props;
      return <div data-stub-studio-app data-has-send={props.send ? 'true' : 'false'} />;
    },
  };
});

vi.mock('@/components/brand-studio/video/workspace', async () => {
  const actual = await vi.importActual<typeof import('@/components/brand-studio/video/workspace')>(
    '@/components/brand-studio/video/workspace',
  );
  return {
    ...actual,
    VideoStudioWorkspace: (props: Record<string, unknown>) => {
      hostMocks.videoWorkspaceProps = props;
      return <div data-stub-video-workspace data-has-send={props.send ? 'true' : 'false'} />;
    },
  };
});

const noop = () => {};
const baseActions: ViewerActions = {
  regionEdit: async () => true,
  rerun: noop,
  toVideo: noop,
  reference: noop,
  save: noop,
  campaign: noop,
  finalize: noop,
  reuse: noop,
  remove: async () => true,
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

async function mountViewerDom(node: Parameters<typeof mountDom>[0]): Promise<MountedDom> {
  const dom = await mountDom(null);
  const g = globalThis as unknown as { Element?: { prototype: Record<string, unknown> } };
  if (g.Element?.prototype && !g.Element.prototype.getAttributeNames) {
    g.Element.prototype.getAttributeNames = function getAttributeNames(this: { attributes?: Record<string, string> }) {
      return Object.keys(this.attributes ?? {});
    };
  }
  await dom.rerender(node);
  return dom;
}

describe('SendPanel SSR and DOM behaviour (Batch C)', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('renders panel SSR markup with existing file conversations, empty state, and deleted file with threads', () => {
    const t1 = makeThread({
      rootId: ROOT_1,
      replyCount: 2,
      lastActivityAt: '2026-11-26T04:40:00.000Z',
      root: makeMsg({ id: ROOT_1, rootId: ROOT_1, authorName: '이하린', body: '첫 번째 의견이에요.' }),
    });
    const t2 = makeThread({
      rootId: ROOT_2,
      replyCount: 0,
      lastActivityAt: '2026-11-26T04:00:00.000Z',
      root: makeMsg({ id: ROOT_2, rootId: ROOT_2, authorName: '박도윤', body: '두 번째 의견이에요.' }),
    });
    const initialWithThreads: SendFileThreads = { ok: true, file: makeFile(), threads: [t1, t2] };

    const withHtml = renderToStaticMarkup(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        initialFile={initialWithThreads}
        onClose={noop}
      />,
    );
    expect(withHtml).toContain('data-send-panel');
    expect(withHtml).toContain(KO.action);
    expect(withHtml).toContain(KO.sendSub);
    expect(withHtml).toContain(KO.sendHint);
    expect(withHtml).not.toContain(KO.composerHint);
    expect(withHtml).toContain('이하린');
    expect(withHtml).toContain('>이<');
    expect(withHtml).toContain('>박<');
    expect(withHtml).toContain('첫 번째 의견이에요.');
    expect(withHtml).toContain(' · 답글 2');
    expect(withHtml).toContain(`/brand/inbox?organizationId=${ORG}&amp;thread=${ROOT_1}`);
    expect(withHtml).toContain('두 번째 의견이에요.');
    expect(withHtml).not.toContain('답글 0');
    expect(withHtml).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*?<(?:p|div|button)\b/);
    const panelCss = readFileSync(path.join(process.cwd(), 'components/brand-send/send-panel.module.css'), 'utf8');
    expect(panelCss).toContain('.avatar');
    expect(panelCss).toMatch(/\.rowLink,\s*\.rowPending\s*\{[^}]*align-items:\s*center;/s);
    expect(withHtml).toContain('data-send-composer');
    expect(withHtml).toContain(KO.sendPlaceholder);
    expect(withHtml).not.toContain('<video');

    const emptyHtml = renderToStaticMarkup(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={EN}
        locale="en"
        initialFile={{ ok: true, file: makeFile(), threads: [] }}
        onClose={noop}
      />,
    );
    expect(emptyHtml).toContain('saved in the recipient');
    expect(emptyHtml).toContain(EN.sendPlaceholder);

    const goneWithThreadsHtml = renderToStaticMarkup(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        initialFile={{ ok: true, file: makeFile({ available: false }), threads: [t1] }}
        onClose={noop}
      />,
    );
    expect(goneWithThreadsHtml).toContain(KO.fileGone);
    expect(goneWithThreadsHtml).toContain('첫 번째 의견이에요.');
    expect(goneWithThreadsHtml).not.toContain('data-send-composer');
  });

  it('loads send.file once across 3 parent re-renders, posts optimistically, keeps focus on click send, and handles refusals', async () => {
    const tExisting = makeThread({
      rootId: ROOT_1,
      replyCount: 1,
      root: makeMsg({ id: ROOT_1, rootId: ROOT_1, authorName: '이하린', body: '기존 대화' }),
    });
    let resolvePost!: (v: Awaited<ReturnType<SendTransport['post']>>) => void;
    const postPromise = new Promise<Awaited<ReturnType<SendTransport['post']>>>((r) => {
      resolvePost = r;
    });

    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [tExisting] })),
      post: vi.fn(() => postPromise),
    });

    mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={transport}
        onClose={noop}
      />,
    );
    await flush();

    expect(transport.file).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toContain('기존 대화');

    // Re-render 3 times with fresh object literal fileRef -> zero extra send.file loads
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(
        <SendPanel
          organizationId={ORG}
          fileRef={{ kind: 'output', outputId: OUT_1 }}
          copy={KO}
          locale="ko"
          transport={transport}
          onClose={noop}
        />,
      );
      await flush();
    }
    expect(transport.file).toHaveBeenCalledTimes(1);

    // Typing plain text without mention shows sendNoMention hint
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '확인 부탁 @');
    await flush();
    expect(transport.people).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-send-picker]')).not.toBeNull();

    // Pick 이하린 -> mention tracked, noMention hint disappears
    const option = mounted.queryAll('[role="option"]').find((el) => el.textContent?.includes('이하린'))!;
    await act(async () => {
      option.dispatchEvent({
        type: 'mousedown',
        button: 0,
        bubbles: true,
        cancelable: true,
        preventDefault() {},
      } as never);
    });
    await flush();
    expect(mounted.container.textContent).not.toContain(KO.sendNoMention);

    // Click send button (focus is on button before send settles) -> optimistic row appears at top with aria-busy="true"
    const submitBtn = mounted.query('[data-send-submit]')!;
    await mounted.click(submitBtn);
    await flush();

    expect(transport.post).toHaveBeenCalledTimes(1);
    const pendingRow = mounted.query('[data-send-pending]');
    expect(pendingRow).not.toBeNull();
    expect(pendingRow?.getAttribute('aria-busy')).toBe('true');

    // Settle server post -> optimistic row replaced in-place, zero duplicates, input clears and keeps focus!
    const createdThread = makeThread({
      rootId: ROOT_2,
      replyCount: 0,
      lastActivityAt: '2026-11-26T05:00:00.000Z',
      root: makeMsg({ id: ROOT_2, rootId: ROOT_2, mine: true, authorName: '김서아', body: '@이하린 ' }),
    });
    resolvePost({ ok: true, thread: createdThread, message: createdThread.root });
    await flush();

    expect(mounted.query('[data-send-pending]')).toBeNull();
    expect(mounted.queryAll('[data-send-panel] li').length).toBe(2);
    expect(mounted.queryAll('[data-send-panel] li')[0]?.textContent).toContain('@이하린');
    expect((textarea as unknown as HTMLTextAreaElement).value).toBe('');
    expect(mounted.document.activeElement).toBe(textarea);

    // Now test rate_limited refusal keeps text and drops optimistic row
    const rateTransport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
      post: vi.fn(async () => ({ ok: false as const, code: 'rate_limited' as const })),
    });
    await mounted.rerender(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'asset', assetId: ASSET_1 }}
        copy={KO}
        locale="ko"
        transport={rateTransport}
        onClose={noop}
      />,
    );
    await flush();

    const rateInput = mounted.query('[data-send-input]')!;
    await mounted.setValue(rateInput, '남아있어야 하는 메시지');
    await mounted.keyDown('Enter', { target: rateInput });
    await flush();

    expect((rateInput as unknown as HTMLTextAreaElement).value).toBe('남아있어야 하는 메시지');
    expect(mounted.query('[data-send-pending]')).toBeNull();
    expect(mounted.query('[data-send-error]')?.textContent).toContain(KO.sendRate);
  });

  it('calls onUnsendable on initial not_found and onClosed on invalid', async () => {
    const onUnsendable = vi.fn();
    const onClosed = vi.fn();
    const notFoundTransport = mockTransport({
      file: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
    });
    mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={notFoundTransport}
        onClose={noop}
        onUnsendable={onUnsendable}
        onClosed={onClosed}
      />,
    );
    await flush();
    expect(onUnsendable).toHaveBeenCalledWith(`output:${OUT_1.toLowerCase()}`);

    const invalidTransport = mockTransport({
      file: vi.fn(async () => ({ ok: false as const, code: 'invalid' as const })),
    });
    await mounted.rerender(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'asset', assetId: ASSET_1 }}
        copy={KO}
        locale="ko"
        transport={invalidTransport}
        onClose={noop}
        onUnsendable={onUnsendable}
        onClosed={onClosed}
      />,
    );
    await flush();
    expect(onClosed).toHaveBeenCalled();
    // Closed panel shows threadGone, removes composer & list, and stops further send.file requests (Fix round 3 item 2)
    expect(mounted.container.textContent).toContain(KO.threadGone);
    expect(mounted.query('[data-send-composer]')).toBeNull();
    expect(invalidTransport.file).toHaveBeenCalledTimes(1);
    await mounted.rerender(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: id(0x98) }}
        copy={KO}
        locale="ko"
        transport={invalidTransport}
        onClose={noop}
        onUnsendable={onUnsendable}
        onClosed={onClosed}
      />,
    );
    await flush();
    expect(invalidTransport.file).toHaveBeenCalledTimes(1);
  });
});

describe('Viewer send integration, roles, external link, layout, and Escape layering (Batch C)', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('replaces review with 보내기 for all roles including viewer, puts 외부 링크 만들기 in quiet actions for owner/editor only, and handles non-sendable kinds', () => {
    const reviewSpy = vi.fn();
    const sendProp: ViewerSendProp = { organizationId: ORG, copy: KO };
    const picOut = output(1);
    const picItem: ViewerItem = { type: 'output', output: picOut, job: job(1, { outputs: [picOut] }) };
    const vidOut = output(2, { kind: 'video', url: '/v.mp4' });
    const vidItem: ViewerItem = { type: 'output', output: vidOut, job: job(2, { kind: 'video', outputs: [vidOut] }) };
    const sndOut = output(3, { kind: 'audio', width: null, height: null, thumbUrl: null, url: '/s.mp3' });
    const sndItem: ViewerItem = { type: 'output', output: sndOut, job: job(3, { kind: 'music', outputs: [sndOut] }) };
    const assetItem: ViewerItem = { type: 'asset', asset: asset(1) };
    const fillItem: ViewerItem = {
      type: 'output',
      output: picOut,
      job: job(4, { kind: 'region_edit', purpose: 'fill', outputs: [picOut] }),
    };
    const composeItem: ViewerItem = {
      type: 'output',
      output: vidOut,
      job: job(5, { kind: 'video', model: 'compose-1080p', outputs: [vidOut] }),
    };

    // Owner with send: has data-action="send", no data-action="review", has data-action="external-link"
    for (const item of [picItem, vidItem, sndItem, assetItem]) {
      const ownerHtml = renderToStaticMarkup(
        <Viewer
          items={[item]}
          index={0}
          copy={copyFor('ko')}
          locale="ko"
          canCreate
          canGenerate
          busy={null}
          notice={null}
          parentOf={() => null}
          onIndex={noop}
          onClose={noop}
          actions={{ ...baseActions, review: reviewSpy }}
          send={sendProp}
        />,
      );
      expect(ownerHtml).toContain('data-action="send"');
      expect(ownerHtml).not.toContain('data-action="review"');
      expect(ownerHtml).toContain('data-action="external-link"');
      expect(ownerHtml).toContain(KO.externalLink);
    }

    // Viewer role (canCreate: false): sees data-action="send", NEVER sees data-action="external-link"
    const viewerHtml = renderToStaticMarkup(
      <Viewer
        items={[picItem]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate={false}
        canGenerate={false}
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={noop}
        actions={{ ...baseActions, review: reviewSpy }}
        send={sendProp}
      />,
    );
    expect(viewerHtml).toContain('data-action="send"');
    expect(viewerHtml).not.toContain('data-action="external-link"');

    // Fill strip & compose export: hide 보내기, keep 외부 링크 만들기 for owner
    for (const unsendable of [fillItem, composeItem]) {
      const html = renderToStaticMarkup(
        <Viewer
          items={[unsendable]}
          index={0}
          copy={copyFor('ko')}
          locale="ko"
          canCreate
          canGenerate
          busy={null}
          notice={null}
          parentOf={() => null}
          onIndex={noop}
          onClose={noop}
          actions={{ ...baseActions, review: reviewSpy }}
          send={sendProp}
        />,
      );
      expect(html).not.toContain('data-action="send"');
      expect(html).toContain('data-action="external-link"');
    }
  });

  it('opens SendPanel in Viewer without altering stage grid attributes, wires 외부 링크 만들기 to actions.review, hides on not_found, and closes cleanly with 3-level Escape', async () => {
    const reviewSpy = vi.fn();
    const onClose = vi.fn();
    const picOut = output(1);
    const picItem: ViewerItem = { type: 'output', output: picOut, job: job(1, { outputs: [picOut] }) };
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
    });

    mounted = await mountDom(
      <Viewer
        items={[picItem]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={onClose}
        actions={{ ...baseActions, review: reviewSpy }}
        send={{ organizationId: ORG, copy: KO, transport }}
      />,
    );
    await flush();

    // Media host keeps the exact same grid attributes when SendPanel opens (1440 / 1920 column layout invariant)
    const bodyBefore = mounted.query('.bs-viewer-body')!;
    expect(bodyBefore.getAttribute('data-region')).toBeNull();
    expect(bodyBefore.getAttribute('data-talk')).toBeNull();

    // External link action invokes actions.review(item)
    await mounted.click('[data-action="external-link"]');
    expect(reviewSpy).toHaveBeenCalledTimes(1);
    expect(reviewSpy).toHaveBeenCalledWith(picItem);

    // Click 보내기 opens SendPanel inside .bs-viewer-side; body columns attributes unchanged
    const sendBtn = mounted.query('[data-action="send"]')!;
    await mounted.click(sendBtn);
    await flush();

    expect(mounted.query('.bs-viewer-side [data-send-panel]')).not.toBeNull();
    expect(bodyBefore.getAttribute('data-region')).toBeNull();
    expect(bodyBefore.getAttribute('data-talk')).toBeNull();
    expect(transport.file).toHaveBeenCalledTimes(1);

    // Open @ picker inside SendPanel
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '@');
    await flush();
    expect(mounted.query('[data-send-picker]')).not.toBeNull();

    // Escape level 1: closes picker only; panel & viewer stay open (even if native dialog cancel fires < 100ms)
    await mounted.keyDown('Escape', { target: textarea });
    const dialog = mounted.query('[data-studio-viewer]')!;
    await act(async () => {
      dialog.dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    expect(mounted.query('[data-send-picker]')).toBeNull();
    expect(mounted.query('[data-send-panel]')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // Escape level 2: closes send panel only & returns focus to sendBtn; viewer stays open
    await mounted.keyDown('Escape', { target: textarea });
    await act(async () => {
      dialog.dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    await flush();
    expect(mounted.query('[data-send-panel]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(mounted.document.activeElement).toBe(sendBtn);

    // Escape level 3: after the 100ms browser-cancel suppression window, modal dialog `cancel` closes viewer
    await act(async () => {
      vi.advanceTimersByTime(120);
      dialog.dispatchEvent({ type: 'cancel', bubbles: false, cancelable: true, preventDefault() {} } as never);
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Re-test initial not_found hides 보내기 without adding custom strings
    const nfTransport = mockTransport({
      file: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
    });
    const onClose2 = vi.fn();
    await mounted.rerender(
      <Viewer
        items={[picItem]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={onClose2}
        actions={{ ...baseActions, review: reviewSpy }}
        send={{ organizationId: ORG, copy: KO, transport: nfTransport }}
      />,
    );
    await mounted.click('[data-action="send"]');
    await flush();
    expect(mounted.query('[data-action="send"]')).toBeNull();
    expect(mounted.query('[data-send-panel]')).toBeNull();

    // Closed (invalid) closes panel and removes [data-action="send"] on the next render (Fix round 3 item 2)
    const closedTransport = mockTransport({
      file: vi.fn(async () => ({ ok: false as const, code: 'invalid' as const })),
    });
    const nextOut = output(8);
    const nextItem: ViewerItem = { type: 'output', output: nextOut, job: job(8, { outputs: [nextOut] }) };
    await mounted.rerender(
      <Viewer
        items={[nextItem]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={onClose2}
        actions={{ ...baseActions, review: reviewSpy }}
        send={{ organizationId: ORG, copy: KO, transport: closedTransport }}
      />,
    );
    await mounted.click('[data-action="send"]');
    await flush();
    expect(mounted.query('[data-action="send"]')).toBeNull();
    expect(mounted.query('[data-send-panel]')).toBeNull();
  });

  it('keeps Viewer media column 340px (unchanged at 1440 and 1920) when send panel is added in studio-v2.css', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/(brand)/studio-v2.css'), 'utf8');
    expect(css).toContain('.bs-viewer { width: min(1280px, calc(100vw - 48px));');
    expect(css).toContain('.bs-viewer-body { display: grid; flex: 1; min-height: 0; grid-template-columns: minmax(0, 1fr) 340px; }');
  });

  it('hosts 보내기 and 외부 링크 만들기 inside the dialogue more panel when revise.talk is active', () => {
    const vidOut = output(7, { kind: 'video', url: '/clip.mp4', draft: true });
    const vidJob = job(7, { kind: 'video', resolution: 'draft', outputs: [vidOut] });
    const talkHtml = renderToStaticMarkup(
      <Viewer
        items={[{ type: 'output', output: vidOut, job: vidJob }]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        revise={{
          organizationId: ORG,
          jobs: [vidJob],
          recent: [],
          resolve: () => null,
          upload: async () => [],
          plan: async () => ({ ok: false, code: 'failed' }),
          create: async () => ({ ok: true, job: vidJob }),
          dialogue: true,
          talk: {
            organizationId: ORG,
            talk: async () => ({ ok: false, code: 'failed' }),
            create: async () => ({ ok: false, code: 'failed' }),
            upload: async () => ({ added: [], failure: null }),
            editStudioHref: (oId) => `/brand/studio/compose?outputId=${oId}`,
          },
        }}
        parentOf={() => null}
        onIndex={noop}
        onClose={noop}
        actions={{ ...baseActions, review: noop }}
        send={{ organizationId: ORG, copy: KO }}
      />,
    );
    expect(talkHtml).toContain('data-talk-more-panel');
    expect(talkHtml).toContain('data-action="send"');
    expect(talkHtml).toContain('data-action="external-link"');
    expect(talkHtml).not.toContain('data-action="review"');
  });
});

describe('Server hosting gating for Image & Video studios (Batch C)', () => {
  beforeEach(() => {
    hostMocks.orgId = ORG;
    hostMocks.userId = USER_1;
    hostMocks.sendSwitchesOn = true;
    hostMocks.sendOpenFor = true;
    hostMocks.spine = {
      open: { kind: 'unfiled' },
      projects: [{ id: PROJ, title: '봄 향수 론칭', origin: 'self', lastActivityAt: '2026-11-26T04:00:00.000Z' }],
      canCreate: true,
      notice: null,
      noticeSource: null,
    };
    hostMocks.role = 'owner';
    hostMocks.staff = false;
    hostMocks.studioAppProps = null;
    hostMocks.videoWorkspaceProps = null;
  });

  it('brandStudioV2 passes send only for active members when brandSendOpenFor is true', async () => {
    const { brandStudioV2 } = await import('@/components/brand-studio/v2-page');

    const runCase = async (
      role: BrandWorkspaceChoice['role'],
      staff: boolean,
      openFor: boolean,
    ): Promise<Record<string, unknown> | null> => {
      hostMocks.studioAppProps = null;
      hostMocks.sendOpenFor = openFor;
      const choice: BrandWorkspaceChoice = {
        id: ORG,
        name: 'Lumiere',
        role,
        logoUrl: null,
        denied: [],
      };
      const viewer: IdentityViewer = { userId: USER_1, email: 'a@b.c', tier: 'free', isAdmin: staff, locale: 'ko' };
      const el = await brandStudioV2({
        deps: { sql: {} as SqlRunner, verifiedEmail: 'a@b.c' },
        viewer,
        choice,
        access: { staff, hasOrganization: true, canRequest: role !== 'viewer', fresh: false, projectScopedOnly: false } as never,
        locale: 'ko',
        brandHost: true,
        tab: undefined,
        mode: undefined,
        project: undefined,
      });
      renderToStaticMarkup(el);
      return hostMocks.studioAppProps as Record<string, unknown> | null;
    };

    const ownerOpen = await runCase('owner', false, true);
    expect(ownerOpen?.send).toMatchObject({ organizationId: ORG, copy: { action: KO.action } });

    const viewerOpen = await runCase('viewer', false, true);
    expect(viewerOpen?.send).toMatchObject({ organizationId: ORG, copy: { action: KO.action } });

    const ownerClosed = await runCase('owner', false, false);
    expect(ownerClosed?.send).toBeUndefined();

    const staffOpen = await runCase('studio', true, true);
    expect(staffOpen?.send).toBeUndefined();

    const guestOpen = await runCase('guest', false, true);
    expect(guestOpen?.send).toBeUndefined();
  });

  it('StudioVideoPage passes send only for active members when brandSendOpenFor is true', async () => {
    const { default: StudioVideoPage } = await import('@/app/(brand)/brand/studio/video/page');

    const runCase = async (
      role: 'owner' | 'editor' | 'viewer' | 'guest' | 'studio',
      staff: boolean,
      openFor: boolean,
    ): Promise<Record<string, unknown> | null> => {
      hostMocks.videoWorkspaceProps = null;
      hostMocks.role = role;
      hostMocks.staff = staff;
      hostMocks.sendOpenFor = openFor;
      const el = await StudioVideoPage({ searchParams: Promise.resolve({ organizationId: ORG }) });
      if (el) renderToStaticMarkup(el);
      return hostMocks.videoWorkspaceProps as Record<string, unknown> | null;
    };

    const editorOpen = await runCase('editor', false, true);
    expect(editorOpen?.send).toMatchObject({ organizationId: ORG, copy: { action: KO.action } });

    const viewerOpen = await runCase('viewer', false, true);
    expect(viewerOpen?.send).toMatchObject({ organizationId: ORG, copy: { action: KO.action } });

    const closed = await runCase('owner', false, false);
    expect(closed?.send).toBeUndefined();

    const staff = await runCase('studio', true, true);
    expect(staff?.send).toBeUndefined();

    const guest = await runCase('guest', false, true);
    expect(guest?.send).toBeUndefined();
  });
});

describe('Fix round 4 (composition Escape, post not_found, page-life closed, sendHint, zero-hook Viewer)', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('ignores Escape during Korean composition (isComposing / keyCode 229) inside SendPanel and Viewer (Item 1)', async () => {
    const onClose = vi.fn();
    const picOut = output(1);
    const picItem: ViewerItem = { type: 'output', output: picOut, job: job(1, { outputs: [picOut] }) };
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
    });

    mounted = await mountDom(
      <Viewer
        items={[picItem]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={onClose}
        actions={baseActions}
        send={{ organizationId: ORG, copy: KO, transport }}
      />,
    );
    await flush();

    await mounted.click('[data-action="send"]');
    await flush();
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '한');

    await act(async () => {
      textarea.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        isComposing: true,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
        preventDefault() {},
        stopPropagation() {},
      } as never);
    });
    await flush();

    expect(mounted.query('[data-send-panel]')).not.toBeNull();
    expect((textarea as unknown as HTMLTextAreaElement).value).toBe('한');
    expect(onClose).not.toHaveBeenCalled();

    // Also keyCode 229 even with panel closed -> Viewer must stay open
    await mounted.keyDown('Escape', { target: textarea });
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    const dialog = mounted.query('[data-studio-viewer]')!;
    await act(async () => {
      dialog.dispatchEvent({
        type: 'keydown',
        key: 'Escape',
        isComposing: false,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
        preventDefault() {},
        stopPropagation() {},
      } as never);
    });
    await flush();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps panel open with fileGone header, kept text, and disabled submit when POST refuses with not_found, hiding send only after user closes (Item 2)', async () => {
    const picOut = output(1);
    const picItem: ViewerItem = { type: 'output', output: picOut, job: job(1, { outputs: [picOut] }) };
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [makeThread()] })),
      post: vi.fn(async () => ({ ok: false as const, code: 'not_found' as const })),
    });

    mounted = await mountDom(
      <Viewer
        items={[picItem]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={noop}
        actions={baseActions}
        send={{ organizationId: ORG, copy: KO, transport }}
      />,
    );
    await flush();

    await mounted.click('[data-action="send"]');
    await flush();
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '지워진 결과 메시지 @이');
    await mounted.keyDown('Enter', { target: textarea });
    await flush();

    // Submit -> POST returns not_found
    await mounted.keyDown('Enter', { target: textarea });
    await flush();

    expect(mounted.query('[data-send-panel]')).not.toBeNull();
    expect(mounted.query('[data-send-file-gone]')?.textContent).toBe(KO.fileGone);
    expect(mounted.container.textContent).not.toContain(KO.sendSub);
    expect(mounted.container.textContent?.match(new RegExp(KO.fileGone, 'g'))).toHaveLength(1);
    expect((textarea as unknown as HTMLTextAreaElement).value).toBe('지워진 결과 메시지 @이하린 ');
    const submitBtn = mounted.query('[data-send-submit]') as unknown as { disabled?: boolean };
    expect(submitBtn.disabled).toBe(true);
    // Send action button stays visible until user closes panel
    expect(mounted.query('[data-action="send"]')).not.toBeNull();

    // User closes panel -> send action now hides for this file
    await mounted.click('[data-send-panel-close]');
    await flush();
    expect(mounted.query('[data-send-panel]')).toBeNull();
    expect(mounted.query('[data-action="send"]')).toBeNull();
  });

  it('persists closed across files for page life while keeping unsendable per file (Item 3)', async () => {
    const outA = output(1);
    const outB = output(2);
    const outC = output(3);
    const itemA: ViewerItem = { type: 'output', output: outA, job: job(1, { outputs: [outA] }) };
    const itemB: ViewerItem = { type: 'output', output: outB, job: job(2, { outputs: [outB] }) };
    const itemC: ViewerItem = { type: 'output', output: outC, job: job(3, { outputs: [outC] }) };

    let nextResult: 'not_found' | 'invalid' | 'ok' = 'not_found';
    const fileFn = vi.fn(async (ref: SendFileRef) => {
      if (nextResult === 'not_found') return { ok: false as const, code: 'not_found' as const };
      if (nextResult === 'invalid') return { ok: false as const, code: 'invalid' as const };
      return { ok: true as const, file: makeFile({ ref }), threads: [] };
    });
    const transport = mockTransport({ file: fileFn });

    mounted = await mountViewerDom(
      <SendPageScope>
        <Viewer
          items={[itemA, itemB, itemC]}
          index={0}
          copy={copyFor('ko')}
          locale="ko"
          canCreate
          canGenerate
          busy={null}
          notice={null}
          parentOf={() => null}
          onIndex={noop}
          onClose={noop}
          actions={baseActions}
          send={{ organizationId: ORG, copy: KO, transport }}
        />
      </SendPageScope>,
    );
    await flush();

    // 1. Initial not_found on itemA -> unsendable per file; moving to itemB STILL shows send action
    await mounted.click('[data-action="send"]');
    await flush();
    expect(mounted.query('[data-action="send"]')).toBeNull();
    expect(fileFn).toHaveBeenCalledTimes(1);

    nextResult = 'invalid';
    await mounted.rerender(
      <SendPageScope>
        <Viewer
          items={[itemA, itemB, itemC]}
          index={1}
          copy={copyFor('ko')}
          locale="ko"
          canCreate
          canGenerate
          busy={null}
          notice={null}
          parentOf={() => null}
          onIndex={noop}
          onClose={noop}
          actions={baseActions}
          send={{ organizationId: ORG, copy: KO, transport }}
        />
      </SendPageScope>,
    );
    await flush();
    expect(mounted.query('[data-action="send"]')).not.toBeNull();

    // 2. invalid on itemB -> closes for page life; closing + reopening Viewer on itemC keeps action hidden & 0 send requests
    await mounted.click('[data-action="send"]');
    await flush();
    expect(mounted.query('[data-action="send"]')).toBeNull();
    expect(fileFn).toHaveBeenCalledTimes(2);

    await mounted.rerender(<SendPageScope>{null}</SendPageScope>);
    await flush();

    nextResult = 'ok';
    await mounted.rerender(
      <SendPageScope>
        <Viewer
          items={[itemA, itemB, itemC]}
          index={2}
          copy={copyFor('ko')}
          locale="ko"
          canCreate
          canGenerate
          busy={null}
          notice={null}
          parentOf={() => null}
          onIndex={noop}
          onClose={noop}
          actions={baseActions}
          send={{ organizationId: ORG, copy: KO, transport }}
        />
      </SendPageScope>,
    );
    await flush();
    expect(mounted.query('[data-action="send"]')).toBeNull();
    expect(fileFn).toHaveBeenCalledTimes(2);
  });

  it('replaces sendHint with sendNoMention when SendPanel field text has no picked mention (Item 4)', async () => {
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
    });
    mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={transport}
        onClose={noop}
      />,
    );
    await flush();

    // Empty field shows sendHint, not composerHint and not sendNoMention
    expect(mounted.container.textContent).toContain(KO.sendHint);
    expect(mounted.container.textContent).not.toContain(KO.composerHint);
    expect(mounted.container.textContent).not.toContain(KO.sendNoMention);

    // Typing without a picked mention replaces sendHint with sendNoMention
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '멤버 없이 남기기');
    expect(mounted.container.textContent).toContain(KO.sendNoMention);
    expect(mounted.container.textContent).not.toContain(KO.sendHint);

    // Picking a mention brings back sendHint
    await mounted.setValue(textarea, '@이');
    await mounted.keyDown('Enter', { target: textarea });
    expect(mounted.container.textContent).not.toContain(KO.sendNoMention);
    expect(mounted.container.textContent).toContain(KO.sendHint);
  });

  it('keeps viewer, studio-app, and video workspace at exact pre-Batch-C hook counts (483c329e) with send state & Escape moved to components/brand-send (Item 5)', () => {
    const checkHookCounts = (relPath: string, expectedCounts: Record<string, number>) => {
      const src = readFileSync(path.join(process.cwd(), relPath), 'utf8');
      for (const [hook, expected] of Object.entries(expectedCounts)) {
        const actual = (src.match(new RegExp(`\\b${hook}\\b`, 'g')) ?? []).length;
        expect(actual, `${hook} count in ${relPath} must match pre-Batch-C (${expected})`).toBe(expected);
      }
      return src;
    };

    const viewerSrc = checkHookCounts('components/brand-studio/viewer.tsx', {
      useState: 18,
      useEffect: 11,
      useLayoutEffect: 3,
      useRef: 12,
      useCallback: 0,
      useMemo: 5,
      useId: 3,
    });
    expect(viewerSrc).not.toContain('if (props.send');
    expect(viewerSrc).not.toContain('<SendPanel');

    checkHookCounts('components/brand-studio/studio-app.tsx', {
      useState: 15,
      useEffect: 19,
      useLayoutEffect: 0,
      useRef: 10,
      useCallback: 13,
      useMemo: 7,
      useId: 3,
    });
    checkHookCounts('components/brand-studio/video/workspace.tsx', {
      useState: 30,
      useEffect: 24,
      useLayoutEffect: 0,
      useRef: 22,
      useCallback: 31,
      useMemo: 14,
      useId: 3,
    });
  });

  it('lets inner-layer Escape close only [data-studio-delete-confirm] without closing Viewer when send is enabled (Fix round 6 item 4)', async () => {
    const out = output(9);
    const item: ViewerItem = { type: 'output', output: out, job: job(9, { outputs: [out] }) };
    const onClose = vi.fn();
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
      people: vi.fn(async () => ({ ok: true as const, people: PEOPLE })),
    });

    mounted = await mountDom(
      <Viewer
        items={[item]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={onClose}
        actions={{ ...baseActions, review: vi.fn() }}
        send={{ organizationId: ORG, copy: KO, transport }}
      />,
    );

    // Case A: SendPanel CLOSED, delete confirm open -> bubbling Escape from delete confirm button closes ONLY confirm box
    await mounted.click('[data-action="delete"]');
    const cancelBtn1 = mounted.queryAll('[data-studio-delete-confirm] button')[1]!;
    expect(cancelBtn1).toBeTruthy();
    await mounted.keyDown('Escape', { target: cancelBtn1 });
    expect(onClose).not.toHaveBeenCalled();
    expect(mounted.query('[data-studio-delete-confirm]')).toBeNull();

    // Case B: SendPanel OPEN, delete confirm open -> bubbling Escape from delete confirm button closes ONLY confirm box; SendPanel & Viewer stay open
    await mounted.click('[data-action="send"]');
    await flush();
    expect(mounted.query('[data-send-panel]')).not.toBeNull();
    await mounted.click('[data-action="delete"]');
    const cancelBtn2 = mounted.queryAll('[data-studio-delete-confirm] button')[1]!;
    expect(cancelBtn2).toBeTruthy();
    await mounted.keyDown('Escape', { target: cancelBtn2 });
    expect(onClose).not.toHaveBeenCalled();
    expect(mounted.query('[data-studio-delete-confirm]')).toBeNull();
    expect(mounted.query('[data-send-panel]')).not.toBeNull();

    // And no native dialog keydown listener remains in FileSend that intercepts Escape before React's root-delegated onKeyDown
    const fileSendSrc = readFileSync(path.join(process.cwd(), 'components/brand-send/file-send.tsx'), 'utf8');
    expect(fileSendSrc).not.toMatch(/addEventListener\(['"]keydown['"]/);
  });

  it('docks composer inside SendPanel with position: sticky without modifying studio-v2.css or moving Viewer side JSX (Fix round 7)', async () => {
    const out = output(10);
    const item: ViewerItem = { type: 'output', output: out, job: job(10, { outputs: [out] }) };
    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
    });

    mounted = await mountDom(
      <Viewer
        items={[item]}
        index={0}
        copy={copyFor('ko')}
        locale="ko"
        canCreate
        canGenerate
        busy={null}
        notice={null}
        parentOf={() => null}
        onIndex={noop}
        onClose={noop}
        actions={{ ...baseActions, review: vi.fn() }}
        send={{ organizationId: ORG, copy: KO, transport }}
      />,
    );

    await mounted.click('[data-action="send"]');
    await flush();
    const actionsEl = mounted.query('[data-studio-viewer-actions]')!;
    const panel = mounted.query('.bs-viewer-side [data-send-panel]')!;
    const stickyComposer = mounted.query('[data-send-panel] [data-send-panel-composer]')!;
    expect(panel).not.toBeNull();
    expect(panel.parentNode).toBe(actionsEl);
    expect(mounted.query('[data-studio-viewer-upper]')).toBeNull();
    expect(stickyComposer.contains(mounted.query('[data-send-composer]')!)).toBe(true);

    // Sticky docking lives inside send-panel.module.css; studio-v2.css keeps no side-column layout rules added in Fix round 6
    const studioCss = readFileSync(path.join(process.cwd(), 'app/(brand)/studio-v2.css'), 'utf8');
    const panelCss = readFileSync(path.join(process.cwd(), 'components/brand-send/send-panel.module.css'), 'utf8');
    expect(studioCss).not.toContain('.bs-viewer-upper');
    expect(studioCss).not.toContain('.bs-viewer-side:has([data-send-panel])');
    expect(panelCss).toMatch(/\.list\s*\{[^}]*max-height:\s*220px;[^}]*overflow-y:\s*auto;/s);
    expect(panelCss).toMatch(/\.composerSticky\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;[^}]*margin-bottom:\s*-16px;[^}]*background:\s*var\(--ys-surface\);[^}]*border-top:\s*1px solid var\(--ys-hairline\);/s);
  });
});
