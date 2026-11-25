import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  BELL_POLL_MS,
  BELL_STOP_CODES,
  bellAccessibleLabel,
  bellActive,
  bellBadgeText,
  bellCanMarkRead,
  bellInboxCount,
  bellLineProjectLabel,
  bellLineText,
  bellLineTime,
  bellMarkReadTarget,
  bellPollReduce,
  initialBellPollState,
  type BellItem,
  type BellState,
} from '@/components/brand-workspace/bell/model';

const ko = getDictionary('ko');
const en = getDictionary('en');

const ORG = 'a0000000-0000-4000-8000-0000000000a1';
const ORG_B = 'b0000000-0000-4000-8000-0000000000b2';
const PROJECT = '11111111-1111-4111-8111-111111111111';

const convItem = (over: Partial<BellItem> = {}): BellItem => ({
  id: `channel:${PROJECT}`,
  kind: 'conversation',
  projectId: PROJECT,
  projectTitle: 'Spring launch',
  title: null,
  line: 'Please check cut 4',
  version: null,
  openNotes: 0,
  unreadCount: 2,
  at: '2026-11-26T03:00:00.000Z',
  unread: true,
  thumbUrl: null,
  href: `/brand/rooms?organizationId=${ORG}&channel=${PROJECT}`,
  ...over,
});

const storyboardItem = (over: Partial<BellItem> = {}): BellItem => ({
  id: 'storyboard:sb-1',
  kind: 'storyboard',
  projectId: PROJECT,
  projectTitle: 'Spring launch',
  title: 'Opening board',
  line: null,
  version: 2,
  openNotes: 0,
  unreadCount: 0,
  at: '2026-11-26T02:00:00.000Z',
  unread: true,
  thumbUrl: '/api/brand-studio/media/sb-1.webp',
  href: `/brand/rooms/${PROJECT}?organizationId=${ORG}&tab=storyboard&board=sb-1`,
  ...over,
});

const reviewItem = (over: Partial<BellItem> = {}): BellItem => ({
  id: 'review:rv-1',
  kind: 'review',
  projectId: PROJECT,
  projectTitle: 'Spring launch',
  title: 'Cut A',
  line: null,
  version: 3,
  openNotes: 4,
  unreadCount: 0,
  at: '2026-11-26T01:00:00.000Z',
  unread: true,
  thumbUrl: '/api/brand-studio/media/rv-1.webp',
  href: `/brand/rooms/${PROJECT}?organizationId=${ORG}&tab=review&review=rv-1`,
  ...over,
});

const sampleBell = (over: Partial<BellState> = {}): BellState => ({
  unread: 3,
  items: [convItem(), storyboardItem(), reviewItem()],
  more: false,
  ...over,
});

describe('bellActive', () => {
  it('is active only when organizationId is in candidates (case-insensitive) and mode is make', () => {
    expect(bellActive({ candidates: [ORG], organizationId: ORG.toUpperCase(), mode: 'make' })).toBe(true);
    expect(bellActive({ candidates: [ORG], organizationId: ORG, mode: 'team' })).toBe(false);
    expect(bellActive({ candidates: [ORG], organizationId: ORG, mode: null })).toBe(false);
    expect(bellActive({ candidates: [ORG], organizationId: ORG_B, mode: 'make' })).toBe(false);
    expect(bellActive({ candidates: [ORG], organizationId: null, mode: 'make' })).toBe(false);
    expect(bellActive({ candidates: [], organizationId: ORG, mode: 'make' })).toBe(false);
  });
});

function settledState(bell: BellState = sampleBell(), organizationId = ORG) {
  const { state: reading } = bellPollReduce(initialBellPollState(), { type: 'activate', organizationId });
  return bellPollReduce(reading, {
    type: 'answer',
    organizationId,
    seq: reading.seq,
    result: { ok: true, bell },
  }).state;
}

