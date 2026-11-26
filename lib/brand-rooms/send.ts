/**
 * 보내기, the server (docs/BRAND-PROJECT-SPINE.md §8.2–§8.4; slice 4a). A workspace member sends a studio file to
 * colleagues with `@` and a message, and reads and answers what they were sent. Wire shapes: ./send-contracts.ts.
 *
 * Where it lives: the organization's MEMBERS channel (`members:<project>` for a file filed in a project, `members` for an
 * unfiled one; migration 0200), in the same table as the team conversation, never in it. Each send is a ROOT line about
 * one file (`ref` output or asset); replies are one level deep, copy the root's ref and stay in its channel.
 *
 * Who: the organization's active workspace members, every role (./members-channel.ts `sendSeat`); a project guest, staff
 * who are not members, another organization and a closed organization (sandboxed, generation or `self_studio` denied)
 * get the rooms' `not_found` before any line is read. Today's rule for a project's conversation lets a viewer talk, so
 * a viewer may send and reply.
 *
 * Open: only while `brandSendOpenFor` says so (BRAND_SEND, BRAND_ROOMS, BRAND_ROOM_NOTIFY, the spine for the
 * organization, migration 0200). Closed: every operation answers exactly what an unknown operation answers (`invalid`)
 * and nothing is read or written.
 *
 * What it never does: a team notice, a Slack call, an event line, anything on a team channel. The only outbound effect
 * is a mention's mail and push in a project's members channel, through the rooms' notice queue (./notices.ts), with the
 * mention words that are true there; everything else is in-app only.
 *
 * Every list is bounded by a named limit (`SEND_LIMITS`, `ROOM_LIMITS`), and a fixed number of statements answers each
 * operation whatever the number of threads (the slice 4a contract lists them).
 *
 * 초대하고 보내기 (slice 4c, ./send-invite.ts): while `BRAND_SEND_INVITE` is open for the organization, `send.post` and
 * `send.reply` also take `invites` (people who are not members yet: the existing workspace invitation, as a viewer, and the
 * line waits for it), every line carries its invitation chips, and `send.lookup` answers what a typed address becomes.
 * Closed, every answer and statement is exactly slice 4a's.
 */
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { isStudioMediaKey, type StudioMediaStore } from '@/lib/brand-studio/media-store';
import { IMAGE_RUNS, LIBRARY_ASSETS, SOUND_RUNS, VIDEO_RUNS, VISIBLE_OUTPUT, liveRunsFilter } from '@/lib/brand-studio/repo';
import { RoomDenied, type RoomSeat } from './access';
import { activeMembersAmong, brandSendOpenFor, MEMBERS_LINE, sendSeat, shownProjectTitles } from './members-channel';
import { ROOM_LIMITS, type RoomErrorCode, type RoomFailure } from './message-contracts';
import { roomAuthorName } from './names';
import { enqueueNotices } from './notices';
import type { Mailer } from '@/lib/notify/mailer';
import {
  attachInvites,
  carriesInvites,
  inviteChips,
  inviteSwitchOpen,
  lookupAddress,
  mailInvites,
  mayInvite,
  planInvites,
  SendInviteDenied,
  type IssuedInvite,
} from './send-invite';
import {
  SEND_LIMITS,
  SendFileSchema,
  SendInboxSchema,
  SendPeopleSchema,
  SendPostInviteSchema,
  SendPostSchema,
  SendReadAllSchema,
  SendReadSchema,
  SendReplyInviteSchema,
  SendReplySchema,
  SendThreadSchema,
  fileRefKeyOf,
  isMembersChannel,
  membersChannelOf,
  parseFileRefKey,
  type SendFileCard,
  type SendFileRef,
  type SendFileThreads,
  type SendInboxPage,
  type SendInboxView,
  type SendInviteChip,
  type SendInviteOutcome,
  type SendMessage,
  type SendOperation,
  type SendPeople,
  type SendPerson,
  type SendPosted,
  type SendReadAllDone,
  type SendReadDone,
  type SendResult,
  type SendThreadPage,
  type SendThreadSummary,
} from './send-contracts';

type Env = Record<string, string | undefined>;

export interface SendDeps {
  sql: SqlRunner;
  media: StudioMediaStore;
  /** 초대하고 보내기 (slice 4c): the existing invitation mail's mailer, used after the commit while `BRAND_ORG_INVITE_EMAIL=on`. */
  mailer?: Mailer | null;
}

class SendDenied extends Error {
  constructor(readonly code: RoomErrorCode) {
    super(code);
    this.name = 'SendDenied';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = (code: RoomErrorCode): RoomFailure => ({ ok: false, code });
const iso = (v: Date | string): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const isoOrNull = (v: Date | string | null | undefined): string | null => (v == null ? null : iso(v));
const flatLine = (body: string | null | undefined): string => (body ?? '').replace(/\s+/g, ' ').trim().slice(0, SEND_LIMITS.lineChars);

async function guard<T>(fn: () => Promise<T>): Promise<T | RoomFailure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof SendDenied || error instanceof RoomDenied || error instanceof SendInviteDenied) return failure(error.code);
    if ((error as { code?: string } | null)?.code === '23505') return failure('conflict');
    throw error;
  }
}

function parse<T>(schema: { safeParse(raw: unknown): { success: true; data: T } | { success: false } }, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new SendDenied('invalid');
  return parsed.data;
}

/* ------------------------------------------------------------------ entry */

/**
 * One `send.*` operation (`POST /api/brand-rooms/messages`, dispatched by ./messages.ts `runRoomOperation`). Only the
 * organization is read before the gate: closed for it, the answer is `invalid` (the unknown operation's) and the
 * database is asked nothing but the remembered schema probes; then the seat, inside the transaction; only then is the
 * rest of the input judged, so nobody who is not seated learns anything from how their input is answered.
 */
