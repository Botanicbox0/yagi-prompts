import { describe, expect, it } from 'vitest';
import { SEND_LIMITS, type SendPerson } from '@/lib/brand-rooms/send-contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { EMPTY_REQUEST_ID_PLAN, applyMentionPick, pickSendCopy, type TrackedMention } from '@/components/brand-send/model';
import {
  INVITE_LOOKUP_DEBOUNCE_MS,
  activeInviteLookupView,
  applyInvitePick,
  buildInviteLinkUrl,
  conflictingInviteEmails,
  extractCopyableInviteTokens,
  extractInviteEmails,
  formatInviteRemoveLabel,
  initialInviteLookupState,
  inviteChipDisplayList,
  inviteLookupReduce,
  inviteRefusalOutcome,
  parseCompleteInviteEmail,
  parseInviteTrigger,
  reconcileInvites,
  remainingInviteDraftAfterSend,
  removeTrackedInvite,
  resolveInviteRequestId,
  stripTrackedInvitesFromBody,
  type TrackedInvite,
} from '@/components/brand-send/invite-model';

const KO = pickSendCopy(getDictionary('ko'));
const EN = pickSendCopy(getDictionary('en'));

const USER_1 = '55555555-5555-4555-8555-555555555551';
const USER_2 = '55555555-5555-4555-8555-555555555552';
const USER_3 = '55555555-5555-4555-8555-555555555553';

const PEOPLE: SendPerson[] = [
  { id: USER_1, name: '김서아', role: 'owner', me: true },
  { id: USER_2, name: '이하린', role: 'editor', me: false },
  { id: USER_3, name: '박도윤', role: 'viewer', me: false },
];