describe('bellPollReduce', () => {
  it('starts inactive with seq 0 and null bell, activates on mount read with 20s period', () => {
    expect(BELL_POLL_MS).toBe(20_000);
    const idle = initialBellPollState();
    expect(idle).toEqual({
      organizationId: null,
      active: false,
      seq: 0,
      bell: null,
      inflight: false,
      stopped: false,
    });

    const activated = bellPollReduce(idle, { type: 'activate', organizationId: ORG });
    expect(activated.shouldRead).toBe(true);
    expect(activated.state).toEqual({
      organizationId: ORG,
      active: true,
      seq: 1,
      bell: null,
      inflight: true,
      stopped: false,
    });
  });

  it('starts a read with monotonic seq on visible tick, visibility return, focus, ROOM_ACTIVITY, and manual refresh', () => {
    const start = settledState();
    expect(start.inflight).toBe(false);
    expect(start.seq).toBe(1);
    for (const reason of ['mount', 'tick', 'visible', 'focus', 'activity', 'manual'] as const) {
      const next = bellPollReduce(start, { type: 'trigger', reason, visible: true });
      expect(next.shouldRead, reason).toBe(true);
      expect(next.state.inflight, reason).toBe(true);
      expect(next.state.seq, reason).toBe(2);
    }
  });

  it('does not read when inactive or stopped or when tick/visible fires while tab is hidden', () => {
    const idle = initialBellPollState();
    expect(bellPollReduce(idle, { type: 'trigger', reason: 'tick', visible: true }).shouldRead).toBe(false);

    const start = settledState();
    for (const reason of ['tick', 'visible'] as const) {
      const next = bellPollReduce(start, { type: 'trigger', reason, visible: false });
      expect(next.shouldRead, reason).toBe(false);
      expect(next.state).toEqual(start);
    }
  });

  it('never allows two reads in flight at once', () => {
    const { state: reading } = bellPollReduce(initialBellPollState(), { type: 'activate', organizationId: ORG });
    expect(reading.inflight).toBe(true);
    for (const reason of ['mount', 'tick', 'focus', 'activity', 'visible', 'manual'] as const) {
      const dup = bellPollReduce(reading, { type: 'trigger', reason, visible: true });
      expect(dup.shouldRead, reason).toBe(false);
      expect(dup.state).toBe(reading);
    }
  });

  it('updates bell state when matching-sequence answer arrives with bell payload', () => {
    const { state: reading } = bellPollReduce(initialBellPollState(), { type: 'activate', organizationId: ORG });
    const fresh = sampleBell({ unread: 1, items: [storyboardItem()] });
    const done = bellPollReduce(reading, {
      type: 'answer',
      organizationId: ORG,
      seq: reading.seq,
      result: { ok: true, bell: fresh },
    });
    expect(done.shouldRead).toBe(false);
    expect(done.state).toEqual({
      organizationId: ORG,
      active: true,
      seq: 1,
      bell: fresh,
      inflight: false,
      stopped: false,
    });
  });

  it('deactivates and ignores late answers for the previous organization or sequence after switching or deactivating', () => {
    const first = bellPollReduce(initialBellPollState(), { type: 'activate', organizationId: ORG });
    expect(first.state.seq).toBe(1);

    // Switch directly to ORG_B while ORG is still in flight.
    const switched = bellPollReduce(first.state, { type: 'activate', organizationId: ORG_B });
    expect(switched.shouldRead).toBe(true);
    expect(switched.state.organizationId).toBe(ORG_B);
    expect(switched.state.seq).toBe(2);
    expect(switched.state.bell).toBeNull();
    expect(switched.state.inflight).toBe(true);

    // Late answer from ORG (seq 1) is ignored cleanly.
    const lateOldOrg = bellPollReduce(switched.state, {
      type: 'answer',
      organizationId: ORG,
      seq: first.state.seq,
      result: { ok: true, bell: sampleBell({ unread: 9 }) },
    });
    expect(lateOldOrg.state).toBe(switched.state);

    // Late answer with stale seq for current org is also ignored.
    const deactivated = bellPollReduce(switched.state, { type: 'deactivate' });
    expect(deactivated.state).toEqual({
      organizationId: null,
      active: false,
      seq: 3,
      bell: null,
      inflight: false,
      stopped: false,
    });
    const lateAfterDeactivate = bellPollReduce(deactivated.state, {
      type: 'answer',
      organizationId: ORG_B,
      seq: switched.state.seq,
      result: { ok: true, bell: sampleBell({ unread: 4 }) },
    });
    expect(lateAfterDeactivate.state).toBe(deactivated.state);
  });

  it('ignores older-sequence answer on same org when a newer read has started', () => {
    const first = settledState(sampleBell({ unread: 1 }));
    const second = bellPollReduce(first, { type: 'trigger', reason: 'tick', visible: true });
    expect(second.state.seq).toBe(2);
    const stale = bellPollReduce(second.state, {
      type: 'answer',
      organizationId: ORG,
      seq: first.seq,
      result: { ok: true, bell: sampleBell({ unread: 99 }) },
    });
    expect(stale.state).toBe(second.state);
  });

  it('goes inactive and stops for the page when an answer omits bell', () => {
    const start = settledState();
    const { state: reading } = bellPollReduce(start, { type: 'trigger', reason: 'tick', visible: true });
    const stopped = bellPollReduce(reading, {
      type: 'answer',
      organizationId: ORG,
      seq: reading.seq,
      result: { ok: true },
    });
    expect(stopped.state).toEqual({
      organizationId: ORG,
      active: false,
      seq: reading.seq,
      bell: null,
      inflight: false,
      stopped: true,
    });
    const later = bellPollReduce(stopped.state, { type: 'trigger', reason: 'tick', visible: true });
    expect(later.shouldRead).toBe(false);
  });

  it.each([...BELL_STOP_CODES])('goes inactive permanently on %s', (code) => {
    const start = settledState();
    const { state: reading } = bellPollReduce(start, { type: 'trigger', reason: 'tick', visible: true });
    const stopped = bellPollReduce(reading, {
      type: 'answer',
      organizationId: ORG,
      seq: reading.seq,
      result: { ok: false, code },
    });
    expect(stopped.state.stopped).toBe(true);
    expect(stopped.state.active).toBe(false);
    expect(stopped.state.bell).toBeNull();
    expect(stopped.state.inflight).toBe(false);
    for (const reason of ['tick', 'focus', 'activity', 'visible', 'manual'] as const) {
      expect(bellPollReduce(stopped.state, { type: 'trigger', reason, visible: true }).shouldRead).toBe(false);
    }
  });

  it.each(['offline', 'failed'] as const)('keeps current bell and retries next tick on %s', (code) => {
    const initial = sampleBell({ unread: 2 });
    const start = settledState(initial);
    const { state: reading } = bellPollReduce(start, { type: 'trigger', reason: 'tick', visible: true });
    const transient = bellPollReduce(reading, {
      type: 'answer',
      organizationId: ORG,
      seq: reading.seq,
      result: { ok: false, code },
    });
    expect(transient.state).toEqual({
      organizationId: ORG,
      active: true,
      seq: reading.seq,
      bell: initial,
      inflight: false,
      stopped: false,
    });
    const retry = bellPollReduce(transient.state, { type: 'trigger', reason: 'tick', visible: true });
    expect(retry.shouldRead).toBe(true);
    expect(retry.state.inflight).toBe(true);
  });
});