export async function runSendOperation(deps: SendDeps, viewer: Viewer, operation: SendOperation, input: unknown, env: Env = process.env): Promise<SendResult | RoomFailure> {
  const raw = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof raw !== 'string' || !UUID.test(raw)) return failure('invalid');
  const organizationId = raw.toLowerCase();
  if (!(await brandSendOpenFor(deps.sql, organizationId, env))) return failure('invalid');
  // 초대하고 보내기 (slice 4c): its own switch and 0202; closed, every answer is exactly what it was before the slice.
  const invitesOpen = await inviteSwitchOpen(deps.sql, env);
  const issued: IssuedInvite[] = [];
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await sendSeat(sql, viewer, organizationId);
      const ctx: Ctx = { sql, media: deps.media, organizationId, me: seat.userId.toLowerCase(), seat, invitesOpen, issued };
      // One lock order for everything that writes a line or a mark, the same as the spine's move (the organization row
      // first, `for update` there, then the threads' roots): the organization row `for key share` before any root,
      // file or mark is touched. A send then reads where its file is filed only after any move in progress committed
      // (or the move waits for it and carries its root), and a reply or a read mark can never hold a root while waiting
      // for the organization row the move holds (no deadlock). Writers do not block each other: `for key share`
      // conflicts only with `for update`.
      // A line that invites someone (slice 4c) takes the row `for update` instead, the lock every invitation writer takes
      // first (the members page, the room invitations, acceptance, revocation): it is then the only invitation writer of
      // the organization until it commits, so two lines inviting one new address make one invitation, and an address
      // cannot join between this line's decision and its write.
      if (WRITES.has(operation)) {
        const inviting = invitesOpen && (operation === 'send.post' || operation === 'send.reply') && mayInvite(seat) && carriesInvites(input);
        if (inviting) await sql.query('select id from brand_organizations where id = $1 for update', [organizationId]);
        else await sql.query('select id from brand_organizations where id = $1 for key share', [organizationId]);
      }
      switch (operation) {
        case 'send.post':
          return post(ctx, input);
        case 'send.reply':
          return reply(ctx, input);
        case 'send.thread':
          return thread(ctx, input);
        case 'send.file':
          return fileThreads(ctx, input);
        case 'send.inbox':
          return inbox(ctx, input);
        case 'send.read':
          return read(ctx, input);
        case 'send.read_all':
          return readAll(ctx, input);
        case 'send.people':
          return people(ctx, input);
        case 'send.lookup':
          return lookupAddress(sql, ctx, input, invitesOpen);
      }
    }),
  );
  // After the commit, as the members page's `invitation.create` does: the existing invitation mail for each new
  // invitation while `BRAND_ORG_INVITE_EMAIL=on` (its state goes into the writer's answer); off, nothing is sent.
  if (issued.length > 0 && result.ok && 'invited' in result && result.invited) {
    const states = await mailInvites({ sql: deps.sql, mailer: deps.mailer ?? null }, viewer, organizationId, issued, env);
    const byEmail = new Map(issued.map((one) => [one.email, states.get(one.inviteId) ?? null]));
    result.invited = result.invited.map((outcome) => (outcome.result === 'invited' ? { ...outcome, mailState: byEmail.get(outcome.email) ?? null } : outcome));
  }
  return result;
}

/** The operations that write a line or a read mark (`send.thread` marks the thread it opens). */
const WRITES: ReadonlySet<SendOperation> = new Set<SendOperation>(['send.post', 'send.reply', 'send.thread', 'send.read', 'send.read_all']);

interface Ctx {
  sql: SqlRunner;
  media: StudioMediaStore;
  organizationId: string;
  me: string;
  seat: RoomSeat;
  /** 초대하고 보내기 is open for the organization (slice 4c): lines carry their invitation chips, sends take `invites`. */
  invitesOpen: boolean;
  /** The invitations this request issued, for the mail after the commit. */
  issued: IssuedInvite[];
}

/** Who reads the chips (`SendMessage.invites`): only while 초대하고 보내기 is open; an owner sees every address. */
type ChipReader = { me: string; owner: boolean } | null;
const chipReaderOf = (ctx: Pick<Ctx, 'invitesOpen' | 'me' | 'seat'>): ChipReader => (ctx.invitesOpen ? { me: ctx.me, owner: ctx.seat.role === 'owner' } : null);

/* ------------------------------------------------------------------ files */

interface FileRow {
  type: 'output' | 'asset';
  id: string;
  kind: string | null;
  name: string | null;
  storage_key: string | null;
  thumb_key: string | null;
  width: number | null;
  height: number | null;
  visible: boolean;
  stored_project_id: string | null;
  /** Filled after the statement: the stored project's title while members are shown it (`shownProjectTitles`). */
  shown_project_title?: string | null;
}

/**
 * The files of this organization named by `refs`, one statement: a run's result (with its run's project) and a library
 * entry. `visible` is the spine's own rule for what a member can open (the assets page's): a result that is ready, not
 * deleted and stored, of a run a member has not removed, of an image, video or sound run (never a fill strip or the
 * editor's export); a library entry that is ready and not deleted. The shown project is the stored one while it can
 * still take work (the spine's `SELECTABLE_PROJECTS`, one more statement). Another organization's file is simply not found.
 */
