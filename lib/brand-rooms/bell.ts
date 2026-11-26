/**
 * The bell of 직접 만들기 (docs/BRAND-PROJECT-SPINE.md §5.1, §8.1 "알림 종", §8.4, §11-5; slice 3a): the bell's number
 * and its small list. Read only: nothing here marks, sends or queues. Whether the rail's 알림함 row in 직접 만들기 shows
 * this number or the summary's `unread` (today's message badge) is still to be decided (slice 3a contract); both come in
 * the same answer.
 *
 * It is not a second count. It is built from the rooms summary the 알림함 page already reads (`loadRoomSummary`,
 * ./messages.ts), for the same person in the same transaction, from exactly the items that page draws: its alert cards
 * and its conversations with their unread badges.
 *  - a line per alert the summary carries (a storyboard or a draft waiting for the brand: `summary.alerts`), always
 *    counted, because it waits for a decision and no read mark exists for it;
 *  - a line per conversation the summary lists that has had any activity (`lastAt`), counted while it has unread
 *    messages for this person (`channels[].unread`, the existing per person × channel read rule).
 * The number (docs/BRAND-PROJECT-SPINE.md §8.4: unread conversations + drafts and storyboards to check) is the count of
 * counted lines over everything the summary carries, before the list is cut to `ROOM_BELL_LIMITS.items`. The summary
 * itself carries at most 20 alerts and `ROOM_LIMITS.channelsMax` conversations, exactly what the 알림함 page lists.
 * It is NOT the badge the 야기 팀과 rail shows today: that badge is the summary's `unread`, the total of unread messages
 * with no alerts, and it is still in the same answer (see the slice 3a contract and its open question).
 *
 * Mentions and files sent between members come with slice 4 (§8.4); nothing of them is here.
 *
 * Opt-in only: `GET /api/brand-rooms/summary?organizationId=…&bell=1` (the route) asks for it, and only then does the
 * summary carry `bell`. Every other caller of the summary gets exactly what it got before. Even when asked, the bell is
 * added only for a workspace member (owner, editor, viewer) of an organization that has 직접 만들기 open: studio v2
 * on, the spine open (`brandProjectSpineOpen`: switch, organization list and columns) and `self_studio` not denied.
 * The rooms gate itself (`BRAND_ROOMS`, the sandbox hardline, the generation policy, membership) is the summary's own
 * and runs before this. A project guest, or a closed organization, gets the plain summary, byte for byte.
 */
import type { StudioMediaStore } from '@/lib/brand-studio/media-store';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RoomAlertItem, RoomSummary } from '@/components/brand-rooms/seams';
import { roomHref } from '@/components/brand-rooms/room/visibility';
import { brandProjectSpineOpen } from '@/lib/brand-studio/brand-projects';
import { reviewThumbUrls } from '@/lib/brand-studio/review';
import { assertBrandFeature, BrandFeatureDenied } from '@/lib/brands/entitlements';
import { scopedHref } from '@/lib/brands/workspace/selection';
import { brandStudioV2Open } from '@/lib/flags';
import type { RoomSeat } from './access';
import { GENERAL_CHANNEL } from './message-contracts';
import { storyboardCoverUrls } from './storyboards';

type Env = Record<string, string | undefined>;

export const ROOM_BELL_LIMITS = {
  /** Lines the bell's window gets, newest first. `RoomBell.unread` counts every counted line, cut or not. */
  items: 20,
} as const;

export type RoomBellKind = 'storyboard' | 'review' | 'conversation';

/** One line of the bell's window. */
export interface RoomBellItem {
  /** Stable key: `storyboard:<id>` / `review:<id>` (the 알림함's alert ids), `channel:<projectId>` or `channel:general`. */
  id: string;
  kind: RoomBellKind;
  /** The project; null for the organization's general channel (일반 문의). */
  projectId: string | null;
  /** The project's title; null for the general channel (the screen names it `roomsChat.inbox.general`). */
  projectTitle: string | null;
  /** A storyboard or a draft: its title. A conversation: null. */
  title: string | null;
  /** A conversation: its last text line as the 알림함 shows it (spaces folded, at most 120 characters); else null. */
  line: string | null;
  /** A storyboard or a draft: its version (for `alertStoryboard`, `alertReview`, `alertReviewNotes`); a conversation: null. */
  version: number | null;
  /** A draft: its open notes (`alertReviewNotes` when above 0); otherwise 0. */
  openNotes: number;
  /** A conversation: messages this person has not read (`roomsChat.inbox.unread`); an alert: 0. */
  unreadCount: number;
  /** ISO time the line sorts by: the alert's `updatedAt`, the conversation's `lastAt`. */
  at: string;
  /** Counted in `RoomBell.unread`: an alert always; a conversation while `unreadCount > 0`. */
  unread: boolean;
  /**
   * A picture this person may open: a storyboard's cover (its first ready cut, as the storyboard list shows it) or a
   * draft's thumbnail (as the deliverable list shows it, null once the file is gone). A conversation: null.
   */
  thumbUrl: string | null;
  /** Where the line opens: the alert's room tab (as the 알림함 links it), or the conversation in the 알림함. */
  href: string;
}

export interface RoomBell {
  /** The bell's number: the counted lines (alerts + conversations with unread messages). Not the summary's message `unread`. */
  unread: number;
  /** At most `ROOM_BELL_LIMITS.items`, newest first (by `at`, then `id`). */
  items: RoomBellItem[];
  /** True when the list was cut by the limit. */
  more: boolean;
}

/** The rooms summary, with `bell` only when the caller asked for it and may have it. */
export type RoomSummaryWithBell = RoomSummary & { bell?: RoomBell };

