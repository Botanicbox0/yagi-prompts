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
  /**
   * 초대하고 보내기 (slice 4c): what a typed e-mail address becomes in the send field (a member to name, someone to
   * invite, or not allowed here).
   */
  'send.lookup',
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
  /**
   * 초대하고 보내기 (slice 4c): e-mail addresses one line may invite (`invites`). New invitations also count against the
   * organization's daily invitation cap, shared with the members page (`BRAND_INVITES_PER_DAY`,
   * lib/brands/workspace/service.ts; `invite_limit`).
   */
  invitesPerMessage: 3,
  /** Lines that may wait for one invitation; one more line naming that address is refused (`invite_limit`). */
  linesPerInvitation: 20,
  /** `send.lookup` calls one person may make per minute in one organization (`rate_limited`). */
  lookupsPerMinute: 30,
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

/**
 * 초대하고 보내기 (slice 4c): one e-mail address as the existing workspace invitation takes it (`z.email()`, at most 254
 * characters), after trimming and lower-casing.
 */
export const SendInviteEmailSchema = z.string().max(320).trim().toLowerCase().pipe(z.email().max(254));
/** At most `SEND_LIMITS.invitesPerMessage` addresses; an empty list is the same as none. Duplicates collapse on the server. */
const Invites = z.array(SendInviteEmailSchema).max(SEND_LIMITS.invitesPerMessage).default([]);

/**
 * While 초대하고 보내기 is open for the organization, `send.post` and `send.reply` take these instead: the same fields plus
 * `invites`. Strict as the rest: a `role` (or any other field) is refused as `invalid`; the role given is always viewer.
 * While it is closed, the schemas above apply and an input carrying `invites` is `invalid`, as on origin/main.
 */
export const SendPostInviteSchema = z
  .object({ organizationId: Id, requestId: Id, file: SendFileRefSchema, body: Body, mentions: Mentions, invites: Invites })
  .strict();
export const SendReplyInviteSchema = z.object({ organizationId: Id, requestId: Id, rootId: Id, body: Body, mentions: Mentions, invites: Invites }).strict();
/** `send.lookup`: one typed address (any text; a malformed address is `invalid`). */
export const SendLookupSchema = z.object({ organizationId: Id, email: SendInviteEmailSchema }).strict();

export type SendPostInput = z.input<typeof SendPostSchema>;
export type SendReplyInput = z.input<typeof SendReplySchema>;
export type SendPostInviteInput = z.input<typeof SendPostInviteSchema>;
export type SendReplyInviteInput = z.input<typeof SendReplyInviteSchema>;
export type SendLookupInput = z.input<typeof SendLookupSchema>;
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
  /**
   * 초대하고 보내기 (slice 4c): the invitations this line waits for, oldest first. Present (possibly empty) on every line of
   * every answer while 초대하고 보내기 is open for the organization; ABSENT while it is closed (the answer is then exactly
   * what it was before slice 4c). A line stops listing one when its invitation is accepted and the line reached them.
   */
  invites?: SendInviteChip[];
}

/** One invitation a line waits for (`SendMessage.invites`). */
export interface SendInviteChip {
  /**
   * `pending`: the invitation can still be accepted. `expired`: past its 7 days, or withdrawn (an owner cancelled it, or
   * invited the address again from the members page, which replaces it). `accepted`: the person joined, but the line
   * did not reach them (they accepted while 초대하고 보내기 was closed, or delivering failed); rare.
   */
  state: 'pending' | 'expired' | 'accepted';
  /**
   * The invited address: only for the line's writer and the organization's owners (an owner-role invitation's, the YAGI
   * team's handover, only for the writer, as the members page hides it from owners too). Null for everyone else.
   */
  email: string | null;
}

/** What one address of a send's `invites` became (`SendPosted.invited`), for the writer only. */
export interface SendInviteOutcome {
  /** The address as the server normalised it (trimmed, lower-case). */
  email: string;
  /**
   * `member`: an active member of this organization, named like any mention (`memberId`; no invitation).
   * `invited`: a new workspace invitation (role viewer, 7 days) was issued and this line waits for it.
   * `reused`: a live invitation to this organization already existed; this line waits for it too (nothing new is sent).
   */
  result: 'member' | 'invited' | 'reused';
  memberId: string | null;
  /**
   * `invited` only, in the first answer only: the invitation's link token, as the members page's `invitation.create`
   * answers it (`/brand/invite#token=<token>`). Shown once and never stored recoverably: a retried request answers null.
   */
  token: string | null;
  /** `invited` only: the invitation mail's outcome while `BRAND_ORG_INVITE_EMAIL=on` (as `invitation.create`); null while it is off (copy the link). */
  mailState: 'sent' | 'failed' | 'skipped' | null;
}

/** `send.lookup`: what a typed address becomes. Says nothing about accounts outside this organization. */
export interface SendLookup {
  ok: true;
  /** The address as the server normalised it. */
  email: string;
  /**
   * `member`: an active member of this organization (name them: `member` is filled). `invitable`: the caller may invite
   * it (owner or editor, 초대하고 보내기 open). `not_allowed`: the caller may not invite here (a viewer, whatever the address,
   * a member's included; or the switch is closed); nothing is looked up.
   */
  status: 'member' | 'invitable' | 'not_allowed';
  member: { id: string; name: string } | null;
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
  /**
   * 초대하고 보내기 (slice 4c): present only when the request carried a non-empty `invites` and wrote the line (a retried
   * request answers the line without it); one entry per distinct address, in the order sent.
   */
  invited?: SendInviteOutcome[];
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

export type SendResult = SendPosted | SendThreadPage | SendFileThreads | SendInboxPage | SendReadDone | SendReadAllDone | SendPeople | SendLookup;
