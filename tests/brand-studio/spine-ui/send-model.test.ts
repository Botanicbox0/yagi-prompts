import { describe, expect, it } from 'vitest';
import { ROOM_LIMITS, ROOM_POLL_HIDDEN_MS, ROOM_POLL_VISIBLE_MS } from '@/lib/brand-rooms/message-contracts';
import type { SendFileCard, SendMessage, SendPerson, SendThreadSummary } from '@/lib/brand-rooms/send-contracts';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  EMPTY_REQUEST_ID_PLAN,
  applyMentionPick,
  bodyCountNearLimit,
  extractMentionIds,
  fileCardInfo,
  filterMentionPeople,
  formatThreadDay,
  inboxPollReduce,
  inboxThreadHref,
  inboxUnreadBadgeText,
  initialChar,
  initialInboxPollState,
  initialSendFileState,
  initialThreadPollState,
  parseMentionTrigger,
  pickSendCopy,
  reconcileMentions,
  refusalMessageText,
  remainingDraftAfterSend,
  resolveRequestId,
  sendFileItems,
  sendFileReduce,
  sendFileRefKey,
  sendPanelLineWords,
  sendRefusalOutcome,
  splitSendMentionRuns,
  threadHeadLead,
  threadPollIntervalMs,
  threadPollReduce,
  threadStreamItems,
  threadRowWords,
  viewerItemToSendRef,
  type TrackedMention,
} from '@/components/brand-send/model';

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
    body: '@이하린 이 컷 확인해 주세요.',
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

