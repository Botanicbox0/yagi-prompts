/**
 * Pure polling state machine and display rules for the 직접 만들기 bell and rail 알림함 row
 * (docs/BRAND-PROJECT-SPINE.md §5.1, §8.1, §8.4; slice 3a).
 *
 * No React, DOM, or server imports so every transition and text composition is unit-tested directly.
 */
import { formatRelativeTime } from '@/components/brand-studio/project-chip/model';
import type { StudioLocale } from '@/components/brand-studio/copy';
import { GENERAL_CHANNEL } from '@/lib/brand-rooms/message-contracts';
import type { SendFileCard, SendInboxView } from '@/lib/brand-rooms/send-contracts';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';

export const BELL_POLL_MS = 20_000;
export const BELL_WINDOW_MAX = 20;

export interface BellCopy {
  bellTitle: string;
  bellCount: string;
  bellMarkRead: string;
  bellSeeAll: string;
  bellEmpty: string;
  general: string;
  generalHint: string;
  noMessages: string;
  unread: string;
  alertStoryboard: string;
  alertReview: string;
  alertReviewNotes: string;
}

export function pickBellCopy(dict: Pick<Dictionary, 'projectHome' | 'roomsChat'>): BellCopy {
  return {
    bellTitle: dict.projectHome.bellTitle,
    bellCount: dict.projectHome.bellCount,
    bellMarkRead: dict.projectHome.bellMarkRead,
    bellSeeAll: dict.projectHome.bellSeeAll,
    bellEmpty: dict.projectHome.bellEmpty,
    general: dict.roomsChat.inbox.general,
    generalHint: dict.roomsChat.inbox.generalHint,
    noMessages: dict.roomsChat.inbox.noMessages,
    unread: dict.roomsChat.inbox.unread,
    alertStoryboard: dict.roomsChat.inbox.alertStoryboard,
    alertReview: dict.roomsChat.inbox.alertReview,
    alertReviewNotes: dict.roomsChat.inbox.alertReviewNotes,
  };
}

export interface BellSendCopy {
  viewAll: string;
  viewMentions: string;
  mentionMark: string;
  markAllRead: string;
  inboxMentionsEmpty: string;
  fileGone: string;
  unfiled: string;
  someone: string;
  loading: string;
}

export function pickBellSendCopy(
  dict: Pick<Dictionary, 'brandSend' | 'roomsChat' | 'projectSpine'>,
): BellSendCopy {
  return {
    viewAll: dict.roomsChat.inbox.filters.all,
    viewMentions: dict.brandSend.viewMentions,
    mentionMark: dict.brandSend.mentionMark,
    markAllRead: dict.brandSend.markAllRead,
    inboxMentionsEmpty: dict.brandSend.inboxMentionsEmpty,
    fileGone: dict.brandSend.fileGone,
    unfiled: dict.projectSpine.unfiled,
    someone: dict.roomsChat.author.someone,
    loading: dict.roomsChat.channel.loading,
  };
}

/** Permanent stops on this page (matches contract §7 / useRoomUnread 401·404 stop rule). */
export const BELL_STOP_CODES: ReadonlySet<string> = new Set(['rooms_closed', 'not_found', 'sign_in_required']);

export type BellLineKind = 'storyboard' | 'review' | 'conversation' | 'thread';

export interface BellItem {
  id: string;
  kind: BellLineKind;
  projectId: string | null;
  projectTitle: string | null;
  title: string | null;
  line: string | null;
  version: number | null;
  openNotes: number;
  unreadCount: number;
  at: string;
  unread: boolean;
  thumbUrl: string | null;
  href: string;
  rootId?: string;
  mentioned?: boolean;
  actorName?: string | null;
  file?: SendFileCard;
}

export interface BellState {
  unread: number;
  items: BellItem[];
  more: boolean;
  view?: SendInboxView;
  mentionsUnread?: number;
}

export interface BellPollMachine {
  organizationId: string | null;
  active: boolean;
  seq: number;
  bell: BellState | null;
  inflight: boolean;
  stopped: boolean;
}

export type BellPollReason = 'mount' | 'tick' | 'activity' | 'focus' | 'visible' | 'manual';

export type BellPollAnswer = { ok: true; bell?: BellState } | { ok: false; code: string };

export type BellPollAction =
  | { type: 'activate'; organizationId: string }
  | { type: 'deactivate' }
  | { type: 'trigger'; reason: BellPollReason; visible: boolean }
  | { type: 'answer'; organizationId: string; seq: number; result: BellPollAnswer };

