/**
 * Room conversation wire contract (docs/BRAND-ROOMS.md §4).
 *
 * The one place the brand inbox, a room's conversation tab, the compact thread beside a cut or a
 * deliverable, the team's admin screen and the service agree on shapes. The route parses every request
 * with these schemas; the screens import the same file.
 *
 * Client-safe: zod, types and pure helpers only (no env, no db).
 */
import { z } from 'zod';
import type { UploadLimitReason } from '@/lib/brands/upload-limits-format';
import type { RoomEventKind, RoomRef } from './events';

export type { RoomEventKind, RoomRef };

/* ---------------------------------------------------------------- vocab */

/** Who wrote a line: the brand's own people, the YAGI team, or the system (an event line). */
export const ROOM_AUTHOR_ROLES = ['brand', 'studio', 'system'] as const;
export type RoomAuthorRole = (typeof ROOM_AUTHOR_ROLES)[number];

/** The six reactions. Stored by name; the screen draws the glyph. */
export const ROOM_REACTIONS = ['thumbs_up', 'heart', 'clap', 'eyes', 'check', 'smile'] as const;
export type RoomReaction = (typeof ROOM_REACTIONS)[number];
export const ROOM_REACTION_GLYPHS: Readonly<Record<RoomReaction, string>> = {
  thumbs_up: '👍',
  heart: '❤️',
  clap: '👏',
  eyes: '👀',
  check: '✅',
  smile: '😄',
};

export const ROOM_OPERATIONS = [
  'message.send',
  'message.edit',
  'message.delete',
  'message.pin',
  'reaction.toggle',
  'channel.read',
  'attachment.reserve',
  'attachment.complete',
] as const;
export type RoomOperation = (typeof ROOM_OPERATIONS)[number];

export const ROOM_ERROR_CODES = [
  'sign_in_required',
  'forbidden',
  'not_found',
  'rooms_closed',
  'invalid',
  'conflict',
  'rate_limited',
  'storage_quota_exceeded',
  'file_too_large',
  'unsupported_file',
  'provider_unavailable',
  'failed',
  /**
   * 초대하고 보내기 (slice 4c; `send.post`/`send.reply` with `invites` only): the organization's daily invitation cap
   * (`BRAND_INVITES_PER_DAY`, shared with the members page) or one invitation's waiting lines
   * (`SEND_LIMITS.linesPerInvitation`) would be passed. Nothing was written or sent.
   */
  'invite_limit',
] as const;
export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];

export const GENERAL_CHANNEL = 'general' as const;

/** The team's desk tabs (docs/BRAND-ROOMS-FEEDBACK.md §4). */
export const ROOM_DESK_TABS = ['drafts', 'storyboards', 'links'] as const;
export type RoomDeskTab = (typeof ROOM_DESK_TABS)[number];

/**
 * The team's desk for one project: `/admin/brand-rooms/<org>/<project>`, with the open tab, the chosen
 * version (`review`) and a moment in it (`t`) in the query so a reload or a shared link returns there.
 */
export function roomDeskPath(organizationId: string, projectId: string, query: { tab?: RoomDeskTab | null; review?: string | null; t?: number | null } = {}): string {
  const params = new URLSearchParams();
  if (query.tab && query.tab !== 'drafts') params.set('tab', query.tab);
  if (query.review) params.set('review', query.review);
  if (query.t != null && query.t > 0) params.set('t', String(Math.round(query.t)));
  const search = params.toString();
  return `/admin/brand-rooms/${organizationId}/${projectId}${search ? `?${search}` : ''}`;
}

export const ROOM_LIMITS = {
  bodyMax: 4000,
  attachmentsPerMessage: 10,
  attachmentBytesMax: 25 * 1024 * 1024,
  /** Lines one person may send per minute in one organization. */
  messagesPerMinute: 20,
  pageDefault: 50,
  pageMax: 100,
  /** Changed lines one poll returns at most. */
  changesMax: 200,
  mentionsMax: 50,
  nameMax: 160,
  legacyMax: 200,
  threadMax: 500,
  refMax: 300,
  channelsMax: 100,
  /** A poll asks again for this much before its cursor, so a line committed late is never missed. */
  overlapMs: 5000,
} as const;