describe('components/brand-send/model.ts', () => {
  it('picks all fixed and reused copy without duplicating dictionary keys', () => {
    expect(KO.action).toBe('보내기');
    expect(EN.action).toBe('Send');
    expect(KO.inboxTitle).toBe('알림함');
    expect(EN.inboxTitle).toBe('Inbox');
    expect(KO.fileGone).toBe('삭제된 파일');
    expect(EN.fileGone).toBe('Deleted file');
    expect(KO.composerHint).toBe('Enter로 보내고, Shift+Enter로 줄을 바꿔요');
    expect(KO.loadMore).toBe('더 보기');
    expect(EN.loadMore).toBe('More');
    expect(KO.roles.viewer).toBe('열람자');
    expect(EN.roles.owner).toBe('Workspace admin');
    expect(KO.unfiled).toBe('미분류');
  });

  it('parses @ triggers at start, after whitespace, in Korean, and ignores @ inside a word', () => {
    expect(parseMentionTrigger('@', 1)).toEqual({ start: 0, end: 1, query: '' });
    expect(parseMentionTrigger('@김서', 3)).toEqual({ start: 0, end: 3, query: '김서' });
    expect(parseMentionTrigger('안녕 @이', 5)).toEqual({ start: 3, end: 5, query: '이' });
    expect(parseMentionTrigger('첫줄\n@박도', 6)).toEqual({ start: 3, end: 6, query: '박도' });
    expect(parseMentionTrigger('앞 @김 뒤', 4)).toEqual({ start: 2, end: 4, query: '김' });
    expect(parseMentionTrigger('a@b', 3)).toBeNull();
    expect(parseMentionTrigger('user@domain.com', 15)).toBeNull();
    expect(parseMentionTrigger('안녕@이', 5)).toBeNull();
    expect(parseMentionTrigger('@김서아 ', 5)).toBeNull();
    expect(parseMentionTrigger(`@${'가'.repeat(31)}`, 32)).toBeNull();

    // Fix 11c: one space allowed while at least one member still matches; closes on second space or zero matches
    const spacedPeople: SendPerson[] = [
      ...PEOPLE,
      { id: '55555555-5555-4555-8555-555555555554', name: 'Editor Lee', role: 'editor', me: false },
    ];
    expect(parseMentionTrigger('@Editor ', 8, spacedPeople)).toEqual({ start: 0, end: 8, query: 'Editor ' });
    expect(parseMentionTrigger('hi @Editor L', 12, spacedPeople)).toEqual({ start: 3, end: 12, query: 'Editor L' });
    expect(parseMentionTrigger('@Editor Lee', 11, spacedPeople)).toEqual({ start: 0, end: 11, query: 'Editor Lee' });
    expect(parseMentionTrigger('@Editor Lee ', 12, spacedPeople)).toBeNull();
    expect(parseMentionTrigger('@Editor X', 9, spacedPeople)).toBeNull();
    expect(parseMentionTrigger('@김서아 ', 5, spacedPeople)).toBeNull();
    expect(parseMentionTrigger('@ ', 2, spacedPeople)).toBeNull();
  });

  it('filters send.people case-insensitively, excludes self (me: true), and offers only provided recipients', () => {
    expect(filterMentionPeople(PEOPLE, '').map((p) => p.id)).toEqual([USER_2, USER_3]);
    expect(filterMentionPeople(PEOPLE, '하린').map((p) => p.id)).toEqual([USER_2]);
    expect(filterMentionPeople(PEOPLE, '김서아')).toEqual([]);
    expect(filterMentionPeople(PEOPLE, '김')).toEqual([]);
    expect(parseMentionTrigger('@김 ', 3, PEOPLE)).toBeNull();
    expect(filterMentionPeople(PEOPLE, '없는사람')).toEqual([]);
    const english: SendPerson[] = [{ id: USER_2, name: 'Editor Lee', role: 'editor', me: false }];
    expect(filterMentionPeople(english, 'editor').map((p) => p.id)).toEqual([USER_2]);
  });

  it('inserts mentions, handles two people and the same person twice, and clears mention if any character is deleted or edited', () => {
    // Pick first person
    const t1 = parseMentionTrigger('@이', 2)!;
    const p1 = applyMentionPick('@이', t1, PEOPLE[1]!, []);
    expect(p1.text).toBe('@이하린 ');
    expect(p1.caret).toBe(5);
    expect(p1.tracked).toEqual([{ userId: USER_2, name: '이하린', start: 0, end: 4 }]);
    expect(extractMentionIds(p1.text, p1.tracked)).toEqual([USER_2]);

    // Pick second different person
    const raw2 = `${p1.text}확인 부탁 @박`;
    const t2 = parseMentionTrigger(raw2, raw2.length)!;
    const p2 = applyMentionPick(raw2, t2, PEOPLE[2]!, p1.tracked);
    expect(p2.text).toBe('@이하린 확인 부탁 @박도윤 ');
    expect(extractMentionIds(p2.text, p2.tracked)).toEqual([USER_2, USER_3]);

    // Delete one character inside @박도윤 -> becomes plain text, @이하린 stays
    const edited2 = '@이하린 확인 부탁 @박도 ';
    const r2 = reconcileMentions(p2.text, edited2, p2.tracked);
    expect(extractMentionIds(edited2, r2)).toEqual([USER_2]);

    // Pick the same person twice -> deduplicates ids while keeping both spans; deleting one char from second leaves first intact
    const rawSame = `${p1.text}@이`;
    const tSame = parseMentionTrigger(rawSame, rawSame.length)!;
    const pSame = applyMentionPick(rawSame, tSame, PEOPLE[1]!, p1.tracked);
    expect(pSame.text).toBe('@이하린 @이하린 ');
    expect(pSame.tracked).toHaveLength(2);
    expect(extractMentionIds(pSame.text, pSame.tracked)).toEqual([USER_2]);

    const delSecond = '@이하린 @이하 ';
    const rSame = reconcileMentions(pSame.text, delSecond, pSame.tracked);
    expect(rSame).toHaveLength(1);
    expect(extractMentionIds(delSecond, rSame)).toEqual([USER_2]);

    // Deleting '@' or any middle char of the remaining mention removes it
    const delAt = '이하린 @이하 ';
    const rNone = reconcileMentions(delSecond, delAt, rSame);
    expect(rNone).toEqual([]);
    expect(extractMentionIds(delAt, rNone)).toEqual([]);

    // Typing non-whitespace directly before '@' breaks the boundary
    const glued = 'x@이하린 ';
    expect(reconcileMentions(p1.text, glued, p1.tracked)).toEqual([]);

    // Manually typing @박도윤 without picking does not attach a mention id
    const manualText = '@박도윤 직접 입력';
    const tracked: TrackedMention[] = [];
    expect(extractMentionIds(manualText, tracked)).toEqual([]);
  });

  it('tracks near-limit character counter and requestId idempotency across retries, edits, and conflicts', () => {
    expect(bodyCountNearLimit('짧은 글')).toBeNull();
    expect(bodyCountNearLimit('가'.repeat(3599))).toBeNull();
    expect(bodyCountNearLimit('가'.repeat(3600))).toEqual({ count: 3600, max: ROOM_LIMITS.bodyMax, over: false });
    expect(bodyCountNearLimit('가'.repeat(4001))).toEqual({ count: 4001, max: ROOM_LIMITS.bodyMax, over: true });

    let n = 0;
    const nextId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const first = resolveRequestId(EMPTY_REQUEST_ID_PLAN, '이 컷 좋아요', [USER_2], nextId);
    const retry = resolveRequestId(first.plan, '이 컷 좋아요', [USER_2], nextId);
    expect(retry.requestId).toBe(first.requestId);

    const editedBody = resolveRequestId(first.plan, '이 컷 아주 좋아요', [USER_2], nextId);
    expect(editedBody.requestId).not.toBe(first.requestId);

    const editedMentions = resolveRequestId(first.plan, '이 컷 좋아요', [USER_3], nextId);
    expect(editedMentions.requestId).not.toBe(first.requestId);
  });

  it('maps every refusal code to its required outcome and copy', () => {
    const inv = sendRefusalOutcome('invalid', 'compose_post');
    expect(inv).toEqual({ hideSend: true, stopPolling: true, keepText: false, resetRequestId: true, messageKey: null });
    expect(refusalMessageText(inv, KO)).toBeNull();

    const nfPost = sendRefusalOutcome('not_found', 'compose_post');
    expect(nfPost.keepText).toBe(true);
    expect(nfPost.stopPolling).toBe(true);
    expect(refusalMessageText(nfPost, KO)).toBe('삭제된 파일');

    const nfThread = sendRefusalOutcome('not_found', 'thread');
    expect(refusalMessageText(nfThread, KO)).toBe('이 대화를 더 볼 수 없어요.');

    const rate = sendRefusalOutcome('rate_limited', 'compose_post');
    expect(rate.keepText).toBe(true);
    expect(rate.resetRequestId).toBe(false);
    expect(refusalMessageText(rate, KO)).toBe('잠시 후 다시 보내 주세요.');

    const off = sendRefusalOutcome('offline', 'compose_reply');
    expect(off.keepText).toBe(true);
    expect(off.resetRequestId).toBe(false);
    expect(refusalMessageText(off, KO)).toBe('보내지 못했어요. 다시 시도해 주세요.');

    const conf = sendRefusalOutcome('conflict', 'compose_post');
    expect(conf.keepText).toBe(true);
    expect(conf.resetRequestId).toBe(true);
    expect(refusalMessageText(conf, KO)).toBe('보내지 못했어요. 다시 시도해 주세요.');
  });

  it('drives inboxPollReduce safely across ticks, hidden tab, view switches, paging, pointer hover, and stop codes', () => {
    let s = initialInboxPollState('all');
    const mount = inboxPollReduce(s, { type: 'mount' });
    s = mount.state;
    expect(mount.command).toEqual({ kind: 'refresh', view: 'all', cursor: null, seq: 1 });
    expect(s.inflight).toBe(true);

    // Never two reads in flight
    expect(inboxPollReduce(s, { type: 'tick', visible: true }).command).toBeNull();
    expect(inboxPollReduce(s, { type: 'focus', visible: true }).command).toBeNull();

    // Answer page 1 with next cursor
    const t1 = makeThread({ rootId: ROOT_1, root: makeMsg({ id: ROOT_1, rootId: ROOT_1 }), unread: true });
    const t2 = makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2, body: '둘째 대화' }), unread: false });
    s = inboxPollReduce(s, {
      type: 'answer',
      kind: 'refresh',
      seq: 1,
      result: { ok: true, view: 'all', threads: [t1, t2], next: 'c2', unread: 1, mentionsUnread: 1 },
    }).state;
    expect(s.loaded).toBe(true);
    expect(s.inflight).toBe(false);
    expect(s.threads.map((t) => t.rootId)).toEqual([ROOT_1, ROOT_2]);

    // Hidden tick skips; visible tick fires
    expect(inboxPollReduce(s, { type: 'tick', visible: false }).command).toBeNull();
    const tickVis = inboxPollReduce(s, { type: 'tick', visible: true });
    expect(tickVis.command).toEqual({ kind: 'refresh', view: 'all', cursor: null, seq: 2 });

    // Pointer hover defers reordering until pointer leaves
    s = inboxPollReduce(tickVis.state, { type: 'pointer_enter' }).state;
    const t3 = makeThread({ rootId: '22222222-2222-4222-8222-222222222223', root: makeMsg({ id: '22222222-2222-4222-8222-222222222223', rootId: '22222222-2222-4222-8222-222222222223', body: '새 대화' }) });
    const t2Updated = makeThread({ ...t2, replyCount: 3 });
    s = inboxPollReduce(s, {
      type: 'answer',
      kind: 'refresh',
      seq: 2,
      result: { ok: true, view: 'all', threads: [t3, t2Updated, t1], next: null, unread: 2, mentionsUnread: 1 },
    }).state;
    // Order did NOT jump while pointer is over the list, but t2 updated in place
    expect(s.threads.map((t) => t.rootId)).toEqual([ROOT_1, ROOT_2]);
    expect(s.threads[1]?.replyCount).toBe(3);
    expect(s.deferredFresh).not.toBeNull();

    s = inboxPollReduce(s, { type: 'pointer_leave' }).state;
    expect(s.threads.map((t) => t.rootId)).toEqual(['22222222-2222-4222-8222-222222222223', ROOT_2, ROOT_1]);
    expect(s.deferredFresh).toBeNull();

    // Switching view while inflight queues pendingReload and drops stale answer
    const moreCmd = inboxPollReduce(
      { ...s, next: 'cursor-1' },
      { type: 'more' },
    );
    expect(moreCmd.command).toEqual({ kind: 'more', view: 'all', cursor: 'cursor-1', seq: 3 });
    const sw = inboxPollReduce(moreCmd.state, { type: 'switch_view', view: 'mentions' });
    expect(sw.command).toBeNull();
    expect(sw.state.pendingReload).toBe(true);
    const settledSw = inboxPollReduce(sw.state, {
      type: 'answer',
      kind: 'more',
      seq: 3,
      result: { ok: false, code: 'offline' },
    });
    expect(settledSw.command).toEqual({ kind: 'refresh', view: 'mentions', cursor: null, seq: 5 });

    // Offline does not stop; invalid closes and stops
    const offRes = inboxPollReduce(settledSw.state, {
      type: 'answer',
      kind: 'refresh',
      seq: 5,
      result: { ok: false, code: 'offline' },
    }).state;
    expect(offRes.stopped).toBe(false);
    expect(offRes.closed).toBe(false);

    const req2 = inboxPollReduce(offRes, { type: 'tick', visible: true });
    const invRes = inboxPollReduce(req2.state, {
      type: 'answer',
      kind: 'refresh',
      seq: 6,
      result: { ok: false, code: 'invalid' },
    }).state;
    expect(invRes.stopped).toBe(true);
    expect(invRes.closed).toBe(true);
    expect(inboxPollReduce(invRes, { type: 'tick', visible: true }).command).toBeNull();
  });

  it('closes inboxPollReduce and threadPollReduce on close action or invalid answer and halts polling (Fix 4)', () => {
    const inboxOpen = inboxPollReduce(initialInboxPollState('all'), { type: 'mount' }).state;
    const inboxClosed = inboxPollReduce(inboxOpen, { type: 'close' }).state;
    expect(inboxClosed.closed).toBe(true);
    expect(inboxClosed.stopped).toBe(true);
    expect(inboxPollReduce(inboxClosed, { type: 'tick', visible: true }).command).toBeNull();

    const thOpen = threadPollReduce(initialThreadPollState(ROOT_1), { type: 'open', rootId: ROOT_1 });
    const thInv = threadPollReduce(thOpen.state, {
      type: 'answer',
      seq: thOpen.command!.seq,
      result: { ok: false, code: 'invalid' },
    }).state;
    expect(thInv.closed).toBe(true);
    expect(thInv.stopped).toBe(true);
    expect(thInv.error).toBeNull();
    expect(threadPollReduce(thInv, { type: 'tick', visible: true }).command).toBeNull();

    const thLoaded = initialThreadPollState(ROOT_1, { ok: true, thread: makeThread(), replies: [] });
    const thManualClose = threadPollReduce(thLoaded, { type: 'close' }).state;
    expect(thManualClose.closed).toBe(true);
    expect(thManualClose.stopped).toBe(true);
    expect(threadPollReduce(thManualClose, { type: 'tick', visible: true }).command).toBeNull();
  });

  it('sends markRead:false on hidden open and pending-root switches until visible turns true (Fix 8)', () => {
    let hs = initialThreadPollState();
    const ho1 = threadPollReduce(hs, { type: 'open', rootId: ROOT_1, visible: false });
    hs = ho1.state;
    expect(ho1.command).toEqual({ rootId: ROOT_1, markRead: false, seq: 1 });

    // Become visible while initial hidden read is still inflight -> once markRead:false finishes, emits one markRead:true
    const hvisEarly = threadPollReduce(hs, { type: 'visible', visible: true });
    expect(hvisEarly.command).toBeNull();
    const hAfter = threadPollReduce(hvisEarly.state, {
      type: 'answer',
      seq: 1,
      result: { ok: true, thread: makeThread(), replies: [] },
    });
    expect(hAfter.command).toEqual({ rootId: ROOT_1, markRead: true, seq: 2 });

    // Pending-root switch while hidden waits and emits markRead:false, then markRead:true when visible
    let ps = initialThreadPollState();
    const p1 = threadPollReduce(ps, { type: 'open', rootId: ROOT_1 });
    ps = p1.state;
    const p2 = threadPollReduce(ps, { type: 'open', rootId: ROOT_2, visible: false });
    expect(p2.command).toBeNull();
    const pDrain = threadPollReduce(p2.state, {
      type: 'answer',
      seq: 1,
      visible: false,
      result: { ok: true, thread: makeThread(), replies: [] },
    });
    expect(pDrain.command).toEqual({ rootId: ROOT_2, markRead: false, seq: 3 });

    const pSettled = threadPollReduce(pDrain.state, {
      type: 'answer',
      seq: 3,
      result: { ok: true, thread: makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }) }), replies: [] },
    });
    expect(pSettled.command).toBeNull();
    const pVis = threadPollReduce(pSettled.state, { type: 'visible', visible: true });
    expect(pVis.command).toEqual({ rootId: ROOT_2, markRead: true, seq: 4 });
  });

  it('clears unread dots immediately on read_all_done, queues pendingReload across an inflight read, and preserves hasMoreUnread when more:true (Fix 7)', () => {
    const t1 = makeThread({ rootId: ROOT_1, unread: true, mentioned: true });
    const t2 = makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }), unread: true, mentioned: false });
    let s = initialInboxPollState('all', { ok: true, view: 'all', threads: [t1, t2], next: null, unread: 2, mentionsUnread: 1 });

    // Start background refresh poll (inflight)
    const tick = inboxPollReduce(s, { type: 'tick', visible: true });
    s = tick.state;
    expect(tick.command).toEqual({ kind: 'refresh', view: 'all', cursor: null, seq: 1 });

    // read_all completes with more:true while tick #1 is still in flight
    const markedMore = inboxPollReduce(s, {
      type: 'read_all_done',
      more: true,
    });
    s = markedMore.state;
    expect(markedMore.command).toBeNull();
    expect(s.threads.every((t) => !t.unread)).toBe(true);
    expect(s.pendingReload).toBe(true);
    expect(s.hasMoreUnread).toBe(true);

    // Pre-readAll tick #1 finishes with stale unread rows -> dropped and replaced with ONE fresh reload
    const afterStale = inboxPollReduce(s, {
      type: 'answer',
      kind: 'refresh',
      seq: 1,
      result: { ok: true, view: 'all', threads: [t1, t2], next: null, unread: 2, mentionsUnread: 1 },
    });
    expect(afterStale.state.threads.every((t) => !t.unread)).toBe(true);
    expect(afterStale.command).toEqual({ kind: 'refresh', view: 'all', cursor: null, seq: 3 });

    // When idle and read_all_done arrives with more:false, starts refresh immediately and clears hasMoreUnread
    const idle = initialInboxPollState('all', { ok: true, view: 'all', threads: [t1], next: null, unread: 1, mentionsUnread: 0 });
    const doneIdle = inboxPollReduce(idle, {
      type: 'read_all_done',
      more: false,
    });
    expect(doneIdle.state.threads.every((t) => !t.unread)).toBe(true);
    expect(doneIdle.state.unread).toBe(0);
    expect(doneIdle.state.hasMoreUnread).toBe(false);
    expect(doneIdle.command).toEqual({ kind: 'refresh', view: 'all', cursor: null, seq: 1 });
  });

  it('drives threadPollReduce with 4s visible / 20s hidden markRead:false, switch safety, and stop codes', () => {
    expect(threadPollIntervalMs(true)).toBe(ROOM_POLL_VISIBLE_MS);
    expect(threadPollIntervalMs(false)).toBe(ROOM_POLL_HIDDEN_MS);

    let s = initialThreadPollState();
    const o1 = threadPollReduce(s, { type: 'open', rootId: ROOT_1 });
    s = o1.state;
    expect(o1.command).toEqual({ rootId: ROOT_1, markRead: true, seq: 1 });

    // Opening same rootId while inflight/loaded does not send another request
    expect(threadPollReduce(s, { type: 'open', rootId: ROOT_1 }).command).toBeNull();

    // Switching to ROOT_2 while ROOT_1 is inflight waits until ROOT_1 finishes (never two in flight)
    const o2 = threadPollReduce(s, { type: 'open', rootId: ROOT_2 });
    expect(o2.command).toBeNull();
    const afterStale = threadPollReduce(o2.state, {
      type: 'answer',
      seq: 1,
      result: { ok: true, thread: makeThread(), replies: [] },
    });
    expect(afterStale.command).toEqual({ rootId: ROOT_2, markRead: true, seq: 3 });

    const settled = threadPollReduce(afterStale.state, {
      type: 'answer',
      seq: 3,
      result: { ok: true, thread: makeThread({ rootId: ROOT_2, root: makeMsg({ id: ROOT_2, rootId: ROOT_2 }) }), replies: [] },
    }).state;
    expect(settled.loaded).toBe(true);

    // Hidden tick sends markRead: false; visible tick sends markRead: true
    const hiddenTick = threadPollReduce(settled, { type: 'tick', visible: false });
    expect(hiddenTick.command).toEqual({ rootId: ROOT_2, markRead: false, seq: 4 });
    const afterHidden = threadPollReduce(hiddenTick.state, {
      type: 'answer',
      seq: 4,
      result: { ok: false, code: 'offline' },
    }).state;
    expect(afterHidden.stopped).toBe(false);

    const visibleTick = threadPollReduce(afterHidden, { type: 'tick', visible: true });
    expect(visibleTick.command).toEqual({ rootId: ROOT_2, markRead: true, seq: 5 });

    // not_found marks gone and stops polling
    const gone = threadPollReduce(visibleTick.state, {
      type: 'answer',
      seq: 5,
      result: { ok: false, code: 'not_found' },
    }).state;
    expect(gone.gone).toBe(true);
    expect(gone.stopped).toBe(true);
    expect(threadPollReduce(gone, { type: 'tick', visible: true }).command).toBeNull();
  });

  it('drops an older inflight thread read when a local apply_reply happened after the read started (Fix 2)', () => {
    const initialThread = makeThread({ replyCount: 0 });
    let s = initialThreadPollState(ROOT_1, { ok: true, thread: initialThread, replies: [] });

    // 4s tick starts inflight read #1
    const t1 = threadPollReduce(s, { type: 'tick', visible: true });
    s = t1.state;
    expect(t1.command).toEqual({ rootId: ROOT_1, markRead: true, seq: 1 });

    // Local reply succeeds before read #1 answers
    const replyMsg = makeMsg({
      id: '99999999-9999-4999-8999-999999999991',
      parentId: ROOT_1,
      authorId: USER_2,
      authorName: '이하린',
      mine: true,
      body: '방금 보낸 답글',
      mentions: [],
      createdAt: '2026-11-26T04:45:00.000Z',
    });
    const updatedThread = makeThread({ replyCount: 1, lastActivityAt: replyMsg.createdAt });
    s = threadPollReduce(s, {
      type: 'apply_reply',
      posted: { ok: true, message: replyMsg, thread: updatedThread },
    }).state;
    expect(s.replies.map((r) => r.id)).toEqual([replyMsg.id]);
    expect(s.thread?.replyCount).toBe(1);

    // Old read #1 finally answers with the pre-reply snapshot (0 replies) -> must be dropped
    const afterStaleRead = threadPollReduce(s, {
      type: 'answer',
      seq: t1.command!.seq,
      result: { ok: true, thread: initialThread, replies: [] },
    }).state;
    expect(afterStaleRead.inflight).toBe(false);
    expect(afterStaleRead.replies.map((r) => r.id)).toEqual([replyMsg.id]);
    expect(afterStaleRead.thread?.replyCount).toBe(1);
  });

  it('tracks optimistic pending replies by requestId, settles in place by returned id without duplicates, and removes on refusal (Fix 3)', () => {
    const t0 = makeThread({ replyCount: 0 });
    let s = initialThreadPollState(ROOT_1, { ok: true, thread: t0, replies: [] });

    // Queue pending reply
    s = threadPollReduce(s, {
      type: 'queue_reply',
      requestId: 'req-1',
      body: '낙관적 답글',
      mentions: [],
      authorId: USER_1,
      authorName: '김서아',
      createdAt: '2026-11-26T04:50:00.000Z',
    }).state;
    expect(s.pendingReplies).toHaveLength(1);
    const pendingItems = threadStreamItems(s.thread!, s.replies, s.pendingReplies, s.settledKeys);
    expect(pendingItems.map((i) => ({ key: i.key, pending: i.pending }))).toEqual([
      { key: ROOT_1, pending: false },
      { key: 'pending:req-1', pending: true },
    ]);

    // Server confirms with returned id -> pending disappears, key maps to pending:req-1
    const serverMsg = makeMsg({
      id: '99999999-9999-4999-8999-999999999994',
      parentId: ROOT_1,
      mine: true,
      body: '낙관적 답글',
      mentions: [],
      createdAt: '2026-11-26T04:50:01.000Z',
    });
    s = threadPollReduce(s, {
      type: 'apply_reply',
      requestId: 'req-1',
      posted: { ok: true, message: serverMsg, thread: makeThread({ replyCount: 1 }) },
    }).state;
    expect(s.pendingReplies).toEqual([]);
    expect(s.replies.map((r) => r.id)).toEqual([serverMsg.id]);
    const settledItems = threadStreamItems(s.thread!, s.replies, s.pendingReplies, s.settledKeys);
    expect(settledItems.map((i) => ({ key: i.key, id: i.message.id, pending: i.pending }))).toEqual([
      { key: ROOT_1, id: ROOT_1, pending: false },
      { key: 'pending:req-1', id: serverMsg.id, pending: false },
    ]);

    // Queue second pending reply and drop on refusal
    s = threadPollReduce(s, {
      type: 'queue_reply',
      requestId: 'req-2',
      body: '실패할 답글',
      mentions: [],
      authorId: USER_1,
      authorName: '김서아',
      createdAt: '2026-11-26T04:51:00.000Z',
    }).state;
    expect(s.pendingReplies).toHaveLength(1);
    s = threadPollReduce(s, { type: 'drop_reply', requestId: 'req-2' }).state;
    expect(s.pendingReplies).toEqual([]);
  });

  it('builds thread links, file card info (including deleted and media kinds), row words, mentions, and dates', () => {
    expect(inboxThreadHref(ORG, ROOT_1)).toBe(`/brand/inbox?organizationId=${ORG}&thread=${ROOT_1}`);
    expect(inboxUnreadBadgeText(0)).toBeNull();
    expect(inboxUnreadBadgeText(99)).toBe('99');
    expect(inboxUnreadBadgeText(100)).toBe('99+');

    const imgInfo = fileCardInfo(makeFile(), ORG, KO);
    expect(imgInfo).toEqual({
      available: true,
      title: '이미지',
      subtitle: '봄 향수 론칭 · 생성 결과',
      thumbUrl: '/api/brand-studio/media/st/pic-thumb.webp',
      openHref: `/brand/studio?organizationId=${ORG}&view=${encodeURIComponent(`o:${OUT_1}`)}`,
    });

    const vidAssetInfo = fileCardInfo(
      makeFile({
        ref: { kind: 'asset', assetId: ASSET_1 },
        kind: 'video',
        name: '런웨이 레퍼런스',
        url: '/api/brand-studio/media/st/vid.mp4',
        thumbUrl: null,
        project: null,
      }),
      ORG,
      KO,
    );
    expect(vidAssetInfo.thumbUrl).toBeNull();
    expect(vidAssetInfo.title).toBe('런웨이 레퍼런스');
    expect(vidAssetInfo.subtitle).toBe('미분류 · 업로드');
    expect(vidAssetInfo.openHref).toBe(`/brand/library?organizationId=${ORG}`);

    const goneInfo = fileCardInfo(
      makeFile({ available: false, kind: null, name: null, url: null, thumbUrl: null, project: null }),
      ORG,
      KO,
    );
    expect(goneInfo).toEqual({
      available: false,
      title: '삭제된 파일',
      subtitle: null,
      thumbUrl: null,
      openHref: null,
    });

    const now = new Date('2026-11-26T05:00:00.000Z');
    const rootThread = makeThread({ replyCount: 0 });
    const rowRoot = threadRowWords(rootThread, KO, 'ko', now);
    expect(rowRoot.actorName).toBe('김서아');
    expect(rowRoot.projectLabel).toBe('봄 향수 론칭');
    expect(rowRoot.line).toBe('@이하린 이 컷 확인해 주세요.');
    expect(rowRoot.replyCountText).toBeNull();

    // Fix 11e: video row never loads full-size video file when thumbUrl is null; image without thumbUrl falls back to file.url
    const videoNoThumbRow = threadRowWords(
      makeThread({
        file: makeFile({ kind: 'video', url: '/api/brand-studio/media/st/clip.mp4', thumbUrl: null }),
      }),
      KO,
      'ko',
      now,
    );
    expect(videoNoThumbRow.thumbUrl).toBeNull();

    const imageNoThumbRow = threadRowWords(
      makeThread({
        file: makeFile({ kind: 'image', url: '/api/brand-studio/media/st/still.png', thumbUrl: null }),
      }),
      KO,
      'ko',
      now,
    );
    expect(imageNoThumbRow.thumbUrl).toBe('/api/brand-studio/media/st/still.png');

    const replyThread = makeThread({
      replyCount: 2,
      latest: {
        messageId: '99999999-9999-4999-8999-999999999999',
        authorId: USER_2,
        authorName: '이하린',
        mine: false,
        line: '톤 좋아요!',
        at: '2026-11-26T04:55:00.000Z',
      },
    });
    const rowReply = threadRowWords(replyThread, KO, 'ko', now);
    expect(rowReply.actorName).toBe('이하린');
    expect(rowReply.line).toBe('답글: 톤 좋아요!');
    expect(rowReply.replyCountText).toBe('답글 2');

    expect(threadHeadLead('김서아', KO)).toBe('김서아 님이 보낸 파일이에요. 멤버끼리만 볼 수 있어요.');
    expect(threadHeadLead(null, KO)).toBe('멤버끼리만 볼 수 있어요.');
    expect(threadHeadLead(null, EN)).toBe('Only members can see this conversation.');

    expect(splitSendMentionRuns('@이하린 립 컬러와 @없는사람', [{ id: USER_2, name: '이하린' }])).toEqual([
      { text: '@이하린', mention: true },
      { text: ' 립 컬러와 @없는사람', mention: false },
    ]);

    expect(initialChar('김서아')).toBe('김');
    expect(initialChar(null)).toBe('·');
    expect(formatThreadDay('2026-11-26T04:40:00.000Z', 'ko', KO, now)).toBe('오늘');
    expect(formatThreadDay('2026-11-25T04:40:00.000Z', 'en', EN, now)).toBe('Yesterday');
  });

  it('pins formatThreadDay to Asia/Seoul across UTC and Asia/Seoul process TZ (Fix 1)', () => {
    const prevTz = process.env.TZ;
    try {
      // 2026-11-25 23:30 KST (14:30 UTC) vs 2026-11-26 00:30 KST (2026-11-25 15:30 UTC)
      const beforeMidnightKst = '2026-11-25T14:30:00.000Z';
      const afterMidnightKst = '2026-11-25T15:30:00.000Z';
      const fixedNow = new Date('2026-11-28T05:00:00.000Z');

      process.env.TZ = 'UTC';
      const utcBefore = formatThreadDay(beforeMidnightKst, 'ko', KO, fixedNow);
      const utcAfter = formatThreadDay(afterMidnightKst, 'ko', KO, fixedNow);

      process.env.TZ = 'Asia/Seoul';
      const kstBefore = formatThreadDay(beforeMidnightKst, 'ko', KO, fixedNow);
      const kstAfter = formatThreadDay(afterMidnightKst, 'ko', KO, fixedNow);

      expect(utcBefore).toBe(kstBefore);
      expect(utcAfter).toBe(kstAfter);
      expect(utcBefore).not.toBe(utcAfter);
      expect(utcAfter).toContain('11월 26일');
    } finally {
      if (prevTz === undefined) delete process.env.TZ;
      else process.env.TZ = prevTz;
    }
  });
});

