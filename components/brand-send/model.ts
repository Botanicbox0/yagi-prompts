/**
 * Pure presentation, `@` mention, request-id, refusal, and polling state machines for 보내기 (slice 4b).
 *
 * Imports nothing from `lib/**` except `import type` and named contract limits (`ROOM_LIMITS`,
 * `ROOM_POLL_VISIBLE_MS`, `ROOM_POLL_HIDDEN_MS`, `SEND_LIMITS`). Reuses `formatRelativeTime` from
 * `components/brand-studio/project-chip/model.ts`.
 */
import { formatRelativeTime } from '@/components/brand-studio/project-chip/model';
import { ROOM_LIMITS, ROOM_POLL_HIDDEN_MS, ROOM_POLL_VISIBLE_MS } from '@/lib/brand-rooms/message-contracts';
import {
  SEND_LIMITS,
  type SendFileCard,
  type SendFileRef,
  type SendFileThreads,
  type SendInboxPage,
  type SendInboxView,
  type SendMention,
  type SendMessage,
  type SendPerson,
  type SendPosted,
  type SendThreadPage,
  type SendThreadSummary,
} from '@/lib/brand-rooms/send-contracts';
import type { Dictionary } from '@/lib/i18n/dictionaries';

export type SendLocale = 'ko' | 'en';

export interface BrandSendClientProp {
  organizationId: string;
}

export interface ViewerSendProp extends BrandSendClientProp {
  copy: SendCopy;
  locale?: SendLocale;
}

export interface SendCopy {
  action: string;
  viewAll: string;
  viewMentions: string;
  mentionMark: string;
  markRead: string;
  markAllRead: string;
  seeAll: string;
  inboxTitle: string;
  openFile: string;
  replyPlaceholder: string;
  peopleHeading: string;
  unfiled: string;
  sendSub: string;
  sendHint: string;
  sendPlaceholder: string;
  sendNoMention: string;
  sendFailed: string;
  sendRate: string;
  peopleEmpty: string;
  replyCount: string;
  fileGone: string;
  threadLead: string;
  threadLeadAnon: string;
  inboxEmpty: string;
  inboxMentionsEmpty: string;
  inboxPick: string;
  threadGone: string;
  externalLink: string;
  replyLead: string;
  composerHint: string;
  composerLabel: string;
  mentionsLabel: string;
  loadMore: string;
  bellEmpty: string;
  someone: string;
  you: string;
  today: string;
  yesterday: string;
  loading: string;
  retry: string;
  failedLoad: string;
  kindImage: string;
  kindVideo: string;
  kindSound: string;
  sourceGenerated: string;
  sourceUpload: string;
  roles: {
    owner: string;
    editor: string;
    viewer: string;
  };
}

export function pickSendCopy(dict: Dictionary): SendCopy {
  const s = dict.brandSend;
  return {
    action: dict.roomsChat.composer.send,
    viewAll: dict.roomsChat.inbox.filters.all,
    viewMentions: s.viewMentions,
    mentionMark: s.mentionMark,
    markRead: dict.projectHome.bellMarkRead,
    markAllRead: s.markAllRead,
    seeAll: dict.projectHome.bellSeeAll,
    inboxTitle: s.inboxTitle,
    openFile: s.openFile,
    replyPlaceholder: s.replyPlaceholder,
    peopleHeading: s.peopleHeading,
    unfiled: dict.projectSpine.unfiled,
    sendSub: s.sendSub,
    sendHint: s.sendHint,
    sendPlaceholder: s.sendPlaceholder,
    sendNoMention: s.sendNoMention,
    sendFailed: s.sendFailed,
    sendRate: s.sendRate,
    peopleEmpty: s.peopleEmpty,
    replyCount: s.replyCount,
    fileGone: s.fileGone,
    threadLead: s.threadLead,
    threadLeadAnon: s.threadLeadAnon,
    inboxEmpty: s.inboxEmpty,
    inboxMentionsEmpty: s.inboxMentionsEmpty,
    inboxPick: s.inboxPick,
    threadGone: s.threadGone,
    externalLink: s.externalLink,
    replyLead: s.replyLead,
    composerHint: dict.roomsChat.composer.hint,
    composerLabel: dict.roomsChat.composer.label,
    mentionsLabel: dict.roomsChat.composer.mentionsLabel,
    loadMore: dict.studioSound.lyricsKit.more,
    bellEmpty: dict.projectHome.bellEmpty,
    someone: dict.roomsChat.author.someone,
    you: dict.roomsChat.author.you,
    today: dict.roomsChat.channel.today,
    yesterday: dict.roomsChat.channel.yesterday,
    loading: dict.roomsChat.channel.loading,
    retry: dict.roomsChat.channel.retry,
    failedLoad: dict.roomsChat.channel.failedLoad,
    kindImage: dict.studioLibrary.item.image,
    kindVideo: dict.studioLibrary.item.video,
    kindSound: dict.projectHome.kindSound,
    sourceGenerated: dict.studioLibrary.hub.sourceGenerated,
    sourceUpload: dict.studioLibrary.hub.sourceUpload,
    roles: {
      owner: dict.brandWorkspace.roles.owner,
      editor: dict.brandWorkspace.roles.editor,
      viewer: dict.brandWorkspace.roles.viewer,
    },
  };
}

function formatTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (full, key: string) => (key in vars ? String(vars[key]) : full));
}

/* ------------------------------------------------------------------ @ mentions */

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

/** True while an IME composition (e.g. Hangul) owns the key event, across React synthetic and native DOM events. */
export function isComposingKeyEvent(event: {
  keyCode?: number;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  return Boolean(
    event.isComposing ||
      event.nativeEvent?.isComposing ||
      event.keyCode === 229 ||
      event.nativeEvent?.keyCode === 229,
  );
}

export interface TrackedMention {
  userId: string;
  name: string;
  start: number;
  end: number;
}

/**
 * Opens the `@` picker when `@` is at start or directly after whitespace.
 * Allows at most one space while at least one member in `people` matches the query (e.g. `"Editor Lee"`).
 */
export function parseMentionTrigger(
  text: string,
  caret: number,
  people?: readonly SendPerson[],
): MentionTrigger | null {
  const clamped = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, clamped);
  const match = /(^|\s)@([^\s@]+ [^\s@]*|[^\s@]*)$/.exec(before);
  if (!match) return null;
  const query = match[2] ?? '';
  if (query.length > 30) return null;
  if (query.includes(' ')) {
    if (!people || filterMentionPeople(people, query).length === 0) return null;
  }
  return {
    start: before.length - query.length - 1,
    end: clamped,
    query,
  };
}

/** Filters ONLY the non-self members returned by `send.people`, preserving server order. */
export function filterMentionPeople(people: readonly SendPerson[], query: string): SendPerson[] {
  const list = people.filter((p) => !p.me).slice(0, SEND_LIMITS.peopleMax);
  const q = query.normalize('NFC').toLowerCase();
  if (!q) return [...list];
  return list.filter((p) => p.name.normalize('NFC').toLowerCase().includes(q));
}

function hasMentionBoundary(text: string, start: number): boolean {
  return start === 0 || /\s/.test(text[start - 1] ?? '');
}