/** Polling: while the tab is on screen, and otherwise. */
export const ROOM_POLL_VISIBLE_MS = 4_000;
export const ROOM_POLL_HIDDEN_MS = 20_000;

/* ----------------------------------------------------------- attachments */

export type RoomAttachmentKind = 'image' | 'video' | 'file';

/** Every type a message may carry, the extension its stored key ends with, and how the screen shows it. */
export const ROOM_ATTACHMENT_TYPES: Readonly<Record<string, { ext: string; kind: RoomAttachmentKind }>> = {
  'image/png': { ext: 'png', kind: 'image' },
  'image/jpeg': { ext: 'jpg', kind: 'image' },
  'image/webp': { ext: 'webp', kind: 'image' },
  'video/mp4': { ext: 'mp4', kind: 'video' },
  'video/quicktime': { ext: 'mov', kind: 'video' },
  'application/pdf': { ext: 'pdf', kind: 'file' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: 'docx', kind: 'file' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: 'xlsx', kind: 'file' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: 'pptx', kind: 'file' },
  'application/x-hwp': { ext: 'hwp', kind: 'file' },
  'application/hwp+zip': { ext: 'hwpx', kind: 'file' },
  'text/plain': { ext: 'txt', kind: 'file' },
  'text/csv': { ext: 'csv', kind: 'file' },
  'application/zip': { ext: 'zip', kind: 'file' },
};
export const ROOM_ATTACHMENT_MIMES = Object.keys(ROOM_ATTACHMENT_TYPES) as [string, ...string[]];

/** What a file name's extension says, for browsers that give no type (`.hwp`, sometimes `.csv`). */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwp: 'application/x-hwp',
  hwpx: 'application/hwp+zip',
  txt: 'text/plain',
  csv: 'text/csv',
  zip: 'application/zip',
};

/** The accepted type of a picked file, or null. The file name's extension wins over a vague browser type. */
export function attachmentMimeOf(name: string, browserType: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? '';
  const fromName = BY_EXTENSION[ext];
  if (fromName) return fromName;
  const type = browserType.split(';')[0]!.trim().toLowerCase();
  return ROOM_ATTACHMENT_TYPES[type] ? type : null;
}

/** A stored attachment key: the studio media store's shape, limited to the types above. */
export const ROOM_FILE_KEY = /^st\/[0-9a-f]{64}\.(png|jpg|webp|mp4|mov|pdf|docx|xlsx|pptx|hwp|hwpx|txt|csv|zip)$/;

export function attachmentMimeOfKey(key: string): string | null {
  const ext = ROOM_FILE_KEY.exec(key)?.[1];
  if (!ext) return null;
  return Object.entries(ROOM_ATTACHMENT_TYPES).find(([, t]) => t.ext === ext)?.[0] ?? null;
}

export function attachmentKindOf(mime: string): RoomAttachmentKind {
  return ROOM_ATTACHMENT_TYPES[mime]?.kind ?? 'file';
}

/** Where the browser puts an upload before `attachment.complete` checks it. */
export const ROOM_STAGING_KEY = /^brand-rooms\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f]{32}$/;

/* -------------------------------------------------------------- inputs */

const Id = z.uuid();
/** A project's id, or `general`. Lower case, the way the channel column stores it. */
const ChannelId = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .pipe(z.union([z.literal(GENERAL_CHANNEL), z.uuid()]));
const Body = z
  .string()
  .transform((s) => s.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim())
  .pipe(z.string().max(ROOM_LIMITS.bodyMax));
const FileName = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001f\u007f/\\]+/g, ' ').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(ROOM_LIMITS.nameMax));
const Dimension = z.number().int().min(1).max(20_000).nullish();

export const RoomRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('storyboard'), storyboardId: Id, frameId: Id.optional() }),
  z.object({ kind: z.literal('review'), reviewId: Id, commentId: Id.optional() }),
]);

export const AttachmentInputSchema = z.object({
  key: z.string().regex(ROOM_FILE_KEY),
  name: FileName,
  size: z.number().int().min(1).max(ROOM_LIMITS.attachmentBytesMax),
  width: Dimension,
  height: Dimension,
});

const ChannelInput = { organizationId: Id, projectId: ChannelId };