describe('components/brand-send/invite-model.ts', () => {
  it('detects complete vs partial addresses, upper case, trailing dot, and Korean before @', () => {
    expect(parseCompleteInviteEmail('mina@example.com')).toBe('mina@example.com');
    expect(parseCompleteInviteEmail('  MINA.Park+1@Example.CO.KR  ')).toBe('mina.park+1@example.co.kr');
    expect(parseCompleteInviteEmail('mina@example.com.')).toBeNull();
    expect(parseCompleteInviteEmail('mina@example')).toBeNull();
    expect(parseCompleteInviteEmail('mina@example.c')).toBeNull();
    expect(parseCompleteInviteEmail('mina@')).toBeNull();
    expect(parseCompleteInviteEmail('@example.com')).toBeNull();
    expect(parseCompleteInviteEmail('한글@example.com')).toBeNull();
    expect(parseCompleteInviteEmail(`${'a'.repeat(243)}@example.com`)).toBeNull();
    expect(parseCompleteInviteEmail(`${'a'.repeat(321)}`)).toBeNull();

    // Trigger inside text: start, after whitespace, uppercase, partial, trailing dot, Korean directly before @ vs Korean + space before @
    expect(parseInviteTrigger('@Mina@Example.com', 17, PEOPLE)).toEqual({
      start: 0,
      end: 17,
      query: 'Mina@Example.com',
    });
    const sample2 = '이 컷 어때요? @new.person@example.com';
    expect(parseInviteTrigger(sample2, sample2.length, PEOPLE)).toEqual({
      start: 9,
      end: 32,
      query: 'new.person@example.com',
    });
    expect(parseInviteTrigger('@@example.com', 13, PEOPLE)).toBeNull();
    expect(parseInviteTrigger('이 컷 @new.person@example.com.', 28, PEOPLE)).toBeNull();
    expect(parseInviteTrigger('이 컷 @new.person@example', 23, PEOPLE)).toBeNull();
    expect(parseInviteTrigger('이 컷 @new.person@example.c', 25, PEOPLE)).toBeNull();
    // Korean directly before @ (no whitespace boundary) does not trigger
    expect(parseInviteTrigger('안녕하세요@mina@example.com', 22, PEOPLE)).toBeNull();
    // Korean + space before @ DOES trigger
    const sample3 = '안녕하세요 @mina@example.com';
    expect(parseInviteTrigger(sample3, sample3.length, PEOPLE)).toEqual({
      start: 6,
      end: 23,
      query: 'mina@example.com',
    });
    // Korean in local part does not trigger
    expect(parseInviteTrigger('@김민아@example.com', 16, PEOPLE)).toBeNull();
    // Existing member trigger still works
    expect(parseInviteTrigger('@이하', 3, PEOPLE)).toEqual({ start: 0, end: 3, query: '이하' });
  });

  it('runs lookup reducer: debounce, single in-flight queueing, cache, rate_limited stop until text changes, and stale drop', () => {
    let state = initialInviteLookupState();

    // Typing complete address schedules 300ms debounce
    const t1 = inviteLookupReduce(state, { type: 'target', email: 'a@example.com', textChanged: true });
    state = t1.state;
    expect(t1.command).toEqual({ type: 'debounce', email: 'a@example.com', seq: 1, delayMs: INVITE_LOOKUP_DEBOUNCE_MS });

    // Debounce fires -> fetches a@example.com
    const f1 = inviteLookupReduce(state, { type: 'debounce_fire', seq: 1, email: 'a@example.com' });
    state = f1.state;
    expect(f1.command).toEqual({ type: 'fetch', email: 'a@example.com', seq: 1 });
    expect(activeInviteLookupView(state, PEOPLE, true)).toEqual({ kind: 'loading', email: 'a@example.com' });

    // While a@example.com is in flight, typing a second address schedules debounce, and firing queues it instead of concurrent fetch
    const t2 = inviteLookupReduce(state, { type: 'target', email: 'b@example.com', textChanged: true });
    state = t2.state;
    expect(t2.command).toEqual({ type: 'debounce', email: 'b@example.com', seq: 2, delayMs: INVITE_LOOKUP_DEBOUNCE_MS });
    const f2 = inviteLookupReduce(state, { type: 'debounce_fire', seq: 2, email: 'b@example.com' });
    state = f2.state;
    expect(f2.command).toBeNull();
    expect(state.inflightEmail).toBe('a@example.com');
    expect(state.queuedEmail).toBe('b@example.com');

    // First answer arrives for a@example.com while target is b@example.com -> DROPPED (not cached) and immediately starts queued b@example.com
    const a1 = inviteLookupReduce(state, {
      type: 'answer',
      seq: 1,
      email: 'a@example.com',
      result: { ok: true, email: 'a@example.com', status: 'invitable', member: null },
    });
    state = a1.state;
    expect(state.cache['a@example.com']).toBeUndefined();
    expect(a1.command).toEqual({ type: 'fetch', email: 'b@example.com', seq: 3 });

    // Answer arrives for b@example.com while target is still b@example.com -> cached
    const a2 = inviteLookupReduce(state, {
      type: 'answer',
      seq: 3,
      email: 'b@example.com',
      result: { ok: true, email: 'b@example.com', status: 'invitable', member: null },
    });
    state = a2.state;
    expect(a2.command).toBeNull();
    expect(activeInviteLookupView(state, PEOPLE, true)).toEqual({ kind: 'invitable', email: 'b@example.com' });

    // Returning to b@example.com hits cache with zero debounce/fetch
    const hit = inviteLookupReduce(state, { type: 'target', email: 'b@example.com', textChanged: false });
    expect(hit.command).toBeNull();
    expect(activeInviteLookupView(hit.state, PEOPLE, true)).toEqual({ kind: 'invitable', email: 'b@example.com' });

    // rate_limited stops further asks until text changes
    const t3 = inviteLookupReduce(state, { type: 'target', email: 'c@example.com', textChanged: true });
    state = t3.state;
    const seq3 = state.debouncingSeq;
    const f3 = inviteLookupReduce(state, { type: 'debounce_fire', seq: seq3, email: 'c@example.com' });
    state = f3.state;
    const rl = inviteLookupReduce(state, {
      type: 'answer',
      seq: seq3,
      email: 'c@example.com',
      result: { ok: false, code: 'rate_limited' },
    });
    state = rl.state;
    expect(state.rateLimited).toBe(true);
    expect(activeInviteLookupView(state, PEOPLE, true)).toEqual({ kind: 'rate_limited', email: 'c@example.com' });

    // Caret movement without text change does not ask while rate_limited
    const caretOnly = inviteLookupReduce(state, { type: 'target', email: 'd@example.com', textChanged: false });
    expect(caretOnly.command).toBeNull();

    // Text change clears rate_limited and asks again
    const resume = inviteLookupReduce(caretOnly.state, { type: 'target', email: 'd@example.com', textChanged: true });
    expect(resume.command).toEqual({
      type: 'debounce',
      email: 'd@example.com',
      seq: resume.state.debouncingSeq,
      delayMs: INVITE_LOOKUP_DEBOUNCE_MS,
    });

    // Self detection via member.id matching me: true
    let selfState = initialInviteLookupState();
    selfState = inviteLookupReduce(selfState, { type: 'target', email: 'me@example.com', textChanged: true }).state;
    selfState = inviteLookupReduce(selfState, { type: 'debounce_fire', seq: 1, email: 'me@example.com' }).state;
    selfState = inviteLookupReduce(selfState, {
      type: 'answer',
      seq: 1,
      email: 'me@example.com',
      result: { ok: true, email: 'me@example.com', status: 'member', member: { id: USER_1, name: '김서아' } },
    }).state;
    expect(activeInviteLookupView(selfState, PEOPLE, false)).toEqual({ kind: 'loading', email: 'me@example.com' });
    expect(activeInviteLookupView(selfState, PEOPLE, true)).toEqual({ kind: 'self', email: 'me@example.com' });

    // Non-self member lookup resolves member role from send.people
    let memberState = initialInviteLookupState();
    memberState = inviteLookupReduce(memberState, { type: 'target', email: 'harin@example.com', textChanged: true }).state;
    memberState = inviteLookupReduce(memberState, { type: 'debounce_fire', seq: 1, email: 'harin@example.com' }).state;
    memberState = inviteLookupReduce(memberState, {
      type: 'answer',
      seq: 1,
      email: 'harin@example.com',
      result: { ok: true, email: 'harin@example.com', status: 'member', member: { id: USER_2, name: '이하린' } },
    }).state;
    expect(activeInviteLookupView(memberState, PEOPLE, true)).toEqual({
      kind: 'member',
      email: 'harin@example.com',
      person: { id: USER_2, name: '이하린', role: 'editor' },
    });
  });

  it('enforces the 3-address limit, preserves mentions while shifting, and removes on deletion or chip removal', () => {
    expect(SEND_LIMITS.invitesPerMessage).toBe(3);
    let text = '@이하린 안녕하세요 @one@example.com';
    let mentions: TrackedMention[] = [{ userId: USER_2, name: '이하린', start: 0, end: 4 }];
    let invites: TrackedInvite[] = [];

    const p1 = applyInvitePick(text, { start: 11, end: 27, query: 'one@example.com' }, 'One@Example.com', mentions, invites);
    expect(p1.ok).toBe(true);
    if (!p1.ok) throw new Error('expected ok');
    text = p1.text;
    mentions = p1.trackedMentions;
    invites = p1.trackedInvites;
    expect(text).toBe('@이하린 안녕하세요 @one@example.com ');
    expect(extractInviteEmails(text, invites)).toEqual(['one@example.com']);

    // Add 2nd and 3rd addresses
    const trig2 = { start: text.length, end: text.length + 16, query: 'two@example.com' };
    const p2 = applyInvitePick(`${text}@two@example.com`, trig2, 'two@example.com', mentions, invites);
    if (!p2.ok) throw new Error('expected ok');
    const trig3 = { start: p2.text.length, end: p2.text.length + 18, query: 'three@example.com' };
    const p3 = applyInvitePick(`${p2.text}@three@example.com`, trig3, 'three@example.com', p2.trackedMentions, p2.trackedInvites);
    if (!p3.ok) throw new Error('expected ok');
    expect(extractInviteEmails(p3.text, p3.trackedInvites)).toEqual([
      'one@example.com',
      'two@example.com',
      'three@example.com',
    ]);

    // 4th distinct address is refused before any request; picking an already-included address is allowed
    const trigDup = { start: p3.text.length, end: p3.text.length + 16, query: 'two@example.com' };
    const pDup = applyInvitePick(`${p3.text}@two@example.com`, trigDup, 'two@example.com', p3.trackedMentions, p3.trackedInvites);
    expect(pDup.ok).toBe(true);

    const trig4 = { start: p3.text.length, end: p3.text.length + 17, query: 'four@example.com' };
    const p4 = applyInvitePick(`${p3.text}@four@example.com`, trig4, 'four@example.com', p3.trackedMentions, p3.trackedInvites);
    expect(p4).toEqual({ ok: false, reason: 'too_many' });

    // Deleting a single character inside an inserted address removes that invite while keeping others
    const edited = p3.text.replace('@two@example.com', '@two@example.co');
    const reconciled = reconcileInvites(p3.text, edited, p3.trackedInvites);
    expect(extractInviteEmails(edited, reconciled)).toEqual(['one@example.com', 'three@example.com']);

    // Explicit chip removal cleans text and shifts both mentions and remaining invites
    const afterRemove = removeTrackedInvite(p3.text, 'one@example.com', p3.trackedMentions, p3.trackedInvites);
    expect(afterRemove.text).not.toContain('one@example.com');
    expect(extractInviteEmails(afterRemove.text, afterRemove.trackedInvites)).toEqual([
      'two@example.com',
      'three@example.com',
    ]);

    // Stripping tracked invites from wire body preserves mentions & prose and removes all invited addresses
    const wire = stripTrackedInvitesFromBody(p3.text, p3.trackedInvites);
    expect(wire).toBe('@이하린 안녕하세요');
    expect(wire).not.toContain('one@example.com');
    expect(wire).not.toContain('two@example.com');
    expect(wire).not.toContain('three@example.com');

    // Inserting a mention before an invite shifts the invite offset cleanly
    const beforeMention = ' @박 @one@example.com ';
    const withMention = applyMentionPick(
      beforeMention,
      { start: 1, end: 3, query: '박' },
      PEOPLE[2]!,
      [],
    );
    const shifted = reconcileInvites(beforeMention, withMention.text, [{ email: 'one@example.com', start: 4, end: 20 }]);
    expect(extractInviteEmails(withMention.text, shifted)).toEqual(['one@example.com']);

    // Remaining draft after send & requestId plan including invites
    const rem = remainingInviteDraftAfterSend(
      `${p1.text}다음 컷`,
      p1.text,
      p1.trackedMentions,
      p1.trackedInvites,
    );
    expect(rem).toEqual({ text: '다음 컷', trackedMentions: [], trackedInvites: [], cleared: false });

    let nextSeq = 0;
    const mk = () => `id-${++nextSeq}`;
    const r1 = resolveInviteRequestId(EMPTY_REQUEST_ID_PLAN, wire, [USER_2], ['one@example.com'], mk);
    const rSame = resolveInviteRequestId(r1.plan, wire, [USER_2], ['one@example.com'], mk);
    const rChanged = resolveInviteRequestId(r1.plan, wire, [USER_2], ['one@example.com', 'two@example.com'], mk);
    expect(r1.requestId).toBe('id-1');
    expect(rSame.requestId).toBe('id-1');
    expect(rChanged.requestId).toBe('id-2');
  });

  it('maps every refusal outcome, chip state, count form, copyable tokens, and invite URLs', () => {
    expect(inviteRefusalOutcome('invite_limit', undefined, 'compose_post', KO)).toEqual({
      hideSend: false,
      keepText: true,
      resetRequestId: false,
      errorText: KO.inviteLimit,
      refusedEmails: [],
    });
    expect(
      inviteRefusalOutcome('invite_refused', ['Bad@Example.com', 'bad@example.com'], 'compose_post', KO),
    ).toEqual({
      hideSend: false,
      keepText: true,
      resetRequestId: true,
      errorText: null,
      refusedEmails: ['bad@example.com'],
    });
    expect(inviteRefusalOutcome('invite_refused', [], 'compose_post', KO)).toEqual({
      hideSend: false,
      keepText: true,
      resetRequestId: true,
      errorText: KO.inviteRefused,
      refusedEmails: [],
    });
    expect(inviteRefusalOutcome('forbidden', undefined, 'compose_reply', EN)).toEqual({
      hideSend: false,
      keepText: true,
      resetRequestId: true,
      errorText: EN.inviteNotAllowed,
      refusedEmails: [],
    });
    expect(inviteRefusalOutcome('rate_limited', undefined, 'compose_post', KO).errorText).toBe(KO.sendRate);
    const reqIdWithoutInvites = inviteRefusalOutcome('invalid', undefined, 'compose_post', KO);
    expect(reqIdWithoutInvites.hideSend).toBe(true);
    const reqIdWithInvites = inviteRefusalOutcome('invalid', undefined, 'compose_post', KO, true);
    expect(reqIdWithInvites).toEqual({
      hideSend: false,
      keepText: true,
      resetRequestId: true,
      errorText: KO.sendFailed,
      refusedEmails: [],
    });

    // Standalone duplicates stripped from wire body; longer tokens and URLs preserved & detected
    const multiText = '@a@b.com 확인 (a@b.com) 그리고 A@B.COM, 봐주세요';
    const trackedA = [{ email: 'a@b.com', start: 0, end: 8 }];
    const multiWire = stripTrackedInvitesFromBody(multiText, trackedA);
    expect(multiWire.toLowerCase()).not.toContain('a@b.com');
    expect(multiWire).toContain('확인');
    expect(multiWire).toContain('봐주세요');

    for (const tricky of [
      '@a@b.com 다른사람 aa@b.com 확인',
      '@a@b.com 링크 https://example.com/?to=a@b.com 확인',
      '@a@b.com 링크 https://a@b.com/home 확인',
      '@a@b.com 메일 mailto:a@b.com 확인',
      '@a@b.com 도메인 a@b.com.kr 확인',
    ]) {
      const stripped = stripTrackedInvitesFromBody(tricky, trackedA);
      expect(stripped.toLowerCase()).toContain('a@b.com');
    }

    // Fix round 2 (1): Hangul syllables/jamo directly before or after address act as boundaries; aa@b.com & a@b.com.kr remain longer tokens
    expect(stripTrackedInvitesFromBody('@a@b.com에게 보내요', trackedA)).toBe('에게 보내요');
    expect(stripTrackedInvitesFromBody('@a@b.com a@b.com에게 보내요', trackedA)).toBe('에게 보내요');
    expect(stripTrackedInvitesFromBody('@a@b.com님 확인 부탁드려요', trackedA)).toBe('님 확인 부탁드려요');
    expect(stripTrackedInvitesFromBody('@a@b.com a@b.com님 확인 부탁드려요', trackedA)).toBe('님 확인 부탁드려요');
    expect(stripTrackedInvitesFromBody('@a@b.com ㄱ', [{ email: 'a@b.com', start: 0, end: 8 }])).toBe('ㄱ');
    expect(stripTrackedInvitesFromBody('@a@b.comㄱ', trackedA)).toBe('ㄱ');
    expect(stripTrackedInvitesFromBody('@a@b.com\u1100', trackedA)).toBe('\u1100');
    expect(stripTrackedInvitesFromBody('@a@b.com 담당자a@b.com 확인', trackedA)).toBe('담당자 확인');
    expect(stripTrackedInvitesFromBody('@a@b.com 담당자a@b.com', trackedA)).toBe('담당자');
    expect(stripTrackedInvitesFromBody('@a@b.com 담당자@a@b.com 확인', trackedA)).toBe('담당자 확인');
    expect(stripTrackedInvitesFromBody('@a@b.com ㄱa@b.com 확인', trackedA)).toBe('ㄱ 확인');
    expect(stripTrackedInvitesFromBody('@a@b.com \u1100a@b.com 확인', trackedA)).toBe('\u1100 확인');
    expect(conflictingInviteEmails(stripTrackedInvitesFromBody('@a@b.com a@b.com.kr 확인', trackedA), ['a@b.com'])).toEqual([
      'a@b.com',
    ]);
    expect(conflictingInviteEmails(stripTrackedInvitesFromBody('@a@b.com aa@b.com 확인', trackedA), ['a@b.com'])).toEqual([
      'a@b.com',
    ]);

    const copyable = new Set(['a@example.com']);
    expect(
      inviteChipDisplayList(
        [
          { state: 'pending', email: 'a@example.com' },
          { state: 'expired', email: 'b@example.com' },
          { state: 'accepted', email: 'c@example.com' },
        ],
        KO,
        copyable,
      ),
    ).toEqual([
      { kind: 'detail', key: 'a@example.com:0', email: 'a@example.com', state: 'pending', stateLabel: KO.chipPending, hasCopyLink: true },
      { kind: 'detail', key: 'b@example.com:1', email: 'b@example.com', state: 'expired', stateLabel: KO.chipExpired, hasCopyLink: false },
      { kind: 'detail', key: 'c@example.com:2', email: 'c@example.com', state: 'accepted', stateLabel: KO.chipAccepted, hasCopyLink: false },
    ]);

    expect(
      inviteChipDisplayList(
        [
          { state: 'pending', email: null },
          { state: 'pending', email: null },
        ],
        KO,
      ),
    ).toEqual([{ kind: 'count', key: 'count', count: 2, label: '2명을 초대했어요' }]);

    expect(
      inviteChipDisplayList([{ state: 'pending', email: null }], EN),
    ).toEqual([{ kind: 'count', key: 'count', count: 1, label: '1 invited' }]);

    expect(
      extractCopyableInviteTokens([
        { email: 'a@example.com', result: 'invited', memberId: null, token: 'tok-1', mailState: null },
        { email: 'b@example.com', result: 'invited', memberId: null, token: 'tok-2', mailState: 'sent' },
        { email: 'c@example.com', result: 'invited', memberId: null, token: 'tok-3', mailState: 'failed' },
        { email: 'd@example.com', result: 'reused', memberId: null, token: null, mailState: null },
        { email: 'e@example.com', result: 'member', memberId: USER_2, token: null, mailState: null },
      ]),
    ).toEqual({
      'a@example.com': 'tok-1',
      'c@example.com': 'tok-3',
    });

    expect(buildInviteLinkUrl('https://brand.twings.app', 'a+b/c=')).toBe(
      'https://brand.twings.app/brand/invite#token=a%2Bb%2Fc%3D',
    );
    expect(formatInviteRemoveLabel('a@example.com', KO.inviteRemove)).toBe('a@example.com 빼기');
    expect(formatInviteRemoveLabel('a@example.com', EN.inviteRemove)).toBe('Remove a@example.com');
    expect(formatInviteRemoveLabel('a@example.com', '삭제')).toBe('삭제 a@example.com');
    expect(formatInviteRemoveLabel('a@example.com', 'Remove')).toBe('Remove a@example.com');
  });
});