describe('viewer SendFileRef mapping and SendPanel file state (Batch C)', () => {
  it('maps live studio outputs and assets to SendFileRef and returns null for fill strips and editor exports', () => {
    expect(
      viewerItemToSendRef({
        type: 'output',
        output: { id: OUT_1.toUpperCase(), url: '/api/brand-studio/media/st/pic.png' },
        job: { kind: 'image', model: 'nano-banana-pro' },
      }),
    ).toEqual({ kind: 'output', outputId: OUT_1.toUpperCase() });

    expect(
      viewerItemToSendRef({
        type: 'output',
        output: { id: OUT_1, url: '/api/brand-studio/media/st/vid.mp4' },
        job: { kind: 'video_final', model: 'seedance-2.5' },
      }),
    ).toEqual({ kind: 'output', outputId: OUT_1 });

    expect(
      viewerItemToSendRef({
        type: 'output',
        output: { id: OUT_1, url: '/api/brand-studio/media/st/song.mp3' },
        job: { kind: 'music', model: 'yue-2' },
      }),
    ).toEqual({ kind: 'output', outputId: OUT_1 });

    expect(
      viewerItemToSendRef({
        type: 'asset',
        asset: { id: ASSET_1.toUpperCase(), url: '/api/brand-studio/media/st/up.png' },
      }),
    ).toEqual({ kind: 'asset', assetId: ASSET_1.toUpperCase() });

    // Fill strips and editing-studio exports are excluded per server sendableFile contract
    expect(
      viewerItemToSendRef({
        type: 'output',
        output: { id: OUT_1, url: '/api/brand-studio/media/st/fill.png' },
        job: { kind: 'region_edit', model: 'nano-banana-pro', purpose: 'fill' },
      }),
    ).toBeNull();

    expect(
      viewerItemToSendRef({
        type: 'output',
        output: { id: OUT_1, url: '/api/brand-studio/media/st/compose.mp4' },
        job: { kind: 'video', model: 'compose-1080p' },
      }),
    ).toBeNull();

    expect(viewerItemToSendRef(null)).toBeNull();
    expect(sendFileRefKey({ kind: 'output', outputId: OUT_1.toUpperCase() })).toBe(`output:${OUT_1}`);
    expect(sendFileRefKey({ kind: 'asset', assetId: ASSET_1.toUpperCase() })).toBe(`asset:${ASSET_1}`);
  });

  it('tracks send.file load, optimistic pending posts, deduplication on confirm, not_found, invalid, and row words', () => {
    const file = makeFile();
    const t1 = makeThread({ rootId: ROOT_1, replyCount: 2, root: makeMsg({ id: ROOT_1, rootId: ROOT_1, authorName: '김서아', body: '  첫   메시지  ' }) });
    const now = new Date('2026-11-26T05:00:00.000Z');

    let state = initialSendFileState(`output:${OUT_1}`);
    const started = sendFileReduce(state, { type: 'start', fileKey: `output:${OUT_1}` });
    state = started.state;
    expect(started.command).toEqual({ fileKey: `output:${OUT_1}`, seq: 1 });
    expect(state.loading).toBe(true);

    // Queue optimistic post before send.file returns or completes
    state = sendFileReduce(state, {
      type: 'queue_post',
      requestId: 'req-p1',
      body: '새로 보낸 메시지',
      createdAt: '2026-11-26T04:59:00.000Z',
      authorName: '나',
    }).state;
    expect(state.pendingPosts).toHaveLength(1);

    // Stale answer ignored
    const staleRes = sendFileReduce(state, {
      type: 'answer',
      seq: 99,
      result: { ok: false, code: 'not_found' },
    }).state;
    expect(staleRes.unsendable).toBe(false);

    // Matching answer populates existing threads
    state = sendFileReduce(state, {
      type: 'answer',
      seq: started.command!.seq,
      result: { ok: true, file, threads: [t1] },
    }).state;
    expect(state.loading).toBe(false);
    expect(state.loaded).toBe(true);
    expect(state.threads).toEqual([t1]);

    // Pending sits at top before settled threads
    const pendingList = sendFileItems(state.threads, state.pendingPosts, state.settledKeys);
    expect(pendingList.map((i) => ({ key: i.key, pending: i.pending, rootId: i.thread.rootId }))).toEqual([
      { key: 'pending:req-p1', pending: true, rootId: 'req-p1' },
      { key: ROOT_1, pending: false, rootId: ROOT_1 },
    ]);

    // Server confirms post -> settles in-place under pending:req-p1 key with zero duplicate
    const newThread = makeThread({
      rootId: ROOT_2,
      root: makeMsg({ id: ROOT_2, rootId: ROOT_2, mine: true, authorName: '김서아', body: '새로 보낸 메시지', createdAt: '2026-11-26T04:59:01.000Z' }),
      replyCount: 0,
    });
    state = sendFileReduce(state, {
      type: 'apply_post',
      requestId: 'req-p1',
      posted: { ok: true, message: newThread.root, thread: newThread },
    }).state;
    expect(state.pendingPosts).toEqual([]);
    const settledList = sendFileItems(state.threads, state.pendingPosts, state.settledKeys);
    expect(settledList.map((i) => ({ key: i.key, pending: i.pending, rootId: i.thread.rootId }))).toEqual([
      { key: 'pending:req-p1', pending: false, rootId: ROOT_2 },
      { key: ROOT_1, pending: false, rootId: ROOT_1 },
    ]);

    // Re-applying same thread never creates duplicates
    state = sendFileReduce(state, {
      type: 'apply_post',
      requestId: 'req-p1',
      posted: { ok: true, message: newThread.root, thread: newThread },
    }).state;
    expect(state.threads).toHaveLength(2);

    // Drop failed optimistic post
    state = sendFileReduce(state, {
      type: 'queue_post',
      requestId: 'req-fail',
      body: '실패',
      createdAt: '2026-11-26T04:59:10.000Z',
      authorName: '나',
    }).state;
    state = sendFileReduce(state, { type: 'drop_post', requestId: 'req-fail' }).state;
    expect(state.pendingPosts).toEqual([]);

    // Line formatting: who, folded first words, time, reply count (null when 0)
    expect(sendPanelLineWords(t1, KO, 'ko', now)).toEqual({
      who: '김서아',
      firstWords: '첫 메시지',
      time: '20분 전',
      replyCountText: '답글 2',
    });
    expect(sendPanelLineWords(newThread, EN, 'en', now).replyCountText).toBeNull();

    // Refusals: not_found -> unsendable; invalid -> closed
    const sNotFound = sendFileReduce(initialSendFileState(`output:${OUT_1}`), { type: 'start', fileKey: `output:${OUT_1}` });
    const nf = sendFileReduce(sNotFound.state, { type: 'answer', seq: sNotFound.command!.seq, result: { ok: false, code: 'not_found' } }).state;
    expect(nf.unsendable).toBe(true);
    expect(nf.closed).toBe(false);

    const sInvalid = sendFileReduce(initialSendFileState(`output:${OUT_1}`), { type: 'start', fileKey: `output:${OUT_1}` });
    const inv = sendFileReduce(sInvalid.state, { type: 'answer', seq: sInvalid.command!.seq, result: { ok: false, code: 'invalid' } }).state;
    expect(inv.closed).toBe(true);
  });
});