export const MessageSendSchema = z
  .object({
    ...ChannelInput,
    requestId: Id,
    body: Body,
    parentId: Id.nullish(),
    ref: RoomRefSchema.nullish(),
    attachments: z.array(AttachmentInputSchema).max(ROOM_LIMITS.attachmentsPerMessage).default([]),
    mentions: z.array(Id).max(ROOM_LIMITS.mentionsMax).default([]),
    mentionsTeam: z.boolean().default(false),
  })
  .refine((v) => v.body.length > 0 || v.attachments.length > 0, { message: 'a line needs words or a file', path: ['body'] })
  .refine((v) => !(v.ref && v.projectId === GENERAL_CHANNEL), { message: 'refs live in a project channel', path: ['ref'] });

export const MessageEditSchema = z.object({ ...ChannelInput, messageId: Id, body: Body });
export const MessageRefSchema = z.object({ ...ChannelInput, messageId: Id });
export const MessagePinSchema = z.object({ ...ChannelInput, messageId: Id, pinned: z.boolean() });
export const ReactionToggleSchema = z.object({ ...ChannelInput, messageId: Id, emoji: z.enum(ROOM_REACTIONS) });
export const ChannelReadSchema = z.object({ ...ChannelInput, at: z.iso.datetime({ offset: true }).nullish() });
export const AttachmentReserveSchema = z.object({
  ...ChannelInput,
  name: FileName,
  mime: z.enum(ROOM_ATTACHMENT_MIMES),
  size: z.number().int().min(1),
});
export const AttachmentCompleteSchema = z.object({
  ...ChannelInput,
  stagingKey: z.string().regex(ROOM_STAGING_KEY),
  name: FileName,
  mime: z.enum(ROOM_ATTACHMENT_MIMES),
  size: z.number().int().min(1).max(ROOM_LIMITS.attachmentBytesMax),
});

export type MessageSendInput = z.input<typeof MessageSendSchema>;

/** `GET` query: one page of a stream, a thread, or the messages about one thing. */
export const StreamQuerySchema = z.object({
  organizationId: Id,
  projectId: ChannelId,
  since: z.iso.datetime({ offset: true }).nullish(),
  before: z.iso.datetime({ offset: true }).nullish(),
  limit: z.coerce.number().int().min(1).max(ROOM_LIMITS.pageMax).nullish(),
  thread: Id.nullish(),
  ref: z.string().nullish(),
});

/* --------------------------------------------------------------- refs */

