import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendTransport } from '@/components/brand-rooms/chat/transport';
import { ROOM_ACTIVITY } from '@/components/brand-rooms/seams';
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
import { SendFileCardView } from '@/components/brand-send/file-card';
import { SendComposer } from '@/components/brand-send/composer';
import { SendThreadView } from '@/components/brand-send/thread-view';
import { SendInboxPage } from '@/components/brand-send/inbox-page';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const PROJ = '11111111-1111-4111-8111-111111111111';
const ROOT_1 = '22222222-2222-4222-8222-222222222221';
const ROOT_2 = '22222222-2222-4222-8222-222222222222';
const OUT_1 = '33333333-3333-4333-8333-333333333331';
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
    authorId: USER_1,
    authorName: '김서아',
    mine: false,
    body: '@이하린 립 컬러는 이 컷이 제일 자연스러워요.',
    mentions: [{ id: USER_2, name: '이하린' }],
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

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (/\.(ts|tsx|css)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('brand-send Batch A SSR markup states', () => {
  it('renders SendFileCardView for available media and deleted files without <video>', () => {
    const imgHtml = renderToStaticMarkup(<SendFileCardView file={makeFile()} organizationId={ORG} copy={KO} />);
    expect(imgHtml).toContain('봄 향수 론칭 · 생성 결과');
    expect(imgHtml).toContain('파일 열기');
    expect(imgHtml).toContain('width="132"');
    expect(imgHtml).toContain('height="99"');
    expect(imgHtml).not.toContain('<video');

    const vidNoThumb = renderToStaticMarkup(
      <SendFileCardView
        file={makeFile({
          ref: { kind: 'asset', assetId: ASSET_1 },
          kind: 'video',
          name: '런웨이',
          thumbUrl: null,
          project: null,
        })}
        organizationId={ORG}
        copy={KO}
      />,
    );
    expect(vidNoThumb).toContain('런웨이');
    expect(vidNoThumb).toContain('미분류 · 업로드');
    expect(vidNoThumb).not.toContain('<img');
    expect(vidNoThumb).not.toContain('<video');

    const goneHtml = renderToStaticMarkup(
      <SendFileCardView
        file={makeFile({ available: false, kind: null, name: null, url: null, thumbUrl: null, project: null })}
        organizationId={ORG}
        copy={KO}
      />,
    );
    expect(goneHtml).toContain('삭제된 파일');
    expect(goneHtml).not.toContain('파일 열기');
    expect(goneHtml).not.toContain('<img');
  });

  it('renders SendComposer states (empty disabled, no-mention hint, @ listbox with roles, empty people, near-limit counter, no extra controls)', () => {
    const emptyHtml = renderToStaticMarkup(
      <SendComposer copy={KO} placeholder={KO.sendPlaceholder} hint={KO.sendHint} showNoMentionHint onSend={async () => ({ ok: true })} />,
    );
    expect(emptyHtml).toContain('disabled=""');
    expect(emptyHtml).not.toContain('type="file"');
    expect(emptyHtml).not.toContain(KO.sendNoMention);

    const pickerHtml = renderToStaticMarkup(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        showNoMentionHint
        initialText="이 컷 어때요? @"
        initialPickerOpen
        initialPeople={PEOPLE}
        onSend={async () => ({ ok: true })}
      />,
    );
    expect(pickerHtml).toContain('role="combobox"');
    expect(pickerHtml).toContain('aria-autocomplete="list"');
    expect(pickerHtml).toContain('role="listbox"');
    expect(pickerHtml).toContain('aria-controls="');
    expect(pickerHtml).toContain('aria-activedescendant="');
    expect(pickerHtml).toContain('멤버');
    expect(pickerHtml).toContain('이하린');
    expect(pickerHtml).toContain('편집자');
    expect(pickerHtml).toContain('박도윤');
    expect(pickerHtml).toContain('열람자');
    expect(pickerHtml).toContain(KO.sendNoMention);
    expect(pickerHtml).not.toMatch(/<button[^>]*role="option"/);

    const noMatchHtml = renderToStaticMarkup(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        initialText="@없는이름"
        initialPickerOpen
        initialPeople={PEOPLE}
        onSend={async () => ({ ok: true })}
      />,
    );
    expect(noMatchHtml).toContain('찾는 멤버가 없어요.');

    const nearLimitHtml = renderToStaticMarkup(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        initialText={'가'.repeat(3650)}
        onSend={async () => ({ ok: true })}
      />,
    );
    expect(nearLimitHtml).toContain('3650 / 4000');
  });

  it('renders SendThreadView with conversation, deleted-file conversation, null author, and threadGone', () => {
    const reply = makeMsg({
      id: '99999999-9999-4999-8999-999999999991',
      parentId: ROOT_1,
      authorId: USER_2,
      authorName: '이하린',
      body: '배경 톤은 지금 그대로 두려고 해요.',
      mentions: [],
      createdAt: '2026-11-26T04:45:00.000Z',
    });
    const seed: SendThreadPage = { ok: true, thread: makeThread({ replyCount: 1 }), replies: [reply] };

    const html = renderToStaticMarkup(
      <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} initialThread={seed} />,
    );
    expect(html).toContain('김서아 님이 보낸 파일이에요. 멤버끼리만 볼 수 있어요.');
    expect(html).toContain('파일 열기');
    expect(html).toContain('배경 톤은 지금 그대로 두려고 해요.');
    expect(html).toContain('답글 남기기');
    // Fix 11b: compact head above stream (no full file card inside <header>); file card under root line inside stream before replies
    const headerSlice = /<header\b[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    expect(headerSlice).not.toContain('data-send-file-card');
    expect(headerSlice).toContain('봄 향수 론칭');
    expect(headerSlice).toContain('파일 열기');
    expect(headerSlice).toContain('/api/brand-studio/media/st/pic-thumb.webp');
    const cardPos = html.indexOf('data-send-file-card');
    const rootPos = html.indexOf(`data-send-message="${ROOT_1}"`);
    const replyPos = html.indexOf('배경 톤은 지금 그대로 두려고 해요.');
    expect(cardPos).toBeGreaterThan(rootPos);
    expect(cardPos).toBeLessThan(replyPos);

    const anonSeed: SendThreadPage = {
      ok: true,
      thread: makeThread({
        root: makeMsg({ authorId: null, authorName: null }),
        file: makeFile({ available: false, kind: null, name: null, url: null, thumbUrl: null, project: null }),
      }),
      replies: [],
    };
    const anonHtml = renderToStaticMarkup(
      <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="en" copy={EN} initialThread={anonSeed} />,
    );
    expect(anonHtml).toContain('Only members can see this conversation.');
    expect(anonHtml).toContain('Deleted file');
    expect(anonHtml).toContain('Write a reply');

    const goneHtml = renderToStaticMarkup(
      <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} initialGone />,
    );
    expect(goneHtml).toContain('이 대화를 더 볼 수 없어요.');
  });

  it('produces identical SSR markup in UTC and Asia/Seoul for thread lines at 23:30 and 00:30 KST (Fix 1)', () => {
    const prevTz = process.env.TZ;
    try {
      // 2026-10-25 23:30 KST (14:30 UTC) vs 2026-10-26 00:30 KST (2026-10-25 15:30 UTC)
      const rootAt2330Kst = makeMsg({
        id: ROOT_1,
        rootId: ROOT_1,
        createdAt: '2026-10-25T14:30:00.000Z',
        body: '자정 전 컷',
      });
      const replyAt0030Kst = makeMsg({
        id: '99999999-9999-4999-8999-999999999993',
        rootId: ROOT_1,
        parentId: ROOT_1,
        createdAt: '2026-10-25T15:30:00.000Z',
        body: '자정 후 답글',
      });
      const seed: SendThreadPage = {
        ok: true,
        thread: makeThread({ root: rootAt2330Kst, replyCount: 1, lastActivityAt: replyAt0030Kst.createdAt }),
        replies: [replyAt0030Kst],
      };

      process.env.TZ = 'UTC';
      const utcHtml = renderToStaticMarkup(
        <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} initialThread={seed} />,
      );

      process.env.TZ = 'Asia/Seoul';
      const seoulHtml = renderToStaticMarkup(
        <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} initialThread={seed} />,
      );

      expect(utcHtml).toBe(seoulHtml);
      expect(utcHtml).toContain('>23:30<');
      expect(utcHtml).toContain('>00:30<');
      expect(utcHtml).toContain('10월 25일');
      expect(utcHtml).toContain('10월 26일');
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });

  it('renders SendInboxPage states: chosen conversation, empty pick, empty all, empty mentions, more button, and rows', () => {
    const tReply = makeThread({
      rootId: ROOT_2,
      root: makeMsg({ id: ROOT_2, rootId: ROOT_2, body: '첫 메시지' }),
      replyCount: 2,
      mentioned: true,
      unread: true,
      latest: {
        messageId: '99999999-9999-4999-8999-999999999992',
        authorId: USER_2,
        authorName: '이하린',
        mine: false,
        line: '수정했어요',
        at: '2026-11-26T04:55:00.000Z',
      },
    });
    const inboxSeed: SendInboxPageData = {
      ok: true,
      view: 'all',
      threads: [makeThread(), tReply],
      next: 'cursor-next',
      unread: 2,
      mentionsUnread: 2,
    };
    const threadSeed: SendThreadPage = { ok: true, thread: makeThread(), replies: [] };

    const fullHtml = renderToStaticMarkup(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        locale="ko"
        copy={KO}
        initialInbox={inboxSeed}
        initialThread={threadSeed}
      />,
    );
    expect(fullHtml).toContain('알림함');
    expect(fullHtml).toContain('전체');
    expect(fullHtml).toContain('멘션');
    expect(fullHtml).toContain('답글: 수정했어요');
    expect(fullHtml).toContain('더 보기');
    expect(fullHtml).not.toMatch(/<a\b(?:(?!<\/a>)[\s\S])*?<(?:p|div|button)\b/);
    // Item 7: 2-line inbox rows: line 1 "who · project" (+ mentionMark pill + time), line 2 firstWords + right unread dot
    expect(fullHtml).toMatch(/김서아[\s\S]*? · [\s\S]*?봄 향수 론칭[\s\S]*?<time/);
    expect(fullHtml).toMatch(/이하린[\s\S]*? · [\s\S]*?봄 향수 론칭[\s\S]*?멘션[\s\S]*?<time/);
    expect(fullHtml).toContain('data-send-unread-dot');
    expect(fullHtml).not.toMatch(/class="[^"]*rowReplies[^"]*"/);
    const inboxCss = readFileSync(path.join(process.cwd(), 'components/brand-send/inbox-page.module.css'), 'utf8');
    expect(inboxCss).toContain('.rowHeadline');
    expect(inboxCss).not.toContain('left: 6px;');

    // Fix 11e: list/head/card thumbnails never put a video URL in <img>, while image without still uses file.url
    const mediaHtml = renderToStaticMarkup(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        locale="ko"
        copy={KO}
        initialInbox={{
          ok: true,
          view: 'all',
          threads: [
            makeThread({
              rootId: ROOT_1,
              file: makeFile({ kind: 'video', url: '/api/brand-studio/media/st/full.mp4', thumbUrl: null }),
            }),
            makeThread({
              rootId: ROOT_2,
              root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }),
              file: makeFile({ kind: 'image', url: '/api/brand-studio/media/st/raw.png', thumbUrl: null }),
            }),
          ],
          next: null,
          unread: 0,
          mentionsUnread: 0,
        }}
        initialThread={{
          ok: true,
          thread: makeThread({
            file: makeFile({ kind: 'video', url: '/api/brand-studio/media/st/full.mp4', thumbUrl: null }),
          }),
          replies: [],
        }}
      />,
    );
    expect(mediaHtml).not.toContain('full.mp4');
    expect(mediaHtml).toContain('/api/brand-studio/media/st/raw.png');

    const pickHtml = renderToStaticMarkup(
      <SendInboxPage send={{ organizationId: ORG }} initialThreadId={null} locale="ko" copy={KO} initialInbox={inboxSeed} />,
    );
    expect(pickHtml).toContain('왼쪽에서 대화를 골라 주세요.');

    const emptyAllHtml = renderToStaticMarkup(
      <SendInboxPage
        send={{ organizationId: ORG }}
        locale="ko"
        copy={KO}
        initialInbox={{ ok: true, view: 'all', threads: [], next: null, unread: 0, mentionsUnread: 0 }}
      />,
    );
    expect(emptyAllHtml).toContain('받은 메시지가 없어요.');

    const emptyMentionsHtml = renderToStaticMarkup(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialView="mentions"
        locale="ko"
        copy={KO}
        initialInbox={{ ok: true, view: 'mentions', threads: [], next: null, unread: 2, mentionsUnread: 0 }}
      />,
    );
    expect(emptyMentionsHtml).toContain('멘션 메시지가 없어요.');
    expect(emptyMentionsHtml).not.toContain('data-send-mark-all');
  });
});