/** What the route hands the summary when the request opts in (`&bell=1`). */
export interface RoomBellRequest {
  media: StudioMediaStore;
  env?: Env;
}

/** `?bell=1` exactly; anything else (absent, `true`, `0`) is not an opt-in. */
export function bellRequested(params: URLSearchParams): boolean {
  return params.get('bell') === '1';
}

/**
 * Does this seat get the bell: a workspace member (never a project guest), studio v2 on, the spine open for the
 * organization, and its policy leaving `self_studio` open (the same feature gate as the spine's own reads).
 */
async function bellOpenFor(sql: SqlRunner, seat: RoomSeat, env: Env): Promise<boolean> {
  if (seat.role !== 'owner' && seat.role !== 'editor' && seat.role !== 'viewer') return false;
  if (!brandStudioV2Open(env as NodeJS.ProcessEnv)) return false;
  if (!(await brandProjectSpineOpen(sql, seat.organizationId, env))) return false;
  try {
    await assertBrandFeature(sql, seat.organizationId, 'self_studio');
  } catch (error) {
    if (error instanceof BrandFeatureDenied) return false;
    throw error;
  }
  return true;
}

const alertHref = (alert: RoomAlertItem, organizationId: string): string =>
  roomHref(alert.projectId, organizationId, alert.kind === 'storyboard' ? 'storyboard' : 'review', {
    [alert.kind === 'storyboard' ? 'board' : 'review']: alert.targetId,
  });

/** The 알림함 with one conversation open: `/brand/rooms?organizationId=…&channel=<projectId|general>`. */
const conversationHref = (projectId: string | null, organizationId: string): string =>
  `${scopedHref('/brand/rooms', { id: organizationId })}&channel=${encodeURIComponent(projectId ? projectId.toLowerCase() : GENERAL_CHANNEL)}`;

/**
 * The bell from a summary (pure): every line, the number over all of them, then the cut. `thumbs` maps
 * `storyboard:<id>` / `review:<id>` to the picture, when there is one.
 */
export function roomBellOf(summary: Pick<RoomSummary, 'channels' | 'alerts'>, organizationId: string, thumbs: ReadonlyMap<string, string | null> = new Map()): RoomBell {
  const lines: RoomBellItem[] = [];
  for (const alert of summary.alerts ?? []) {
    lines.push({
      id: alert.id,
      kind: alert.kind,
      projectId: alert.projectId,
      projectTitle: alert.projectTitle,
      title: alert.title,
      line: null,
      version: alert.version,
      openNotes: alert.kind === 'review' ? alert.openNotes : 0,
      unreadCount: 0,
      at: alert.updatedAt,
      unread: true,
      thumbUrl: thumbs.get(alert.id) ?? null,
      href: alertHref(alert, organizationId),
    });
  }
  for (const channel of summary.channels) {
    if (!channel.lastAt) continue;
    lines.push({
      id: `channel:${channel.projectId ? channel.projectId.toLowerCase() : GENERAL_CHANNEL}`,
      kind: 'conversation',
      projectId: channel.projectId,
      projectTitle: channel.projectId ? channel.title : null,
      title: null,
      line: channel.lastLine,
      version: null,
      openNotes: 0,
      unreadCount: channel.unread,
      at: channel.lastAt,
      unread: channel.unread > 0,
      thumbUrl: null,
      href: conversationHref(channel.projectId, organizationId),
    });
  }
  lines.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    unread: lines.filter((line) => line.unread).length,
    items: lines.slice(0, ROOM_BELL_LIMITS.items),
    more: lines.length > ROOM_BELL_LIMITS.items,
  };
}

/**
 * The bell for this seat from the summary just read in the same transaction, or null when the seat does not get it.
 * A fixed number of statements beyond the summary, whatever the number of lines: the gate (the policy and plan rows
 * `self_studio` reads), then the storyboards' covers and the drafts' thumbnails of the alerts (each one statement, for
 * at most the summary's 20 alerts). All of it under one savepoint: if any of it fails, the answer is the plain summary
 * (null here), never a failed summary, exactly as the summary treats its own alerts.
 */
export async function roomBellFor(sql: SqlRunner, seat: RoomSeat, summary: Pick<RoomSummary, 'channels' | 'alerts'>, request: RoomBellRequest): Promise<RoomBell | null> {
  if (seat.role === 'guest') return null;
  await sql.query('savepoint brand_room_bell');
  try {
    const bell = await bellFrom(sql, seat, summary, request);
    await sql.query('release savepoint brand_room_bell');
    return bell;
  } catch {
    await sql.query('rollback to savepoint brand_room_bell');
    return null;
  }
}

async function bellFrom(sql: SqlRunner, seat: RoomSeat, summary: Pick<RoomSummary, 'channels' | 'alerts'>, request: RoomBellRequest): Promise<RoomBell | null> {
  if (!(await bellOpenFor(sql, seat, request.env ?? process.env))) return null;
  const alerts = summary.alerts ?? [];
  const ids = (kind: RoomAlertItem['kind']) => alerts.filter((alert) => alert.kind === kind).map((alert) => alert.targetId);
  const boards = await storyboardCoverUrls(sql, request.media, seat.organizationId, ids('storyboard'));
  const reviews = await reviewThumbUrls(sql, request.media, seat.organizationId, ids('review'));
  const thumbs = new Map<string, string | null>();
  for (const alert of alerts) {
    const found = (alert.kind === 'storyboard' ? boards : reviews).get(alert.targetId.toLowerCase());
    thumbs.set(alert.id, found ?? null);
  }
  return roomBellOf(summary, seat.organizationId, thumbs);
}