describe('Fix round 3 pure model rules', () => {
  it('settles a pending reply on a poll answer with matching author and body only onto new replies not in the previous answer while keeping React key (Fix round 3 + round 5 item 1)', () => {
    const oldReply = makeMsg({
      id: '99999999-9999-4999-8999-999999999901',
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '경합 답글',
      createdAt: '2026-11-26T04:49:00.000Z',
    });
    const t0 = makeThread({ replyCount: 1 });
    let s = initialThreadPollState(ROOT_1, { ok: true, thread: t0, replies: [oldReply] });

    // Start poll #1 before queuing optimistic reply
    const pollCmd = threadPollReduce(s, { type: 'tick', visible: true });
    s = pollCmd.state;
    expect(pollCmd.command).toBeTruthy();

    // Queue pending reply at 04:50:00
    s = threadPollReduce(s, {
      type: 'queue_reply',
      requestId: 'req-race',
      body: '경합 답글',
      mentions: [],
      authorId: USER_1,
      authorName: '김서아',
      createdAt: '2026-11-26T04:50:00.000Z',
    }).state;

    // An older identical reply already in the thread/previous answer must NOT settle the new pending entry
    const afterEarlyPoll = threadPollReduce(s, {
      type: 'answer',
      seq: pollCmd.command!.seq,
      result: { ok: true, thread: t0, replies: [oldReply] },
    }).state;
    expect(afterEarlyPoll.pendingReplies).toHaveLength(1);

    // Next poll brings the saved server reply at 04:50:01 -> settles pending in place under pending:req-race
    const pollCmd2 = threadPollReduce(afterEarlyPoll, { type: 'tick', visible: true });
    const savedReply = makeMsg({
      id: '99999999-9999-4999-8999-999999999902',
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '경합 답글',
      createdAt: '2026-11-26T04:50:01.000Z',
    });
    const afterRacePoll = threadPollReduce(pollCmd2.state, {
      type: 'answer',
      seq: pollCmd2.command!.seq,
      result: { ok: true, thread: makeThread({ replyCount: 2 }), replies: [oldReply, savedReply] },
    }).state;
    expect(afterRacePoll.pendingReplies).toEqual([]);
    expect(afterRacePoll.replies.map((r) => r.id)).toEqual([oldReply.id, savedReply.id]);
    const streamAfterPoll = threadStreamItems(
      afterRacePoll.thread!,
      afterRacePoll.replies,
      afterRacePoll.pendingReplies,
      afterRacePoll.settledKeys,
    );
    expect(streamAfterPoll.map((i) => ({ key: i.key, id: i.message.id, pending: i.pending }))).toEqual([
      { key: ROOT_1, id: ROOT_1, pending: false },
      { key: oldReply.id, id: oldReply.id, pending: false },
      { key: 'pending:req-race', id: savedReply.id, pending: false },
    ]);

    // When reply's own answer then lands -> still no duplicate
    const afterReplyAnswer = threadPollReduce(afterRacePoll, {
      type: 'apply_reply',
      requestId: 'req-race',
      posted: { ok: true, message: savedReply, thread: makeThread({ replyCount: 2 }) },
    }).state;
    expect(afterReplyAnswer.replies).toHaveLength(2);
    expect(afterReplyAnswer.pendingReplies).toEqual([]);
  });

  it('keeps closed state across threadPollReduce open and inboxPollReduce switch_view (Item 2)', () => {
    const closedThread = threadPollReduce(initialThreadPollState(null, null, false, true), {
      type: 'open',
      rootId: ROOT_1,
      visible: true,
      closed: true,
    });
    expect(closedThread.state.closed).toBe(true);
    expect(closedThread.state.stopped).toBe(true);
    expect(closedThread.command).toBeNull();

    let inbox = initialInboxPollState('all');
    inbox = inboxPollReduce(inbox, { type: 'mount' }).state;
    inbox = inboxPollReduce(inbox, { type: 'answer', kind: 'refresh', seq: 1, result: { ok: false, code: 'sign_in_required' } }).state;
    expect(inbox.closed).toBe(true);
    const sw = inboxPollReduce(inbox, { type: 'switch_view', view: 'mentions' });
    expect(sw.command).toBeNull();
  });

  it('keeps only suffix typed after sent body (dropping mentions inside sent prefix) or whole field when edited (Item 3)', () => {
    // 1. Exact body matches -> clears field
    expect(remainingDraftAfterSend('안녕', '안녕', [{ userId: USER_2, name: '이하린', start: 0, end: 4 }])).toEqual({
      text: '',
      tracked: [],
      cleared: true,
    });

    // 2. Typed more after sent body (prefix had a mention + space after prefix + suffix has another mention)
    // Sent: "@이하린 확인" (len 7), followed by " " + "다음엔 @박도윤 에게"
    const full = '@이하린 확인 다음엔 @박도윤 에게';
    const tracked: TrackedMention[] = [
      { userId: USER_2, name: '이하린', start: 0, end: 4 },
      { userId: USER_3, name: '박도윤', start: 12, end: 16 },
    ];
    expect(remainingDraftAfterSend(full, '@이하린 확인', tracked)).toEqual({
      text: '다음엔 @박도윤 에게',
      tracked: [{ userId: USER_3, name: '박도윤', start: 4, end: 8 }],
      cleared: false,
    });

    // 3. Newline after sent body -> drops 1 newline and starts suffix at index 0 with boundary preserved
    expect(
      remainingDraftAfterSend('첫 줄\n@이하린 둘째 줄', '첫 줄', [
        { userId: USER_2, name: '이하린', start: 4, end: 8 },
      ]),
    ).toEqual({
      text: '@이하린 둘째 줄',
      tracked: [{ userId: USER_2, name: '이하린', start: 0, end: 4 }],
      cleared: false,
    });

    // 4. User edited inside the sent prefix -> keep whole field + mentions untouched
    expect(
      remainingDraftAfterSend('수정한 첫 줄 @이하린', '첫 줄', [
        { userId: USER_2, name: '이하린', start: 8, end: 12 },
      ]),
    ).toEqual({
      text: '수정한 첫 줄 @이하린',
      tracked: [{ userId: USER_2, name: '이하린', start: 8, end: 12 }],
      cleared: false,
    });
  });

  it('tracks post_gone separately from initial unsendable in sendFileReduce (Fix round 4 item 2)', () => {
    const start = sendFileReduce(initialSendFileState(`output:${OUT_1}`), {
      type: 'answer',
      seq: 0,
      result: { ok: true, file: makeFile(), threads: [] },
    }).state;
    const queued = sendFileReduce(start, {
      type: 'queue_post',
      requestId: 'r1',
      body: '삭제 직전 글',
      createdAt: '2026-11-26T05:00:00.000Z',
      authorName: '김서아',
    }).state;
    const dropped = sendFileReduce(queued, { type: 'drop_post', requestId: 'r1' }).state;
    const gone = (sendFileReduce as (s: typeof dropped, a: unknown) => { state: typeof dropped & { postGone?: boolean } })(
      dropped,
      { type: 'post_gone' },
    ).state;
    expect(gone.postGone).toBe(true);
    expect(gone.unsendable).toBe(false);
    expect(gone.closed).toBe(false);
  });
});