async function fileRows(sql: SqlRunner, organizationId: string, refs: readonly SendFileRef[]): Promise<Map<string, FileRow>> {
  const outputIds = [...new Set(refs.filter((r) => r.kind === 'output').map((r) => (r as { outputId: string }).outputId.toLowerCase()))];
  const assetIds = [...new Set(refs.filter((r) => r.kind === 'asset').map((r) => (r as { assetId: string }).assetId.toLowerCase()))];
  if (outputIds.length === 0 && assetIds.length === 0) return new Map();
  const live = await liveRunsFilter(sql, 'j');
  const rows = (
    await sql.query<FileRow>(
      `select 'output'::text as type, o.id::text as id, o.kind, null::text as name, o.storage_key, o.thumb_key, o.width, o.height,
              (${VISIBLE_OUTPUT('o')} and ((${IMAGE_RUNS('j')}) or (${VIDEO_RUNS('j')}) or (${SOUND_RUNS('j')})) ${live}) as visible,
              j.brand_project_id::text as stored_project_id
         from brand_studio_outputs o
         join brand_studio_jobs j on j.id = o.job_id and j.organization_id = o.organization_id
        where o.organization_id = $1 and o.id = any($2::uuid[])
       union all
       select 'asset'::text, a.id::text, a.kind, a.name, a.storage_key, a.thumb_key, a.width, a.height,
              (${LIBRARY_ASSETS('a')}) as visible,
              a.brand_project_id::text
         from brand_studio_assets a
        where a.organization_id = $1 and a.id = any($3::uuid[])`,
      [organizationId, outputIds, assetIds],
    )
  ).rows;
  const titles = await shownProjectTitles(sql, organizationId, rows.flatMap((row) => (row.visible && row.stored_project_id ? [String(row.stored_project_id)] : [])));
  return new Map(
    rows.map((row) => [
      `${row.type}:${String(row.id).toLowerCase()}`,
      { ...row, shown_project_title: row.stored_project_id ? (titles.get(String(row.stored_project_id).toLowerCase()) ?? null) : null },
    ]),
  );
}

const mediaUrl = (media: StudioMediaStore, key: string | null): string | null => (key && isStudioMediaKey(key) ? media.url(key) : null);

/** The card of one file: everything null but the ref when it is gone ("지워진 파일"). */
function cardOf(ref: SendFileRef, row: FileRow | undefined, media: StudioMediaStore): SendFileCard {
  const url = row?.visible ? mediaUrl(media, row.storage_key) : null;
  if (!row || !row.visible || !url) {
    return { ref, available: false, kind: null, name: null, url: null, thumbUrl: null, width: null, height: null, project: null };
  }
  const kind = row.kind === 'image' || row.kind === 'video' || row.kind === 'audio' ? row.kind : null;
  return {
    ref,
    available: true,
    kind,
    name: row.type === 'asset' && row.name ? String(row.name).slice(0, ROOM_LIMITS.nameMax) : null,
    url,
    thumbUrl: mediaUrl(media, row.thumb_key),
    width: Number.isInteger(row.width) ? Number(row.width) : null,
    height: Number.isInteger(row.height) ? Number(row.height) : null,
    project: row.stored_project_id && typeof row.shown_project_title === 'string' ? { id: String(row.stored_project_id).toLowerCase(), title: row.shown_project_title } : null,
  };
}

/** A file a member may send: this organization's, and one a member can open. Its STORED project decides the channel. */
async function sendableFile(sql: SqlRunner, organizationId: string, ref: SendFileRef): Promise<{ projectId: string | null }> {
  const row = (await fileRows(sql, organizationId, [ref])).get(fileRefKeyOf(ref));
  // Made up, another organization's, deleted, not ready, a fill strip or the editor's export: one answer.
  if (!row || !row.visible || !row.storage_key) throw new SendDenied('not_found');
  return { projectId: row.stored_project_id ? String(row.stored_project_id).toLowerCase() : null };
}

/* ------------------------------------------------------------------ threads */

interface SummaryRow {
  root_id: string;
  ref_key: string;
  author_id: string | null;
  body: string;
  mentions: string[] | null;
  created_at: Date | string;
  display_name: string | null;
  email: string | null;
  reply_count: number;
  latest_id: string;
  latest_author: string | null;
  latest_body: string | null;
  latest_at: Date | string;
  latest_name: string | null;
  latest_email: string | null;
  mentioned: boolean;
  last_read_at: Date | string | null;
  unread: boolean;
}

interface LineRow {
  id: string;
  parent_id: string | null;
  author_id: string | null;
  body: string;
  mentions: string[] | null;
  created_at: Date | string;
  display_name: string | null;
  email: string | null;
}