/** The flat form of a ref (`storyboard:<id>[:<frame>]`, `review:<id>[:<comment>]`), the way the table indexes it. */
export function refKeyOf(ref: RoomRef): string {
  if (ref.kind === 'storyboard') return `storyboard:${ref.storyboardId.toLowerCase()}${ref.frameId ? `:${ref.frameId.toLowerCase()}` : ''}`;
  return `review:${ref.reviewId.toLowerCase()}${ref.commentId ? `:${ref.commentId.toLowerCase()}` : ''}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?ref=<kind>:<id>[:<sub>]` back to a ref; anything else is null. */
export function parseRefKey(value: string | null | undefined): RoomRef | null {
  const parts = (value ?? '').trim().toLowerCase().split(':');
  if (parts.length < 2 || parts.length > 3 || !parts.slice(1).every((p) => UUID.test(p))) return null;
  if (parts[0] === 'storyboard') return parts[2] ? { kind: 'storyboard', storyboardId: parts[1]!, frameId: parts[2] } : { kind: 'storyboard', storyboardId: parts[1]! };
  if (parts[0] === 'review') return parts[2] ? { kind: 'review', reviewId: parts[1]!, commentId: parts[2] } : { kind: 'review', reviewId: parts[1]! };
  return null;
}

/** The room tab that shows what a ref points at (`/brand/rooms/<project>?tab=storyboard&board=…&frame=…`). */
export function roomRefHref(projectId: string, ref: RoomRef, organizationId?: string | null, atMs?: number | null): string {
  const params = new URLSearchParams();
  if (organizationId) params.set('organizationId', organizationId);
  if (ref.kind === 'storyboard') {
    params.set('tab', 'storyboard');
    params.set('board', ref.storyboardId);
    if (ref.frameId) params.set('frame', ref.frameId);
  } else {
    params.set('tab', 'review');
    params.set('review', ref.reviewId);
    if (ref.commentId) params.set('comment', ref.commentId);
    if (atMs != null && Number.isFinite(atMs) && atMs >= 0) params.set('t', String(Math.round(atMs)));
  }
  return `/brand/rooms/${projectId}?${params.toString()}`;
}

/* --------------------------------------------------------------- views */

export interface RoomAttachment {
  key: string;
  url: string;
  name: string;
  mime: string;
  kind: RoomAttachmentKind;
  size: number;
  width: number | null;
  height: number | null;
}

export interface RoomReactionView {
  emoji: RoomReaction;
  count: number;
  mine: boolean;
}

/** What a ref card shows. Facts only; the screen writes the words ("스토리보드 v2 · 컷 3"). */
export interface RoomRefView {
  ref: RoomRef;
  /** False when the thing it points at is gone or not visible here (the card still shows, without a link). */
  available: boolean;
  title: string | null;
  version: number | null;
  /** 1-based cut number for a storyboard frame. */
  cut: number | null;
  scene: string | null;
  shot: string | null;
  thumbUrl: string | null;
  /** Present when `ref` narrows to one deliverable comment (`review:<id>:<comment>`). */
  noteBody?: string | null;
  atMs?: number | null;
  endMs?: number | null;
  hasSpot?: boolean;
  hasDrawing?: boolean;
}

export interface RoomEventDetail {
  title?: string;
  version?: number;
}

export interface RoomMessage {
  id: string;
  /** `general` or the project id. */
  channel: string;
  projectId: string | null;
  parentId: string | null;
  kind: 'text' | 'event';
  event: RoomEventKind | null;
  detail: RoomEventDetail | null;
  authorId: string | null;
  authorRole: RoomAuthorRole;
  /** A display name; null for a team member without one (the screen then shows only "야기 팀"). */
  authorName: string | null;
  /**
   * An event line for a note left through a share link (no account): `authorName` is the name the guest
   * typed, or null. Never shown as the YAGI team's.
   */
  guest?: true;
  /** The viewer wrote it (may edit and delete it). */
  mine: boolean;
  /** Empty when deleted. */
  body: string;
  attachments: RoomAttachment[];
  mentions: string[];
  mentionsTeam: boolean;
  ref: RoomRefView | null;
  reactions: RoomReactionView[];
  replyCount: number;
  lastReplyAt: string | null;
  /** The newest reply is the viewer's own (it is not "new" to them). */
  lastReplyMine: boolean;
  pinned: boolean;
  edited: boolean;
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A line from the project's earlier conversation (before rooms). Read only. */
export interface RoomLegacyMessage {
  id: string;
  authorRole: 'brand' | 'studio';
  authorName: string | null;
  body: string;
  createdAt: string;
}

/** Someone the composer may mention. */
export interface RoomPerson {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer' | 'guest';
}

export interface RoomFailure {
  ok: false;
  code: RoomErrorCode;
  reason?: UploadLimitReason;
}

export interface RoomStreamPage {
  ok: true;
  channel: string;
  projectId: string | null;
  /** The project's title; null for the general channel. */
  title: string | null;
  /** Oldest first. */
  messages: RoomMessage[];
  /** Older lines exist before the first one here. */
  hasMore: boolean;
  /** Pass back as `since` on the next poll. */
  cursor: string;
  /** Where this viewer stopped reading (first page only; null when never read or on a poll). */
  lastReadAt: string | null;
  /** The earlier project conversation, once the page reaches the beginning. */
  legacy: RoomLegacyMessage[];
  /** First page only: who may be mentioned. */
  people: RoomPerson[];
  /** First page only: every pinned line of the channel, newest pin first. */
  pinned: RoomMessage[];
  canTalk: boolean;
  canPin: boolean;
  /** The viewer is the YAGI team (the admin screen). */
  team: boolean;
}

export interface RoomThreadPage {
  ok: true;
  parent: RoomMessage;
  /** Oldest first. */
  replies: RoomMessage[];
  cursor: string;
  /** First load only: who may be mentioned. */
  people: RoomPerson[];
}

export interface RoomRefPage {
  ok: true;
  /** Oldest first: every line about this thing, replies included. */
  messages: RoomMessage[];
  cursor: string;
  /** First load only: who may be mentioned. */
  people: RoomPerson[];
  canTalk: boolean;
}

export interface RoomMessageDone {
  ok: true;
  message: RoomMessage;
}

export interface RoomReactionsDone {
  ok: true;
  messageId: string;
  reactions: RoomReactionView[];
}

export interface RoomReadDone {
  ok: true;
  lastReadAt: string;
}

export interface RoomUploadReserved {
  ok: true;
  stagingKey: string;
  /** Where the browser sends the bytes: a signed URL (PUT) or the local gateway (POST). */
  url: string;
  direct: boolean;
}

export interface RoomAttachmentDone {
  ok: true;
  attachment: RoomAttachment;
}

export interface RoomDone {
  ok: true;
}

export type RoomOperationResult =
  | RoomFailure
  | RoomMessageDone
  | RoomReactionsDone
  | RoomReadDone
  | RoomUploadReserved
  | RoomAttachmentDone
  | RoomDone;

/* ------------------------------------------------------------ helpers */

export function isRoomOperation(value: unknown): value is RoomOperation {
  return typeof value === 'string' && (ROOM_OPERATIONS as readonly string[]).includes(value);
}

export function isRoomErrorCode(value: unknown): value is RoomErrorCode {
  return typeof value === 'string' && (ROOM_ERROR_CODES as readonly string[]).includes(value);
}

export function roomErrorStatus(code: RoomErrorCode): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
    case 'rooms_closed':
      return 404;
    case 'invalid':
      return 400;
    case 'conflict':
    case 'storage_quota_exceeded':
      return 409;
    case 'file_too_large':
      return 413;
    case 'unsupported_file':
      return 415;
    case 'rate_limited':
    case 'invite_limit':
      return 429;
    case 'provider_unavailable':
      return 503;
    default:
      return 500;
  }
}