/** Inserts `@이름 ` at the trigger range, shifts existing tracked mentions, and records this member id. */
export function applyMentionPick(
  text: string,
  trigger: MentionTrigger,
  person: Pick<SendPerson, 'id' | 'name'>,
  tracked: readonly TrackedMention[],
): { text: string; caret: number; tracked: TrackedMention[] } {
  const insert = `@${person.name} `;
  const nextText = text.slice(0, trigger.start) + insert + text.slice(trigger.end);
  const delta = insert.length - (trigger.end - trigger.start);
  const tokenEnd = trigger.start + 1 + person.name.length;
  const nextTracked: TrackedMention[] = [];

  for (const m of tracked) {
    if (m.end <= trigger.start) {
      nextTracked.push({ ...m });
    } else if (m.start >= trigger.end) {
      nextTracked.push({ ...m, start: m.start + delta, end: m.end + delta });
    }
  }
  nextTracked.push({
    userId: person.id,
    name: person.name,
    start: trigger.start,
    end: tokenEnd,
  });
  nextTracked.sort((a, b) => a.start - b.start);

  return {
    text: nextText,
    caret: trigger.start + insert.length,
    tracked: nextTracked,
  };
}

/**
 * Updates tracked mention spans after any text edit. Deleting or inserting any character inside an
 * inserted `@이름` token (or breaking the whitespace boundary before `@`) removes that mention so it
 * becomes plain text.
 */