describe('bell rail & display decisions', () => {
  it('takes rail inbox count directly from bell.unread without recounting items', () => {
    expect(bellInboxCount(null)).toBe(0);
    expect(bellInboxCount(sampleBell({ unread: 0, items: [storyboardItem()] }))).toBe(0);
    expect(bellInboxCount(sampleBell({ unread: -2, items: [storyboardItem()] }))).toBe(0);
    expect(bellInboxCount(sampleBell({ unread: 5, items: [convItem()] }))).toBe(5);
  });

  it('formats bell count badge text and accessible button label', () => {
    expect(bellBadgeText(0)).toBeNull();
    expect(bellBadgeText(4)).toBe('4');
    expect(bellBadgeText(120)).toBe('99+');
    expect(bellAccessibleLabel(0, ko.projectHome)).toBe(ko.projectHome.bellTitle);
    expect(bellAccessibleLabel(3, ko.projectHome)).toBe('알림 3건');
    expect(bellAccessibleLabel(3, en.projectHome)).toBe('3 notifications');
  });

  it('composes line text and project label for storyboard, review, and conversation items', () => {
    expect(bellLineProjectLabel(convItem(), ko.roomsChat.inbox.general)).toBe('Spring launch');
    expect(bellLineProjectLabel(convItem({ projectId: null, projectTitle: null }), ko.roomsChat.inbox.general)).toBe('일반 문의');

    expect(bellLineText(storyboardItem({ version: 2 }), ko.roomsChat.inbox)).toBe('스토리보드 v2 확인 대기');
    expect(bellLineText(reviewItem({ version: 3, openNotes: 4 }), ko.roomsChat.inbox)).toBe('시안 v3 · 열린 의견 4개');
    expect(bellLineText(reviewItem({ version: 3, openNotes: 0 }), ko.roomsChat.inbox)).toBe('시안 v3 확인 대기');
    expect(bellLineText(convItem({ line: 'Check cut 4' }), ko.roomsChat.inbox)).toBe('Check cut 4');
    expect(bellLineText(convItem({ projectId: null, projectTitle: null, line: null }), ko.roomsChat.inbox)).toBe(
      ko.roomsChat.inbox.generalHint,
    );
    expect(bellLineText(convItem({ projectId: PROJECT, line: null }), ko.roomsChat.inbox)).toBe(
      ko.roomsChat.inbox.noMessages,
    );
  });

  it('enables mark-read only for unread conversation items', () => {
    const unreadConv = convItem({ projectId: PROJECT, unread: true });
    const generalUnread = convItem({ id: 'channel:general', projectId: null, projectTitle: null, unread: true });
    const readConv = convItem({ unread: false, unreadCount: 0 });
    expect(bellCanMarkRead(unreadConv)).toBe(true);
    expect(bellCanMarkRead(generalUnread)).toBe(true);
    expect(bellCanMarkRead(readConv)).toBe(false);
    expect(bellCanMarkRead(storyboardItem())).toBe(false);
    expect(bellCanMarkRead(reviewItem())).toBe(false);

    expect(bellMarkReadTarget(unreadConv)).toEqual({ channel: PROJECT, at: unreadConv.at });
    expect(bellMarkReadTarget(generalUnread)).toEqual({ channel: 'general', at: generalUnread.at });
    expect(bellMarkReadTarget(readConv)).toBeNull();
    expect(bellMarkReadTarget(storyboardItem())).toBeNull();
  });

  it('formats line timestamps via relative time helper', () => {
    const now = new Date('2026-11-26T04:00:00.000Z');
    expect(bellLineTime(convItem({ at: '2026-11-26T02:00:00.000Z' }), 'ko', now)).toBe('2시간 전');
  });
});
