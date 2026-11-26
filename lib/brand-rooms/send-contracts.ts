/**
 * 보내기 wire contract (docs/BRAND-PROJECT-SPINE.md §8; slice 4a): a workspace member sends a studio file to colleagues
 * with `@` and a message, on the organization's MEMBERS channel, and reads and answers what they were sent.
 *
 * The one place the server (./send.ts), the transport (components/brand-rooms/chat/transport.ts `sendTransport`) and
 * the screens agree on shapes. Client-safe: zod, types and pure helpers only (no env, no db).
 *
 * Every operation goes through `POST /api/brand-rooms/messages` as `{ operation, input }`, beside the room operations
 * (`ROOM_OPERATIONS`). While 보내기 is closed for the organization each of them answers exactly what an unknown
 * operation answers (`invalid`).
 */
import { z } from 'zod';
import { ROOM_LIMITS } from './message-contracts';

/* ---------------------------------------------------------------- vocab */

export const SEND_OPERATIONS = [
  /** A new thread about one file (a root line on the file's members channel). */
  'send.post',
  /** A reply in a thread. */
  'send.reply',
  /** One thread: the root and its replies (marks it read for the caller unless `markRead: false`). */
  'send.thread',
  /** The threads about one file, newest first (the viewer's send panel). */
  'send.file',
  /** "나에게 온 것": the caller's threads, by last activity, page by page. */
  'send.inbox',
  /** Mark one thread read for the caller. */
  'send.read',
  /** "모두 읽음": mark the caller's unread inbox threads read (bounded). */
  'send.read_all',
  /** Who may be named with `@`: the organization's active members. */
  'send.people',
] as const;
export type SendOperation = (typeof SEND_OPERATIONS)[number];

export function isSendOperation(value: unknown): value is SendOperation {
  return typeof value === 'string' && (SEND_OPERATIONS as readonly string[]).includes(value);
}

/**
 * Named limits of 보내기. A line's length, mentions per line and the send rate are the rooms' own
 * (`ROOM_LIMITS.bodyMax`, `ROOM_LIMITS.mentionsMax`, `ROOM_LIMITS.messagesPerMinute`, shared with the team channels),
 * and a thread shows at most `ROOM_LIMITS.threadMax` replies.
 */
export const SEND_LIMITS = {
  /** Threads per `send.inbox` page. */
  inboxPage: 30,
  /** Longest inbox cursor accepted. */
  cursorMax: 200,
  /** Threads `send.file` lists for one file, newest first. */
  fileThreads: 50,
  /** Members `send.people` lists. */
  peopleMax: 200,
  /** Threads one `send.read_all` marks at most (the newest unread first); `more` says when some are left. */
  readAllMax: 500,
  /** The unread counts stop counting here (a badge shows 99+ long before). */
  unreadCountMax: 999,
  /** A thread line's excerpt (the bell and the inbox): characters, spaces folded. */
  lineChars: 120,
} as const;

/* ---------------------------------------------------------------- channels */

/** An unfiled file's members channel. */
export const MEMBERS_CHANNEL = 'members' as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The members channel of a project (`members:<id>`), or of unfiled files (`members`). */
export function membersChannelOf(projectId: string | null | undefined): string {
  return projectId ? `${MEMBERS_CHANNEL}:${projectId.toLowerCase()}` : MEMBERS_CHANNEL;
}

/** Whether a stored channel value is a members channel (the 0200 check allows exactly these two forms). */
export function isMembersChannel(channel: string | null | undefined): boolean {
  if (channel === MEMBERS_CHANNEL) return true;
  return typeof channel === 'string' && channel.startsWith(`${MEMBERS_CHANNEL}:`) && UUID.test(channel.slice(MEMBERS_CHANNEL.length + 1));
}

/* ---------------------------------------------------------------- file refs */

/** What a send is about: one result of a studio run, or one library entry. */
export type SendFileRef = { kind: 'output'; outputId: string } | { kind: 'asset'; assetId: string };

const Id = z.uuid();

export const SendFileRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('output'), outputId: Id }).strict(),
  z.object({ kind: z.literal('asset'), assetId: Id }).strict(),
]);

/** The flat form the table indexes: `output:<id>` / `asset:<id>`. */
export function fileRefKeyOf(ref: SendFileRef): string {
  return ref.kind === 'output' ? `output:${ref.outputId.toLowerCase()}` : `asset:${ref.assetId.toLowerCase()}`;
}

/** `output:<id>` / `asset:<id>` back to a ref; anything else (a storyboard or review key included) is null. */
export function parseFileRefKey(value: string | null | undefined): SendFileRef | null {
  const parts = (value ?? '').trim().toLowerCase().split(':');
  if (parts.length !== 2 || !UUID.test(parts[1]!)) return null;
  if (parts[0] === 'output') return { kind: 'output', outputId: parts[1]! };
  if (parts[0] === 'asset') return { kind: 'asset', assetId: parts[1]! };
  return null;
}

/* ---------------------------------------------------------------- links */

/**
 * Where a members thread opens: the mode-neutral 알림함 page the screen half builds, with the organization the brand
 * side's links carry (`?organizationId=`): `/brand/inbox?organizationId=<org>&thread=<root id>`. Every notice, mail,
 * push and bell line about a members thread points here; none points at `/brand/rooms*`.
 */
export function sendThreadHref(organizationId: string, rootId: string): string {
  const params = new URLSearchParams({ organizationId: organizationId.toLowerCase(), thread: rootId.toLowerCase() });
  return `/brand/inbox?${params.toString()}`;
}

/* ---------------------------------------------------------------- inputs */