export function reconcileMentions(
  prevText: string,
  nextText: string,
  tracked: readonly TrackedMention[],
): TrackedMention[] {
  if (tracked.length === 0) return [];
  if (prevText === nextText) {
    return tracked.filter(
      (m) =>
        m.start >= 0 &&
        m.end <= nextText.length &&
        hasMentionBoundary(nextText, m.start) &&
        nextText.slice(m.start, m.end) === `@${m.name}`,
    );
  }

  let prefix = 0;
  const minLen = Math.min(prevText.length, nextText.length);
  while (prefix < minLen && prevText[prefix] === nextText[prefix]) prefix += 1;

  let suffix = 0;
  const maxSuffix = minLen - prefix;
  while (
    suffix < maxSuffix &&
    prevText[prevText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const editStart = prefix;
  const prevEditEnd = prevText.length - suffix;
  const delta = nextText.length - prevText.length;

  const kept: TrackedMention[] = [];
  for (const m of tracked) {
    let start = m.start;
    let end = m.end;
    if (editStart >= m.end) {
      // Edit is strictly after this mention token.
    } else if (prevEditEnd <= m.start) {
      // Edit is strictly before this mention token.
      start += delta;
      end += delta;
    } else {
      // Edit touched [m.start, m.end): remove the mention.
      continue;
    }

    if (
      start >= 0 &&
      end <= nextText.length &&
      hasMentionBoundary(nextText, start) &&
      nextText.slice(start, end) === `@${m.name}`
    ) {
      kept.push({ ...m, start, end });
    }
  }
  return kept;
}

/**
 * When a send settles in-flight, drops only the already-sent prefix (plus one trailing space or line
 * break) if the field still starts with `sentBody`, preserving newly appended suffix text and shifting
 * its tracked mentions cleanly. If the user edited inside the sent prefix, keeps the whole draft.
 */
export function remainingDraftAfterSend(
  currentText: string,
  sentBody: string,
  currentTracked: readonly TrackedMention[],
): { text: string; tracked: TrackedMention[]; cleared: boolean } {
  if (!currentText.startsWith(sentBody)) {
    return {
      text: currentText,
      tracked: currentTracked.map((m) => ({ ...m })),
      cleared: currentText.length === 0,
    };
  }
  let cut = sentBody.length;
  const trailing = currentText[cut];
  if (trailing === ' ' || trailing === '\n') {
    cut += 1;
  }
  const nextText = currentText.slice(cut);
  const nextTracked: TrackedMention[] = [];
  for (const m of currentTracked) {
    if (m.start < cut) continue;
    const start = m.start - cut;
    const end = m.end - cut;
    if (end <= nextText.length && hasMentionBoundary(nextText, start) && nextText.slice(start, end) === `@${m.name}`) {
      nextTracked.push({ ...m, start, end });
    }
  }
  return {
    text: nextText,
    tracked: nextTracked,
    cleared: nextText.length === 0,
  };
}

/** Verified unique member ids carried by `text` in order, capped at `ROOM_LIMITS.mentionsMax`. */
export function extractMentionIds(text: string, tracked: readonly TrackedMention[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of tracked) {
    if (
      m.start >= 0 &&
      m.end <= text.length &&
      hasMentionBoundary(text, m.start) &&
      text.slice(m.start, m.end) === `@${m.name}` &&
      !seen.has(m.userId)
    ) {
      seen.add(m.userId);
      ids.push(m.userId);
      if (ids.length >= ROOM_LIMITS.mentionsMax) break;
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ body & requestId */

const BODY_COUNTER_THRESHOLD = Math.floor(ROOM_LIMITS.bodyMax * 0.9);

export function bodyCountNearLimit(text: string): { count: number; max: number; over: boolean } | null {
  if (text.length < BODY_COUNTER_THRESHOLD) return null;
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
  return {
    count: text.length,
    max: ROOM_LIMITS.bodyMax,
    over: normalized.length > ROOM_LIMITS.bodyMax,
  };
}

export interface RequestIdPlan {
  key: string | null;
  requestId: string | null;
}

export const EMPTY_REQUEST_ID_PLAN: RequestIdPlan = { key: null, requestId: null };

function normalizeSendBody(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

/** Reuses the same `requestId` for retries of identical text+mentions; allocates a new id when edited. */
export function resolveRequestId(
  plan: RequestIdPlan,
  body: string,
  mentions: readonly string[],
  makeId: () => string = () => crypto.randomUUID(),
): { plan: RequestIdPlan; requestId: string } {
  const key = `${normalizeSendBody(body)}\u0000${mentions.join(',')}`;
  if (plan.key === key && plan.requestId) {
    return { plan, requestId: plan.requestId };
  }
  const requestId = makeId();
  return { plan: { key, requestId }, requestId };
}

/* ------------------------------------------------------------------ refusals */

export type SendRefusalContext = 'compose_post' | 'compose_reply' | 'thread' | 'inbox' | 'file';

export type SendRefusalMessageKey = 'sendFailed' | 'sendRate' | 'fileGone' | 'threadGone' | 'failedLoad' | null;

export interface SendRefusalOutcome {
  hideSend: boolean;
  stopPolling: boolean;
  keepText: boolean;
  resetRequestId: boolean;
  messageKey: SendRefusalMessageKey;
}

export function sendRefusalOutcome(code: string, context: SendRefusalContext): SendRefusalOutcome {
  if (code === 'invalid' || code === 'rooms_closed' || code === 'sign_in_required') {
    return {
      hideSend: true,
      stopPolling: true,
      keepText: false,
      resetRequestId: true,
      messageKey: null,
    };
  }
  if (code === 'not_found') {
    return {
      hideSend: false,
      stopPolling: true,
      keepText: true,
      resetRequestId: true,
      messageKey: context === 'compose_post' || context === 'file' ? 'fileGone' : context === 'inbox' ? 'failedLoad' : 'threadGone',
    };
  }
  if (code === 'rate_limited') {
    return {
      hideSend: false,
      stopPolling: false,
      keepText: true,
      resetRequestId: false,
      messageKey: 'sendRate',
    };
  }
  if (code === 'conflict') {
    return {
      hideSend: false,
      stopPolling: false,
      keepText: true,
      resetRequestId: true,
      messageKey: 'sendFailed',
    };
  }
  return {
    hideSend: false,
    stopPolling: false,
    keepText: true,
    resetRequestId: false,
    messageKey: context === 'inbox' || context === 'thread' || context === 'file' ? 'failedLoad' : 'sendFailed',
  };
}

export function refusalMessageText(outcome: SendRefusalOutcome, copy: SendCopy): string | null {
  switch (outcome.messageKey) {
    case 'sendFailed':
      return copy.sendFailed;
    case 'sendRate':
      return copy.sendRate;
    case 'fileGone':
      return copy.fileGone;
    case 'threadGone':
      return copy.threadGone;
    case 'failedLoad':
      return copy.failedLoad;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ inbox poll reducer */

export interface InboxPollState {
  view: SendInboxView;
  threads: SendThreadSummary[];
  next: string | null;
  unread: number;
  mentionsUnread: number;
  hasMoreUnread: boolean;
  loaded: boolean;
  loadingMore: boolean;
  inflight: boolean;
  inflightKind: 'refresh' | 'more' | null;
  seq: number;
  pendingReload: boolean;
  stopped: boolean;
  closed: boolean;
  error: string | null;
  pointerOver: boolean;
  deferredFresh: SendInboxPage | null;
}

export type InboxPollCommand = {
  kind: 'refresh' | 'more';
  view: SendInboxView;
  cursor: string | null;
  seq: number;
};

export type InboxPollAction =
  | { type: 'mount' }
  | { type: 'tick'; visible: boolean }
  | { type: 'focus'; visible: boolean }
  | { type: 'visible'; visible: boolean }
  | { type: 'activity' }
  | { type: 'retry' }
  | { type: 'more' }
  | { type: 'switch_view'; view: SendInboxView }
  | { type: 'pointer_enter' }
  | { type: 'pointer_leave' }
  | { type: 'mark_read'; rootId: string }
  | { type: 'read_all_done'; more: boolean }
  | { type: 'upsert_thread'; thread: SendThreadSummary }
  | { type: 'close' }
  | { type: 'answer'; kind: 'refresh' | 'more'; seq: number; result: SendInboxPage | { ok: false; code: string } };

export function initialInboxPollState(
  initialView: SendInboxView = 'all',
  seed: SendInboxPage | null = null,
): InboxPollState {
  return {
    view: seed?.view ?? initialView,
    threads: seed ? [...seed.threads] : [],
    next: seed?.next ?? null,
    unread: seed?.unread ?? 0,
    mentionsUnread: seed?.mentionsUnread ?? 0,
    hasMoreUnread: false,
    loaded: seed !== null,
    loadingMore: false,
    inflight: false,
    inflightKind: null,
    seq: 0,
    pendingReload: false,
    stopped: false,
    closed: false,
    error: null,
    pointerOver: false,
    deferredFresh: null,
  };
}

function mergeInboxRefreshOrder(
  existing: readonly SendThreadSummary[],
  freshFirstPage: readonly SendThreadSummary[],
): SendThreadSummary[] {
  const seen = new Set(freshFirstPage.map((t) => t.rootId));
  const tail = existing.filter((t) => !seen.has(t.rootId));
  return [...freshFirstPage, ...tail];
}

function updateInboxInPlace(
  existing: readonly SendThreadSummary[],
  freshFirstPage: readonly SendThreadSummary[],
): SendThreadSummary[] {
  const byId = new Map(freshFirstPage.map((t) => [t.rootId, t]));
  return existing.map((t) => byId.get(t.rootId) ?? t);
}

function appendInboxPage(
  existing: readonly SendThreadSummary[],
  pageThreads: readonly SendThreadSummary[],
): SendThreadSummary[] {
  const seen = new Set(existing.map((t) => t.rootId));
  const extra = pageThreads.filter((t) => !seen.has(t.rootId));
  return [...existing, ...extra];
}

export function inboxPollReduce(
  state: InboxPollState,
  action: InboxPollAction,
): { state: InboxPollState; command: InboxPollCommand | null } {
  if (action.type === 'pointer_enter') {
    return state.pointerOver ? { state, command: null } : { state: { ...state, pointerOver: true }, command: null };
  }

  if (action.type === 'pointer_leave') {
    if (!state.pointerOver) return { state, command: null };
    if (!state.deferredFresh) {
      return { state: { ...state, pointerOver: false }, command: null };
    }
    const fresh = state.deferredFresh;
    return {
      state: {
        ...state,
        pointerOver: false,
        deferredFresh: null,
        threads: mergeInboxRefreshOrder(state.threads, fresh.threads),
        next: state.next === null ? fresh.next : state.next,
        unread: fresh.unread,
        mentionsUnread: fresh.mentionsUnread,
      },
      command: null,
    };
  }

  if (action.type === 'mark_read') {
    const target = state.threads.find((t) => t.rootId === action.rootId) ?? null;
    if (!target || !target.unread) return { state, command: null };
    const nextThreads = state.threads.map((t) => (t.rootId === action.rootId ? { ...t, unread: false } : t));
    const nextDeferred = state.deferredFresh
      ? {
          ...state.deferredFresh,
          threads: state.deferredFresh.threads.map((t) => (t.rootId === action.rootId ? { ...t, unread: false } : t)),
          unread: Math.max(0, state.deferredFresh.unread - 1),
          mentionsUnread: target.mentioned ? Math.max(0, state.deferredFresh.mentionsUnread - 1) : state.deferredFresh.mentionsUnread,
        }
      : null;
    return {
      state: {
        ...state,
        threads: nextThreads,
        deferredFresh: nextDeferred,
        unread: Math.max(0, state.unread - 1),
        mentionsUnread: target.mentioned ? Math.max(0, state.mentionsUnread - 1) : state.mentionsUnread,
      },
      command: null,
    };
  }

  if (action.type === 'read_all_done') {
    const clearedThreads = state.threads.map((t) => (t.unread ? { ...t, unread: false } : t));
    if (state.stopped || state.closed) {
      return {
        state: {
          ...state,
          threads: clearedThreads,
          deferredFresh: null,
          unread: 0,
          mentionsUnread: 0,
          hasMoreUnread: action.more,
        },
        command: null,
      };
    }
    const nextSeq = state.seq + 1;
    if (state.inflight) {
      return {
        state: {
          ...state,
          threads: clearedThreads,
          deferredFresh: null,
          unread: 0,
          mentionsUnread: 0,
          hasMoreUnread: action.more,
          seq: nextSeq,
          pendingReload: true,
          error: null,
        },
        command: null,
      };
    }
    return {
      state: {
        ...state,
        threads: clearedThreads,
        deferredFresh: null,
        unread: 0,
        mentionsUnread: 0,
        hasMoreUnread: action.more,
        inflight: true,
        inflightKind: 'refresh',
        seq: nextSeq,
        pendingReload: false,
        error: null,
      },
      command: { kind: 'refresh', view: state.view, cursor: null, seq: nextSeq },
    };
  }

  if (action.type === 'upsert_thread') {
    const nextThreads = [action.thread, ...state.threads.filter((t) => t.rootId !== action.thread.rootId)];
    const nextDeferred = state.deferredFresh
      ? {
          ...state.deferredFresh,
          threads: [action.thread, ...state.deferredFresh.threads.filter((t) => t.rootId !== action.thread.rootId)],
        }
      : null;
    return { state: { ...state, threads: nextThreads, deferredFresh: nextDeferred }, command: null };
  }

  if (action.type === 'switch_view') {
    if (state.closed) {
      return { state, command: null };
    }
    if (action.view === state.view && state.loaded && !state.error) {
      return { state, command: null };
    }
    const nextSeq = state.seq + 1;
    if (state.inflight) {
      return {
        state: {
          ...state,
          view: action.view,
          threads: [],
          next: null,
          loaded: false,
          loadingMore: false,
          seq: nextSeq,
          pendingReload: true,
          error: null,
          deferredFresh: null,
        },
        command: null,
      };
    }
    return {
      state: {
        ...state,
        view: action.view,
        threads: [],
        next: null,
        loaded: false,
        loadingMore: false,
        inflight: true,
        inflightKind: 'refresh',
        seq: nextSeq,
        pendingReload: false,
        stopped: false,
        error: null,
        deferredFresh: null,
      },
      command: { kind: 'refresh', view: action.view, cursor: null, seq: nextSeq },
    };
  }

  if (action.type === 'more') {
    if (state.stopped || state.closed || state.inflight || !state.next) {
      return { state, command: null };
    }
    const nextSeq = state.seq + 1;
    return {
      state: {
        ...state,
        loadingMore: true,
        inflight: true,
        inflightKind: 'more',
        seq: nextSeq,
        error: null,
      },
      command: { kind: 'more', view: state.view, cursor: state.next, seq: nextSeq },
    };
  }

  if (
    action.type === 'mount' ||
    action.type === 'tick' ||
    action.type === 'focus' ||
    action.type === 'visible' ||
    action.type === 'activity' ||
    action.type === 'retry'
  ) {
    if (state.stopped || state.closed || state.inflight) return { state, command: null };
    if ((action.type === 'tick' || action.type === 'visible') && !action.visible) {
      return { state, command: null };
    }
    if (action.type === 'mount' && state.loaded) {
      return { state, command: null };
    }
    const nextSeq = state.seq + 1;
    return {
      state: {
        ...state,
        inflight: true,
        inflightKind: 'refresh',
        seq: nextSeq,
        pendingReload: false,
        error: null,
      },
      command: { kind: 'refresh', view: state.view, cursor: null, seq: nextSeq },
    };
  }

  if (action.type === 'close') {
    return {
      state: {
        ...state,
        inflight: false,
        inflightKind: null,
        loadingMore: false,
        pendingReload: false,
        hasMoreUnread: false,
        stopped: true,
        closed: true,
        error: null,
      },
      command: null,
    };
  }

  // `answer`
  if (action.seq !== state.seq) {
    if (state.pendingReload && !state.closed && !state.stopped) {
      const nextSeq = state.seq + 1;
      return {
        state: {
          ...state,
          inflight: true,
          inflightKind: 'refresh',
          seq: nextSeq,
          pendingReload: false,
        },
        command: { kind: 'refresh', view: state.view, cursor: null, seq: nextSeq },
      };
    }
    return {
      state: { ...state, inflight: false, inflightKind: null, loadingMore: false },
      command: null,
    };
  }

  if (!action.result.ok) {
    const outcome = sendRefusalOutcome(action.result.code, 'inbox');
    return {
      state: {
        ...state,
        inflight: false,
        inflightKind: null,
        loadingMore: false,
        stopped: outcome.stopPolling,
        closed: outcome.hideSend,
        error: outcome.hideSend ? null : action.result.code,
      },
      command: null,
    };
  }

  const page = action.result;
  if (action.kind === 'more') {
    return {
      state: {
        ...state,
        threads: appendInboxPage(state.threads, page.threads),
        next: page.next,
        unread: page.unread,
        mentionsUnread: page.mentionsUnread,
        loaded: true,
        loadingMore: false,
        inflight: false,
        inflightKind: null,
        error: null,
      },
      command: null,
    };
  }

  if (state.pointerOver && state.loaded && state.threads.length > 0) {
    return {
      state: {
        ...state,
        threads: updateInboxInPlace(state.threads, page.threads),
        unread: page.unread,
        mentionsUnread: page.mentionsUnread,
        inflight: false,
        inflightKind: null,
        error: null,
        deferredFresh: page,
      },
      command: null,
    };
  }

  const mergedThreads = state.loaded ? mergeInboxRefreshOrder(state.threads, page.threads) : [...page.threads];
  const nextCursor = state.loaded && state.threads.length > page.threads.length ? state.next : page.next;
  return {
    state: {
      ...state,
      threads: mergedThreads,
      next: nextCursor,
      unread: page.unread,
      mentionsUnread: page.mentionsUnread,
      loaded: true,
      loadingMore: false,
      inflight: false,
      inflightKind: null,
      error: null,
      deferredFresh: null,
    },
    command: null,
  };
}

export function inboxUnreadBadgeText(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  const n = Math.floor(count);
  return n > 99 ? '99+' : String(n);
}

/* ------------------------------------------------------------------ thread poll reducer */

export interface OptimisticSendReply {
  requestId: string;
  message: SendMessage;
}

export interface ThreadStreamItem {
  key: string;
  message: SendMessage;
  isRoot: boolean;
  pending: boolean;
}

export interface ThreadPollState {
  rootId: string | null;
  thread: SendThreadSummary | null;
  replies: SendMessage[];
  lastAnswerIds: string[];
  pendingReplies: OptimisticSendReply[];
  settledKeys: Record<string, string>;
  loaded: boolean;
  inflight: boolean;
  inflightMarkRead: boolean;
  needsMarkRead: boolean;
  visible: boolean;
  seq: number;
  pendingRootId: string | null;
  stopped: boolean;
  closed: boolean;
  gone: boolean;
  error: string | null;
}

export interface ThreadPollCommand {
  rootId: string;
  markRead: boolean;
  seq: number;
}

export type ThreadPollAction =
  | {
      type: 'open';
      rootId: string | null;
      seed?: SendThreadPage | null;
      visible?: boolean;
      closed?: boolean;
      markSeedRead?: boolean;
    }
  | { type: 'tick'; visible: boolean }
  | { type: 'focus'; visible: boolean }
  | { type: 'visible'; visible: boolean }
  | { type: 'manual'; visible: boolean }
  | {
      type: 'queue_reply';
      requestId: string;
      body: string;
      mentions: SendMention[];
      authorId: string | null;
      authorName: string | null;
      createdAt: string;
    }
  | { type: 'drop_reply'; requestId: string }
  | { type: 'apply_reply'; posted: SendPosted; requestId?: string }
  | { type: 'close' }
  | { type: 'answer'; seq: number; result: SendThreadPage | { ok: false; code: string }; visible?: boolean };

export function initialThreadPollState(
  initialRootId: string | null = null,
  seed: SendThreadPage | null = null,
  initialGone = false,
  initialClosed = false,
  initialNeedsMarkRead = false,
): ThreadPollState {
  return {
    rootId: seed?.thread.rootId ?? initialRootId,
    thread: seed?.thread ?? null,
    replies: seed ? [...seed.replies] : [],
    lastAnswerIds: seed ? seed.replies.map((r) => r.id) : [],
    pendingReplies: [],
    settledKeys: {},
    loaded: seed !== null,
    inflight: false,
    inflightMarkRead: false,
    needsMarkRead: Boolean(seed && initialNeedsMarkRead && !initialGone && !initialClosed),
    visible: true,
    seq: 0,
    pendingRootId: null,
    stopped: initialGone || initialClosed,
    closed: initialClosed,
    gone: initialGone,
    error: initialGone && !initialClosed ? 'not_found' : null,
  };
}

export function threadPollIntervalMs(visible: boolean): number {
  return visible ? ROOM_POLL_VISIBLE_MS : ROOM_POLL_HIDDEN_MS;
}

function pendingReplyKey(requestId: string): string {
  return `pending:${requestId}`;
}

function normalizeReplyMatchBody(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function settlePendingFromReplies(
  pendingReplies: readonly OptimisticSendReply[],
  settledKeys: Readonly<Record<string, string>>,
  lastAnswerIds: readonly string[],
  serverReplies: readonly SendMessage[],
): { pendingReplies: OptimisticSendReply[]; settledKeys: Record<string, string> } {
  if (pendingReplies.length === 0 || serverReplies.length === 0) {
    return { pendingReplies: [...pendingReplies], settledKeys: { ...settledKeys } };
  }
  const nextSettledKeys: Record<string, string> = { ...settledKeys };
  const prevIds = new Set<string>(lastAnswerIds);
  const usedIds = new Set<string>(Object.keys(nextSettledKeys));
  const nextPending: OptimisticSendReply[] = [];

  for (const entry of pendingReplies) {
    const targetBody = normalizeReplyMatchBody(entry.message.body);
    const match = serverReplies.find((reply) => {
      if (prevIds.has(reply.id) || usedIds.has(reply.id) || !reply.mine) return false;
      if (entry.message.authorId && reply.authorId !== entry.message.authorId) return false;
      return normalizeReplyMatchBody(reply.body) === targetBody;
    });
    if (match) {
      usedIds.add(match.id);
      nextSettledKeys[match.id] = pendingReplyKey(entry.requestId);
    } else {
      nextPending.push(entry);
    }
  }
  return { pendingReplies: nextPending, settledKeys: nextSettledKeys };
}

function mergeReply(replies: readonly SendMessage[], incoming: SendMessage): SendMessage[] {
  const byId = new Map(replies.map((r) => [r.id, r]));
  byId.set(incoming.id, incoming);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function threadStreamItems(
  thread: SendThreadSummary,
  replies: readonly SendMessage[],
  pendingReplies: readonly OptimisticSendReply[],
  settledKeys: Readonly<Record<string, string>>,
): ThreadStreamItem[] {
  const items: ThreadStreamItem[] = [{ key: thread.root.id, message: thread.root, isRoot: true, pending: false }];
  for (const reply of replies) {
    items.push({
      key: settledKeys[reply.id] ?? reply.id,
      message: reply,
      isRoot: false,
      pending: false,
    });
  }
  for (const entry of pendingReplies) {
    items.push({
      key: entry.message.id,
      message: entry.message,
      isRoot: false,
      pending: true,
    });
  }
  return items;
}

export function threadPollReduce(
  state: ThreadPollState,
  action: ThreadPollAction,
): { state: ThreadPollState; command: ThreadPollCommand | null } {
  if (action.type === 'open') {
    const vis = action.visible ?? state.visible;
    if (action.closed || state.closed) {
      return {
        state: {
          rootId: action.rootId,
          thread: null,
          replies: [],
          lastAnswerIds: [],
          pendingReplies: [],
          settledKeys: {},
          loaded: false,
          inflight: state.inflight,
          inflightMarkRead: state.inflightMarkRead,
          needsMarkRead: false,
          visible: vis,
          seq: state.seq + 1,
          pendingRootId: null,
          stopped: true,
          closed: true,
          gone: false,
          error: null,
        },
        command: null,
      };
    }
    if (!action.rootId) {
      return {
        state: {
          rootId: null,
          thread: null,
          replies: [],
          lastAnswerIds: [],
          pendingReplies: [],
          settledKeys: {},
          loaded: false,
          inflight: state.inflight,
          inflightMarkRead: state.inflightMarkRead,
          needsMarkRead: false,
          visible: vis,
          seq: state.seq + 1,
          pendingRootId: null,
          stopped: false,
          closed: false,
          gone: false,
          error: null,
        },
        command: null,
      };
    }

    const sameRoot = state.rootId !== null && state.rootId.toLowerCase() === action.rootId.toLowerCase();
    if (sameRoot && (state.loaded || state.inflight || state.gone) && !state.closed) {
      if (state.needsMarkRead && vis && !state.inflight && !state.gone) {
        const nextSeq = state.seq + 1;
        return {
          state: {
            ...state,
            visible: true,
            inflight: true,
            inflightMarkRead: true,
            needsMarkRead: false,
            seq: nextSeq,
          },
          command: { rootId: state.rootId!, markRead: true, seq: nextSeq },
        };
      }
      return state.visible !== vis ? { state: { ...state, visible: vis }, command: null } : { state, command: null };
    }

    const nextSeq = state.seq + 1;
    if (action.seed && action.seed.thread.rootId.toLowerCase() === action.rootId.toLowerCase()) {
      if (action.markSeedRead && vis && !state.inflight) {
        return {
          state: {
            rootId: action.rootId,
            thread: action.seed.thread,
            replies: [...action.seed.replies],
            lastAnswerIds: action.seed.replies.map((r) => r.id),
            pendingReplies: [],
            settledKeys: {},
            loaded: true,
            inflight: true,
            inflightMarkRead: true,
            needsMarkRead: false,
            visible: vis,
            seq: nextSeq,
            pendingRootId: null,
            stopped: false,
            closed: false,
            gone: false,
            error: null,
          },
          command: { rootId: action.rootId, markRead: true, seq: nextSeq },
        };
      }
      return {
        state: {
          rootId: action.rootId,
          thread: action.seed.thread,
          replies: [...action.seed.replies],
          lastAnswerIds: action.seed.replies.map((r) => r.id),
          pendingReplies: [],
          settledKeys: {},
          loaded: true,
          inflight: state.inflight,
          inflightMarkRead: state.inflightMarkRead,
          needsMarkRead: Boolean(action.markSeedRead && !vis),
          visible: vis,
          seq: nextSeq,
          pendingRootId: null,
          stopped: false,
          closed: false,
          gone: false,
          error: null,
        },
        command: null,
      };
    }

    if (state.inflight) {
      return {
        state: {
          rootId: action.rootId,
          thread: null,
          replies: [],
          lastAnswerIds: [],
          pendingReplies: [],
          settledKeys: {},
          loaded: false,
          inflight: true,
          inflightMarkRead: state.inflightMarkRead,
          needsMarkRead: !vis,
          visible: vis,
          seq: nextSeq,
          pendingRootId: action.rootId,
          stopped: false,
          closed: false,
          gone: false,
          error: null,
        },
        command: null,
      };
    }

    return {
      state: {
        rootId: action.rootId,
        thread: null,
        replies: [],
        lastAnswerIds: [],
        pendingReplies: [],
        settledKeys: {},
        loaded: false,
        inflight: true,
        inflightMarkRead: vis,
        needsMarkRead: !vis,
        visible: vis,
        seq: nextSeq,
        pendingRootId: null,
        stopped: false,
        closed: false,
        gone: false,
        error: null,
      },
      command: { rootId: action.rootId, markRead: vis, seq: nextSeq },
    };
  }

  if (action.type === 'queue_reply') {
    if (!state.rootId) return { state, command: null };
    const id = pendingReplyKey(action.requestId);
    const optimistic: SendMessage = {
      id,
      rootId: state.rootId,
      parentId: state.rootId,
      authorId: action.authorId,
      authorName: action.authorName,
      mine: true,
      body: action.body,
      mentions: [...action.mentions],
      createdAt: action.createdAt,
    };
    const nextPending = [
      ...state.pendingReplies.filter((item) => item.requestId !== action.requestId),
      { requestId: action.requestId, message: optimistic },
    ];
    return {
      state: {
        ...state,
        pendingReplies: nextPending,
      },
      command: null,
    };
  }

  if (action.type === 'drop_reply') {
    const nextPending = state.pendingReplies.filter((item) => item.requestId !== action.requestId);
    if (nextPending.length === state.pendingReplies.length) {
      return { state, command: null };
    }
    return {
      state: {
        ...state,
        pendingReplies: nextPending,
      },
      command: null,
    };
  }

  if (action.type === 'apply_reply') {
    if (!state.rootId || state.rootId.toLowerCase() !== action.posted.thread.rootId.toLowerCase()) {
      return { state, command: null };
    }
    const nextPending = action.requestId
      ? state.pendingReplies.filter((item) => item.requestId !== action.requestId)
      : state.pendingReplies;
    let nextKeys = state.settledKeys;
    if (action.requestId) {
      const targetKey = pendingReplyKey(action.requestId);
      const updated: Record<string, string> = {};
      for (const [id, key] of Object.entries(state.settledKeys)) {
        if (key !== targetKey) {
          updated[id] = key;
        }
      }
      updated[action.posted.message.id] = targetKey;
      nextKeys = updated;
    }
    const nextLastAnswerIds = state.lastAnswerIds.includes(action.posted.message.id)
      ? state.lastAnswerIds
      : [...state.lastAnswerIds, action.posted.message.id];
    return {
      state: {
        ...state,
        seq: state.seq + 1,
        thread: action.posted.thread,
        replies: mergeReply(state.replies, action.posted.message),
        lastAnswerIds: nextLastAnswerIds,
        pendingReplies: nextPending,
        settledKeys: nextKeys,
      },
      command: null,
    };
  }

  if (action.type === 'tick' || action.type === 'focus' || action.type === 'visible' || action.type === 'manual') {
    if (!state.rootId || state.stopped || state.closed || state.gone) {
      return { state, command: null };
    }
    if (state.inflight) {
      return state.visible !== action.visible
        ? { state: { ...state, visible: action.visible }, command: null }
        : { state, command: null };
    }
    if ((action.type === 'focus' || action.type === 'visible') && !action.visible) {
      return state.visible !== action.visible
        ? { state: { ...state, visible: action.visible }, command: null }
        : { state, command: null };
    }
    const nextSeq = state.seq + 1;
    const markRead = action.visible;
    return {
      state: {
        ...state,
        visible: action.visible,
        inflight: true,
        inflightMarkRead: markRead,
        needsMarkRead: markRead ? false : state.needsMarkRead,
        seq: nextSeq,
      },
      command: { rootId: state.rootId, markRead, seq: nextSeq },
    };
  }

  if (action.type === 'close') {
    return {
      state: {
        ...state,
        inflight: false,
        inflightMarkRead: false,
        needsMarkRead: false,
        seq: state.seq + 1,
        pendingRootId: null,
        stopped: true,
        closed: true,
        error: null,
      },
      command: null,
    };
  }

  // `answer`
  const vis = action.visible ?? state.visible;
  if (action.seq !== state.seq) {
    if (state.pendingRootId && !state.closed && !state.stopped) {
      const nextSeq = state.seq + 1;
      const target = state.pendingRootId;
      return {
        state: {
          ...state,
          visible: vis,
          inflight: true,
          inflightMarkRead: vis,
          needsMarkRead: !vis,
          seq: nextSeq,
          pendingRootId: null,
        },
        command: { rootId: target, markRead: vis, seq: nextSeq },
      };
    }
    return {
      state: { ...state, visible: vis, inflight: false, inflightMarkRead: false, pendingRootId: null },
      command: null,
    };
  }

  if (!action.result.ok) {
    const outcome = sendRefusalOutcome(action.result.code, 'thread');
    return {
      state: {
        ...state,
        visible: vis,
        inflight: false,
        inflightMarkRead: false,
        needsMarkRead: outcome.stopPolling ? false : state.needsMarkRead,
        stopped: outcome.stopPolling,
        closed: outcome.hideSend,
        gone: action.result.code === 'not_found',
        error: outcome.hideSend ? null : action.result.code,
      },
      command: null,
    };
  }

  const settled = settlePendingFromReplies(
    state.pendingReplies,
    state.settledKeys,
    state.lastAnswerIds,
    action.result.replies,
  );
  const nextLastAnswerIds = action.result.replies.map((r) => r.id);
  const followUpMarkRead =
    state.needsMarkRead && !state.inflightMarkRead && vis && !state.closed && !state.stopped && Boolean(state.rootId);
  if (followUpMarkRead) {
    const nextSeq = state.seq + 1;
    return {
      state: {
        ...state,
        visible: vis,
        thread: action.result.thread,
        replies: [...action.result.replies],
        lastAnswerIds: nextLastAnswerIds,
        pendingReplies: settled.pendingReplies,
        settledKeys: settled.settledKeys,
        loaded: true,
        inflight: true,
        inflightMarkRead: true,
        needsMarkRead: false,
        seq: nextSeq,
        gone: false,
        error: null,
      },
      command: { rootId: state.rootId!, markRead: true, seq: nextSeq },
    };
  }

  return {
    state: {
      ...state,
      visible: vis,
      thread: action.result.thread,
      replies: [...action.result.replies],
      lastAnswerIds: nextLastAnswerIds,
      pendingReplies: settled.pendingReplies,
      settledKeys: settled.settledKeys,
      loaded: true,
      inflight: false,
      inflightMarkRead: false,
      needsMarkRead: state.inflightMarkRead ? false : state.needsMarkRead,
      gone: false,
      error: null,
    },
    command: null,
  };
}

/* ------------------------------------------------------------------ display words & links */

export function inboxThreadHref(organizationId: string, rootId: string): string {
  const params = new URLSearchParams({
    organizationId: organizationId.toLowerCase(),
    thread: rootId.toLowerCase(),
  });
  return `/brand/inbox?${params.toString()}`;
}

function fileOpenHref(file: SendFileCard, organizationId: string): string | null {
  if (!file.available) return null;
  const orgParam = encodeURIComponent(organizationId);
  if (file.ref.kind === 'asset') {
    return `/brand/library?organizationId=${orgParam}`;
  }
  const viewParam = encodeURIComponent(`o:${file.ref.outputId}`);
  if (file.kind === 'video') {
    return `/brand/studio/video?organizationId=${orgParam}&view=${viewParam}`;
  }
  if (file.kind === 'audio') {
    return `/brand/studio/sound?organizationId=${orgParam}`;
  }
  return `/brand/studio?organizationId=${orgParam}&view=${viewParam}`;
}

export interface FileCardInfo {
  available: boolean;
  title: string;
  subtitle: string | null;
  thumbUrl: string | null;
  openHref: string | null;
}

export function fileCardInfo(file: SendFileCard, organizationId: string, copy: SendCopy): FileCardInfo {
  if (!file.available) {
    return {
      available: false,
      title: copy.fileGone,
      subtitle: null,
      thumbUrl: null,
      openHref: null,
    };
  }
  const kindLabel =
    file.kind === 'video' ? copy.kindVideo : file.kind === 'audio' ? copy.kindSound : copy.kindImage;
  const sourceLabel = file.ref.kind === 'output' ? copy.sourceGenerated : copy.sourceUpload;
  const projectLabel = file.project?.title ?? copy.unfiled;
  const thumbUrl = file.kind === 'audio' ? null : file.kind === 'image' ? (file.thumbUrl ?? file.url) : file.thumbUrl;
  return {
    available: true,
    title: file.name?.trim() || kindLabel,
    subtitle: `${projectLabel} · ${sourceLabel}`,
    thumbUrl,
    openHref: fileOpenHref(file, organizationId),
  };
}

export interface ThreadRowWords {
  actorName: string;
  projectLabel: string;
  line: string;
  time: string;
  thumbUrl: string | null;
  replyCountText: string | null;
  mentioned: boolean;
  unread: boolean;
}

export function threadRowWords(
  thread: SendThreadSummary,
  copy: SendCopy,
  locale: SendLocale,
  now = new Date(),
): ThreadRowWords {
  const isReplyLatest = thread.latest.messageId !== thread.root.id;
  const actorName = thread.latest.authorName?.trim() || copy.someone;
  const projectLabel = thread.file.available ? (thread.file.project?.title ?? copy.unfiled) : copy.fileGone;
  const rawLine = thread.latest.line;
  const line = isReplyLatest ? `${copy.replyLead} ${rawLine}` : rawLine;
  const thumbUrl =
    thread.file.available && thread.file.kind !== 'audio'
      ? thread.file.kind === 'image'
        ? (thread.file.thumbUrl ?? thread.file.url)
        : thread.file.thumbUrl
      : null;
  const replyCountText =
    thread.replyCount > 0 ? formatTemplate(copy.replyCount, { n: thread.replyCount }) : null;

  return {
    actorName,
    projectLabel,
    line,
    time: formatRelativeTime(thread.lastActivityAt, locale, now),
    thumbUrl,
    replyCountText,
    mentioned: thread.mentioned,
    unread: thread.unread,
  };
}

export function threadHeadLead(authorName: string | null | undefined, copy: Pick<SendCopy, 'threadLead' | 'threadLeadAnon'>): string {
  const trimmed = authorName?.trim();
  return trimmed ? formatTemplate(copy.threadLead, { name: trimmed }) : copy.threadLeadAnon;
}

export function splitSendMentionRuns(
  body: string,
  mentions: readonly SendMention[],
): Array<{ text: string; mention: boolean }> {
  const tokens = [...new Set(mentions.map((m) => m.name).filter((n): n is string => Boolean(n)))].sort(
    (a, b) => b.length - a.length,
  );
  if (tokens.length === 0) return body ? [{ text: body, mention: false }] : [];
  const runs: Array<{ text: string; mention: boolean }> = [];
  let rest = body;
  while (rest.length > 0) {
    let at = -1;
    let hit = '';
    for (const token of tokens) {
      const index = rest.indexOf(`@${token}`);
      if (index !== -1 && (at === -1 || index < at)) {
        at = index;
        hit = `@${token}`;
      }
    }
    if (at === -1) {
      runs.push({ text: rest, mention: false });
      break;
    }
    if (at > 0) runs.push({ text: rest.slice(0, at), mention: false });
    runs.push({ text: hit, mention: true });
    rest = rest.slice(at + hit.length);
  }
  return runs;
}

export function initialChar(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : '·';
}

const KST_TIMEZONE = 'Asia/Seoul';

function seoulDayStamp(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: KST_TIMEZONE,
  }).format(date);
}

export function formatSendClock(iso: string, locale: SendLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  return new Intl.DateTimeFormat(tag, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: KST_TIMEZONE,
  }).format(date);
}

export function formatSendFullTime(iso: string, locale: SendLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  return new Intl.DateTimeFormat(tag, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: KST_TIMEZONE,
  }).format(date);
}

export function formatThreadDay(
  iso: string,
  locale: SendLocale,
  copy: Pick<SendCopy, 'today' | 'yesterday'>,
  now = new Date(),
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const key = seoulDayStamp(date);
  const nowKey = seoulDayStamp(now);
  if (key === nowKey) return copy.today;
  if (key === seoulDayStamp(new Date(now.getTime() - 86_400_000))) return copy.yesterday;
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  const sameYear = key.slice(0, 4) === nowKey.slice(0, 4);
  return new Intl.DateTimeFormat(tag, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    timeZone: KST_TIMEZONE,
  }).format(date);
}

/* ------------------------------------------------------------------ viewer send panel (Batch C) */

export type SendViewerItemLike =
  | {
      type: 'output';
      output: { id: string; url: string };
      job: { kind: string; model: string; purpose?: string };
    }
  | {
      type: 'asset';
      asset: { id: string; url: string };
    };

const SENDABLE_OUTPUT_KINDS = new Set([
  'image',
  'region_edit',
  'video',
  'video_remix',
  'video_final',
  'music',
  'sound_effect',
]);

/** Maps a viewer item to its contract `SendFileRef`, or null for fill strips and editor exports. */
export function viewerItemToSendRef(item: SendViewerItemLike | null | undefined): SendFileRef | null {
  if (!item) return null;
  if (item.type === 'asset') {
    return item.asset.id && item.asset.url ? { kind: 'asset', assetId: item.asset.id } : null;
  }
  if (item.job.purpose === 'fill' || item.job.model === 'compose-1080p') return null;
  if (!SENDABLE_OUTPUT_KINDS.has(item.job.kind)) return null;
  if (!item.output.id || !item.output.url) return null;
  return { kind: 'output', outputId: item.output.id };
}

export function sendFileRefKey(ref: SendFileRef): string {
  return ref.kind === 'output' ? `output:${ref.outputId.toLowerCase()}` : `asset:${ref.assetId.toLowerCase()}`;
}

export interface SendFilePendingPost {
  requestId: string;
  body: string;
  createdAt: string;
  authorName: string;
}

export interface SendFileState {
  fileKey: string | null;
  loaded: boolean;
  loading: boolean;
  seq: number;
  file: SendFileCard | null;
  threads: SendThreadSummary[];
  pendingPosts: SendFilePendingPost[];
  settledKeys: Record<string, string>;
  unsendable: boolean;
  postGone: boolean;
  closed: boolean;
  error: string | null;
}

export type SendFileAction =
  | { type: 'start'; fileKey: string }
  | { type: 'answer'; seq: number; result: SendFileThreads | { ok: false; code: string } }
  | { type: 'queue_post'; requestId: string; body: string; createdAt: string; authorName: string }
  | { type: 'apply_post'; requestId?: string; posted: SendPosted }
  | { type: 'drop_post'; requestId: string }
  | { type: 'post_gone' };

export function initialSendFileState(
  fileKey: string | null,
  initial?: SendFileThreads | null,
): SendFileState {
  return {
    fileKey,
    loaded: Boolean(initial),
    loading: false,
    seq: 0,
    file: initial?.file ?? null,
    threads: initial ? [...initial.threads] : [],
    pendingPosts: [],
    settledKeys: {},
    unsendable: false,
    postGone: false,
    closed: false,
    error: null,
  };
}

export function sendFileReduce(
  state: SendFileState,
  action: SendFileAction,
): { state: SendFileState; command: { fileKey: string; seq: number } | null } {
  if (action.type === 'start') {
    const nextSeq = state.seq + 1;
    const sameFile = state.fileKey === action.fileKey;
    return {
      state: {
        fileKey: action.fileKey,
        loaded: sameFile ? state.loaded : false,
        loading: true,
        seq: nextSeq,
        file: sameFile ? state.file : null,
        threads: sameFile ? [...state.threads] : [],
        pendingPosts: sameFile ? [...state.pendingPosts] : [],
        settledKeys: sameFile ? { ...state.settledKeys } : {},
        unsendable: false,
        postGone: sameFile ? state.postGone : false,
        closed: false,
        error: null,
      },
      command: { fileKey: action.fileKey, seq: nextSeq },
    };
  }

  if (action.type === 'post_gone') {
    return {
      state: {
        ...state,
        postGone: true,
        error: null,
      },
      command: null,
    };
  }

  if (action.type === 'queue_post') {
    if (state.pendingPosts.some((p) => p.requestId === action.requestId)) {
      return { state, command: null };
    }
    const next: SendFilePendingPost = {
      requestId: action.requestId,
      body: action.body,
      createdAt: action.createdAt,
      authorName: action.authorName,
    };
    return {
      state: {
        ...state,
        pendingPosts: [next, ...state.pendingPosts],
      },
      command: null,
    };
  }

  if (action.type === 'apply_post') {
    const nextPending = action.requestId
      ? state.pendingPosts.filter((p) => p.requestId !== action.requestId)
      : state.pendingPosts;
    const settledKeys =
      action.requestId && !state.settledKeys[action.posted.thread.rootId]
        ? { ...state.settledKeys, [action.posted.thread.rootId]: `pending:${action.requestId}` }
        : state.settledKeys;
    const idx = state.threads.findIndex((t) => t.rootId === action.posted.thread.rootId);
    const nextThreads =
      idx === -1
        ? [action.posted.thread, ...state.threads]
        : state.threads.map((t, i) => (i === idx ? action.posted.thread : t));
    return {
      state: {
        ...state,
        file: state.file ?? action.posted.thread.file,
        threads: nextThreads,
        pendingPosts: nextPending,
        settledKeys,
        error: null,
      },
      command: null,
    };
  }

  if (action.type === 'drop_post') {
    return {
      state: {
        ...state,
        pendingPosts: state.pendingPosts.filter((p) => p.requestId !== action.requestId),
      },
      command: null,
    };
  }

  // `answer`
  if (action.seq !== state.seq) {
    return { state, command: null };
  }
  if (!action.result.ok) {
    if (action.result.code === 'not_found') {
      return {
        state: {
          ...state,
          loading: false,
          loaded: true,
          unsendable: true,
          postGone: false,
          error: null,
        },
        command: null,
      };
    }
    const outcome = sendRefusalOutcome(action.result.code, 'file');
    return {
      state: {
        ...state,
        loading: false,
        postGone: false,
        closed: outcome.hideSend,
        error: outcome.hideSend ? null : action.result.code,
      },
      command: null,
    };
  }

  // Preserve any thread just posted locally while initial send.file was in flight.
  const serverIds = new Set(action.result.threads.map((t) => t.rootId));
  const localOnly = state.threads.filter((t) => !serverIds.has(t.rootId));
  return {
    state: {
      ...state,
      loading: false,
      loaded: true,
      file: action.result.file,
      threads: [...localOnly, ...action.result.threads],
      unsendable: false,
      closed: false,
      error: null,
    },
    command: null,
  };
}

export interface SendFileItem {
  key: string;
  pending: boolean;
  thread: SendThreadSummary;
}

export function sendFileItems(
  threads: readonly SendThreadSummary[],
  pendingPosts: readonly SendFilePendingPost[],
  settledKeys: Readonly<Record<string, string>>,
): SendFileItem[] {
  const out: SendFileItem[] = [];
  const seen = new Set<string>();
  const fallbackRef: SendFileRef = threads[0]?.file.ref ?? { kind: 'asset', assetId: '00000000-0000-4000-8000-000000000000' };
  const fallbackCard: SendFileCard = threads[0]?.file ?? {
    ref: fallbackRef,
    available: true,
    kind: null,
    name: null,
    url: null,
    thumbUrl: null,
    width: null,
    height: null,
    project: null,
  };

  for (const p of pendingPosts) {
    out.push({
      key: `pending:${p.requestId}`,
      pending: true,
      thread: {
        rootId: p.requestId,
        root: {
          id: p.requestId,
          rootId: p.requestId,
          parentId: null,
          authorId: null,
          authorName: p.authorName,
          mine: true,
          body: p.body,
          mentions: [],
          createdAt: p.createdAt,
        },
        file: fallbackCard,
        replyCount: 0,
        lastActivityAt: p.createdAt,
        latest: {
          messageId: p.requestId,
          authorId: null,
          authorName: p.authorName,
          mine: true,
          line: p.body,
          at: p.createdAt,
        },
        mentioned: false,
        unread: false,
        lastReadAt: p.createdAt,
      },
    });
  }

  for (const t of threads) {
    if (seen.has(t.rootId)) continue;
    seen.add(t.rootId);
    out.push({
      key: settledKeys[t.rootId] ?? t.rootId,
      pending: false,
      thread: t,
    });
  }
  return out;
}

export interface SendPanelLineWords {
  who: string;
  firstWords: string;
  time: string;
  replyCountText: string | null;
}

export function sendPanelLineWords(
  thread: SendThreadSummary,
  copy: Pick<SendCopy, 'you' | 'someone' | 'replyCount'>,
  locale: SendLocale,
  now = new Date(),
): SendPanelLineWords {
  const who = thread.root.authorName?.trim() || (thread.root.mine ? copy.you : copy.someone);
  const firstWords = thread.root.body.replace(/\s+/g, ' ').trim();
  const time = formatRelativeTime(thread.lastActivityAt, locale, now);
  const replyCountText = thread.replyCount > 0 ? formatTemplate(copy.replyCount, { n: thread.replyCount }) : null;
  return { who, firstWords, time, replyCountText };
}