/** Active only when the selected workspace is a server-eligible candidate and the rail mode is 직접 만들기. */
export function bellActive(input: {
  candidates: readonly string[];
  organizationId: string | null | undefined;
  mode: 'make' | 'team' | null | undefined;
}): boolean {
  if (!input.organizationId || input.mode !== 'make') return false;
  const target = input.organizationId.toLowerCase();
  return input.candidates.some((id) => id.toLowerCase() === target);
}

export function initialBellPollState(): BellPollMachine {
  return { organizationId: null, active: false, seq: 0, bell: null, inflight: false, stopped: false };
}

function shouldReadForTrigger(
  state: Pick<BellPollMachine, 'active' | 'inflight' | 'stopped'>,
  reason: BellPollReason,
  visible: boolean,
): boolean {
  if (!state.active || state.stopped || state.inflight) return false;
  if ((reason === 'tick' || reason === 'visible') && !visible) return false;
  return true;
}

export function bellPollReduce(state: BellPollMachine, action: BellPollAction): { state: BellPollMachine; shouldRead: boolean } {
  if (action.type === 'deactivate') {
    if (!state.active && state.organizationId === null && state.bell === null && !state.inflight && !state.stopped) {
      return { state, shouldRead: false };
    }
    return {
      state: {
        organizationId: null,
        active: false,
        seq: state.seq + 1,
        bell: null,
        inflight: false,
        stopped: false,
      },
      shouldRead: false,
    };
  }
  if (action.type === 'activate') {
    const sameOrg = state.organizationId !== null && state.organizationId.toLowerCase() === action.organizationId.toLowerCase();
    if (state.active && sameOrg && !state.stopped) {
      return { state, shouldRead: false };
    }
    const nextSeq = state.seq + 1;
    return {
      state: {
        organizationId: action.organizationId,
        active: true,
        seq: nextSeq,
        bell: null,
        inflight: true,
        stopped: false,
      },
      shouldRead: true,
    };
  }
  if (action.type === 'trigger') {
    if (!shouldReadForTrigger(state, action.reason, action.visible)) return { state, shouldRead: false };
    return { state: { ...state, seq: state.seq + 1, inflight: true }, shouldRead: true };
  }
  // Ignore stale/out-of-sequence answers after org/mode switches or permanent deactivation.
  if (
    !state.active ||
    state.stopped ||
    action.seq !== state.seq ||
    state.organizationId === null ||
    state.organizationId.toLowerCase() !== action.organizationId.toLowerCase()
  ) {
    return { state, shouldRead: false };
  }
  if (action.result.ok) {
    if (!action.result.bell) {
      return { state: { ...state, active: false, bell: null, inflight: false, stopped: true }, shouldRead: false };
    }
    return { state: { ...state, bell: action.result.bell, inflight: false, stopped: false }, shouldRead: false };
  }
  if (BELL_STOP_CODES.has(action.result.code)) {
    return { state: { ...state, active: false, bell: null, inflight: false, stopped: true }, shouldRead: false };
  }
  return { state: { ...state, inflight: false }, shouldRead: false };
}

/** The rail's 알림함 badge count comes straight from `bell.unread` (never derived from `items`). */
export function bellInboxCount(bell: Pick<BellState, 'unread'> | null | undefined): number {
  if (!bell || typeof bell.unread !== 'number' || !Number.isFinite(bell.unread) || bell.unread <= 0) return 0;
  return Math.floor(bell.unread);
}

export function bellBadgeText(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  const count = Math.floor(unread);
  return count > 99 ? '99+' : String(count);
}

export function bellAccessibleLabel(unread: number, copy: Pick<Dictionary['projectHome'], 'bellTitle' | 'bellCount'>): string {
  return unread > 0 ? interpolate(copy.bellCount, { n: Math.floor(unread) }) : copy.bellTitle;
}

export function bellLineProjectLabel(
  item: Pick<BellItem, 'kind' | 'projectId' | 'projectTitle' | 'file'>,
  generalLabel: string,
  sendCopy?: Pick<BellSendCopy, 'fileGone' | 'unfiled'> | null,
): string {
  if (item.kind === 'thread' && sendCopy) {
    if (item.file && !item.file.available) return sendCopy.fileGone;
    return item.projectTitle ?? sendCopy.unfiled;
  }
  return item.projectId === null ? generalLabel : (item.projectTitle ?? '');
}