const Body = z
  .string()
  .transform((s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim())
  .pipe(z.string().min(1).max(ROOM_LIMITS.bodyMax));
const Mentions = z.array(Id).max(ROOM_LIMITS.mentionsMax).default([]);
const At = z.iso.datetime({ offset: true });

/** Every input is strict: a field this contract does not name (a `projectId`, a `channel`) is refused as `invalid`. */
export const SendPostSchema = z
  .object({ organizationId: Id, requestId: Id, file: SendFileRefSchema, body: Body, mentions: Mentions })
  .strict();
export const SendReplySchema = z.object({ organizationId: Id, requestId: Id, rootId: Id, body: Body, mentions: Mentions }).strict();
export const SendThreadSchema = z.object({ organizationId: Id, rootId: Id, markRead: z.boolean().default(true) }).strict();
export const SendFileSchema = z.object({ organizationId: Id, file: SendFileRefSchema }).strict();
export const SendInboxSchema = z
  .object({
    organizationId: Id,
    view: z.enum(['all', 'mentions']).default('all'),
    cursor: z.string().min(1).max(SEND_LIMITS.cursorMax).nullish(),
  })
  .strict();
export const SendReadSchema = z.object({ organizationId: Id, rootId: Id, at: At.nullish() }).strict();
export const SendReadAllSchema = z.object({ organizationId: Id }).strict();
export const SendPeopleSchema = z.object({ organizationId: Id }).strict();

export type SendPostInput = z.input<typeof SendPostSchema>;
export type SendReplyInput = z.input<typeof SendReplySchema>;
export type SendThreadInput = z.input<typeof SendThreadSchema>;
export type SendFileInput = z.input<typeof SendFileSchema>;
export type SendInboxInput = z.input<typeof SendInboxSchema>;
export type SendReadInput = z.input<typeof SendReadSchema>;
export type SendInboxView = 'all' | 'mentions';

/* ---------------------------------------------------------------- views */

/** A project as a members thread shows it: only while the project can take new work (else the file reads as 미분류). */
export interface SendProject {
  id: string;
  title: string;
}

/**
 * The file a thread is about. `available: false` means the file was deleted (or is no longer one a member can open):
 * then `kind`, `name`, `url`, `thumbUrl`, `width`, `height` and `project` are all null, and the screen draws
 * "지워진 파일". The thread itself stays.
 */
export interface SendFileCard {
  ref: SendFileRef;
  available: boolean;
  kind: 'image' | 'video' | 'audio' | null;
  /** A library entry's name; null for a run's result (the screen names it by its kind). */
  name: string | null;
  url: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  /** Where the file is shown: its project while that project can take new work, else null (미분류). */
  project: SendProject | null;
}

export interface SendMention {
  id: string;
  /** The colleague's display name, as the room conversation names them; null when they have none to show. */
  name: string | null;
}

/** One line of a members thread. */
export interface SendMessage {
  id: string;
  rootId: string;
  /** Null for the root. */
  parentId: string | null;
  authorId: string | null;
  /** As the room conversation names a brand member (their display name, else the part of their address before the @). */
  authorName: string | null;
  /** The caller wrote it. */
  mine: boolean;
  body: string;
  mentions: SendMention[];
  createdAt: string;
}

/** The newest line of a thread, as a list row shows it. */
export interface SendLatest {
  messageId: string;
  authorId: string | null;
  authorName: string | null;
  mine: boolean;
  /** Its text, spaces folded, at most `SEND_LIMITS.lineChars` characters. */
  line: string;
  at: string;
}

/** One thread as every list (the inbox, a file's threads, the bell) shows it. */
export interface SendThreadSummary {
  rootId: string;
  root: SendMessage;
  file: SendFileCard;
  /** Live replies. */
  replyCount: number;
  /** The newest line's time (the root's when nobody replied). Lists sort by this. */
  lastActivityAt: string;
  latest: SendLatest;
  /** The caller is named in the root or in any reply. */
  mentioned: boolean;
  /** A line someone else wrote is newer than the caller's read mark (never read: any line by someone else). */
  unread: boolean;
  /** The caller's read mark on this thread, or null. */
  lastReadAt: string | null;
}

export interface SendPosted {
  ok: true;
  thread: SendThreadSummary;
  message: SendMessage;
}

export interface SendThreadPage {
  ok: true;
  thread: SendThreadSummary;
  /** Oldest first, at most `ROOM_LIMITS.threadMax`. */
  replies: SendMessage[];
}

export interface SendFileThreads {
  ok: true;
  file: SendFileCard;
  /** Newest root first, at most `SEND_LIMITS.fileThreads`. */
  threads: SendThreadSummary[];
}

export interface SendInboxPage {
  ok: true;
  view: SendInboxView;
  /** By last activity, newest first; ties by root id. */
  threads: SendThreadSummary[];
  /** Pass back as `cursor` for the next page; null on the last page. */
  next: string | null;
  /** Unread threads in the whole inbox (capped at `SEND_LIMITS.unreadCountMax`). */
  unread: number;
  /** Unread threads where the caller is named (same cap). */
  mentionsUnread: number;
}

export interface SendReadDone {
  ok: true;
  rootId: string;
  lastReadAt: string;
}

export interface SendReadAllDone {
  ok: true;
  /** Threads marked by this call. */
  marked: number;
  /** Unread threads were left because of `SEND_LIMITS.readAllMax`. */
  more: boolean;
}

export interface SendPerson {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
  /** The caller. */
  me: boolean;
}

export interface SendPeople {
  ok: true;
  /** By name, at most `SEND_LIMITS.peopleMax`. No avatar is served for members today. */
  people: SendPerson[];
}

export type SendResult = SendPosted | SendThreadPage | SendFileThreads | SendInboxPage | SendReadDone | SendReadAllDone | SendPeople;