/** The names of the people lines name, one statement (as the room conversation names them). */
async function namesOf(sql: SqlRunner, ids: Iterable<string>): Promise<Map<string, string | null>> {
  const wanted = [...new Set([...ids].map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
  if (wanted.length === 0) return new Map();
  const rows = (
    await sql.query<{ id: string; display_name: string | null; email: string | null }>('select id::text as id, display_name, email from profiles where id = any($1::uuid[])', [wanted])
  ).rows;
  return new Map(rows.map((row) => [String(row.id).toLowerCase(), roomAuthorName('brand', row.display_name, row.email)]));
}

/** `chips` (slice 4c) only while 초대하고 보내기 is open; otherwise the line is exactly slice 4a's (no `invites` field). */
function messageOf(row: LineRow, rootId: string, me: string, names: Map<string, string | null>, chips?: Map<string, SendInviteChip[]> | null): SendMessage {
  const authorId = row.author_id ? String(row.author_id).toLowerCase() : null;
  const id = String(row.id).toLowerCase();
  const message: SendMessage = {
    id,
    rootId,
    parentId: row.parent_id ? String(row.parent_id).toLowerCase() : null,
    authorId,
    authorName: roomAuthorName('brand', row.display_name, row.email),
    mine: authorId === me,
    body: String(row.body ?? ''),
    mentions: (row.mentions ?? []).map((id) => String(id).toLowerCase()).map((id) => ({ id, name: names.get(id) ?? null })),
    createdAt: iso(row.created_at),
  };
  if (chips) message.invites = chips.get(id) ?? [];
  return message;
}

/** The invitation chips of `rows` for `reader` (one statement), or null while 초대하고 보내기 is closed (no statement). */
async function chipsOf(sql: SqlRunner, organizationId: string, rows: ReadonlyArray<{ id: string; author_id: string | null }>, reader: ChipReader): Promise<Map<string, SendInviteChip[]> | null> {
  if (!reader) return null;
  return inviteChips(
    sql,
    organizationId,
    rows.map((row) => ({ id: String(row.id), authorId: row.author_id ? String(row.author_id) : null })),
    reader,
  );
}

/**
 * The summaries of members threads of this organization, in the order of `rootIds` (a root that is not a live members
 * root of this organization is left out). Four statements whatever the number: the threads with their newest line, read
 * mark and the caller's flags; the files; the titles of the projects members are shown; the names the roots name.
 */
async function threadSummaries(ctx: Pick<Ctx, 'sql' | 'media' | 'organizationId' | 'me'> & { chips?: ChipReader }, rootIds: readonly string[]): Promise<SendThreadSummary[]> {
  const ids = [...new Set(rootIds.map((id) => id.toLowerCase()))].filter((id) => UUID.test(id));
  if (ids.length === 0) return [];
  const rows = (
    await ctx.sql.query<SummaryRow>(
      `select r.id::text as root_id, r.ref_key, r.author_id::text as author_id, r.body, r.mentions::text[] as mentions, r.created_at,
              rp.display_name, rp.email,
              (select count(*)::int from brand_room_messages x where x.parent_id = r.id and x.deleted_at is null) as reply_count,
              l.id::text as latest_id, l.author_id::text as latest_author, l.body as latest_body, l.created_at as latest_at,
              lp.display_name as latest_name, lp.email as latest_email,
              (r.mentions @> array[$3::uuid]
                or exists (select 1 from brand_room_messages x where x.parent_id = r.id and x.deleted_at is null and x.mentions @> array[$3::uuid])) as mentioned,
              tr.last_read_at,
              ((r.author_id is distinct from $3::uuid and r.created_at > coalesce(tr.last_read_at, '-infinity'::timestamptz))
                or exists (select 1 from brand_room_messages x where x.parent_id = r.id and x.deleted_at is null
                            and x.author_id is distinct from $3::uuid and x.created_at > coalesce(tr.last_read_at, '-infinity'::timestamptz))) as unread
         from brand_room_messages r
         left join profiles rp on rp.id = r.author_id
         left join brand_room_thread_reads tr on tr.root_message_id = r.id and tr.user_id = $3::uuid
         left join lateral (
           select z.id, z.author_id, z.body, z.created_at from (
             select r.id, r.author_id, r.body, r.created_at
             union all
             select x.id, x.author_id, x.body, x.created_at from brand_room_messages x where x.parent_id = r.id and x.deleted_at is null
           ) z order by z.created_at desc, z.id desc limit 1
         ) l on true
         left join profiles lp on lp.id = l.author_id
        where r.organization_id = $1 and r.id = any($2::uuid[]) and r.parent_id is null and r.deleted_at is null and ${MEMBERS_LINE('r')}`,
      [ctx.organizationId, ids, ctx.me],
    )
  ).rows;
  const refs = rows.map((row) => parseFileRefKey(row.ref_key)).filter((ref): ref is SendFileRef => ref !== null);
  const files = await fileRows(ctx.sql, ctx.organizationId, refs);
  const names = await namesOf(
    ctx.sql,
    rows.flatMap((row) => (row.mentions ?? []).map(String)),
  );
  // 초대하고 보내기 (slice 4c): the roots' invitation chips, one more statement, only while it is open (never for the bell).
  const chips = await chipsOf(ctx.sql, ctx.organizationId, rows.map((row) => ({ id: row.root_id, author_id: row.author_id })), ctx.chips ?? null);
  const byId = new Map<string, SendThreadSummary>();
  for (const row of rows) {
    const ref = parseFileRefKey(row.ref_key);
    if (!ref) continue;
    const rootId = String(row.root_id).toLowerCase();
    const root = messageOf({ ...row, id: row.root_id, parent_id: null }, rootId, ctx.me, names, chips);
    const latestAuthor = row.latest_author ? String(row.latest_author).toLowerCase() : null;
    byId.set(rootId, {
      rootId,
      root,
      file: cardOf(ref, files.get(fileRefKeyOf(ref)), ctx.media),
      replyCount: Number(row.reply_count ?? 0),
      lastActivityAt: iso(row.latest_at),
      latest: {
        messageId: String(row.latest_id).toLowerCase(),
        authorId: latestAuthor,
        authorName: roomAuthorName('brand', row.latest_name, row.latest_email),
        mine: latestAuthor === ctx.me,
        line: flatLine(row.latest_body),
        at: iso(row.latest_at),
      },
      mentioned: row.mentioned === true,
      unread: row.unread === true,
      lastReadAt: isoOrNull(row.last_read_at),
    });
  }
  return ids.map((id) => byId.get(id)).filter((s): s is SendThreadSummary => Boolean(s));
}

/** A live members root of this organization (locked when writing to it), or `not_found`: a staff channel's line, another organization's, a reply, made up. */
async function membersRoot(sql: SqlRunner, organizationId: string, rootId: string, lock: boolean): Promise<{ id: string; project_id: string | null; channel: string; ref: unknown; ref_key: string }> {
  const row = (
    await sql.query<{ id: string; project_id: string | null; channel: string; ref: unknown; ref_key: string }>(
      `select r.id::text as id, r.project_id::text as project_id, r.channel, r.ref, r.ref_key from brand_room_messages r
        where r.id = $1 and r.organization_id = $2 and r.parent_id is null and r.deleted_at is null and ${MEMBERS_LINE('r')}${lock ? ' for update' : ''}`,
      [rootId, organizationId],
    )
  ).rows[0];
  if (!row || !isMembersChannel(row.channel) || !parseFileRefKey(row.ref_key)) throw new SendDenied('not_found');
  return { ...row, id: String(row.id).toLowerCase(), project_id: row.project_id ? String(row.project_id).toLowerCase() : null };
}

/* ------------------------------------------------------------------ writes */

/** The person's line with this request id, if any (one send per request id, across every channel: 0082's unique key). */
async function priorLine(ctx: Ctx, requestId: string): Promise<{ id: string; parent_id: string | null; channel: string; ref_key: string | null } | null> {
  return (
    (
      await ctx.sql.query<{ id: string; parent_id: string | null; channel: string; ref_key: string | null }>(
        'select id::text as id, parent_id::text as parent_id, channel, ref_key from brand_room_messages where organization_id = $1 and author_id = $2 and request_id = $3',
        [ctx.organizationId, ctx.me, requestId],
      )
    ).rows[0] ?? null
  );
}

/** The rooms' send rate, shared with the team channels: `ROOM_LIMITS.messagesPerMinute` lines per person per organization. */
async function requireRate(ctx: Ctx): Promise<void> {
  const recent = (
    await ctx.sql.query<{ n: number }>(
      "select count(*)::int as n from brand_room_messages where author_id = $1 and organization_id = $2 and kind = 'text' and created_at > now() - interval '1 minute'",
      [ctx.me, ctx.organizationId],
    )
  ).rows[0]!.n;
  if (Number(recent) >= ROOM_LIMITS.messagesPerMinute) throw new SendDenied('rate_limited');
}

/**
 * Who a line may name (the coordinator's decision 5): active members of this organization only, the writer included
 * (naming yourself notifies nobody). Anyone else (a project guest, staff who are not members, a removed member,
 * another organization's member, an id that does not exist) refuses the whole line with one answer, `invalid`.
 */
async function requireMembers(ctx: Ctx, mentions: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(mentions.map((id) => id.toLowerCase()))];
  if (wanted.length === 0) return [];
  const members = await activeMembersAmong(ctx.sql, ctx.organizationId, wanted);
  if (wanted.some((id) => !members.has(id))) throw new SendDenied('invalid');
  return wanted;
}

async function insertLine(
  ctx: Ctx,
  line: { projectId: string | null; channel: string; parentId: string | null; body: string; ref: unknown; refKey: string; mentions: string[]; requestId: string },
): Promise<string> {
  return String(
    (
      await ctx.sql.query<{ id: string }>(
        `insert into brand_room_messages (organization_id, project_id, channel, parent_id, author_id, author_role, kind, body, ref, ref_key,
                                          attachments, mentions, mentions_team, request_id)
           values ($1, $2, $3, $4, $5, 'brand', 'text', $6, $7::jsonb, $8, '[]'::jsonb, $9::uuid[], false, $10) returning id::text as id`,
        [ctx.organizationId, line.projectId, line.channel, line.parentId, ctx.me, line.body, JSON.stringify(line.ref), line.refKey, line.mentions, line.requestId],
      )
    ).rows[0]!.id,
  ).toLowerCase();
}

async function postedAnswer(ctx: Ctx, rootId: string, messageId: string): Promise<SendPosted> {
  const reader = chipReaderOf(ctx);
  const [summary] = await threadSummaries({ ...ctx, chips: reader }, [rootId]);
  if (!summary) throw new SendDenied('not_found');
  if (messageId === rootId) return { ok: true, thread: summary, message: summary.root };
  const row = (
    await ctx.sql.query<LineRow>(
      `select x.id::text as id, x.parent_id::text as parent_id, x.author_id::text as author_id, x.body, x.mentions::text[] as mentions, x.created_at,
              p.display_name, p.email
         from brand_room_messages x left join profiles p on p.id = x.author_id
        where x.id = $1 and x.parent_id = $2 and x.organization_id = $3`,
      [messageId, rootId, ctx.organizationId],
    )
  ).rows[0];
  if (!row) throw new SendDenied('not_found');
  const names = await namesOf(ctx.sql, (row.mentions ?? []).map(String));
  return { ok: true, thread: summary, message: messageOf(row, rootId, ctx.me, names, await chipsOf(ctx.sql, ctx.organizationId, [row], reader)) };
}

/**
 * `send.post`: a new thread about one file. The project and the channel come from the FILE (its stored project; none =
 * `members`), never from the request (a `projectId` or `channel` field is refused by the strict schema). A file the
 * caller cannot open, a deleted one and another organization's answer exactly like a made-up id (`not_found`).
 */
async function post(ctx: Ctx, input: unknown): Promise<SendPosted> {
  // While 초대하고 보내기 is closed the slice 4a schema answers alone: an `invites` field is an unknown field (`invalid`).
  const v: { requestId: string; file: SendFileRef; body: string; mentions: string[]; invites: string[] } = ctx.invitesOpen ? parse(SendPostInviteSchema, input) : { ...parse(SendPostSchema, input), invites: [] };
  if (!ctx.seat.canTalk) throw new SendDenied('forbidden');
  if (v.invites.length > 0 && !mayInvite(ctx.seat)) throw new SendDenied('forbidden');
  const ref: SendFileRef = v.file.kind === 'output' ? { kind: 'output', outputId: v.file.outputId.toLowerCase() } : { kind: 'asset', assetId: v.file.assetId.toLowerCase() };
  const refKey = fileRefKeyOf(ref);
  const prior = await priorLine(ctx, v.requestId);
  if (prior) {
    // The same request again: the line it made. The id reused for anything else: `conflict`.
    if (prior.parent_id !== null || prior.ref_key !== refKey || !isMembersChannel(prior.channel)) throw new SendDenied('conflict');
    return postedAnswer(ctx, String(prior.id).toLowerCase(), String(prior.id).toLowerCase());
  }
  await requireRate(ctx);
  // The organization row is already held `for key share` (`runSendOperation`), so where the file is filed is read only
  // after any move in progress committed, and a move that starts later waits for this root and carries it.
  const file = await sendableFile(ctx.sql, ctx.organizationId, ref);
  const named = await requireMembers(ctx, v.mentions);
  // 초대하고 보내기 (slice 4c): what each address becomes, every refusal before anything is written.
  const { plan, mentions } = await planInvites(ctx.sql, ctx, { invites: v.invites, body: v.body, mentions: named });
  const channel = membersChannelOf(file.projectId);
  const id = await insertLine(ctx, { projectId: file.projectId, channel, parentId: null, body: v.body, ref, refKey, mentions, requestId: v.requestId });
  const invited = await attachInvites(ctx.sql, ctx, { messageId: id, requestId: v.requestId }, plan);
  ctx.issued.push(...invited.issued);
  await enqueueNotices(ctx.sql, { type: 'member', organizationId: ctx.organizationId, projectId: file.projectId, channel, messageId: id, rootId: id, actorId: ctx.me, mentions, reply: false });
  return withInvited(await postedAnswer(ctx, id, id), invited.outcomes);
}

/** The writer's answer with what each address became (only when the request named any). */
function withInvited(answer: SendPosted, outcomes: SendInviteOutcome[]): SendPosted {
  return outcomes.length > 0 ? { ...answer, invited: outcomes } : answer;
}

/**
 * `send.reply`: one level, in the root's channel (copied from the locked root, so a reply never changes channel and
 * follows a move that commits first), carrying the root's file ref. A root on a team channel, of another organization, a
 * reply used as a root, or a made-up id: `not_found`.
 */
async function reply(ctx: Ctx, input: unknown): Promise<SendPosted> {
  const v: { requestId: string; rootId: string; body: string; mentions: string[]; invites: string[] } = ctx.invitesOpen ? parse(SendReplyInviteSchema, input) : { ...parse(SendReplySchema, input), invites: [] };
  if (!ctx.seat.canTalk) throw new SendDenied('forbidden');
  if (v.invites.length > 0 && !mayInvite(ctx.seat)) throw new SendDenied('forbidden');
  const rootId = v.rootId.toLowerCase();
  const prior = await priorLine(ctx, v.requestId);
  if (prior) {
    if (!prior.parent_id || String(prior.parent_id).toLowerCase() !== rootId || !isMembersChannel(prior.channel)) throw new SendDenied('conflict');
    return postedAnswer(ctx, rootId, String(prior.id).toLowerCase());
  }
  await requireRate(ctx);
  const root = await membersRoot(ctx.sql, ctx.organizationId, rootId, true);
  const named = await requireMembers(ctx, v.mentions);
  const { plan, mentions } = await planInvites(ctx.sql, ctx, { invites: v.invites, body: v.body, mentions: named });
  const id = await insertLine(ctx, { projectId: root.project_id, channel: root.channel, parentId: root.id, body: v.body, ref: root.ref, refKey: root.ref_key, mentions, requestId: v.requestId });
  const invited = await attachInvites(ctx.sql, ctx, { messageId: id, requestId: v.requestId }, plan);
  ctx.issued.push(...invited.issued);
  await ctx.sql.query('update brand_room_messages set updated_at = now() where id = $1', [root.id]);
  await enqueueNotices(ctx.sql, { type: 'member', organizationId: ctx.organizationId, projectId: root.project_id, channel: root.channel, messageId: id, rootId: root.id, actorId: ctx.me, mentions, reply: true });
  return withInvited(await postedAnswer(ctx, root.id, id), invited.outcomes);
}

/** Move the caller's read mark on one thread forward (never back), at most to now. */
async function markThread(ctx: Ctx, rootId: string, at: string | null | undefined): Promise<string> {
  const row = (
    await ctx.sql.query<{ at: Date | string }>(
      `insert into brand_room_thread_reads (organization_id, root_message_id, user_id, last_read_at)
         values ($1, $2, $3, least(coalesce($4::timestamptz, now()), now()))
       on conflict (root_message_id, user_id)
         do update set last_read_at = greatest(brand_room_thread_reads.last_read_at, excluded.last_read_at)
       returning last_read_at as at`,
      [ctx.organizationId, rootId, ctx.me, at ?? null],
    )
  ).rows[0]!;
  return iso(row.at);
}

/** `send.read`: the caller's mark on one thread (only theirs; a colleague's is never touched). */
async function read(ctx: Ctx, input: unknown): Promise<SendReadDone> {
  const v = parse(SendReadSchema, input);
  const root = await membersRoot(ctx.sql, ctx.organizationId, v.rootId.toLowerCase(), false);
  return { ok: true, rootId: root.id, lastReadAt: await markThread(ctx, root.id, v.at) };
}

/* ------------------------------------------------------------------ reads */

/** `send.thread`: the root and its replies (oldest first, at most `ROOM_LIMITS.threadMax`); opening it marks it read for the caller. */
async function thread(ctx: Ctx, input: unknown): Promise<SendThreadPage> {
  const v = parse(SendThreadSchema, input);
  const root = await membersRoot(ctx.sql, ctx.organizationId, v.rootId.toLowerCase(), false);
  if (v.markRead) await markThread(ctx, root.id, null);
  const reader = chipReaderOf(ctx);
  const [summary] = await threadSummaries({ ...ctx, chips: reader }, [root.id]);
  if (!summary) throw new SendDenied('not_found');
  const rows = (
    await ctx.sql.query<LineRow>(
      `select x.id::text as id, x.parent_id::text as parent_id, x.author_id::text as author_id, x.body, x.mentions::text[] as mentions, x.created_at,
              p.display_name, p.email
         from brand_room_messages x left join profiles p on p.id = x.author_id
        where x.parent_id = $1 and x.organization_id = $2 and x.deleted_at is null
        order by x.created_at, x.id limit $3`,
      [root.id, ctx.organizationId, ROOM_LIMITS.threadMax],
    )
  ).rows;
  const names = await namesOf(ctx.sql, rows.flatMap((row) => (row.mentions ?? []).map(String)));
  const chips = await chipsOf(ctx.sql, ctx.organizationId, rows, reader);
  return { ok: true, thread: summary, replies: rows.map((row) => messageOf(row, root.id, ctx.me, names, chips)) };
}

/** `send.file`: the threads about one file, newest root first (at most `SEND_LIMITS.fileThreads`), and its card. */
async function fileThreads(ctx: Ctx, input: unknown): Promise<SendFileThreads> {
  const v = parse(SendFileSchema, input);
  const ref: SendFileRef = v.file.kind === 'output' ? { kind: 'output', outputId: v.file.outputId.toLowerCase() } : { kind: 'asset', assetId: v.file.assetId.toLowerCase() };
  const refKey = fileRefKeyOf(ref);
  const row = (await fileRows(ctx.sql, ctx.organizationId, [ref])).get(refKey);
  const roots = (
    await ctx.sql.query<{ id: string }>(
      `select r.id::text as id from brand_room_messages r
        where r.organization_id = $1 and r.ref_key = $2 and r.parent_id is null and r.deleted_at is null and ${MEMBERS_LINE('r')}
        order by r.created_at desc, r.id desc limit $3`,
      [ctx.organizationId, refKey, SEND_LIMITS.fileThreads],
    )
  ).rows.map((r) => String(r.id).toLowerCase());
  // No file a member can open by that name and no thread about it: the made-up id's answer (a deleted, not-ready or
  // internal file of this organization says nothing about itself until someone has talked about it).
  if ((!row || !row.visible) && roots.length === 0) throw new SendDenied('not_found');
  return { ok: true, file: cardOf(ref, row, ctx.media), threads: await threadSummaries({ ...ctx, chips: chipReaderOf(ctx) }, roots) };
}

/* ------------------------------------------------------------------ inbox */

/**
 * "나에게 온 것" (the coordinator's decision 10) as SQL: the live roots on this organization's members channels where the
 * caller wrote the root or a reply, or is named in the root or a reply; `last_at` the newest live line, `mentioned` the
 * caller named anywhere in it, `unread` a live line by someone else newer than the caller's mark. `$1` the organization,
 * `$2` the caller. The candidate lines are found through the 0200 partial indexes (the caller's lines, the lines naming
 * them); the work grows with the caller's own threads, never with the organization's.
 */
const INBOX = `
  with mine as (
    select distinct coalesce(m.parent_id, m.id) as root_id
      from brand_room_messages m
     where m.organization_id = $1 and ${MEMBERS_LINE('m')} and m.deleted_at is null
       and (m.author_id = $2::uuid or m.mentions @> array[$2::uuid])
  ), t as (
    select r.id,
           greatest(r.created_at, coalesce((select max(x.created_at) from brand_room_messages x where x.parent_id = r.id and x.deleted_at is null), r.created_at)) as last_at,
           (r.mentions @> array[$2::uuid]
             or exists (select 1 from brand_room_messages x where x.parent_id = r.id and x.deleted_at is null and x.mentions @> array[$2::uuid])) as mentioned,
           ((r.author_id is distinct from $2::uuid and r.created_at > coalesce(tr.last_read_at, '-infinity'::timestamptz))
             or exists (select 1 from brand_room_messages x where x.parent_id = r.id and x.deleted_at is null
                         and x.author_id is distinct from $2::uuid and x.created_at > coalesce(tr.last_read_at, '-infinity'::timestamptz))) as unread
      from mine
      join brand_room_messages r on r.id = mine.root_id
      left join brand_room_thread_reads tr on tr.root_message_id = r.id and tr.user_id = $2::uuid
     where r.organization_id = $1 and r.parent_id is null and r.deleted_at is null and ${MEMBERS_LINE('r')}
  )`;

const KEY_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})$/;