export function bellThreadActorName(
  item: Pick<BellItem, 'actorName'>,
  sendCopy?: Pick<BellSendCopy, 'someone'> | null,
): string {
  return item.actorName?.trim() || sendCopy?.someone || '';
}

type BellInboxCopy = Pick<
  Dictionary['roomsChat']['inbox'],
  'alertStoryboard' | 'alertReview' | 'alertReviewNotes' | 'generalHint' | 'noMessages'
>;

export function bellLineText(
  item: Pick<BellItem, 'kind' | 'projectId' | 'line' | 'version' | 'openNotes'>,
  copy: BellInboxCopy,
  options?: { sendOpen?: boolean },
): string {
  if (item.kind === 'storyboard') {
    return interpolate(copy.alertStoryboard, { version: item.version ?? 1 });
  }
  if (item.kind === 'review') {
    const version = item.version ?? 1;
    return item.openNotes > 0
      ? interpolate(copy.alertReviewNotes, { version, count: item.openNotes })
      : interpolate(copy.alertReview, { version });
  }
  if (options?.sendOpen && item.kind === 'thread') return item.line ?? '';
  if (item.line !== null && item.line !== '') return item.line;
  return item.projectId === null ? copy.generalHint : copy.noMessages;
}

export function bellCanMarkRead(
  item: Pick<BellItem, 'kind' | 'unread'>,
  options?: { sendOpen?: boolean },
): boolean {
  if (!item.unread) return false;
  if (item.kind === 'conversation') return true;
  return Boolean(options?.sendOpen && item.kind === 'thread');
}

export function bellMarkReadTarget(
  item: Pick<BellItem, 'kind' | 'projectId' | 'at' | 'unread'>,
): { channel: string; at: string } | null {
  if (item.kind !== 'conversation' || !item.unread) return null;
  return { channel: item.projectId ?? GENERAL_CHANNEL, at: item.at };
}

export function bellThreadMarkReadTarget(
  item: Pick<BellItem, 'id' | 'kind' | 'rootId' | 'at' | 'unread'>,
): { rootId: string; at: string } | null {
  if (item.kind !== 'thread' || !item.unread) return null;
  const rootId = item.rootId?.trim() || (item.id.startsWith('thread:') ? item.id.slice('thread:'.length) : '');
  return rootId ? { rootId, at: item.at } : null;
}

export function bellMarkAllConversationTargets(
  items: readonly Pick<BellItem, 'kind' | 'projectId' | 'at' | 'unread'>[],
): Array<{ channel: string; at: string }> {
  const targets: Array<{ channel: string; at: string }> = [];
  const seen = new Set<string>();
  for (const item of items.slice(0, BELL_WINDOW_MAX)) {
    const target = bellMarkReadTarget(item);
    if (!target) continue;
    const key = target.channel.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      targets.push(target);
    }
  }
  return targets;
}

export function bellCanMarkAllRead(
  bell: Pick<BellState, 'unread' | 'items'> | null | undefined,
  options?: { sendOpen?: boolean },
): boolean {
  if (!bell) return false;
  const shown = bell.items.slice(0, BELL_WINDOW_MAX);
  if (shown.some((item) => bellCanMarkRead(item, options))) return true;
  const visibleAlerts = shown.filter((item) => item.kind === 'storyboard' || item.kind === 'review').length;
  return bell.unread > visibleAlerts;
}

export function bellHasSendView(bell: BellState | null | undefined): boolean {
  return Boolean(bell && 'view' in bell && (bell.view === 'all' || bell.view === 'mentions'));
}

export function bellAnswerForView(bell: BellState, desiredView: SendInboxView): BellState {
  if (!bellHasSendView(bell) || bell.view === desiredView) return bell;
  return { ...bell, items: [], more: false };
}

export function bellSeeAllHref(
  organizationId: string,
  options?: { sendOpen?: boolean; view?: SendInboxView },
): string {
  const org = encodeURIComponent(organizationId);
  if (!options?.sendOpen) {
    return `/brand/rooms?organizationId=${org}`;
  }
  return options.view === 'mentions'
    ? `/brand/inbox?organizationId=${org}&view=mentions`
    : `/brand/inbox?organizationId=${org}`;
}

export function bellLineTime(item: Pick<BellItem, 'at'>, locale: StudioLocale, now = new Date()): string {
  return formatRelativeTime(item.at, locale, now);
}