describe('brand-send Batch A DOM interactions, races, and polling', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it('opens @ picker once for send.people, supports Korean IME composition, arrow+Enter pick, Escape, and mention deletion', async () => {
    const loadPeople = vi.fn(async () => ({ ok: true as const, people: PEOPLE }));
    const onSend = vi.fn(async () => ({ ok: true as const }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        loadPeople={loadPeople}
        onSend={onSend}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;
    // Typing '@' opens picker and loads send.people once
    await mounted.setValue(textarea, '@');
    expect(loadPeople).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-send-picker]')).not.toBeNull();

    // Korean composition: half-composed input does not filter until compositionend
    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionstart', bubbles: true, cancelable: true } as never);
    });
    await mounted.setValue(textarea, '@ㅇ');
    // Still shows both non-self options until compositionend
    expect(mounted.queryAll('[role="option"]')).toHaveLength(2);

    await mounted.setValue(textarea, '@이');
    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionend', bubbles: true, cancelable: true } as never);
    });
    expect(mounted.queryAll('[role="option"]')).toHaveLength(1);
    expect(mounted.query('[role="option"]')?.textContent).toContain('이하린');

    // Escape closes picker and leaves text intact
    await mounted.keyDown('Escape', { target: textarea });
    expect(mounted.query('[data-send-picker]')).toBeNull();
    expect((textarea as unknown as { value: string }).value).toBe('@이');

    // Reopen picker with @박 -> does NOT call loadPeople a second time
    await mounted.setValue(textarea, '@박');
    expect(loadPeople).toHaveBeenCalledTimes(1);
    await mounted.keyDown('Enter', { target: textarea });
    expect((textarea as unknown as { value: string }).value).toBe('@박도윤 ');
    expect(mounted.query('[data-send-picker]')).toBeNull();

    // Deleting one char from @박도윤 turns it into plain text with mentions: []
    await mounted.setValue(textarea, '@박도 ');
    await mounted.keyDown('Enter', { target: textarea });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ body: '@박도 ', mentions: [] }));
  });

  it('implements @ combobox ARIA, lets Tab close and move focus without picking, stops Escape only while open, and keeps focus on pointer pick (Fix 9)', async () => {
    const parentReactKeyDown = vi.fn();
    mounted = await mountDom(
      <div data-host onKeyDown={parentReactKeyDown}>
        <SendComposer
          copy={KO}
          placeholder={KO.sendPlaceholder}
          hint={KO.sendHint}
          initialPeople={PEOPLE}
          onSend={async () => ({ ok: true })}
        />
      </div>,
    );

    const textarea = mounted.query('[data-send-input]')!;
    expect(textarea.getAttribute('role')).toBe('combobox');
    expect(textarea.getAttribute('aria-autocomplete')).toBe('list');
    expect(textarea.getAttribute('aria-expanded')).toBe('false');
    expect(textarea.getAttribute('aria-controls')).toBeNull();

    // Open @ picker and verify non-button options + aria attributes
    textarea.focus();
    await mounted.setValue(textarea, '@이');
    expect(textarea.getAttribute('aria-expanded')).toBe('true');
    const controls = textarea.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(mounted.query('[role="listbox"]')?.getAttribute('id')).toBe(controls);
    const opt = mounted.query('[role="option"]')!;
    expect(opt.tagName.toLowerCase()).toBe('div');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(opt.getAttribute('id'));

    // Tab closes the picker WITHOUT picking and leaves Tab default behavior un-prevented
    const tabEv = {
      type: 'keydown',
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      defaultPrevented: false,
      cancelBubble: false,
      target: textarea,
      currentTarget: null as unknown,
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.cancelBubble = true;
      },
      stopImmediatePropagation() {
        this.cancelBubble = true;
      },
    };
    await act(async () => {
      textarea.dispatchEvent(tabEv as never);
      await Promise.resolve();
    });
    expect(tabEv.defaultPrevented).toBe(false);
    expect(mounted.query('[data-send-picker]')).toBeNull();
    expect((textarea as unknown as { value: string }).value).toBe('@이');

    // Reopen picker -> first Escape closes list only and stops propagation to parent host; second Escape reaches host
    parentReactKeyDown.mockClear();
    const nativeBodyKeyDown = vi.fn();
    mounted.document.body.addEventListener('keydown', nativeBodyKeyDown as never);
    await mounted.setValue(textarea, '@박');
    expect(mounted.query('[data-send-picker]')).not.toBeNull();
    await mounted.keyDown('Escape', { target: textarea });
    expect(mounted.query('[data-send-picker]')).toBeNull();
    expect(parentReactKeyDown).not.toHaveBeenCalled();
    expect(nativeBodyKeyDown).not.toHaveBeenCalled();

    await mounted.keyDown('Escape', { target: textarea });
    expect(parentReactKeyDown).toHaveBeenCalledTimes(1);
    expect(nativeBodyKeyDown).toHaveBeenCalledTimes(1);

    // Reopen picker -> pointer mousedown picks non-self person while keeping textarea focused
    await mounted.setValue(textarea, '@이');
    const pickOpt = mounted.query('[role="option"]')!;
    let mousedownPrevented = false;
    await act(async () => {
      pickOpt.dispatchEvent({
        type: 'mousedown',
        bubbles: true,
        cancelable: true,
        button: 0,
        target: pickOpt,
        currentTarget: null,
        preventDefault() {
          mousedownPrevented = true;
        },
        stopPropagation() {},
      } as never);
      await Promise.resolve();
    });
    expect(mousedownPrevented).toBe(true);
    expect((textarea as unknown as { value: string }).value).toBe('@이하린 ');
    expect(mounted.query('[data-send-picker]')).toBeNull();
    expect(mounted.document.activeElement).toBe(textarea);
  });

  it('shows sendNoMention hint only when field has text AND extractMentionIds is empty (Fix 10)', async () => {
    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        showNoMentionHint
        initialPeople={PEOPLE}
        onSend={async () => ({ ok: true })}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;
    // Empty text -> noMention hidden, hint visible
    expect(mounted.container.textContent).not.toContain(KO.sendNoMention);
    expect(mounted.container.textContent).toContain(KO.sendHint);

    // Plain text without picked recipient -> noMention replaces hint
    await mounted.setValue(textarea, '확인 부탁해요');
    expect(mounted.container.textContent).toContain(KO.sendNoMention);
    expect(mounted.container.textContent).not.toContain(KO.sendHint);

    // Pick a recipient via @ -> hint returns and noMention disappears
    await mounted.setValue(textarea, '확인 부탁 @이');
    await mounted.keyDown('Enter', { target: textarea });
    expect((textarea as unknown as { value: string }).value).toBe('확인 부탁 @이하린 ');
    expect(mounted.container.textContent).not.toContain(KO.sendNoMention);
    expect(mounted.container.textContent).toContain(KO.sendHint);

    // Break the picked mention -> noMention comes back
    await mounted.setValue(textarea, '확인 부탁 @이하 ');
    expect(mounted.container.textContent).toContain(KO.sendNoMention);
    expect(mounted.container.textContent).not.toContain(KO.sendHint);
  });

  it('prevents double-send on two fast Enters, keeps text on refusal, reuses requestId on retry, rotates on conflict or edit', async () => {
    let resolveFirst!: (val: { ok: false; code: string } | { ok: true }) => void;
    const onSend = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: false; code: string } | { ok: true }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: false, code: 'conflict' })
      .mockResolvedValueOnce({ ok: true });

    const loadPeople = vi.fn(async () => ({ ok: true as const, people: PEOPLE }));
    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        loadPeople={loadPeople}
        onSend={onSend}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '확인해 주세요 @이');
    await mounted.keyDown('Enter', { target: textarea });
    expect((textarea as unknown as { value: string }).value).toBe('확인해 주세요 @이하린 ');

    // Two fast Enters -> only 1 request fires
    await mounted.keyDown('Enter', { target: textarea });
    await mounted.keyDown('Enter', { target: textarea });
    expect(onSend).toHaveBeenCalledTimes(1);
    const firstArg = onSend.mock.calls[0]![0] as { body: string; mentions: string[]; requestId: string };
    expect(firstArg.mentions).toEqual([USER_2]);

    // Refused offline -> restores text & mention, keeps same requestId on retry
    await act(async () => {
      resolveFirst({ ok: false, code: 'offline' });
    });
    expect((textarea as unknown as { value: string }).value).toBe('확인해 주세요 @이하린 ');
    expect(mounted.query('[data-send-error]')?.textContent).toBe('보내지 못했어요. 다시 시도해 주세요.');

    // Shift+Enter does not send
    await mounted.keyDown('Enter', { target: textarea, shiftKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);

    // Retry same text -> reuses exact requestId; server answers conflict -> resets requestId
    await mounted.keyDown('Enter', { target: textarea });
    expect(onSend).toHaveBeenCalledTimes(2);
    const secondArg = onSend.mock.calls[1]![0] as { requestId: string };
    expect(secondArg.requestId).toBe(firstArg.requestId);

    // Next press after conflict -> gets a NEW requestId and clears on ok
    await mounted.keyDown('Enter', { target: textarea });
    expect(onSend).toHaveBeenCalledTimes(3);
    const thirdArg = onSend.mock.calls[2]![0] as { requestId: string };
    expect(thirdArg.requestId).not.toBe(firstArg.requestId);
    expect((textarea as unknown as { value: string }).value).toBe('');
  });

  it('preserves text and mentions typed while an earlier send is in flight and rotates requestId for the next send (Fix 5)', async () => {
    let resolveInflight!: (val: { ok: true }) => void;
    const onSend = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveInflight = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true });

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        initialPeople={PEOPLE}
        onSend={onSend}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '첫 문장');
    await mounted.keyDown('Enter', { target: textarea });
    expect(onSend).toHaveBeenCalledTimes(1);
    const firstArg = onSend.mock.calls[0]![0] as { body: string; mentions: string[]; requestId: string };
    expect(firstArg.body).toBe('첫 문장');

    // Type more and pick a mention BEFORE the first send resolves
    await mounted.setValue(textarea, '첫 문장 더 쓴 말 @이');
    await mounted.keyDown('Enter', { target: textarea });
    expect((textarea as unknown as { value: string }).value).toBe('첫 문장 더 쓴 말 @이하린 ');

    await act(async () => {
      resolveInflight({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Extra words + picked mention remain WITHOUT the already-sent prefix ("첫 문장 ") and get a fresh requestId
    expect((textarea as unknown as { value: string }).value).toBe('더 쓴 말 @이하린 ');
    await mounted.keyDown('Enter', { target: textarea });
    expect(onSend).toHaveBeenCalledTimes(2);
    const secondArg = onSend.mock.calls[1]![0] as { body: string; mentions: string[]; requestId: string };
    expect(secondArg.body).toBe('더 쓴 말 @이하린 ');
    expect(secondArg.mentions).toEqual([USER_2]);
    expect(secondArg.requestId).not.toBe(firstArg.requestId);
  });

  it('keeps edited field intact when user edited inside sent prefix while in flight (Fix round 3 item 3)', async () => {
    let resolveInflight!: (val: { ok: true }) => void;
    const onSend = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: true }>((resolve) => {
            resolveInflight = resolve;
          }),
      );

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        initialPeople={PEOPLE}
        onSend={onSend}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '원래 문장');
    await mounted.keyDown('Enter', { target: textarea });

    // Edit inside the prefix while in flight
    await mounted.setValue(textarea, '고친 원래 문장 @이하린 ');
    await act(async () => {
      resolveInflight({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((textarea as unknown as { value: string }).value).toBe('고친 원래 문장 @이하린 ');
  });

  it('keeps @ arrow selection across ArrowDown keyup, excludes me:true, and inserts the 3rd member (Fix round 6 items 1-2)', async () => {
    const fourth: SendPerson = { id: '55555555-5555-4555-8555-555555555554', name: '정우진', role: 'viewer', me: false };
    const teamWithFour: SendPerson[] = [...PEOPLE, fourth];

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        initialPeople={teamWithFour}
        onSend={async () => ({ ok: true })}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;
    const dispatchKeyUp = async (key: string) => {
      await act(async () => {
        textarea.dispatchEvent({ type: 'keyup', key, bubbles: true, cancelable: true } as never);
        await Promise.resolve();
      });
    };

    await mounted.setValue(textarea, '@');
    await dispatchKeyUp('@');

    // Excludes me:true ('김서아') so only the 3 recipients render
    const options = mounted.queryAll('[role="option"]');
    expect(options).toHaveLength(3);
    expect(options.some((el) => el.textContent?.includes('김서아'))).toBe(false);
    expect(options[0]?.textContent).toContain('이하린');
    expect(options[1]?.textContent).toContain('박도윤');
    expect(options[2]?.textContent).toContain('정우진');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');

    // First ArrowDown keydown + keyup -> moves to 2nd option ('박도윤') and keeps it on keyup
    await mounted.keyDown('ArrowDown', { target: textarea });
    await dispatchKeyUp('ArrowDown');
    expect(mounted.queryAll('[role="option"]')[1]?.getAttribute('aria-selected')).toBe('true');

    // Navigation/modifier keyups must not reset activeIndex
    await dispatchKeyUp('Home');
    await dispatchKeyUp('End');
    await dispatchKeyUp('Shift');
    await dispatchKeyUp('Control');
    expect(mounted.queryAll('[role="option"]')[1]?.getAttribute('aria-selected')).toBe('true');

    // Second ArrowDown keydown + keyup -> moves to 3rd option ('정우진'), then Enter inserts it
    await mounted.keyDown('ArrowDown', { target: textarea });
    await dispatchKeyUp('ArrowDown');
    expect(mounted.queryAll('[role="option"]')[2]?.getAttribute('aria-selected')).toBe('true');

    await mounted.keyDown('Enter', { target: textarea });
    expect((textarea as unknown as { value: string }).value).toBe('@정우진 ');

    // Changing query text DOES reset activeIndex back to 0 for the new filtered subset
    await mounted.setValue(textarea, '@정우진 @');
    await mounted.keyDown('ArrowDown', { target: textarea });
    await dispatchKeyUp('ArrowDown');
    expect(mounted.queryAll('[role="option"]')[1]?.getAttribute('aria-selected')).toBe('true');
    await mounted.setValue(textarea, '@정우진 @박');
    await dispatchKeyUp('박');
    expect(mounted.queryAll('[role="option"]')).toHaveLength(1);
    expect(mounted.queryAll('[role="option"]')[0]?.getAttribute('aria-selected')).toBe('true');
    expect(mounted.queryAll('[role="option"]')[0]?.textContent).toContain('박도윤');
  });

  it('sends one send.thread across 3 parent re-renders, handles hidden markRead:false, optimistic reply, and invalid close', async () => {
    const transport = mockTransport();
    const onClosed = vi.fn();

    mounted = await mountDom(
      <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} transport={transport} onClosed={onClosed} />,
    );
    expect(transport.thread).toHaveBeenCalledTimes(1);
    expect(transport.thread).toHaveBeenCalledWith(ROOT_1, { markRead: true });

    // Three parent re-renders with identical primitive props must send 0 new requests
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(
        <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} transport={transport} onClosed={onClosed} />,
      );
    }
    expect(transport.thread).toHaveBeenCalledTimes(1);

    // Hidden tab tick sends markRead: false at 20s
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      mounted!.document.dispatchEvent({ type: 'visibilitychange', bubbles: true, cancelable: false } as never);
    });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(transport.thread).toHaveBeenCalledTimes(2);
    expect(transport.thread).toHaveBeenLastCalledWith(ROOT_1, { markRead: false });

    // Optimistic reply appears immediately with aria-busy="true", settles in place, and does not duplicate on next poll (Fix 3)
    const optimisticReplyId = '99999999-9999-4999-8999-999999999994';
    const settledReplyMsg = makeMsg({
      id: optimisticReplyId,
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '지금 확인 중',
      mentions: [],
      createdAt: '2026-11-26T04:50:00.000Z',
    });
    const settledThread = makeThread({ replyCount: 1, lastActivityAt: settledReplyMsg.createdAt });
    let resolveOptReply!: (val: { ok: true; message: SendMessage; thread: SendThreadSummary }) => void;
    (transport.reply as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOptReply = resolve;
        }),
    );

    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '지금 확인 중');
    await mounted.keyDown('Enter', { target: textarea });

    const pendingRow = mounted.query('[data-send-thread-stream] article[aria-busy="true"]');
    expect(pendingRow).not.toBeNull();
    expect(pendingRow?.textContent).toContain('지금 확인 중');
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);

    await act(async () => {
      resolveOptReply({ ok: true, message: settledReplyMsg, thread: settledThread });
      await Promise.resolve();
      await Promise.resolve();
    });
    const settledRow = mounted.query(`[data-send-message="${optimisticReplyId}"]`);
    expect(settledRow).toBe(pendingRow);
    expect(settledRow?.getAttribute('aria-busy')).toBeNull();
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);

    // Become visible again and receive poll containing the same server reply -> zero duplicate
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'visible', configurable: true });
    (transport.thread as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      thread: settledThread,
      replies: [settledReplyMsg],
    });
    await act(async () => {
      mounted!.document.dispatchEvent({ type: 'visibilitychange', bubbles: true, cancelable: false } as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);

    // Refused reply with offline removes pending row and keeps text with error message (Fix 3)
    let resolveFailReply!: (val: { ok: false; code: 'offline' }) => void;
    (transport.reply as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFailReply = resolve;
        }),
    );
    await mounted.setValue(textarea, '실패할 답글');
    await mounted.keyDown('Enter', { target: textarea });
    expect(mounted.query('[data-send-thread-stream] article[aria-busy="true"]')?.textContent).toContain('실패할 답글');
    await act(async () => {
      resolveFailReply({ ok: false, code: 'offline' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-thread-stream] article[aria-busy="true"]')).toBeNull();
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);
    expect(mounted.query('[data-send-error]')?.textContent).toBe('보내지 못했어요. 다시 시도해 주세요.');
    expect((textarea as unknown as { value: string }).value).toBe('실패할 답글');

    // Refused reply with invalid triggers onClosed
    (transport.reply as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, code: 'invalid' });
    await mounted.setValue(textarea, '답글 내용');
    await mounted.keyDown('Enter', { target: textarea });
    expect(onClosed).toHaveBeenCalledTimes(1);
    // Invalid removes composer completely (no textarea, no error) and stops all polling for 30s (Fix 4)
    expect(mounted.query('textarea')).toBeNull();
    expect(mounted.query('[data-send-error]')).toBeNull();
    const threadCallsAfterInvalid = (transport.thread as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(transport.thread).toHaveBeenCalledTimes(threadCallsAfterInvalid);
  });

  it('closes composer and stops both thread and inbox list polling when thread or reply answers invalid on SendInboxPage (Fix 4)', async () => {
    const t1 = makeThread({ rootId: ROOT_1, root: makeMsg({ id: ROOT_1, rootId: ROOT_1, body: '대기 스레드' }) });
    const inboxFn = vi.fn().mockResolvedValue({ ok: true, view: 'all', threads: [t1], next: null, unread: 0, mentionsUnread: 0 });
    const threadFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, thread: t1, replies: [] })
      .mockResolvedValueOnce({ ok: false, code: 'invalid' });
    const transport = mockTransport({ inbox: inboxFn, thread: threadFn });

    mounted = await mountDom(
      <SendInboxPage send={{ organizationId: ORG }} initialThreadId={ROOT_1} locale="ko" copy={KO} transport={transport} />,
    );
    expect(inboxFn).toHaveBeenCalledTimes(1);
    expect(threadFn).toHaveBeenCalledTimes(1);
    expect(mounted.query('textarea')).not.toBeNull();

    // 4s thread poll answers `invalid` -> removes textarea, shows no error line, stops both thread and inbox for 30s
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(threadFn).toHaveBeenCalledTimes(2);
    expect(mounted.query('textarea')).toBeNull();
    expect(mounted.query('[data-send-error]')).toBeNull();
    expect(mounted.query('[role="status"]')).toBeNull();

    const inboxCallsBefore30s = inboxFn.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
    });
    expect(threadFn).toHaveBeenCalledTimes(2);
    expect(inboxFn).toHaveBeenCalledTimes(inboxCallsBefore30s);
  });

  it('settles a pending reply once when poll answers before the reply promise resolves (Fix round 3 item 1)', async () => {
    vi.setSystemTime(new Date('2026-11-26T05:00:00.000Z'));
    const initialThread = makeThread({ replyCount: 0 });
    const replyId = '99999999-9999-4999-8999-999999999992';
    const savedReply = makeMsg({
      id: replyId,
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '먼저 도착한 폴링 답글',
      mentions: [],
      createdAt: '2026-11-26T05:00:01.000Z',
    });
    const updatedThread = makeThread({ replyCount: 1, lastActivityAt: savedReply.createdAt });

    let resolvePoll!: (v: SendThreadPage) => void;
    const threadFn = vi.fn().mockImplementationOnce(
      () =>
        new Promise<SendThreadPage>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    let resolveReply!: (v: { ok: true; message: SendMessage; thread: SendThreadSummary }) => void;
    const replyFn = vi.fn().mockImplementationOnce(
      () =>
        new Promise<{ ok: true; message: SendMessage; thread: SendThreadSummary }>((resolve) => {
          resolveReply = resolve;
        }),
    );

    const transport = mockTransport({ thread: threadFn, reply: replyFn });
    mounted = await mountDom(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        transport={transport}
        initialThread={{ ok: true, thread: initialThread, replies: [] }}
        initialPeople={PEOPLE}
      />,
    );

    // 1. Send reply (in flight -> pending row rendered)
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '먼저 도착한 폴링 답글');
    await mounted.keyDown('Enter', { target: textarea });
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);
    const pendingRow = mounted.query('[data-send-thread-stream] article[aria-busy="true"]');
    expect(pendingRow).not.toBeNull();

    // 2. 4s poll runs and returns with savedReply BEFORE reply promise resolves
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
    });
    expect(threadFn).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolvePoll({ ok: true, thread: updatedThread, replies: [savedReply] });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Pending row settles onto the same DOM node and renders ONLY once (zero duplicate!)
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);
    expect(mounted.query('[data-send-thread-stream] article[aria-busy="true"]')).toBeNull();
    expect(mounted.query(`[data-send-message="${replyId}"]`)).toBe(pendingRow);

    // 3. Reply promise finally resolves -> still 2 messages (no duplicate!)
    await act(async () => {
      resolveReply({ ok: true, message: savedReply, thread: updatedThread });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);
  });

  it('shows threadGone, disables row selection, hides mark-all-read, and sends 0 reads when closed (Fix round 3 item 2)', async () => {
    const t1 = makeThread({ rootId: ROOT_1, unread: true, root: makeMsg({ id: ROOT_1, rootId: ROOT_1, body: '첫 대화' }) });
    const t2 = makeThread({ rootId: ROOT_2, unread: true, root: makeMsg({ id: ROOT_2, rootId: ROOT_2, body: '둘째 대화' }) });

    const inboxFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [t1, t2], next: null, unread: 2, mentionsUnread: 0 });
    const threadFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, thread: t1, replies: [] })
      .mockResolvedValueOnce({ ok: false, code: 'sign_in_required' });
    const transport = mockTransport({ inbox: inboxFn, thread: threadFn });

    mounted = await mountDom(
      <SendInboxPage send={{ organizationId: ORG }} initialThreadId={ROOT_1} locale="ko" copy={KO} transport={transport} />,
    );
    expect(threadFn).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-send-mark-all]')).not.toBeNull();

    // 4s poll answers sign_in_required -> right pane shows threadGone, mark-all-read disappears, rows become non-selectable
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(threadFn).toHaveBeenCalledTimes(2);
    expect(mounted.query('[data-send-mark-all]')).toBeNull();
    expect(mounted.query('[data-send-inbox-closed], [data-send-thread-closed], [data-send-thread-gone]')?.textContent ?? mounted.container.textContent).toContain(KO.threadGone);

    // Clicking another row sends 0 reads and does not switch URL/selection
    await mounted.click(`[data-send-inbox-row="${ROOT_2}"]`);
    expect(threadFn).toHaveBeenCalledTimes(2);

    // Also test SendInboxPage when inbox read itself returns invalid before any thread was opened
    const inboxClosedTransport = mockTransport({
      inbox: vi.fn(async () => ({ ok: false as const, code: 'invalid' as const })),
    });
    await mounted.rerender(
      <SendInboxPage send={{ organizationId: 'b0000000-0000-4000-8000-0000000000b1' }} locale="ko" copy={KO} transport={inboxClosedTransport} />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain(KO.threadGone);
    expect(mounted.query('[data-send-mark-all]')).toBeNull();
  });

  it('keeps a just-sent reply in the thread and inbox count when an older inflight poll answers afterwards (Fix 2)', async () => {
    const initialThread = makeThread({ replyCount: 0 });
    const replyId = '99999999-9999-4999-8999-999999999991';
    const replyMsg = makeMsg({
      id: replyId,
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '방금 남긴 새 답글',
      mentions: [],
      createdAt: '2026-11-26T04:45:00.000Z',
    });
    const updatedThread = makeThread({ replyCount: 1, lastActivityAt: replyMsg.createdAt });

    let resolveStaleRead!: (v: SendThreadPage) => void;
    const threadFn = vi.fn().mockImplementationOnce(
      () =>
        new Promise<SendThreadPage>((resolve) => {
          resolveStaleRead = resolve;
        }),
    );
    const replyFn = vi.fn(async () => ({ ok: true as const, message: replyMsg, thread: updatedThread }));
    const onThreadLoaded = vi.fn();
    const onReplyPosted = vi.fn();
    const transport = mockTransport({ thread: threadFn, reply: replyFn });

    mounted = await mountDom(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        transport={transport}
        initialThread={{ ok: true, thread: initialThread, replies: [] }}
        onThreadLoaded={onThreadLoaded}
        onReplyPosted={onReplyPosted}
      />,
    );

    // 4s poll starts a slow read BEFORE the reply is submitted
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
    });
    expect(threadFn).toHaveBeenCalledTimes(1);

    // Reply submits and resolves first
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '방금 남긴 새 답글');
    await mounted.keyDown('Enter', { target: textarea });
    expect(mounted.query(`[data-send-message="${replyId}"]`)?.textContent).toContain('방금 남긴 새 답글');
    expect(onReplyPosted).toHaveBeenCalledWith(expect.objectContaining({ thread: updatedThread }));

    // The slow read started before the reply now answers with 0 replies -> must NOT erase the reply
    await act(async () => {
      resolveStaleRead({ ok: true, thread: initialThread, replies: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query(`[data-send-message="${replyId}"]`)?.textContent).toContain('방금 남긴 새 답글');
    expect(mounted.queryAll('[data-send-message]')).toHaveLength(2);
    expect(onThreadLoaded).not.toHaveBeenCalled();
  });

  it('drives SendInboxPage: 1 mount read across 3 re-renders, view switch, paging, pushState, and pointer-hover freeze', async () => {
    const t1 = makeThread({ rootId: ROOT_1, root: makeMsg({ id: ROOT_1, rootId: ROOT_1, body: '첫 대화' }) });
    const t2 = makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2, body: '둘째 대화' }) });
    const t3 = makeThread({
      rootId: '22222222-2222-4222-8222-222222222223',
      root: makeMsg({ id: '22222222-2222-4222-8222-222222222223', rootId: '22222222-2222-4222-8222-222222222223', body: '새 대화' }),
    });

    const inboxFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [t1], next: 'c2', unread: 1, mentionsUnread: 1 })
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [t2], next: null, unread: 1, mentionsUnread: 1 })
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [t3, t1], next: null, unread: 2, mentionsUnread: 1 })
      .mockResolvedValueOnce({ ok: true, view: 'mentions', threads: [t1], next: null, unread: 2, mentionsUnread: 1 });
    const transport = mockTransport({ inbox: inboxFn });

    mounted = await mountDom(
      <SendInboxPage send={{ organizationId: ORG }} locale="ko" copy={KO} transport={transport} />,
    );
    const pushStateSpy = vi.fn();
    Object.defineProperty(globalThis.window, 'history', {
      value: { pushState: pushStateSpy },
      configurable: true,
    });
    Object.defineProperty(globalThis.window, 'location', {
      value: { search: `?organizationId=${ORG}` },
      configurable: true,
    });
    expect(inboxFn).toHaveBeenCalledTimes(1);

    // 3 parent re-renders with new `{ organizationId: ORG }` object literals send 0 new requests
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(
        <SendInboxPage send={{ organizationId: ORG }} locale="ko" copy={KO} transport={transport} />,
      );
    }
    expect(inboxFn).toHaveBeenCalledTimes(1);

    // Load more appends page 2
    await mounted.click('[data-send-inbox-more]');
    expect(inboxFn).toHaveBeenCalledTimes(2);
    expect(inboxFn).toHaveBeenLastCalledWith({ view: 'all', cursor: 'c2' });
    expect(mounted.queryAll('[data-send-inbox-row]')).toHaveLength(2);

    // Pointer hover prevents jump on 20s refresh until pointer leaves
    const listEl = mounted.query('[data-send-inbox-list]')!;
    await act(async () => {
      listEl.dispatchEvent({ type: 'pointerenter', bubbles: true, cancelable: false } as never);
    });
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(inboxFn).toHaveBeenCalledTimes(3);
    expect(mounted.queryAll('[data-send-inbox-row]')[0]?.getAttribute('data-send-inbox-row')).toBe(ROOT_1);

    await act(async () => {
      listEl.dispatchEvent({ type: 'pointerleave', bubbles: true, cancelable: false } as never);
    });
    expect(mounted.queryAll('[data-send-inbox-row]')[0]?.getAttribute('data-send-inbox-row')).toBe('22222222-2222-4222-8222-222222222223');

    // Click row updates history without reload and opens thread once
    await mounted.click(`[data-send-inbox-row="${ROOT_1}"]`);
    expect(pushStateSpy).toHaveBeenCalledWith(null, '', `/brand/inbox?organizationId=${ORG}&thread=${ROOT_1}`);
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(transport.thread).toHaveBeenCalledTimes(1);
    expect(transport.thread).toHaveBeenCalledWith(ROOT_1, { markRead: true });

    // Clicking the already-open row must not push a duplicate history entry (Fix 11a)
    await mounted.click(`[data-send-inbox-row="${ROOT_1}"]`);
    expect(pushStateSpy).toHaveBeenCalledTimes(1);
    expect(transport.thread).toHaveBeenCalledTimes(1);

    // Switching view to 멘션 re-reads once and hides "모두 읽음 처리"
    expect(mounted.queryAll('[data-send-mark-all]')).toHaveLength(1);
    await mounted.click('[data-send-view="mentions"]');
    expect(inboxFn).toHaveBeenCalledTimes(4);
    expect(inboxFn).toHaveBeenLastCalledWith({ view: 'mentions' });
    expect(mounted.queryAll('[data-send-mark-all]')).toHaveLength(0);
  });

  it('sends one send.read_all per click on 모두 읽음 처리 and deduplicates two fast clicks', async () => {
    let resolveFirst!: (val: { ok: true; marked: number; more: false }) => void;
    const readAllFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<{ ok: true; marked: number; more: false }>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, marked: 1, more: false });

    const inboxFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        view: 'all',
        threads: [makeThread({ unread: true })],
        next: null,
        unread: 2,
        mentionsUnread: 1,
      })
      .mockResolvedValueOnce({
        ok: true,
        view: 'all',
        threads: [makeThread({ unread: true })],
        next: null,
        unread: 1,
        mentionsUnread: 0,
      })
      .mockResolvedValueOnce({
        ok: true,
        view: 'all',
        threads: [makeThread({ unread: false })],
        next: null,
        unread: 0,
        mentionsUnread: 0,
      });

    const transport = mockTransport({ inbox: inboxFn, readAll: readAllFn });
    mounted = await mountDom(
      <SendInboxPage send={{ organizationId: ORG }} locale="ko" copy={KO} transport={transport} />,
    );

    const markAllBtn = mounted.query('[data-send-mark-all]')!;
    // Two fast clicks in the same turn while disabled hasn't committed yet -> only ONE read_all request fires
    await act(async () => {
      markAllBtn.dispatchEvent({ type: 'click', bubbles: true, cancelable: true } as never);
      markAllBtn.dispatchEvent({ type: 'click', bubbles: true, cancelable: true } as never);
    });
    expect(readAllFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ ok: true, marked: 1, more: false });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(inboxFn).toHaveBeenCalledTimes(2);

    // Next click after settling sends the second read_all request
    await mounted.click('[data-send-mark-all]');
    expect(readAllFn).toHaveBeenCalledTimes(2);
    expect(inboxFn).toHaveBeenCalledTimes(3);
  });

  it('clears row unread dots immediately on readAll, queues one reload past an inflight poll, and keeps control enabled when more:true (Fix 7)', async () => {
    let resolveInflightPoll!: (val: SendInboxPageData) => void;
    const tUnread = makeThread({ rootId: ROOT_1, unread: true });
    const tRead = makeThread({ rootId: ROOT_1, unread: false });

    const inboxFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [tUnread], next: null, unread: 1, mentionsUnread: 0 })
      .mockImplementationOnce(
        () =>
          new Promise<SendInboxPageData>((resolve) => {
            resolveInflightPoll = resolve;
          }),
      )
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [tRead], next: null, unread: 0, mentionsUnread: 0 })
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [tRead], next: null, unread: 0, mentionsUnread: 0 });

    const readAllFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, marked: 1, more: true })
      .mockResolvedValueOnce({ ok: true as const, marked: 1, more: false });

    const transport = mockTransport({ inbox: inboxFn, readAll: readAllFn });
    mounted = await mountDom(
      <SendInboxPage send={{ organizationId: ORG }} locale="ko" copy={KO} transport={transport} />,
    );
    expect(inboxFn).toHaveBeenCalledTimes(1);
    expect(mounted.queryAll('[data-send-inbox-row][data-unread="true"]')).toHaveLength(1);

    // 20s tick starts an inflight poll #2
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
    });
    expect(inboxFn).toHaveBeenCalledTimes(2);

    // Click "모두 읽음 처리" while poll #2 is in flight -> readAll answers more:true
    await mounted.click('[data-send-mark-all]');
    expect(readAllFn).toHaveBeenCalledTimes(1);
    // Dots cleared locally immediately BEFORE any reload returns
    expect(mounted.queryAll('[data-send-inbox-row][data-unread="true"]')).toHaveLength(0);
    // Only queued reload pending; did not start duplicate #3 yet
    expect(inboxFn).toHaveBeenCalledTimes(2);

    // Pre-readAll poll #2 resolves with stale unread row -> dropped; triggers EXACTLY ONE reload #3
    await act(async () => {
      resolveInflightPoll({ ok: true, view: 'all', threads: [tUnread], next: null, unread: 1, mentionsUnread: 0 });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(inboxFn).toHaveBeenCalledTimes(3);
    expect(mounted.queryAll('[data-send-inbox-row][data-unread="true"]')).toHaveLength(0);

    // Because readAll answered more:true, button remains enabled even though reload returned unread:0 -> second press fires readAll #2
    const btn = mounted.query('[data-send-mark-all]') as unknown as { disabled?: boolean } | null;
    expect(Boolean(btn?.disabled)).toBe(false);
    await mounted.click('[data-send-mark-all]');
    expect(readAllFn).toHaveBeenCalledTimes(2);
    expect(inboxFn).toHaveBeenCalledTimes(4);
    expect(Boolean((mounted.query('[data-send-mark-all]') as unknown as { disabled?: boolean } | null)?.disabled)).toBe(true);
  });

  it('does not clear unread inbox row on hidden-tab markRead:false thread poll, and keeps pending-root open markRead:false until visible (Fix 8)', async () => {
    const tUnread = makeThread({ rootId: ROOT_1, unread: true });
    const tRead = makeThread({ rootId: ROOT_1, unread: false });

    const inboxFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [tRead], next: null, unread: 0, mentionsUnread: 0 })
      .mockResolvedValueOnce({ ok: true, view: 'all', threads: [tUnread], next: null, unread: 1, mentionsUnread: 0 })
      .mockResolvedValue({ ok: true, view: 'all', threads: [tRead], next: null, unread: 0, mentionsUnread: 0 });
    const threadFn = vi.fn().mockResolvedValue({ ok: true, thread: tRead, replies: [] });

    const transport = mockTransport({ inbox: inboxFn, thread: threadFn });
    mounted = await mountDom(
      <SendInboxPage send={{ organizationId: ORG }} initialThreadId={ROOT_1} locale="ko" copy={KO} transport={transport} />,
    );
    expect(threadFn).toHaveBeenCalledTimes(1);

    // Tab becomes hidden before another reply arrives in inbox list
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      mounted!.document.dispatchEvent({ type: 'visibilitychange', bubbles: true, cancelable: false } as never);
    });

    // Activity updates inbox while hidden so ROOT_1 shows an unread dot again
    await act(async () => {
      globalThis.window.dispatchEvent(new Event(ROOM_ACTIVITY));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query(`[data-send-inbox-row="${ROOT_1}"]`)?.getAttribute('data-unread')).toBe('true');

    // Hidden thread poll at 20s runs with markRead: false -> row MUST stay unread
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(threadFn).toHaveBeenLastCalledWith(ROOT_1, { markRead: false });
    expect(mounted.query(`[data-send-inbox-row="${ROOT_1}"]`)?.getAttribute('data-unread')).toBe('true');

    // Tab returns visible -> marks read and clears row unread
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      mounted!.document.dispatchEvent({ type: 'visibilitychange', bubbles: true, cancelable: false } as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(threadFn).toHaveBeenLastCalledWith(ROOT_1, { markRead: true });
    expect(mounted.query(`[data-send-inbox-row="${ROOT_1}"]`)?.getAttribute('data-unread')).toBeNull();
    await mounted.unmount();
    mounted = null;

    // Pending-root path while tab is hidden sends markRead: false until tab becomes visible
    let resolveRoot1!: (v: SendThreadPage) => void;
    const pendingThreadFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<SendThreadPage>((resolve) => {
            resolveRoot1 = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ok: true,
        thread: makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }) }),
        replies: [],
      })
      .mockResolvedValueOnce({
        ok: true,
        thread: makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }) }),
        replies: [],
      });
    const pendingTransport = mockTransport({ thread: pendingThreadFn });
    mounted = await mountDom(
      <SendThreadView organizationId={ORG} rootId={ROOT_1} locale="ko" copy={KO} transport={pendingTransport} />,
    );
    expect(pendingThreadFn).toHaveBeenCalledWith(ROOT_1, { markRead: true });

    // Tab hides, then props switch to ROOT_2 while ROOT_1 is still inflight
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      mounted!.document.dispatchEvent({ type: 'visibilitychange', bubbles: true, cancelable: false } as never);
    });
    await mounted.rerender(
      <SendThreadView organizationId={ORG} rootId={ROOT_2} locale="ko" copy={KO} transport={pendingTransport} />,
    );

    // ROOT_1 answers -> ROOT_2 starts with markRead: false (because tab is hidden!)
    await act(async () => {
      resolveRoot1({ ok: true, thread: makeThread(), replies: [] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pendingThreadFn).toHaveBeenCalledTimes(2);
    expect(pendingThreadFn).toHaveBeenNthCalledWith(2, ROOT_2, { markRead: false });

    // Tab becomes visible -> immediately sends ONE markRead: true read for ROOT_2
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      mounted!.document.dispatchEvent({ type: 'visibilitychange', bubbles: true, cancelable: false } as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pendingThreadFn).toHaveBeenCalledTimes(3);
    expect(pendingThreadFn).toHaveBeenNthCalledWith(3, ROOT_2, { markRead: true });
  });

  it('marks an SSR-seeded ?thread= read once when mounted in a visible tab, and sends 0 marking reads when mounted hidden until visible (Fix round 6 item 3)', async () => {
    const tUnread = makeThread({ rootId: ROOT_1, unread: true });
    const tRead = makeThread({ rootId: ROOT_1, unread: false });

    // 1. Visible mount with SSR-seeded initialInbox + initialThread -> sends 1 markRead: true and clears row unread
    const visibleThreadFn = vi.fn().mockResolvedValue({ ok: true, thread: tRead, replies: [] });
    const visibleTransport = mockTransport({ thread: visibleThreadFn });
    mounted = await mountDom(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        initialInbox={{ ok: true, view: 'all', threads: [tUnread], next: null, unread: 1, mentionsUnread: 0 }}
        initialThread={{ ok: true, thread: tUnread, replies: [] }}
        locale="ko"
        copy={KO}
        transport={visibleTransport}
      />,
    );
    expect(visibleThreadFn).toHaveBeenCalledTimes(1);
    expect(visibleThreadFn).toHaveBeenCalledWith(ROOT_1, { markRead: true });
    expect(mounted.query(`[data-send-inbox-row="${ROOT_1}"]`)?.getAttribute('data-unread')).toBeNull();

    // Parent re-renders must not issue duplicate marking reads
    for (let i = 0; i < 3; i += 1) {
      await mounted.rerender(
        <SendInboxPage
          send={{ organizationId: ORG }}
          initialThreadId={ROOT_1}
          initialInbox={{ ok: true, view: 'all', threads: [tUnread], next: null, unread: 1, mentionsUnread: 0 }}
          initialThread={{ ok: true, thread: tUnread, replies: [] }}
          locale="ko"
          copy={KO}
          transport={visibleTransport}
        />,
      );
    }
    expect(visibleThreadFn).toHaveBeenCalledTimes(1);
    await mounted.unmount();
    mounted = null;

    // 2. Hidden mount with SSR-seeded initialInbox + initialThread -> 0 marking reads until visibilitychange -> visible
    const hiddenThreadFn = vi.fn().mockResolvedValue({ ok: true, thread: tRead, replies: [] });
    const hiddenTransport = mockTransport({ thread: hiddenThreadFn });
    mounted = await mountDom(<span />);
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'hidden', configurable: true });
    await mounted.rerender(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        initialInbox={{ ok: true, view: 'all', threads: [tUnread], next: null, unread: 1, mentionsUnread: 0 }}
        initialThread={{ ok: true, thread: tUnread, replies: [] }}
        locale="ko"
        copy={KO}
        transport={hiddenTransport}
      />,
    );
    expect(hiddenThreadFn).not.toHaveBeenCalled();
    expect(mounted.query(`[data-send-inbox-row="${ROOT_1}"]`)?.getAttribute('data-unread')).toBe('true');

    // Window focus while still hidden or 20s poll while hidden must NOT send markRead: true
    await act(async () => {
      globalThis.window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(20_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hiddenThreadFn.mock.calls.some((call) => call[1]?.markRead === true)).toBe(false);
    expect(mounted.query(`[data-send-inbox-row="${ROOT_1}"]`)?.getAttribute('data-unread')).toBe('true');

    // Becomes visible -> sends 1 marking read and clears unread dot
    Object.defineProperty(mounted.document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      mounted!.document.dispatchEvent({ type: 'visibilitychange', bubbles: true, cancelable: false } as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hiddenThreadFn.mock.calls.filter((call) => call[1]?.markRead === true)).toHaveLength(1);
    expect(hiddenThreadFn).toHaveBeenLastCalledWith(ROOT_1, { markRead: true });
    expect(mounted.query(`[data-send-inbox-row="${ROOT_1}"]`)?.getAttribute('data-unread')).toBeNull();
  });

  it('pins SendThreadView .stream to bottom on new lines unless reader scrolled up > 48px, and always scrolls on own reply (Fix round 6 item 5)', async () => {
    const t1 = makeThread({ rootId: ROOT_1, replyCount: 1 });
    const r1 = makeMsg({ id: '99999999-9999-4999-8999-999999999911', parentId: ROOT_1, body: '첫 답글', createdAt: '2026-11-26T04:10:00.000Z' });
    const r2 = makeMsg({ id: '99999999-9999-4999-8999-999999999912', parentId: ROOT_1, body: '둘째 남의 답글', authorId: USER_2, authorName: '이하린', mine: false, createdAt: '2026-11-26T04:11:00.000Z' });
    const r3 = makeMsg({ id: '99999999-9999-4999-8999-999999999913', parentId: ROOT_1, body: '셋째 남의 답글', authorId: USER_2, authorName: '이하린', mine: false, createdAt: '2026-11-26T04:12:00.000Z' });
    const ownReply = makeMsg({ id: '99999999-9999-4999-8999-999999999914', parentId: ROOT_1, body: '내가 쓴 답글', createdAt: '2026-11-26T04:13:00.000Z' });

    const threadFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, thread: { ...t1, replyCount: 2 }, replies: [r1, r2] })
      .mockResolvedValueOnce({ ok: true, thread: { ...t1, replyCount: 3 }, replies: [r1, r2, r3] });
    const replyFn = vi.fn().mockResolvedValueOnce({ ok: true, message: ownReply, thread: { ...t1, replyCount: 4 } });
    const transport = mockTransport({ thread: threadFn, reply: replyFn });

    mounted = await mountDom(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        transport={transport}
        initialThread={{ ok: true, thread: t1, replies: [r1] }}
      />,
    );

    const stream = mounted.query('[data-send-thread-stream]')! as unknown as {
      scrollTop: number;
      scrollHeight: number;
      clientHeight: number;
      dispatchEvent: (e: unknown) => void;
    };
    let mockScrollHeight = 800;
    Object.defineProperty(stream, 'scrollHeight', { get: () => mockScrollHeight, configurable: true });
    Object.defineProperty(stream, 'clientHeight', { value: 300, configurable: true });
    stream.scrollTop = 500; // gap = 800 - 500 - 300 = 0 (at bottom)

    await act(async () => {
      stream.dispatchEvent({ type: 'scroll', bubbles: false, cancelable: false });
    });

    // Near bottom -> incoming r2 auto-scrolls stream to new bottom
    mockScrollHeight = 960;
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stream.scrollTop).toBe(960);

    // Reader scrolls up > 48px -> incoming r3 preserves scrollTop
    stream.scrollTop = 100; // gap = 960 - 100 - 300 = 560 > 48
    await act(async () => {
      stream.dispatchEvent({ type: 'scroll', bubbles: false, cancelable: false });
    });
    mockScrollHeight = 1120;
    await act(async () => {
      vi.advanceTimersByTime(4_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(stream.scrollTop).toBe(100);

    // Reader posts own reply -> scrolls back to bottom
    const textarea = mounted.query('[data-send-input]')!;
    mockScrollHeight = 1280;
    await mounted.setValue(textarea, '내가 쓴 답글');
    await mounted.keyDown('Enter', { target: textarea });
    expect(stream.scrollTop).toBe(1280);
  });
});

