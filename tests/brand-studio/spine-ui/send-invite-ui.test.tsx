import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Profiler, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendInviteTransport, SendTransport } from '@/components/brand-rooms/chat/transport';
import type {
  SendFileCard,
  SendMessage,
  SendPerson,
  SendThreadPage,
  SendThreadSummary,
} from '@/lib/brand-rooms/send-contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';
import { pickSendCopy } from '@/components/brand-send/model';
import {
  INVITE_COPIED_FEEDBACK_MS,
  INVITE_LOOKUP_DEBOUNCE_MS,
} from '@/components/brand-send/invite-model';
import { SendComposer } from '@/components/brand-send/composer';
import { SendInviteChips } from '@/components/brand-send/invite-chips';
import { SendInviteRow } from '@/components/brand-send/invite-row';
import { SendPanel } from '@/components/brand-send/send-panel';
import { SendThreadView } from '@/components/brand-send/thread-view';

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const PROJ = '11111111-1111-4111-8111-111111111111';
const ROOT_1 = '22222222-2222-4222-8222-222222222221';
const OUT_1 = '33333333-3333-4333-8333-333333333331';
const USER_1 = '55555555-5555-4555-8555-555555555551';
const USER_2 = '55555555-5555-4555-8555-555555555552';
const USER_3 = '55555555-5555-4555-8555-555555555553';

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
    authorId: USER_1,
    authorName: '김서아',
    mine: true,
    body: '이 컷 어때요?',
    mentions: [],
    createdAt: '2026-11-26T04:40:00.000Z',
    invites: [],
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
    mentioned: false,
    unread: false,
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