function encodeCursor(k: string, i: string): string {
  return Buffer.from(JSON.stringify([k, i]), 'utf8').toString('base64url');
}

/** A cursor this module wrote, or null (anything else is `invalid`). */
function decodeCursor(raw: string): { k: string; i: string } | null {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [k, i] = value as unknown[];
  if (typeof k !== 'string' || typeof i !== 'string' || !UUID.test(i)) return null;
  const m = KEY_TIME.exec(k);
  if (!m) return null;
  const at = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])));
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 19) !== k.slice(0, 19)) return null;
  return { k, i: i.toLowerCase() };
}

/** One page of the caller's threads (root ids by last activity, newest first; ties by root id), and whether more follow. */
async function inboxKeys(
  ctx: Pick<Ctx, 'sql' | 'organizationId' | 'me'>,
  options: { mentionsOnly: boolean; after: { k: string; i: string } | null; limit: number },
): Promise<{ ids: string[]; next: string | null }> {
  const params: unknown[] = [ctx.organizationId, ctx.me, options.mentionsOnly, options.limit + 1];
  const after = options.after ? `and (t.last_at, t.id) < ($5::timestamp at time zone 'UTC', $6::uuid)` : '';
  if (options.after) params.push(options.after.k, options.after.i);
  const rows = (
    await ctx.sql.query<{ id: string; k: string }>(
      `${INBOX}
       select t.id::text as id, to_char(t.last_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as k from t
        where ($3::boolean = false or t.mentioned) ${after}
        order by t.last_at desc, t.id desc
        limit $4`,
      params,
    )
  ).rows;
  const page = rows.slice(0, options.limit);
  const last = page[page.length - 1];
  return { ids: page.map((row) => String(row.id).toLowerCase()), next: rows.length > options.limit && last ? encodeCursor(String(last.k), String(last.id).toLowerCase()) : null };
}

