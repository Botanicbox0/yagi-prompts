import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendTransport } from '@/components/brand-rooms/chat/transport';
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
import { pickSendCopy } from '@/components/brand-send/model';
import { SendComposer } from '@/components/brand-send/composer';
import { SendPanel } from '@/components/brand-send/send-panel';
import { SendThreadView } from '@/components/brand-send/thread-view';
import { SendInboxPage } from '@/components/brand-send/inbox-page';

/**
 * Slice 4c §1 parity snapshots — WITH `send` and WITHOUT `invite`.
 * Generated on the untouched branch before any other edit. NEVER regenerate these snapshots.
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
const USER_1 = '55555555-5555-4555-8555-555555555551';
const USER_2 = '55555555-5555-4555-8555-555555555552';
const USER_3 = '55555555-5555-4555-8555-555555555553';

const KO = pickSendCopy(getDictionary('ko'));

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

describe('Slice 4c §1 parity (with send, without invite)', () => {
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

  it('matches untouched markup snapshots across composer, send panel, thread view, and inbox page', async () => {
    const fileCard = makeFile();
    const t1 = makeThread({
      rootId: ROOT_1,
      root: makeMsg({ id: ROOT_1, rootId: ROOT_1, body: '이 컷 어때요?' }),
      replyCount: 1,
      lastActivityAt: '2026-11-26T04:45:00.000Z',
    });
    const t2 = makeThread({
      rootId: ROOT_2,
      root: makeMsg({
        id: ROOT_2,
        rootId: ROOT_2,
        authorId: USER_3,
        authorName: '박도윤',
        body: '배경이 조금 더 밝으면 좋겠어요.',
        mentions: [],
        createdAt: '2026-11-26T03:00:00.000Z',
      }),
      mentioned: false,
      unread: false,
    });
    const reply1 = makeMsg({
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

    await expect(
      renderToStaticMarkup(
        <SendComposer
          copy={KO}
          placeholder={KO.sendPlaceholder}
          hint={KO.sendHint}
          showNoMentionHint
          onSend={async () => ({ ok: true })}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-composer-empty.html');

    await expect(
      renderToStaticMarkup(
        <SendComposer
          copy={KO}
          placeholder={KO.sendPlaceholder}
          hint={KO.sendHint}
          showNoMentionHint
          initialText="이 컷 어때요?"
          onSend={async () => ({ ok: true })}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-composer-text.html');

    await expect(
      renderToStaticMarkup(
        <SendComposer
          copy={KO}
          placeholder={KO.sendPlaceholder}
          hint={KO.sendHint}
          showNoMentionHint
          initialText="이 컷 어때요? @이"
          initialPickerOpen
          initialPeople={PEOPLE}
          onSend={async () => ({ ok: true })}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-composer-member-picker.html');

    await expect(
      renderToStaticMarkup(
        <SendComposer
          copy={KO}
          placeholder={KO.sendPlaceholder}
          hint={KO.sendHint}
          showNoMentionHint
          initialText="@new.person"
          initialPickerOpen
          initialPeople={PEOPLE}
          onSend={async () => ({ ok: true })}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-composer-no-match.html');

    await expect(
      renderToStaticMarkup(
        <SendComposer
          copy={KO}
          placeholder={KO.sendPlaceholder}
          hint={KO.sendHint}
          showNoMentionHint
          initialText="이 컷 어때요? @new.person@example.com"
          initialPickerOpen
          initialPeople={PEOPLE}
          onSend={async () => ({ ok: true })}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-composer-email-query.html');

    await expect(
      renderToStaticMarkup(
        <SendPanel
          organizationId={ORG}
          fileRef={fileCard.ref}
          copy={KO}
          locale="ko"
          initialFile={{ ok: true, file: fileCard, threads: [t1, t2] }}
          initialPeople={PEOPLE}
          onClose={() => {}}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-panel-conversations.html');

    const threadSeed: SendThreadPage = { ok: true, thread: t1, replies: [reply1] };
    await expect(
      renderToStaticMarkup(
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_1}
          locale="ko"
          copy={KO}
          initialThread={threadSeed}
          initialPeople={PEOPLE}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-thread-lines.html');

    const inboxSeed: SendInboxPageData = {
      ok: true,
      view: 'all',
      threads: [t1, t2],
      next: null,
      unread: 1,
      mentionsUnread: 1,
    };
    await expect(
      renderToStaticMarkup(
        <SendInboxPage
          send={{ organizationId: ORG }}
          initialThreadId={ROOT_1}
          locale="ko"
          copy={KO}
          initialInbox={inboxSeed}
          initialThread={threadSeed}
          initialPeople={PEOPLE}
        />,
      ),
    ).toMatchFileSnapshot('./__snapshots__/send-invite-inbox-page.html');
  });

  it('sends identical requests without invite (zero send.lookup, no invites field, plain text email query)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    const recorded: Array<{ op: string; input: Record<string, unknown> }> = [];
    const t1 = makeThread({ rootId: ROOT_1 });
    const transport: SendTransport = {
      organizationId: ORG,
      file: vi.fn(async (file) => {
        recorded.push({ op: 'send.file', input: { file } });
        return { ok: true as const, file: makeFile(), threads: [] };
      }),
      people: vi.fn(async () => {
        recorded.push({ op: 'send.people', input: {} });
        return { ok: true as const, people: PEOPLE };
      }),
      post: vi.fn(async (input) => {
        recorded.push({ op: 'send.post', input: { ...input } });
        return { ok: true as const, thread: t1, message: t1.root };
      }),
      reply: vi.fn(async (input) => {
        recorded.push({ op: 'send.reply', input: { ...input } });
        return { ok: true as const, thread: t1, message: t1.root };
      }),
      thread: vi.fn(async (rootId, opts) => {
        recorded.push({ op: 'send.thread', input: { rootId, ...opts } });
        return { ok: true as const, thread: t1, replies: [] };
      }),
      inbox: vi.fn(async (opts) => {
        recorded.push({ op: 'send.inbox', input: { ...opts } });
        return { ok: true as const, view: 'all' as const, threads: [t1], next: null, unread: 1, mentionsUnread: 1 };
      }),
      read: vi.fn(async () => ({ ok: true as const, rootId: ROOT_1, lastReadAt: '2026-11-26T05:00:00.000Z' })),
      readAll: vi.fn(async () => ({ ok: true as const, marked: 0, more: false })),
    };

    // 1. Composer without invite: typing @unknown shows "찾는 멤버가 없어요."; an email-looking query stays plain text with closed picker, zero lookup calls, no invites key
    const composerSubmissions: Array<Record<string, unknown>> = [];
    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        loadPeople={() => transport.people()}
        onSend={async (draft) => {
          composerSubmissions.push({ ...draft });
          return { ok: true };
        }}
      />,
    );
    const input1 = mounted.query('[data-send-input]')!;
    await mounted.setValue(input1, '@unknown');
    expect(mounted.container.textContent).toContain('찾는 멤버가 없어요.');
    await mounted.setValue(input1, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-picker]')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();

    await mounted.click('[data-send-submit]');
    expect(composerSubmissions).toHaveLength(1);
    expect('invites' in composerSubmissions[0]!).toBe(false);
    expect(composerSubmissions[0]!.body).toBe('@new.person@example.com');
    expect(composerSubmissions[0]!.mentions).toEqual([]);
    await mounted.unmount();
    mounted = null;

    // 2. SendPanel without invite: email query does NOT even open picker or fetch people, sends only send.file and send.post (no invites field)
    recorded.length = 0;
    mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={transport}
        onClose={() => {}}
      />,
    );
    const input2 = mounted.query('[data-send-input]')!;
    await mounted.setValue(input2, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-picker]')).toBeNull();
    await mounted.click('[data-send-submit]');
    expect(recorded.map((r) => r.op)).toEqual(['send.file', 'send.post']);
    expect('invites' in recorded[1]!.input).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    await mounted.unmount();
    mounted = null;

    // 3. SendInboxPage + SendThreadView without invite: sends only send.inbox, send.thread, send.reply (no people, no lookup, no invites)
    recorded.length = 0;
    mounted = await mountDom(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        locale="ko"
        copy={KO}
        transport={transport}
      />,
    );
    const input3 = mounted.query('[data-send-input]')!;
    await mounted.setValue(input3, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-picker]')).toBeNull();
    await mounted.click('[data-send-submit]');
    expect(recorded.map((r) => r.op)).toEqual(['send.thread', 'send.inbox', 'send.reply', 'send.inbox']);
    expect('invites' in recorded[2]!.input).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