describe('brand-send Batch A source & CSS invariants (§6)', () => {
  const root = process.cwd();
  const sendDir = path.join(root, 'components/brand-send');

  it('imports and calls every exported runtime function from components/brand-send/model.ts', () => {
    const modelSrc = readFileSync(path.join(sendDir, 'model.ts'), 'utf8');
    const runtimeExports = [...modelSrc.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    expect(runtimeExports.length).toBeGreaterThan(0);

    const callers = [
      ...collectFiles(sendDir).filter((f) => /\.tsx$/.test(f)),
      path.join(root, 'components/brand-studio/viewer.tsx'),
      path.join(root, 'components/brand-studio/v2-page.tsx'),
      path.join(root, 'app/(brand)/brand/studio/video/page.tsx'),
      path.join(root, 'app/(brand)/brand/inbox/page.tsx'),
    ]
      .filter((f) => {
        try {
          return statSync(f).isFile();
        } catch {
          return false;
        }
      })
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');

    for (const sym of runtimeExports) {
      expect(callers, `${sym} from components/brand-send/model.ts must be imported/called by components`).toMatch(
        new RegExp(`\\b${sym}\\b`),
      );
    }
  });

  it('enforces no <video>, timer containment, no paperclip/edit/delete/reaction, no inline object/array literals in deps, and zero lib/** runtime imports', () => {
    const files = collectFiles(sendDir);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const base = path.basename(file);
      expect(src, base).not.toMatch(/<video\b/);
      expect(src, base).not.toMatch(/type=["']file["']|brc-attach|message\.edit|message\.delete|reaction\.toggle/);
      if (base !== 'inbox-page.tsx' && base !== 'thread-view.tsx') {
        expect(src, base).not.toMatch(/\b(setInterval|setTimeout)\b/);
      }

      // No lib/** imports except `import type` or contract limit constants
      for (const imp of src.matchAll(/^import\s+([^;]*?)\s+from\s+['"](@\/lib\/[^'"]+)['"];?/gm)) {
        const clause = imp[1]!.trim();
        const target = imp[2]!;
        if (clause.startsWith('type ')) continue;
        expect(['@/lib/brand-rooms/message-contracts', '@/lib/brand-rooms/send-contracts']).toContain(target);
        const stripped = clause.replace(/^\{|\}$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
        for (const item of stripped) {
          if (item.startsWith('type ')) continue;
          expect(['ROOM_LIMITS', 'ROOM_POLL_VISIBLE_MS', 'ROOM_POLL_HIDDEN_MS', 'SEND_LIMITS']).toContain(item);
        }
      }

      // No inline object/array literals passed directly to JSX poll/effect components or effect/memo dependency arrays
      expect(src, base).not.toMatch(/use(?:Effect|Memo|Callback|LayoutEffect)\([^)]*,\s*\[[^\]]*(?:\{\s*[^}]*\}|\[\s*[^\]]*\])[^\]]*\]/s);
      expect(src, base).not.toMatch(/<(?:SendThreadView|SendComposer|SendFileCardView)\b[^>]*=\{\s*[\[{]/);
    }
  });

  it('keeps all CSS modules under components/brand-send/ pure, token-only, reduced-motion compliant, and limits --ys-accent to the send button', () => {
    const cssFiles = collectFiles(sendDir).filter((f) => f.endsWith('.module.css'));
    expect(cssFiles.length).toBeGreaterThanOrEqual(4);

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
        if (header.startsWith('@media')) headers.push(...extractSelectorHeaders(body));
        else if (header && !header.startsWith('@')) headers.push(header);
      }
      return headers;
    };

    for (const file of cssFiles) {
      const base = path.basename(file);
      const css = stripComments(readFileSync(file, 'utf8'));
      expect(css, base).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/);
      expect(css, base).toContain('prefers-reduced-motion: reduce');
      if (base !== 'composer.module.css') {
        expect(css, base).not.toContain('--ys-accent');
      }
      const headers = extractSelectorHeaders(css);
      expect(headers.length, base).toBeGreaterThan(0);
      for (const header of headers) {
        for (const selector of splitCommaOutsideParens(header)) {
          const localRemainder = stripGlobalCalls(selector);
          expect(localRemainder, `${base}: selector "${selector}" must contain a local class or id`).toMatch(/[.#][A-Za-z_-]/);
        }
      }
    }
  });

  it('keeps fixed-height two-pane inbox shell and internal stream scroll (Fix round 6 item 5)', () => {
    const inboxCss = readFileSync(path.join(sendDir, 'inbox-page.module.css'), 'utf8');
    const inboxSrc = readFileSync(path.join(sendDir, 'inbox-page.tsx'), 'utf8');
    const threadCss = readFileSync(path.join(sendDir, 'thread-view.module.css'), 'utf8');

    expect(inboxCss).toContain(':global(.bw-main):has(.shell)');
    expect(inboxCss).toContain('max-width: none;');
    expect(inboxCss).toContain('padding: 16px 20px;');
    expect(inboxCss).toContain('height: var(--send-fit-h, calc(100dvh - 32px));');
    expect(inboxCss).toContain('min-height: 380px;');
    expect(inboxCss).not.toContain('min-height: min(820px');
    expect(inboxCss).toMatch(/\.left\s*\{[^}]*min-height:\s*0;/s);
    expect(inboxCss).toMatch(/\.list\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
    expect(inboxCss).toMatch(/\.right\s*\{[^}]*min-height:\s*0;/s);
    expect(inboxSrc).toContain('--send-fit-h');

    expect(threadCss).toMatch(/\.wrap\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
    expect(threadCss).toMatch(/\.head\s*\{[^}]*flex:\s*none;/s);
    expect(threadCss).toMatch(/\.stream\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
    expect(threadCss).toMatch(/\.composerDock\s*\{[^}]*flex:\s*none;/s);
  });

  it('reserves right clearance on the inbox reply bar for .bw-support-launch without touching shared composer or panel CSS (Fix round 8)', async () => {
    const inboxCss = readFileSync(path.join(sendDir, 'inbox-page.module.css'), 'utf8');
    const workspaceCss = readFileSync(path.join(root, 'app/(brand)/workspace.css'), 'utf8');
    const composerCss = readFileSync(path.join(sendDir, 'composer.module.css'), 'utf8');
    const panelCss = readFileSync(path.join(sendDir, 'send-panel.module.css'), 'utf8');
    const threadCss = readFileSync(path.join(sendDir, 'thread-view.module.css'), 'utf8');

    const launchRule = workspaceCss.match(/\.bw-support-launch\s*\{([^}]*)\}/);
    expect(launchRule?.[1]).toBeTruthy();
    const widthPx = launchRule?.[1]?.match(/\bwidth:\s*(\d+)px/)?.[1];
    const rightPx = launchRule?.[1]?.match(/\bright:\s*(\d+)px/)?.[1];
    expect(widthPx).toBeTruthy();
    expect(rightPx).toBeTruthy();

    const expectedCalc = `calc(${widthPx}px + ${rightPx}px)`;
    expect(inboxCss).toMatch(new RegExp(`\\.right\\s*\\{[^}]*--send-support-clear:\\s*${expectedCalc.replace(/[()+]/g, '\\$&')};`, 's'));
    expect(inboxCss).toMatch(
      /\.right\s+\[data-send-composer\]\s*>\s*div:has\(\s*>\s*\[data-send-input\]\s*\)\s*>\s*div:has\(\s*\[data-send-submit\]\s*\)\s*\{[^}]*padding-right:\s*var\(--send-support-clear\);/s,
    );
    const inboxRulesCss = inboxCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(inboxRulesCss).not.toContain('bw-support-launch');
    expect(composerCss).not.toContain('--send-support-clear');
    expect(composerCss).not.toContain('padding-right');
    expect(panelCss).not.toContain('--send-support-clear');
    expect(threadCss).not.toContain('--send-support-clear');

    // Verify rendered inbox DOM matches every segment of the inbox-scoped reply bar selector
    const thread = makeThread();
    const mounted = await mountDom(
      <SendInboxPage
        send={{ organizationId: ORG }}
        initialThreadId={ROOT_1}
        locale="ko"
        copy={KO}
        initialInbox={{ ok: true, view: 'all', threads: [thread], next: null, unread: 1, mentionsUnread: 1 }}
        initialThread={{ ok: true, thread, replies: [] }}
      />,
    );
    try {
      const composer = mounted.container.querySelector('section [data-send-composer]');
      expect(composer).not.toBeNull();
      const fieldBox = Array.from(composer!.children).find(
        (child) => child.tagName === 'DIV' && Array.from(child.children).some((c) => c.hasAttribute('data-send-input')),
      );
      expect(fieldBox).toBeDefined();
      const replyBar = Array.from(fieldBox!.children).find(
        (child) => child.tagName === 'DIV' && child.querySelector('[data-send-submit]') !== null,
      );
      expect(replyBar).toBeDefined();
      expect(replyBar!.querySelector('[data-send-submit]')?.textContent).toBe(KO.action);
    } finally {
      await mounted.unmount();
    }
  });
});