/** The unread threads of the caller's inbox, and those of them that name the caller (each capped at `SEND_LIMITS.unreadCountMax`). */
async function inboxCounts(ctx: Pick<Ctx, 'sql' | 'organizationId' | 'me'>): Promise<{ unread: number; mentionsUnread: number }> {
  const row = (
    await ctx.sql.query<{ unread: number; mentions: number }>(
      `${INBOX}
       select count(*)::int as unread, count(*) filter (where c.mentioned)::int as mentions
         from (select t.mentioned from t where t.unread limit $3) c`,
      [ctx.organizationId, ctx.me, SEND_LIMITS.unreadCountMax],
    )
  ).rows[0];
  return { unread: Number(row?.unread ?? 0), mentionsUnread: Number(row?.mentions ?? 0) };
}

/** `send.inbox`: one page (`SEND_LIMITS.inboxPage`) of "나에게 온 것", or of its "멘션" view, with the unread counts. */
async function inbox(ctx: Ctx, input: unknown): Promise<SendInboxPage> {
  const v = parse(SendInboxSchema, input);
  const after = v.cursor ? decodeCursor(v.cursor) : null;
  if (v.cursor && !after) throw new SendDenied('invalid');
  const page = await inboxKeys(ctx, { mentionsOnly: v.view === 'mentions', after, limit: SEND_LIMITS.inboxPage });
  const counts = await inboxCounts(ctx);
  return { ok: true, view: v.view, threads: await threadSummaries({ ...ctx, chips: chipReaderOf(ctx) }, page.ids), next: page.next, ...counts };
}