/** Dispatches both keydown and keyup on target (and document/window via keyDown) so keyup cannot reset selection. */
async function pressKey(
  mounted: MountedDom,
  target: NonNullable<ReturnType<MountedDom['query']>>,
  key: string,
  opts?: { shiftKey?: boolean },
) {
  await mounted.keyDown(key, { target, shiftKey: opts?.shiftKey });
  await act(async () => {
    target.dispatchEvent({
      type: 'keyup',
      key,
      shiftKey: Boolean(opts?.shiftKey),
      bubbles: true,
      cancelable: true,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {},
    } as never);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectFiles(full, acc);
    else if (/\.(ts|tsx|css)$/.test(name)) acc.push(full);
  }
  return acc;
}

describe('Slice 4c UI: lookup, chips, refusals, clipboard, and keyboard', () => {
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

  it('debounces send.lookup at 300ms for complete addresses only and never during Korean IME composition', async () => {
    const lookupFn = vi.fn(async (email: string) => ({
      ok: true as const,
      email,
      status: 'invitable' as const,
      member: null,
    }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={async () => ({ ok: true })}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;

    // Partial address sends zero lookups
    await mounted.setValue(textarea, '@new.person@example');
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    // IME composing suppresses lookups until compositionend + 300ms
    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionstart', bubbles: true, cancelable: false } as never);
    });
    await mounted.setValue(textarea, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionend', bubbles: true, cancelable: false } as never);
    });
    expect(lookupFn).not.toHaveBeenCalled();

    // After 299ms -> still 0; at 300ms -> 1 lookup
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS - 1);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(lookupFn).toHaveBeenCalledWith('new.person@example.com');
    expect(mounted.container.textContent).toContain(KO.inviteHeading);
    expect(mounted.container.textContent).toContain(KO.inviteAction);
  });

  it('inserts invite chip via Enter (keydown+keyup) or button, strips address from wire body, and deletes on edit', async () => {
    const lookupFn = vi.fn(async (email: string) => ({
      ok: true as const,
      email,
      status: 'invitable' as const,
      member: null,
    }));
    const onSend = vi.fn(async () => ({ ok: true as const }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );

    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '이 컷 어때요? @new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });

    await pressKey(mounted, textarea, 'Enter');
    expect(mounted.query('[data-send-invite-draft="new.person@example.com"]')).not.toBeNull();
    expect(mounted.query('[data-send-picker]')).toBeNull();

    // Deleting one character of the inserted @address removes the invite chip cleanly
    const currentVal = (textarea as unknown as { value: string }).value;
    await mounted.setValue(textarea, currentVal.replace('new.person@example.com', 'new.person@example.co'));
    expect(mounted.query('[data-send-invite-draft="new.person@example.com"]')).toBeNull();

    // Re-type and click the invite action button directly
    await mounted.setValue(textarea, '이 컷 어때요? @new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupFn).toHaveBeenCalledTimes(1); // Cached!
    await mounted.click('[data-send-invite-action]');
    expect(mounted.query('[data-send-invite-draft="new.person@example.com"]')).not.toBeNull();

    // Enter submits with `invites` and wire `body` stripped of the invited email address
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(1);
    const sent = (onSend.mock.calls[0] as unknown as [Record<string, unknown>])[0]!;
    expect(sent.invites).toEqual(['new.person@example.com']);
    expect(sent.body).toBe('이 컷 어때요?');
    expect(String(sent.body).toLowerCase()).not.toContain('new.person@example.com');
  });

  it('handles member, self, not_allowed, 4th-address refusal, and arrow-key coexistence with keyup intact', async () => {
    const lookupFn = vi.fn(async (email: string) => {
      if (email === 'harin@example.com') {
        return { ok: true as const, email, status: 'member' as const, member: { id: USER_2, name: '이하린' } };
      }
      if (email === 'me@example.com') {
        return { ok: true as const, email, status: 'member' as const, member: { id: USER_1, name: '김서아' } };
      }
      if (email === 'blocked@example.com') {
        return { ok: true as const, email, status: 'not_allowed' as const, member: null };
      }
      return { ok: true as const, email, status: 'invitable' as const, member: null };
    });
    const onSend = vi.fn(async () => ({ ok: true as const }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );
    const textarea = mounted.query('[data-send-input]')!;

    // 1. member lookup -> normal mention, no invites
    await mounted.setValue(textarea, '@harin@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.container.textContent).not.toContain(KO.inviteHeading);
    await pressKey(mounted, textarea, 'Enter');
    expect(mounted.query('[data-send-invite-tray]')).toBeNull();
    expect((textarea as unknown as { value: string }).value).toBe('@이하린 ');

    // 2. self lookup -> inviteSelf outside listbox; Enter submits like closed picker
    await mounted.setValue(textarea, '@me@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-invite-self]')?.textContent).toBe(KO.inviteSelf);
    expect(mounted.queryAll('[role="listbox"] [role="status"]').length).toBe(0);
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(1);

    // 3. not_allowed -> inviteNotAllowed outside listbox; Enter submits like closed picker
    await mounted.setValue(textarea, '@blocked@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-invite-not-allowed]')?.textContent).toBe(KO.inviteNotAllowed);
    expect(mounted.queryAll('[role="listbox"] [role="status"]').length).toBe(0);
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(2);
    onSend.mockClear();

    // 4. Arrow keys with BOTH members and invite option (member named 'a@example.com' vs invite 'a@example.com')
    const peopleWithEmailName: SendPerson[] = [
      ...PEOPLE,
      { id: '55555555-5555-4555-8555-555555555559', name: 'a@example.com 담당자', role: 'editor', me: false },
    ];
    await mounted.unmount();
    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={peopleWithEmailName}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );
    const textarea2 = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea2, '@a@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    const options = mounted.queryAll('[role="option"]');
    expect(options).toHaveLength(2);
    expect(options[0]!.getAttribute('aria-selected')).toBe('true');
    expect(options[1]!.getAttribute('aria-selected')).toBe('false');

    // ArrowDown (with real keyup!) moves selection onto the invite row and keeps it selected
    await pressKey(mounted, textarea2, 'ArrowDown');
    const optionsAfterDown = mounted.queryAll('[role="option"]');
    expect(optionsAfterDown[0]!.getAttribute('aria-selected')).toBe('false');
    expect(optionsAfterDown[1]!.getAttribute('aria-selected')).toBe('true');

    // ArrowUp (with real keyup!) moves selection back to the member row; Enter inserts mention (no invites)
    await pressKey(mounted, textarea2, 'ArrowUp');
    const optionsAfterUp = mounted.queryAll('[role="option"]');
    expect(optionsAfterUp[0]!.getAttribute('aria-selected')).toBe('true');
    await pressKey(mounted, textarea2, 'Enter');
    expect((textarea2 as unknown as { value: string }).value).toBe('@a@example.com 담당자 ');
    expect(mounted.query('[data-send-invite-tray]')).toBeNull();

    // 5. 4th distinct invite address is refused in-field with inviteTooMany before any request
    let draft = '';
    for (const addr of ['one@example.com', 'two@example.com', 'three@example.com', 'four@example.com']) {
      await mounted.setValue(textarea2, `${draft}@${addr}`);
      await act(async () => {
        vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
        await Promise.resolve();
        await Promise.resolve();
      });
      await pressKey(mounted, textarea2, 'Enter');
      draft = (textarea2 as unknown as { value: string }).value;
    }
    expect(mounted.query('[data-send-error]')?.textContent).toBe(KO.inviteTooMany);
    expect(mounted.query('[data-send-invite-draft="four@example.com"]')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('handles invite_refused, invite_limit, forbidden, and lookup rate_limited until text changes', async () => {
    const lookupFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, code: 'rate_limited' as const })
      .mockResolvedValue({ ok: true as const, email: 'd@example.com', status: 'invitable' as const, member: null });

    const onSend = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, code: 'invite_refused' as const, refused: ['bad@example.com'] })
      .mockResolvedValueOnce({ ok: false as const, code: 'invite_limit' as const })
      .mockResolvedValueOnce({ ok: false as const, code: 'forbidden' as const })
      .mockResolvedValueOnce({ ok: true as const });

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );
    const textarea = mounted.query('[data-send-input]')!;

    // rate_limited stops lookup on caret/click until text changes
    await mounted.setValue(textarea, '@c@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(mounted.query('[data-send-invite-rate]')?.textContent).toBe(KO.sendRate);
    await mounted.click(textarea);
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(lookupFn).toHaveBeenCalledTimes(1);

    // Changing text resumes lookup
    await mounted.setValue(textarea, '확인 @bad@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupFn).toHaveBeenCalledTimes(2);
    await pressKey(mounted, textarea, 'Enter');

    await mounted.setValue(textarea, `${(textarea as unknown as { value: string }).value}@ok@example.com`);
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');

    // Distinct accessible names per draft chip remove button
    const removeBad = mounted.query('[data-send-invite-remove="bad@example.com"]');
    const removeOk = mounted.query('[data-send-invite-remove="ok@example.com"]');
    expect(removeBad?.getAttribute('aria-label')).toContain('bad@example.com');
    expect(removeOk?.getAttribute('aria-label')).toContain('ok@example.com');
    expect(removeBad?.getAttribute('aria-label')).not.toBe(removeOk?.getAttribute('aria-label'));

    // 1. invite_refused marks listed chip and keeps text & chips
    await pressKey(mounted, textarea, 'Enter');
    expect(mounted.query('[data-send-invite-refused="bad@example.com"]')?.textContent).toBe(KO.inviteRefused);
    expect(mounted.query('[data-send-invite-refused="ok@example.com"]')).toBeNull();
    expect((textarea as unknown as { value: string }).value).toContain('확인');

    // Remove refused chip -> remaining invite stays, retry hits invite_limit (keeps text & chips)
    await mounted.click('[data-send-invite-remove="bad@example.com"]');
    expect(mounted.query('[data-send-invite-draft="bad@example.com"]')).toBeNull();
    await pressKey(mounted, textarea, 'Enter');
    expect(mounted.query('[data-send-error]')?.textContent).toBe(KO.inviteLimit);
    expect(mounted.query('[data-send-invite-draft="ok@example.com"]')).not.toBeNull();

    // 3. forbidden -> inviteNotAllowed
    await pressKey(mounted, textarea, 'Enter');
    expect(mounted.query('[data-send-error]')?.textContent).toBe(KO.inviteNotAllowed);
    expect(mounted.query('[data-send-invite-draft="ok@example.com"]')).not.toBeNull();

    // 4. Final send succeeds and clears draft
    await pressKey(mounted, textarea, 'Enter');
    expect((textarea as unknown as { value: string }).value).toBe('');
    expect(mounted.query('[data-send-invite-tray]')).toBeNull();
  });

  it('Fix round 1 (1): strips stray standalone copies, blocks longer tokens/URLs with inviteRefused, and treats invalid with invites as sendFailed without closing', async () => {
    const lookupFn = vi.fn(async (email: string) => ({
      ok: true as const,
      email,
      status: 'invitable' as const,
      member: null,
    }));
    const onSend = vi.fn(async () => ({ ok: true as const }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );
    const textarea = mounted.query('[data-send-input]')!;
    const submitBtn = () => mounted!.query('[data-send-submit]')!;

    // 1a. Pick a@b.com, then also type a@b.com in words -> both stripped, send works
    await mounted.setValue(textarea, '@a@b.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');
    await mounted.setValue(textarea, `${(textarea as unknown as { value: string }).value}확인하고 a@b.com 도 보세요`);
    expect(submitBtn().hasAttribute('disabled')).toBe(false);
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(1);
    const firstCall = (onSend.mock.calls[0] as unknown as [Record<string, unknown>])[0]!;
    expect(firstCall.invites).toEqual(['a@b.com']);
    expect(String(firstCall.body).toLowerCase()).not.toContain('a@b.com');
    expect(firstCall.body).toBe('확인하고 도 보세요');

    // 1b. Address inside a URL -> refused in-field, button disabled, editing clears it
    await mounted.setValue(textarea, '@a@b.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');
    const pickedA = (textarea as unknown as { value: string }).value;
    await mounted.setValue(textarea, `${pickedA}https://example.com/?to=a@b.com 확인`);
    expect(submitBtn().hasAttribute('disabled')).toBe(true);
    expect(mounted.query('[data-send-invite-refused="a@b.com"]')?.textContent).toBe(KO.inviteRefused);
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(1);

    // Editing URL removes the conflict
    await mounted.setValue(textarea, `${pickedA}https://example.com/ check 확인`);
    expect(mounted.query('[data-send-invite-refused="a@b.com"]')).toBeNull();
    expect(submitBtn().hasAttribute('disabled')).toBe(false);

    // 1c. Longer address aa@b.com while inviting a@b.com -> refused in-field, removing chip clears it
    await mounted.setValue(textarea, `${pickedA}다른 사람 aa@b.com 확인`);
    expect(submitBtn().hasAttribute('disabled')).toBe(true);
    expect(mounted.query('[data-send-invite-refused="a@b.com"]')?.textContent).toBe(KO.inviteRefused);
    await mounted.click('[data-send-invite-remove="a@b.com"]');
    expect(mounted.query('[data-send-invite-draft="a@b.com"]')).toBeNull();
    expect(submitBtn().hasAttribute('disabled')).toBe(false);
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(2);

    // 1d. Mentions + invites above contract total returning `invalid` inside SendPanel -> FAILED SEND (sendFailed, text/chips kept, panel stays open, new requestId)
    const manyPeople: SendPerson[] = [
      ...PEOPLE,
      ...Array.from({ length: 49 }, (_, idx) => ({
        id: `55555555-5555-4555-8555-${String(idx + 10).padStart(12, '0')}`,
        name: `멤버${idx + 1}`,
        role: 'viewer' as const,
        me: false,
      })),
    ];
    await mounted.unmount();
    mounted = null;

    const onClosed = vi.fn();
    let resolvePostCount = 0;
    const postSpy = vi.fn(async () => {
      resolvePostCount += 1;
      if (resolvePostCount === 1) return { ok: false as const, code: 'invalid' as const };
      const msg = makeMsg({ body: '메시지', invites: [{ state: 'pending', email: 'a@b.com' }] });
      return {
        ok: true as const,
        message: msg,
        thread: makeThread({ root: msg }),
        invited: [{ email: 'a@b.com', result: 'invited' as const, memberId: null, token: 'T1', mailState: null }],
      };
    });

    const panelDom = (mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={mockTransport({
          file: vi.fn(async () => ({ ok: true as const, file: makeFile({ kind: 'video', url: '/v.mp4' }), threads: [] })),
        })}
        invite
        inviteTransport={mockInviteTransport({
          lookup: lookupFn,
          post: postSpy,
        })}
        initialPeople={manyPeople}
        onClose={() => {}}
        onClosed={onClosed}
      />,
    ));

    const panelInput = panelDom.query('[data-send-input]')!;
    // Pick 49 mentions + 2 invites = 51 > ROOM_LIMITS.mentionsMax (50)
    for (let idx = 0; idx < 49; idx += 1) {
      const cur = (panelInput as unknown as { value: string }).value;
      await panelDom.setValue(panelInput, `${cur}@멤버${idx + 1}`);
      await pressKey(panelDom, panelInput, 'Enter');
    }
    for (const addr of ['a@b.com', 'b@c.com']) {
      const cur = (panelInput as unknown as { value: string }).value;
      await panelDom.setValue(panelInput, `${cur}@${addr}`);
      await act(async () => {
        vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
        await Promise.resolve();
        await Promise.resolve();
      });
      await pressKey(panelDom, panelInput, 'Enter');
    }

    await act(async () => {
      await pressKey(panelDom, panelInput, 'Enter');
      await Promise.resolve();
      await Promise.resolve();
    });

    // Must NOT close panel, must show sendFailed, must keep text and both chips
    expect(onClosed).not.toHaveBeenCalled();
    expect(panelDom.query('[data-send-input]')).not.toBeNull();
    expect(panelDom.query('[data-send-error]')?.textContent).toBe(KO.sendFailed);
    expect(panelDom.query('[data-send-invite-draft="a@b.com"]')).not.toBeNull();
    expect(panelDom.query('[data-send-invite-draft="b@c.com"]')).not.toBeNull();
    expect((panelDom.query('[data-send-input]') as unknown as { value: string }).value).toContain('@멤버1');

    // Removing one invite & retrying uses a new requestId
    await panelDom.click('[data-send-invite-remove="b@c.com"]');
    await act(async () => {
      await pressKey(panelDom, panelInput, 'Enter');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(postSpy).toHaveBeenCalledTimes(2);
    const req1 = (postSpy.mock.calls[0] as unknown as [{ requestId: string; mentions: string[]; invites: string[] }])[0];
    const req2 = (postSpy.mock.calls[1] as unknown as [{ requestId: string; mentions: string[]; invites: string[] }])[0];
    expect(req1.mentions).toHaveLength(49);
    expect(req1.invites).toEqual(['a@b.com', 'b@c.com']);
    expect(req1.requestId).not.toBe(req2.requestId);

    // 1e. Contrast: a request WITHOUT invites returning `invalid` still closes the send panel (4b meaning preserved)
    const onClosedPlain = vi.fn();
    await mounted.unmount();
    const plainDom = (mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={mockTransport({
          file: vi.fn(async () => ({ ok: true as const, file: makeFile(), threads: [] })),
          post: vi.fn(async () => ({ ok: false as const, code: 'invalid' as const })),
        })}
        invite
        inviteTransport={mockInviteTransport({ lookup: lookupFn })}
        initialPeople={PEOPLE}
        onClose={() => {}}
        onClosed={onClosedPlain}
      />,
    ));
    const plainInput = plainDom.query('[data-send-input]')!;
    await plainDom.setValue(plainInput, '일반 전송 테스트');
    await act(async () => {
      await pressKey(plainDom, plainInput, 'Enter');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onClosedPlain).toHaveBeenCalled();
  });

  it('draws no optimistic chips while pending, reveals chips + copy button without putting the link in DOM, copies to clipboard, and drops token on unmount', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText } },
    });

    let resolvePost!: (v: unknown) => void;
    const postPromise = new Promise((res) => {
      resolvePost = res;
    });
    const postedMsg = makeMsg({
      id: ROOT_1,
      body: '확인해 주세요',
      invites: [{ state: 'pending', email: 'new.person@example.com' }],
    });
    const postedThread = makeThread({ root: postedMsg });

    const transport = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile({ kind: 'video', url: '/v.mp4' }), threads: [] })),
    });
    const inviteTransport = mockInviteTransport({
      post: vi.fn(() => postPromise as never),
    });

    mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={transport}
        invite
        inviteTransport={inviteTransport}
        initialPeople={PEOPLE}
        onClose={() => {}}
      />,
    );
    Object.defineProperty(globalThis.window, 'location', {
      configurable: true,
      value: { origin: 'https://brand.twings.app' },
    });

    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '확인해 주세요 @new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');
    await pressKey(mounted, textarea, 'Enter');

    // While pending: optimistic row appears WITHOUT any invite chip
    expect(mounted.query('[data-send-pending]')).not.toBeNull();
    expect(mounted.query('[data-send-invite-chips]')).toBeNull();

    // Server settles with single-use token (mail off -> mailState: null)
    await act(async () => {
      resolvePost({
        ok: true,
        thread: postedThread,
        message: postedMsg,
        invited: [
          {
            email: 'new.person@example.com',
            result: 'invited',
            memberId: null,
            token: 'SECRET_TOKEN_XYZ',
            mailState: null,
          },
        ],
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mounted.query('[data-send-invite-chip="new.person@example.com"]')?.textContent).toContain(KO.chipPending);
    const copyBtn = mounted.query('[data-send-invite-copy="new.person@example.com"]');
    expect(copyBtn?.textContent).toBe(KO.inviteLinkCopy);
    // Security invariant: token / invite URL never rendered as text or DOM attribute
    const collectDomTextAndAttrs = (node: unknown): string => {
      if (!node || typeof node !== 'object') return '';
      const n = node as { _data?: string; tagName?: string; attributes?: Record<string, string>; childNodes?: unknown[] };
      const self = `${n.tagName ?? ''} ${n._data ?? ''} ${JSON.stringify(n.attributes ?? {})}`;
      return [self, ...(n.childNodes ?? []).map(collectDomTextAndAttrs)].join('\n');
    };
    const serialized = collectDomTextAndAttrs(mounted.container);
    expect(serialized).not.toContain('SECRET_TOKEN_XYZ');
    expect(serialized).not.toContain('/brand/invite#token=');

    // Click copies full URL via closure and shows inviteLinkCopied briefly
    await mounted.click('[data-send-invite-copy="new.person@example.com"]');
    expect(writeText).toHaveBeenCalledWith('https://brand.twings.app/brand/invite#token=SECRET_TOKEN_XYZ');
    expect(copyBtn?.textContent).toBe(KO.inviteLinkCopied);
    await act(async () => {
      vi.advanceTimersByTime(INVITE_COPIED_FEEDBACK_MS);
      await Promise.resolve();
    });
    expect(copyBtn?.textContent).toBe(KO.inviteLinkCopy);

    // Unmount drops tokens from state: remounting without new post shows no copy button
    await mounted.unmount();
    mounted = null;

    const transportAfterRemount = mockTransport({
      file: vi.fn(async () => ({ ok: true as const, file: makeFile({ kind: 'video', url: '/v.mp4' }), threads: [postedThread] })),
    });
    mounted = await mountDom(
      <SendPanel
        organizationId={ORG}
        fileRef={{ kind: 'output', outputId: OUT_1 }}
        copy={KO}
        locale="ko"
        transport={transportAfterRemount}
        invite
        inviteTransport={mockInviteTransport()}
        initialPeople={PEOPLE}
        onClose={() => {}}
      />,
    );
    expect(mounted.query('[data-send-invite-chip="new.person@example.com"]')).not.toBeNull();
    expect(mounted.query('[data-send-invite-copy]')).toBeNull();
  });

  it('shows chips + copy button on SendThreadView reply (with mailState: null) and omits copy button when mailState: sent', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText } },
    });

    const baseThread = makeThread({
      file: makeFile({ kind: 'video', url: '/api/brand-studio/media/st/clip.mp4' }),
      root: makeMsg({ invites: [] }),
    });
    const reply1 = makeMsg({
      id: '99999999-9999-4999-8999-999999999911',
      parentId: ROOT_1,
      body: '답글입니다',
      invites: [{ state: 'pending', email: 'a@example.com' }],
    });
    const reply2 = makeMsg({
      id: '99999999-9999-4999-8999-999999999912',
      parentId: ROOT_1,
      body: '둘째 답글',
      invites: [{ state: 'pending', email: 'b@example.com' }],
    });
    const inviteTransport = mockInviteTransport({
      reply: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          thread: baseThread,
          message: reply1,
          invited: [{ email: 'a@example.com', result: 'invited', memberId: null, token: 'T1', mailState: null }],
        })
        .mockResolvedValueOnce({
          ok: true,
          thread: baseThread,
          message: reply2,
          invited: [{ email: 'b@example.com', result: 'invited', memberId: null, token: 'T2', mailState: 'sent' }],
        }),
    });

    const seed: SendThreadPage = { ok: true, thread: baseThread, replies: [] };
    mounted = await mountDom(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        transport={mockTransport()}
        invite
        inviteTransport={inviteTransport}
        initialThread={seed}
        initialPeople={PEOPLE}
      />,
    );
    Object.defineProperty(globalThis.window, 'location', {
      configurable: true,
      value: { origin: 'https://brand.twings.app' },
    });
    const textarea = mounted.query('[data-send-input]')!;

    // Reply 1 (mail off -> mailState: null) -> copy button visible
    await mounted.setValue(textarea, '답글입니다 @a@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');
    await pressKey(mounted, textarea, 'Enter');
    expect(mounted.query('[data-send-invite-copy="a@example.com"]')).not.toBeNull();

    // Reply 2 (mailState: 'sent') -> NO copy button
    await mounted.setValue(textarea, '둘째 답글 @b@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');
    await pressKey(mounted, textarea, 'Enter');
    expect(mounted.query('[data-send-invite-chip="b@example.com"]')).not.toBeNull();
    expect(mounted.query('[data-send-invite-copy="b@example.com"]')).toBeNull();
  });

  it('renders writer/owner chips for all three states, non-owner count chip without address, and ordinary mention after acceptance', () => {
    const ownerHtml = renderToStaticMarkup(
      <SendInviteChips
        invites={[
          { state: 'pending', email: 'a@example.com' },
          { state: 'expired', email: 'b@example.com' },
          { state: 'accepted', email: 'c@example.com' },
        ]}
        copy={KO}
      />,
    );
    expect(ownerHtml).toContain('a@example.com');
    expect(ownerHtml).toContain(KO.chipPending);
    expect(ownerHtml).toContain('b@example.com');
    expect(ownerHtml).toContain(KO.chipExpired);
    expect(ownerHtml).toContain('c@example.com');
    expect(ownerHtml).toContain(KO.chipAccepted);

    const viewerHtmlKo = renderToStaticMarkup(
      <SendInviteChips
        invites={[
          { state: 'pending', email: null },
          { state: 'pending', email: null },
        ]}
        copy={KO}
      />,
    );
    expect(viewerHtmlKo).toContain('2명을 초대했어요');
    expect(viewerHtmlKo).not.toContain('@');

    const viewerHtmlEn = renderToStaticMarkup(
      <SendInviteChips invites={[{ state: 'pending', email: null }]} copy={EN} />,
    );
    expect(viewerHtmlEn).toContain('1 invited');

    // Accepted + delivered thread line: invites: [], ordinary mention rendered, zero invite chips
    const deliveredThread: SendThreadPage = {
      ok: true,
      thread: makeThread({
        root: makeMsg({
          body: '@Mina 이 컷 확인 부탁드려요',
          mentions: [{ id: USER_2, name: 'Mina' }],
          invites: [],
        }),
      }),
      replies: [],
    };
    const deliveredHtml = renderToStaticMarkup(
      <SendThreadView
        organizationId={ORG}
        rootId={ROOT_1}
        locale="ko"
        copy={KO}
        invite
        initialThread={deliveredThread}
      />,
    );
    expect(deliveredHtml).toContain('@Mina');
    expect(deliveredHtml).not.toContain('data-send-invite-chips');
  });

  it('Fix round 1 (4): shows inviteNeedsWords in place of hint when invite chips exist with no words, only when invite is open', async () => {
    const lookupFn = vi.fn(async (email: string) => ({
      ok: true as const,
      email,
      status: 'invitable' as const,
      member: null,
    }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={async () => ({ ok: true })}
      />,
    );
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');

    const describedId = textarea.getAttribute('aria-describedby');
    expect(describedId).toBeTruthy();
    const hintNode = mounted.query(`[id="${describedId}"]`);
    expect(hintNode?.textContent).toBe('메시지를 입력해야 보낼 수 있어요.');
    expect(mounted.container.textContent).not.toContain(KO.sendHint);
    expect(mounted.query('[data-send-submit]')?.hasAttribute('disabled')).toBe(true);

    // Only another standalone copy (still no words) keeps inviteNeedsWords visible
    await mounted.setValue(textarea, `${(textarea as unknown as { value: string }).value}   new.person@example.com  `);
    expect(mounted.query(`[id="${describedId}"]`)?.textContent).toBe('메시지를 입력해야 보낼 수 있어요.');
    expect(mounted.query('[data-send-submit]')?.hasAttribute('disabled')).toBe(true);

    // Adding words switches back to normal hint and enables submit
    await mounted.setValue(textarea, `${(textarea as unknown as { value: string }).value}확인 부탁드려요`);
    expect(mounted.query(`[id="${describedId}"]`)?.textContent).toBe(KO.sendHint);
    expect(mounted.query('[data-send-submit]')?.hasAttribute('disabled')).toBe(false);

    // English copy check + without invite never shows it
    await mounted.unmount();
    mounted = await mountDom(
      <SendComposer
        copy={EN}
        placeholder={EN.sendPlaceholder}
        hint={EN.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={async () => ({ ok: true })}
      />,
    );
    const enInput = mounted.query('[data-send-input]')!;
    await mounted.setValue(enInput, '@new.person@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, enInput, 'Enter');
    const enHintId = enInput.getAttribute('aria-describedby')!;
    expect(mounted.query(`[id="${enHintId}"]`)?.textContent).toBe('Please enter a message to send the invitation.');

    await mounted.unmount();
    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        initialText="@new.person@example.com"
        initialPeople={PEOPLE}
        onSend={async () => ({ ok: true })}
      />,
    );
    expect(mounted.container.textContent).toContain(KO.sendHint);
    expect(mounted.container.textContent).not.toContain('메시지를 입력해야 보낼 수 있어요.');
  });

  it('Fix round 1 (5): Enter submits in empty-choice status states and keeps listbox structure valid without nested buttons or inside-listbox status', async () => {
    let pendingResolve!: (val: { ok: true; email: string; status: 'invitable'; member: null }) => void;
    const lookupFn = vi.fn((email: string) => {
      if (email === 'slow@example.com') {
        return new Promise<{ ok: true; email: string; status: 'invitable'; member: null }>((resolve) => {
          pendingResolve = resolve;
        });
      }
      if (email === 'rate@example.com') {
        return Promise.resolve({ ok: false as const, code: 'rate_limited' as const });
      }
      if (email === 'blocked@example.com') {
        return Promise.resolve({ ok: true as const, email, status: 'not_allowed' as const, member: null });
      }
      return Promise.resolve({ ok: true as const, email, status: 'invitable' as const, member: null });
    });
    const onSend = vi.fn(async () => ({ ok: true as const }));

    const mixedPeople: SendPerson[] = [
      ...PEOPLE,
      { id: '55555555-5555-4555-8555-555555555561', name: 'blocked@example.com 동료', role: 'editor', me: false },
    ];

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );
    const textarea = mounted.query('[data-send-input]')!;

    // 5a. loading with no member row -> status sits outside listbox, Enter sends
    await mounted.setValue(textarea, '@slow@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-picker]')?.textContent).toContain(KO.loading);
    expect(mounted.queryAll('[role="listbox"] [role="status"]')).toHaveLength(0);
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(1);
    pendingResolve({ ok: true, email: 'slow@example.com', status: 'invitable', member: null });

    // 5b. rate_limited with no member row -> status sits outside listbox, Enter sends
    await mounted.setValue(textarea, '@rate@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-invite-rate]')?.textContent).toBe(KO.sendRate);
    expect(mounted.queryAll('[role="listbox"] [role="status"]')).toHaveLength(0);
    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(2);

    // 5c. invitable -> option IS role="option", NO <button> inside option, non-focusable visual span, pointerDown activates
    await mounted.setValue(textarea, '확인 @pick@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    const opt = mounted.query('[data-send-invite-option]')!;
    expect(opt.getAttribute('role')).toBe('option');
    expect(opt.querySelector('button')).toBeNull();
    const visualAction = mounted.query('[data-send-invite-action]')!;
    expect(visualAction.tagName).not.toBe('BUTTON');
    expect(visualAction.hasAttribute('tabindex')).toBe(false);

    // Activate via mousedown (pointer down) without mouseup/click -> picks cleanly
    await act(async () => {
      opt.dispatchEvent({ type: 'mousedown', button: 0, bubbles: true, cancelable: true, preventDefault() {} } as never);
      await Promise.resolve();
    });
    expect(mounted.query('[data-send-invite-draft="pick@example.com"]')).not.toBeNull();

    // 5d. Member row + not_allowed status -> member sits in listbox, status sits outside listbox
    await mounted.unmount();
    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={mixedPeople}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );
    const input2 = mounted.query('[data-send-input]')!;
    await mounted.setValue(input2, '@blocked@example.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mounted.queryAll('[role="listbox"] [role="option"]')).toHaveLength(1);
    expect(mounted.queryAll('[role="listbox"] [role="status"]')).toHaveLength(0);
    expect(mounted.query('[data-send-picker] [role="status"]')?.textContent).toBe(KO.inviteNotAllowed);
  });

  it('Fix round 1 (6): without invite (or with empty tokens), SendThreadView and SendPanel render once on seeded mount without extra render', async () => {
    const threadPage: SendThreadPage = {
      ok: true,
      thread: makeThread(),
      replies: [],
    };
    const threadRenderPhases: string[] = [];
    const panelRenderPhases: string[] = [];

    mounted = await mountDom(
      <Profiler id="thread-mount" onRender={(_id, phase) => threadRenderPhases.push(phase)}>
        <SendThreadView
          organizationId={ORG}
          rootId={ROOT_1}
          locale="ko"
          copy={KO}
          transport={mockTransport()}
          initialThread={threadPage}
          initialPeople={PEOPLE}
          markSeedRead={false}
        />
      </Profiler>,
    );
    expect(threadRenderPhases).toEqual(['mount']);

    await mounted.unmount();
    mounted = null;

    mounted = await mountDom(
      <Profiler id="panel-mount" onRender={(_id, phase) => panelRenderPhases.push(phase)}>
        <SendPanel
          organizationId={ORG}
          fileRef={{ kind: 'output', outputId: OUT_1 }}
          copy={KO}
          locale="ko"
          transport={mockTransport()}
          initialFile={{ ok: true, file: makeFile(), threads: [] }}
          initialPeople={PEOPLE}
          onClose={() => {}}
        />
      </Profiler>,
    );
    expect(panelRenderPhases).toEqual(['mount']);
  });

  it('Fix round 2 (1): Korean particles directly adjacent to an invited address stay in wire body without triggering inviteRefused', async () => {
    const lookupFn = vi.fn(async (email: string) => ({
      ok: true as const,
      email,
      status: 'invitable' as const,
      member: null,
    }));
    const onSend = vi.fn(async () => ({ ok: true as const }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={onSend}
      />,
    );
    const textarea = mounted.query('[data-send-input]')!;
    await mounted.setValue(textarea, '@a@b.com');
    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS);
      await Promise.resolve();
      await Promise.resolve();
    });
    await pressKey(mounted, textarea, 'Enter');

    const pickedA = (textarea as unknown as { value: string }).value;
    await mounted.setValue(textarea, `${pickedA}a@b.com에게 보내요`);
    expect(mounted.query('[data-send-invite-refused="a@b.com"]')).toBeNull();
    expect(mounted.query('[data-send-submit]')?.hasAttribute('disabled')).toBe(false);

    await pressKey(mounted, textarea, 'Enter');
    expect(onSend).toHaveBeenCalledTimes(1);
    const sent1 = (onSend.mock.calls[0] as unknown as [{ body: string; invites: string[] }])[0];
    expect(sent1.invites).toEqual(['a@b.com']);
    expect(sent1.body).toBe('에게 보내요');
  });

  it('Fix round 2 (2): SendInviteRow resets pickedOnDownRef on pointerup, pointerleave, and pointercancel so subsequent click still triggers onPick', async () => {
    const onPick = vi.fn();
    mounted = await mountDom(
      <SendInviteRow mode="invitable" email="a@b.com" optionId="opt-1" selected copy={KO} onPick={onPick} />,
    );

    const opt = mounted.query('[data-send-invite-option]')!;

    // 1. mousedown + pointerleave (lost click via drag off) -> next click is NOT ignored
    await act(async () => {
      opt.dispatchEvent({ type: 'mousedown', button: 0, bubbles: true, cancelable: true, preventDefault() {} } as never);
      opt.dispatchEvent({ type: 'pointerout', bubbles: true, cancelable: false } as never);
      await Promise.resolve();
    });
    expect(onPick).toHaveBeenCalledTimes(1);
    await mounted.click(opt);
    expect(onPick).toHaveBeenCalledTimes(2);

    // 2. mousedown + pointercancel -> next click is NOT ignored
    await act(async () => {
      opt.dispatchEvent({ type: 'mousedown', button: 0, bubbles: true, cancelable: true, preventDefault() {} } as never);
      opt.dispatchEvent({ type: 'pointercancel', bubbles: true, cancelable: false } as never);
      await Promise.resolve();
    });
    expect(onPick).toHaveBeenCalledTimes(3);
    await mounted.click(opt);
    expect(onPick).toHaveBeenCalledTimes(4);

    // 3. mousedown + pointerup without click -> next click is NOT ignored
    await act(async () => {
      opt.dispatchEvent({ type: 'mousedown', button: 0, bubbles: true, cancelable: true, preventDefault() {} } as never);
      opt.dispatchEvent({ type: 'pointerup', bubbles: true, cancelable: true } as never);
      await Promise.resolve();
    });
    expect(onPick).toHaveBeenCalledTimes(5);
    await mounted.click(opt);
    expect(onPick).toHaveBeenCalledTimes(6);

    // 4. Direct mousedown + click without reset still fires onPick only once
    await act(async () => {
      opt.dispatchEvent({ type: 'mousedown', button: 0, bubbles: true, cancelable: true, preventDefault() {} } as never);
      await Promise.resolve();
    });
    await mounted.click(opt);
    expect(onPick).toHaveBeenCalledTimes(7);
  });

  it('Fix round 3: cancels armed debounce on compositionstart, ignores updates during composition, and decides anew on compositionend', async () => {
    const lookupFn = vi.fn(async (email: string) => ({
      ok: true as const,
      email,
      status: 'invitable' as const,
      member: null,
    }));

    mounted = await mountDom(
      <SendComposer
        copy={KO}
        placeholder={KO.sendPlaceholder}
        hint={KO.sendHint}
        invite
        initialPeople={PEOPLE}
        lookupAddress={lookupFn}
        onSend={async () => ({ ok: true })}
      />,
    );
    const textarea = mounted.query('[data-send-input]')!;

    // 1. Complete address arms 300ms debounce, then Korean composition starts within 300ms -> canceled
    await mounted.setValue(textarea, '@a@b.com');
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionstart', bubbles: true, cancelable: false } as never);
      textarea.dispatchEvent({ type: 'compositionupdate', data: 'ㅇ', bubbles: true, cancelable: false } as never);
    });
    await mounted.setValue(textarea, '@a@b.comㅇ');
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    // 2. Ending composition with Hangul directly following @a@b.com -> NOT a lookup target
    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionupdate', data: '에', bubbles: true, cancelable: false } as never);
    });
    await mounted.setValue(textarea, '@a@b.com에');
    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionend', data: '에', bubbles: true, cancelable: false } as never);
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    // 3. Complete address @c@d.com -> compositionstart cancels armed debounce; compositionend back at @c@d.com arms fresh debounce and fires once
    await mounted.setValue(textarea, '@c@d.com');
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionstart', bubbles: true, cancelable: false } as never);
      textarea.dispatchEvent({ type: 'compositionupdate', data: 'ㅇ', bubbles: true, cancelable: false } as never);
    });
    await mounted.setValue(textarea, '@c@d.comㅇ');
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    // Cancel Korean char inside composition back to @c@d.com and commit
    await mounted.setValue(textarea, '@c@d.com');
    await act(async () => {
      textarea.dispatchEvent({ type: 'compositionend', data: '', bubbles: true, cancelable: false } as never);
    });
    expect(lookupFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(INVITE_LOOKUP_DEBOUNCE_MS - 1);
      await Promise.resolve();
    });
    expect(lookupFn).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lookupFn).toHaveBeenCalledTimes(1);
    expect(lookupFn).toHaveBeenCalledWith('c@d.com');
  });

  it('enforces Slice 4c source guards, string exactness, invite-behind-flag, and CSS invariants', () => {
    const root = process.cwd();
    const sendDir = path.join(root, 'components/brand-send');

    // 1. Every exported function in invite-model.ts is imported & called by components
    const inviteModelSrc = readFileSync(path.join(sendDir, 'invite-model.ts'), 'utf8');
    const runtimeExports = [...inviteModelSrc.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]!);
    expect(runtimeExports.length).toBeGreaterThan(0);

    const componentSrc = collectFiles(sendDir)
      .filter((f) => /\.tsx$/.test(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    for (const sym of runtimeExports) {
      expect(componentSrc, `${sym} in invite-model.ts must be used by components`).toMatch(new RegExp(`\\b${sym}\\b`));
    }

    // 2. Timer containment & no hardcoded text in new UI components & CSS purity
    const files = collectFiles(sendDir);
    for (const file of files) {
      const base = path.basename(file);
      const src = readFileSync(file, 'utf8');
      if (base !== 'inbox-page.tsx' && base !== 'thread-view.tsx' && base !== 'composer.tsx' && base !== 'invite-chips.tsx') {
        expect(src, base).not.toMatch(/\b(setInterval|setTimeout)\b/);
      }
      // Zero runtime lib/** imports except contract limits
      for (const imp of src.matchAll(/^import\s+([^;]*?)\s+from\s+['"](@\/lib\/[^'"]+)['"];?/gm)) {
        const clause = imp[1]!.trim();
        const target = imp[2]!;
        if (clause.startsWith('type ')) continue;
        expect(['@/lib/brand-rooms/message-contracts', '@/lib/brand-rooms/send-contracts']).toContain(target);
      }
      // No inline object/array literals in hook deps or component props
      expect(src, base).not.toMatch(/use(?:Effect|Memo|Callback|LayoutEffect)\([^)]*,\s*\[[^\]]*(?:\{\s*[^}]*\}|\[\s*[^\]]*\])[^\]]*\]/s);
      expect(src, base).not.toMatch(/<(?:SendThreadView|SendComposer|SendFileCardView|SendInviteRow|SendInviteChips)\b[^>]*=\{\s*[\[{]/);
    }

    for (const cssName of ['invite-row.module.css', 'invite-chips.module.css', 'composer.module.css']) {
      const css = readFileSync(path.join(sendDir, cssName), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, cssName).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/);
      expect(css, cssName).toContain('prefers-reduced-motion: reduce');
      if (cssName !== 'composer.module.css') {
        expect(css, cssName).not.toContain('--ys-accent');
      }
    }

    // 3. sendInviteTransport & lookup & invites live strictly behind the `invite` flag
    const panelSrc = readFileSync(path.join(sendDir, 'send-panel.tsx'), 'utf8');
    expect(panelSrc).toMatch(/invite\s*\?\s*\(inviteTransport\s*\?\?\s*sendInviteTransport/);
    expect(panelSrc).toMatch(/invite\s*&&\s*invites\s*&&\s*invites\.length\s*>\s*0\s*&&\s*activeInviteTransport/);

    const threadSrc = readFileSync(path.join(sendDir, 'thread-view.tsx'), 'utf8');
    expect(threadSrc).toMatch(/invite\s*\?\s*\(inviteTransport\s*\?\?\s*sendInviteTransport/);
    expect(threadSrc).toMatch(/invite\s*&&\s*draft\.invites\s*&&\s*draft\.invites\.length\s*>\s*0\s*&&\s*activeInviteTransport/);

    // 4. Verbatim strings check from slice4c-strings.md
    expect(KO_DICT.brandSend).toMatchObject({
      inviteHeading: '멤버가 아닌 주소',
      inviteDesc: '초대장을 보내고 수락하면 메시지가 전달돼요',
      inviteAction: '초대하고 보내기',
      chipPending: '초대 수락을 기다려요',
      chipExpired: '초대가 만료됐어요',
      chipAccepted: '멤버가 되었지만 메시지는 전달되지 않았어요',
      chipCount: '{n}명을 초대했어요',
      inviteRefused: '이 주소로는 초대할 수 없어요.',
      inviteNotAllowed: '보기 권한만으로는 초대할 수 없어요.',
      inviteLimit: '오늘 초대 한도를 다 썼어요. 내일 다시 시도해 주세요.',
      inviteTooMany: '한 번에 3명까지만 초대할 수 있어요.',
      inviteSelf: '내 주소는 초대할 수 없어요.',
      inviteLinkCopy: '초대 링크 복사하기',
      inviteLinkCopied: '링크를 복사했어요',
      inviteNeedsWords: '메시지를 입력해야 보낼 수 있어요.',
    });
    expect(EN_DICT.brandSend).toMatchObject({
      inviteHeading: 'Non-member address',
      inviteDesc: 'The message will be delivered once the invite is accepted',
      inviteAction: 'Invite and send',
      chipPending: 'Pending acceptance',
      chipExpired: 'Invite expired',
      chipAccepted: 'Joined but message not delivered',
      chipCount: '{n} invited',
      inviteRefused: 'This address cannot be invited',
      inviteNotAllowed: 'Viewers cannot invite others',
      inviteLimit: 'Daily invite limit reached. Please try again tomorrow.',
      inviteTooMany: 'You can invite up to 3 people at once',
      inviteSelf: 'You cannot invite yourself',
      inviteLinkCopy: 'Copy invite link',
      inviteLinkCopied: 'Link copied',
      inviteNeedsWords: 'Please enter a message to send the invitation.',
    });
  });
});