/** The channel key of a channel id or `null` (general). */
export function channelKeyOf(projectId: string | null | undefined): string {
  return projectId ? projectId.toLowerCase() : GENERAL_CHANNEL;
}

/** Bytes as the composer and the file chip show them ("2.4 MB"). */
export function formatBytes(size: number, locale: 'ko' | 'en'): string {
  const tag = locale === 'ko' ? 'ko-KR' : 'en-US';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(size / 1024)} KB`;
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(size / (1024 * 1024))} MB`;
}

/** Same author, same side, a text line, within five minutes: the second line drops its name row. */
export function continuesGroup(previous: Pick<RoomMessage, 'authorId' | 'authorRole' | 'kind' | 'createdAt'> | null, next: Pick<RoomMessage, 'authorId' | 'authorRole' | 'kind' | 'createdAt'>): boolean {
  if (!previous || previous.kind !== 'text' || next.kind !== 'text') return false;
  if (previous.authorRole !== next.authorRole || previous.authorId !== next.authorId || !next.authorId) return false;
  const gap = Date.parse(next.createdAt) - Date.parse(previous.createdAt);
  return gap >= 0 && gap <= 5 * 60_000 && dayKey(previous.createdAt) === dayKey(next.createdAt);
}

/** The local calendar day of an instant (`2026-11-11`), for day dividers. */
export function dayKey(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  return parts;
}

/**
 * The text of a line in runs: plain text and `@name` mentions of the people it named (or `@야기 팀` when
 * it called the team). Only names the message actually mentioned are marked; anything else is text.
 */
export function mentionRuns(body: string, names: readonly string[], teamLabel: string | null): Array<{ text: string; mention: boolean }> {
  const tokens = [...new Set([...names.filter(Boolean), ...(teamLabel ? [teamLabel] : [])])].sort((a, b) => b.length - a.length);
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

/** The `@` word being typed just before the caret, or null. */
export function mentionQueryAt(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,30})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2]!.length - 1, query: match[2]! };
}

/** Merge changed lines into a list by id (newer `updatedAt` wins), oldest first, dropping deleted lines nobody answered. */
export function mergeMessages(current: readonly RoomMessage[], changed: readonly RoomMessage[]): RoomMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of changed) {
    const had = byId.get(m.id);
    if (!had || had.updatedAt <= m.updatedAt) byId.set(m.id, m);
  }
  return [...byId.values()]
    .filter((m) => !(m.deleted && m.replyCount === 0))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