describe('Fix round 5 pure model rules', () => {
  it('settles without clock comparison when browser clock is 5m ahead or 5m behind, ignoring previous-answer lines and matching oldest pending first (Item 1)', () => {
    const oldSameBody = makeMsg({
      id: '99999999-9999-4999-8999-999999999801',
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '같은 문장',
      createdAt: '2026-11-26T04:49:00.000Z',
    });
    const t0 = makeThread({ replyCount: 1 });

    // Case A: browser clock is 5 minutes AHEAD (pending createdAt 04:55:00 vs server saved 04:50:01)
    let ahead = initialThreadPollState(ROOT_1, { ok: true, thread: t0, replies: [oldSameBody] });
    const cmdAhead = threadPollReduce(ahead, { type: 'tick', visible: true });
    ahead = threadPollReduce(cmdAhead.state, {
      type: 'queue_reply',
      requestId: 'req-ahead',
      body: '같은 문장',
      mentions: [],
      authorId: USER_1,
      authorName: '김서아',
      createdAt: '2026-11-26T04:55:00.000Z',
    }).state;
    const savedAhead = makeMsg({
      id: '99999999-9999-4999-8999-999999999802',
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '같은 문장',
      createdAt: '2026-11-26T04:50:01.000Z',
    });
    ahead = threadPollReduce(ahead, {
      type: 'answer',
      seq: cmdAhead.command!.seq,
      result: { ok: true, thread: makeThread({ replyCount: 2 }), replies: [oldSameBody, savedAhead] },
    }).state;
    expect(ahead.pendingReplies).toEqual([]);
    expect(
      threadStreamItems(ahead.thread!, ahead.replies, ahead.pendingReplies, ahead.settledKeys).map((i) => ({
        key: i.key,
        id: i.message.id,
      })),
    ).toEqual([
      { key: ROOT_1, id: ROOT_1 },
      { key: oldSameBody.id, id: oldSameBody.id },
      { key: 'pending:req-ahead', id: savedAhead.id },
    ]);

    // Case B: browser clock is 5 minutes BEHIND (pending createdAt 04:45:00 < oldSameBody 04:49:00)
    // Must NOT settle onto oldSameBody already in the previous answer, and matches oldest pending first!
    let behind = initialThreadPollState(ROOT_1, { ok: true, thread: t0, replies: [oldSameBody] });
    const cmdB1 = threadPollReduce(behind, { type: 'tick', visible: true });
    behind = threadPollReduce(cmdB1.state, {
      type: 'queue_reply',
      requestId: 'req-b1',
      body: '같은 문장',
      mentions: [],
      authorId: USER_1,
      authorName: '김서아',
      createdAt: '2026-11-26T04:45:00.000Z',
    }).state;
    behind = threadPollReduce(behind, {
      type: 'queue_reply',
      requestId: 'req-b2',
      body: '같은 문장',
      mentions: [],
      authorId: USER_1,
      authorName: '김서아',
      createdAt: '2026-11-26T04:45:02.000Z',
    }).state;

    // First poll still has only oldSameBody -> neither pending settles
    behind = threadPollReduce(behind, {
      type: 'answer',
      seq: cmdB1.command!.seq,
      result: { ok: true, thread: t0, replies: [oldSameBody] },
    }).state;
    expect(behind.pendingReplies.map((p) => p.requestId)).toEqual(['req-b1', 'req-b2']);

    // Next poll brings 1 new reply -> oldest pending (req-b1) settles onto it, req-b2 stays pending
    const cmdB2 = threadPollReduce(behind, { type: 'tick', visible: true });
    const savedB1 = makeMsg({
      id: '99999999-9999-4999-8999-999999999803',
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '같은 문장',
      createdAt: '2026-11-26T04:50:03.000Z',
    });
    behind = threadPollReduce(cmdB2.state, {
      type: 'answer',
      seq: cmdB2.command!.seq,
      result: { ok: true, thread: makeThread({ replyCount: 2 }), replies: [oldSameBody, savedB1] },
    }).state;
    expect(behind.pendingReplies.map((p) => p.requestId)).toEqual(['req-b2']);
    expect(behind.settledKeys[savedB1.id]).toBe('pending:req-b1');
    expect(behind.settledKeys[oldSameBody.id]).toBeUndefined();
  });

  it('gives the pending React key to the answered line and lets another settled line use its own id when apply_reply names a different message (Item 2)', () => {
    const t0 = makeThread({ replyCount: 0 });
    let s = initialThreadPollState(ROOT_1, { ok: true, thread: t0, replies: [] });

    const cmd = threadPollReduce(s, { type: 'tick', visible: true });
    s = threadPollReduce(cmd.state, {
      type: 'queue_reply',
      requestId: 'req-tab1',
      body: '동일 답글',
      mentions: [],
      authorId: USER_1,
      authorName: '김서아',
      createdAt: '2026-11-26T04:50:00.000Z',
    }).state;

    // Another tab of the same user posted the same body first -> poll settles req-tab1 onto otherTabMsg
    const otherTabMsg = makeMsg({
      id: '99999999-9999-4999-8999-999999999811',
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '동일 답글',
      createdAt: '2026-11-26T04:50:01.000Z',
    });
    s = threadPollReduce(s, {
      type: 'answer',
      seq: cmd.command!.seq,
      result: { ok: true, thread: makeThread({ replyCount: 1 }), replies: [otherTabMsg] },
    }).state;
    expect(s.settledKeys[otherTabMsg.id]).toBe('pending:req-tab1');

    // Now this tab's own reply() returns a different server message id
    const myPostedMsg = makeMsg({
      id: '99999999-9999-4999-8999-999999999812',
      parentId: ROOT_1,
      authorId: USER_1,
      authorName: '김서아',
      mine: true,
      body: '동일 답글',
      createdAt: '2026-11-26T04:50:02.000Z',
    });
    s = threadPollReduce(s, {
      type: 'apply_reply',
      requestId: 'req-tab1',
      posted: { ok: true, message: myPostedMsg, thread: makeThread({ replyCount: 2 }) },
    }).state;

    const rendered = threadStreamItems(s.thread!, s.replies, s.pendingReplies, s.settledKeys);
    const keys = rendered.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rendered.map((item) => ({ key: item.key, id: item.message.id }))).toEqual([
      { key: ROOT_1, id: ROOT_1 },
      { key: otherTabMsg.id, id: otherTabMsg.id },
      { key: 'pending:req-tab1', id: myPostedMsg.id },
    ]);
  });

  it('includes ?project= on fileOpenHref only when file.project.selectable === true across every file kind', () => {
    const viewParam = encodeURIComponent(`o:${OUT_1}`);
    const projectParam = encodeURIComponent(PROJ);
    const activeProject = { id: PROJ, title: '봄 향수 론칭', selectable: true };
    const finishedProject = { id: PROJ, title: '봄 향수 론칭', selectable: false };
    const legacyProject = { id: PROJ, title: '봄 향수 론칭' };

    const cases: Array<{
      label: string;
      patch: Partial<SendFileCard>;
      baseHref: string;
      activeHref: string;
    }> = [
      {
        label: 'studio image output',
        patch: { ref: { kind: 'output', outputId: OUT_1 }, kind: 'image' },
        baseHref: `/brand/studio?organizationId=${ORG}&view=${viewParam}`,
        activeHref: `/brand/studio?organizationId=${ORG}&project=${projectParam}&view=${viewParam}`,
      },
      {
        label: 'studio null-kind output (image fallback)',
        patch: { ref: { kind: 'output', outputId: OUT_1 }, kind: null },
        baseHref: `/brand/studio?organizationId=${ORG}&view=${viewParam}`,
        activeHref: `/brand/studio?organizationId=${ORG}&project=${projectParam}&view=${viewParam}`,
      },
      {
        label: 'studio video output',
        patch: { ref: { kind: 'output', outputId: OUT_1 }, kind: 'video' },
        baseHref: `/brand/studio/video?organizationId=${ORG}&view=${viewParam}`,
        activeHref: `/brand/studio/video?organizationId=${ORG}&project=${projectParam}&view=${viewParam}`,
      },
      {
        label: 'studio sound output',
        patch: { ref: { kind: 'output', outputId: OUT_1 }, kind: 'audio' },
        baseHref: `/brand/studio/sound?organizationId=${ORG}`,
        activeHref: `/brand/studio/sound?organizationId=${ORG}&project=${projectParam}`,
      },
      {
        label: 'uploaded image asset',
        patch: { ref: { kind: 'asset', assetId: ASSET_1 }, kind: 'image', name: '제품컷' },
        baseHref: `/brand/library?organizationId=${ORG}`,
        activeHref: `/brand/library?organizationId=${ORG}&project=${projectParam}`,
      },
      {
        label: 'uploaded video asset',
        patch: { ref: { kind: 'asset', assetId: ASSET_1 }, kind: 'video', name: '런웨이 클립' },
        baseHref: `/brand/library?organizationId=${ORG}`,
        activeHref: `/brand/library?organizationId=${ORG}&project=${projectParam}`,
      },
      {
        label: 'uploaded audio asset',
        patch: { ref: { kind: 'asset', assetId: ASSET_1 }, kind: 'audio', name: '배경음' },
        baseHref: `/brand/library?organizationId=${ORG}`,
        activeHref: `/brand/library?organizationId=${ORG}&project=${projectParam}`,
      },
    ];

    for (const c of cases) {
      const noProject = fileCardInfo(makeFile({ ...c.patch, project: null }), ORG, KO).openHref;
      const legacy = fileCardInfo(makeFile({ ...c.patch, project: legacyProject }), ORG, KO).openHref;
      const active = fileCardInfo(makeFile({ ...c.patch, project: activeProject }), ORG, KO).openHref;
      const finished = fileCardInfo(makeFile({ ...c.patch, project: finishedProject }), ORG, KO).openHref;

      expect(noProject, `${c.label} / no project`).toBe(c.baseHref);
      expect(legacy, `${c.label} / legacy project without selectable`).toBe(c.baseHref);
      expect(finished, `${c.label} / finished project (selectable: false)`).toBe(c.baseHref);
      expect(active, `${c.label} / active project (selectable: true)`).toBe(c.activeHref);
    }

    // Deleted file always returns openHref: null even if project is active
    expect(
      fileCardInfo(makeFile({ available: false, kind: null, project: activeProject }), ORG, KO).openHref,
    ).toBeNull();
  });
});