/** `send.read_all` ("모두 읽음"): the caller's unread inbox threads, newest first, at most `SEND_LIMITS.readAllMax`, marked read now. */
async function readAll(ctx: Ctx, input: unknown): Promise<SendReadAllDone> {
  parse(SendReadAllSchema, input);
  const rows = (
    await ctx.sql.query<{ id: string }>(
      `${INBOX}
       select t.id::text as id from t where t.unread order by t.last_at desc, t.id desc limit $3`,
      [ctx.organizationId, ctx.me, SEND_LIMITS.readAllMax + 1],
    )
  ).rows.map((row) => String(row.id).toLowerCase());
  const marked = rows.slice(0, SEND_LIMITS.readAllMax);
  if (marked.length > 0) {
    // In id order, so two "모두 읽음" of the same person at once take the marks' keys in the same order (no deadlock).
    await ctx.sql.query(
      `insert into brand_room_thread_reads (organization_id, root_message_id, user_id, last_read_at)
         select $1, r.id, $3, now() from unnest($2::uuid[]) as r(id) order by r.id
       on conflict (root_message_id, user_id)
         do update set last_read_at = greatest(brand_room_thread_reads.last_read_at, excluded.last_read_at)`,
      [ctx.organizationId, marked, ctx.me],
    );
  }
  return { ok: true, marked: marked.length, more: rows.length > SEND_LIMITS.readAllMax };
}

/** `send.people`: who may be named (the organization's active members, every role), by name, at most `SEND_LIMITS.peopleMax`. */
async function people(ctx: Ctx, input: unknown): Promise<SendPeople> {
  parse(SendPeopleSchema, input);
  const rows = (
    await ctx.sql.query<{ user_id: string; role: string; display_name: string | null; email: string | null }>(
      `select m.user_id::text as user_id, m.role, p.display_name, p.email
         from brand_memberships m join profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.status = 'active'
        order by m.created_at, m.user_id
        limit $2`,
      [ctx.organizationId, SEND_LIMITS.peopleMax],
    )
  ).rows;
  const list: SendPerson[] = [];
  for (const row of rows) {
    const role = row.role === 'owner' || row.role === 'editor' || row.role === 'viewer' ? row.role : null;
    const name = roomAuthorName('brand', row.display_name, row.email);
    if (!role || !name) continue;
    const id = String(row.user_id).toLowerCase();
    list.push({ id, name, role, me: id === ctx.me });
  }
  return { ok: true, people: list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) };
}

/* ------------------------------------------------------------------ the bell */

/**
 * The bell's members-thread part (./bell.ts), for a seat the bell already admitted, inside its savepoint: the newest
 * `limit` threads of the caller's inbox (or of its "멘션" view), whether more follow, and the two unread counts.
 * Null while 보내기 is closed for the organization (then the bell is exactly what it was before slice 4a).
 */
export async function sendBellPart(
  sql: SqlRunner,
  media: StudioMediaStore,
  seat: RoomSeat,
  options: { view: SendInboxView; limit: number; env?: Env },
): Promise<{ threads: SendThreadSummary[]; more: boolean; unread: number; mentionsUnread: number } | null> {
  if (seat.role === 'guest') return null;
  const organizationId = seat.organizationId.toLowerCase();
  if (!(await brandSendOpenFor(sql, organizationId, options.env ?? process.env))) return null;
  const ctx = { sql, media, organizationId, me: seat.userId.toLowerCase() };
  const page = await inboxKeys(ctx, { mentionsOnly: options.view === 'mentions', after: null, limit: options.limit });
  const counts = await inboxCounts(ctx);
  return { threads: await threadSummaries(ctx, page.ids), more: page.next !== null, ...counts };
}
