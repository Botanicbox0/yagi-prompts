/**
 * Project room conversations (docs/BRAND-ROOMS.md §4): one channel per commissioned project plus the
 * organization's general channel, one level of threads, mentions, six reactions, files, edits and
 * deletions of one's own lines, pins, read marks, and the event lines other slices post.
 *
 * Brand side: every read and write passes the room seat first (lib/brand-rooms/access.ts: sign-in ->
 * membership or a project invitation -> the sandbox hardline and the generation policy (404) -> role),
 * then, for a project channel, `requireRoomProject` (a guest reaches only the projects they were invited
 * to; the general channel is members only). Everyone seated may talk; owners and editors may pin.
 * Team side (`staff*`): the admin flag is re-read from the profile row inside the transaction, team
 * lines carry `author_role = 'studio'`, and a sandboxed or generation-closed organization does not exist.
 *
 * Customer-visible text does not live here: failures are `ROOM_ERROR_CODES` only. The one sentence this
 * module writes is the internal team notice (`RoomNotice`), which the route hands to the team notifier
 * after the answer has gone out and which never reaches a customer.
 */
import { randomBytes } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { interpolate } from '@/lib/i18n/format';
import type { UploadLimitReason } from '@/lib/brands/upload-limits-format';
import {
  completePendingRoomUpload,
  consumePendingRoomUploadKeys,
  isOrganizationUploadApproved,
  reservePendingRoomUpload,
} from '@/lib/brands/upload-gate';
import { STAGING_BUCKET, type StorageDriver } from '@/lib/storage';
import { adminUrl } from '@/lib/seo/site-url';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { enqueueTeamNotice } from '@/lib/brands/team-notice-outbox';
import { loadFeaturePolicies } from '@/lib/brands/entitlements';
import {
  adjustOrganizationStorageBytes,
  checkStorageQuotaForUpload,
  reconcileOrganizationStorage,
} from '@/lib/brands/storage-quota';
import { imageInfo, sniffMime, videoInfo } from '@/lib/brand-studio/files';
import { isStudioMediaKey, type StudioMediaStore } from '@/lib/brand-studio/media-store';
import { dropUnreferencedStudioKeys } from '@/lib/brand-studio/physical-cleanup';
import { publicNotesOnly, teamNotesReady } from '@/lib/brand-studio/review-visibility';
import type { RoomAlertItem, RoomSummary } from '@/components/brand-rooms/seams';
import { canTalkIn, requireRoomProject, RoomDenied, roomSeat, type RoomSeat } from './access';
import type { RoomEventKind, RoomRef } from './events';
import { enqueueNotices } from './notices';
import {
  AttachmentCompleteSchema,
  AttachmentReserveSchema,
  ChannelReadSchema,
  GENERAL_CHANNEL,
  MessageEditSchema,
  MessagePinSchema,
  MessageRefSchema,
  MessageSendSchema,
  ReactionToggleSchema,
  ROOM_ATTACHMENT_TYPES,
  ROOM_LIMITS,
  ROOM_REACTIONS,
  ROOM_STAGING_KEY,
  StreamQuerySchema,
  attachmentKindOf,
  attachmentMimeOfKey,
  isRoomOperation,
  parseRefKey,
  refKeyOf,
  type RoomAttachment,
  type RoomAttachmentDone,
  type RoomAuthorRole,
  type RoomDone,
  type RoomErrorCode,
  type RoomEventDetail,
  type RoomFailure,
  type RoomLegacyMessage,
  type RoomMessage,
  type RoomMessageDone,
  type RoomOperationResult,
  type RoomPerson,
  type RoomReaction,
  type RoomReactionsDone,
  type RoomReactionView,
  type RoomReadDone,
  type RoomRefPage,
  type RoomRefView,
  type RoomStreamPage,
  type RoomThreadPage,
  type RoomUploadReserved,
} from './message-contracts';

export interface RoomMessageDeps {
  sql: SqlRunner;
  media: StudioMediaStore;
  /** Uploads only (`attachment.*`): the staging bucket the browser puts bytes in. */
  staging?: Pick<StorageDriver, 'read' | 'putStaging' | 'signedUploadUrl' | 'servesSignedUrls' | 'releaseStaging'>;
  /** Optional best-effort cleanup of staging objects once copied to `media`. */
  purgeStagingKey?: (key: string) => Promise<void>;
}

/** What the team is told after a brand member writes. Internal only. */
export interface RoomNotice {
  organizationId: string;
  userId: string;
  messageId: string;
  body: string;
}

export class MessageDenied extends Error {
  constructor(
    readonly code: RoomErrorCode,
    readonly reason?: UploadLimitReason,
  ) {
    super(code);
    this.name = 'MessageDenied';
  }
}

const failure = (code: RoomErrorCode, reason?: UploadLimitReason): RoomFailure =>
  reason ? { ok: false, code, reason } : { ok: false, code };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run `fn`; a refusal becomes its code, a unique-key race becomes `conflict`. Anything else propagates. */
async function guard<T>(fn: () => Promise<T>): Promise<T | RoomFailure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof MessageDenied) return failure(error.code, error.reason);
    if (error instanceof RoomDenied) return failure(error.code);
    if ((error as { code?: string } | null)?.code === '23505') return failure('conflict');
    throw error;
  }
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: Date | string | null | undefined): string | null => (v == null ? null : iso(v));

/* ------------------------------------------------------------------ scope */

/** Who is reading and what they may do, the same shape for a brand seat and the team. */
interface Reader {
  organizationId: string;
  viewerId: string;
  channel: string;
  projectId: string | null;
  title: string | null;
  team: boolean;
  canTalk: boolean;
  canPin: boolean;
  /** A brand member (not a project guest). */
  member: boolean;
}

/** `general` (members only) or a project this seat may open. */
async function brandReader(sql: SqlRunner, seat: RoomSeat, channel: string): Promise<Reader> {
  const base = { organizationId: seat.organizationId, viewerId: seat.userId, team: false, canTalk: seat.canTalk, canPin: seat.canEdit, member: seat.role !== 'guest' };
  if (channel === GENERAL_CHANNEL) {
    if (seat.role === 'guest') throw new RoomDenied('not_found');
    return { ...base, channel: GENERAL_CHANNEL, projectId: null, title: null };
  }
  const project = await requireRoomProject(sql, seat, channel);
  const id = project.id.toLowerCase();
  // A guest invited to view only reads this room and posts nothing (lib/brand-rooms/access.ts `canTalkIn`).
  return { ...base, canTalk: canTalkIn(seat, id), channel: id, projectId: id, title: project.title };
}

/* ------------------------------------------------------------------ rows */

interface MessageRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  channel: string;
  parent_id: string | null;
  author_id: string | null;
  author_role: RoomAuthorRole;
  kind: 'text' | 'event';
  body: string;
  event: string | null;
  detail: Record<string, unknown> | null;
  ref: RoomRef | null;
  ref_key: string | null;
  attachments: unknown;
  mentions: string[] | null;
  mentions_team: boolean;
  pinned_at: Date | string | null;
  edited_at: Date | string | null;
  deleted_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  display_name: string | null;
  email: string | null;
  reply_count: number;
  last_reply_at: Date | string | null;
}

const MESSAGE_SELECT = `
  select m.id, m.organization_id, m.project_id, m.channel, m.parent_id, m.author_id, m.author_role, m.kind, m.body, m.event,
         m.detail, m.ref, m.ref_key, m.attachments, m.mentions, m.mentions_team, m.pinned_at, m.edited_at, m.deleted_at,
         m.created_at, m.updated_at, p.display_name, p.email,
         (select count(*)::int from brand_room_messages r where r.parent_id = m.id and r.deleted_at is null) as reply_count,
         (select max(r.created_at) from brand_room_messages r where r.parent_id = m.id and r.deleted_at is null) as last_reply_at
    from brand_room_messages m
    left join profiles p on p.id = m.author_id`;

/** A display name: the profile's own name, else (brand side only) the part of the address before the @. */
export function roomAuthorName(role: 'brand' | 'studio', displayName: string | null, email: string | null): string | null {
  const name = displayName?.replace(/\s+/g, ' ').trim();
  if (name) return name.slice(0, 60);
  if (role === 'studio') return null;
  const local = email?.split('@')[0]?.trim();
  return local ? local.slice(0, 60) : null;
}

interface StoredAttachment {
  key: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

function storedAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: StoredAttachment[] = [];
  for (const item of value) {
    const a = item as Partial<StoredAttachment> | null;
    if (!a || typeof a.key !== 'string' || !isStudioMediaKey(a.key)) continue;
    const mime = attachmentMimeOfKey(a.key);
    if (!mime) continue;
    out.push({
      key: a.key,
      name: typeof a.name === 'string' && a.name ? a.name.slice(0, ROOM_LIMITS.nameMax) : a.key.slice(-12),
      mime,
      size: Number.isFinite(Number(a.size)) ? Number(a.size) : 0,
      width: Number.isInteger(a.width) ? Number(a.width) : null,
      height: Number.isInteger(a.height) ? Number(a.height) : null,
    });
  }
  return out;
}

function attachmentView(a: StoredAttachment, media: StudioMediaStore): RoomAttachment {
  return { key: a.key, url: media.url(a.key), name: a.name, mime: a.mime, kind: attachmentKindOf(a.mime), size: a.size, width: a.width, height: a.height };
}

function eventDetail(value: Record<string, unknown> | null): (RoomEventDetail & { actorRole?: 'brand' | 'studio' }) | null {
  if (!value || typeof value !== 'object') return null;
  const detail: RoomEventDetail & { actorRole?: 'brand' | 'studio' } = {};
  if (typeof value.title === 'string' && value.title.trim()) detail.title = value.title.trim().slice(0, 120);
  if (Number.isInteger(value.version)) detail.version = Number(value.version);
  if (value.actorRole === 'brand' || value.actorRole === 'studio') detail.actorRole = value.actorRole;
  return detail;
}

function nameOf(row: MessageRow): string | null {
  if (row.author_role === 'system') {
    const side = eventDetail(row.detail)?.actorRole ?? 'brand';
    return roomAuthorName(side, row.display_name, row.email);
  }
  return roomAuthorName(row.author_role, row.display_name, row.email);
}

/**
 * A note a share link's guest left (lib/brand-rooms/shares.ts): its line is a brand-side `review_commented`
 * with no actor. It must never read as the YAGI team's; the screen shows the guest's name from the note.
 */
function isGuestNoteLine(row: MessageRow): boolean {
  return row.kind === 'event' && row.event === 'review_commented' && row.author_id == null && eventDetail(row.detail)?.actorRole === 'brand';
}

/** The guest names on those lines' notes, by line id. A note of another organization or a team note gives none. */
async function guestNoteNames(sql: SqlRunner, organizationId: string, rows: readonly MessageRow[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const wanted = new Map<string, string>();
  for (const row of rows) {
    if (row.deleted_at || !isGuestNoteLine(row)) continue;
    out.set(String(row.id), null);
    const ref = parseRefKey(row.ref_key);
    if (ref?.kind === 'review' && ref.commentId) wanted.set(String(row.id), ref.commentId.toLowerCase());
  }
  if (wanted.size === 0 || !(await tableExists(sql, 'brand_studio_review_comments'))) return out;
  const names = new Map(
    (
      await sql.query<{ id: string; guest_name: string | null }>(
        `select c.id::text as id, to_jsonb(c) ->> 'guest_name' as guest_name from brand_studio_review_comments c
          where c.id = any($1::uuid[]) and c.organization_id = $2${publicNotesOnly('c', await teamNotesReady(sql))}`,
        [[...new Set(wanted.values())], organizationId],
      )
    ).rows.map((r) => [r.id, r.guest_name?.replace(/\s+/g, ' ').trim().slice(0, 60) || null]),
  );
  for (const [lineId, commentId] of wanted) out.set(lineId, names.get(commentId) ?? null);
  return out;
}

/* ------------------------------------------------------------ ref cards */

async function tableExists(sql: SqlRunner, name: string): Promise<boolean> {
  const row = (await sql.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${name}`])).rows[0];
  return Boolean(row?.t);
}

type Json = Record<string, unknown>;
const jsonString = (row: Json | undefined, key: string): string | null => (row && typeof row[key] === 'string' ? (row[key] as string) : null);
const jsonInt = (row: Json | undefined, key: string): number | null => (row && Number.isInteger(Number(row[key])) && row[key] !== null ? Number(row[key]) : null);
const mediaUrlOf = (media: StudioMediaStore, key: string | null): string | null => (key && isStudioMediaKey(key) ? media.url(key) : null);

/**
 * What each ref card shows, keyed by `ref_key`. Facts are read only from things of this organization AND
 * this project: a ref that points anywhere else shows as unavailable, with no title and no picture.
 * Tables of other slices are read through `to_jsonb` after a `to_regclass` check, so a missing table or
 * column never fails a page (and never aborts the caller's transaction).
 */
async function refViews(sql: SqlRunner, media: StudioMediaStore, organizationId: string, projectId: string | null, refs: readonly RoomRef[]): Promise<Map<string, RoomRefView>> {
  const out = new Map<string, RoomRefView>();
  if (refs.length === 0) return out;
  const blank = (ref: RoomRef): RoomRefView => ({ ref, available: false, title: null, version: null, cut: null, scene: null, shot: null, thumbUrl: null });
  for (const ref of refs) out.set(refKeyOf(ref), blank(ref));
  if (!projectId) return out;

  const boardRefs = refs.filter((r): r is Extract<RoomRef, { kind: 'storyboard' }> => r.kind === 'storyboard');
  if (boardRefs.length && (await tableExists(sql, 'brand_storyboards')) && (await tableExists(sql, 'brand_storyboard_frames'))) {
    const boardIds = [...new Set(boardRefs.map((r) => r.storyboardId.toLowerCase()))];
    const frameIds = [...new Set(boardRefs.map((r) => r.frameId?.toLowerCase()).filter((id): id is string => Boolean(id)))];
    const boards = new Map(
      (await sql.query<{ id: string; row: Json }>('select s.id::text as id, to_jsonb(s) as row from brand_storyboards s where s.id = any($1::uuid[]) and s.organization_id = $2', [boardIds, organizationId])).rows.map(
        (r) => [r.id, r.row],
      ),
    );
    const frames = frameIds.length
      ? new Map(
          (
            await sql.query<{ id: string; row: Json }>('select f.id::text as id, to_jsonb(f) as row from brand_storyboard_frames f where f.id = any($1::uuid[]) and f.organization_id = $2', [
              frameIds,
              organizationId,
            ])
          ).rows.map((r) => [r.id, r.row]),
        )
      : new Map<string, Json>();
    const firstFrames = new Map(
      (
        await sql.query<{ id: string; row: Json }>(
          `select distinct on (f.storyboard_id) f.storyboard_id::text as id, to_jsonb(f) as row from brand_storyboard_frames f
            where f.storyboard_id = any($1::uuid[]) and f.organization_id = $2 order by f.storyboard_id, f.idx`,
          [boardIds, organizationId],
        )
      ).rows.map((r) => [r.id, r.row]),
    );
    for (const ref of boardRefs) {
      const board = boards.get(ref.storyboardId.toLowerCase());
      if (!board || jsonString(board, 'deleted_at') || jsonString(board, 'project_id')?.toLowerCase() !== projectId) continue;
      const frame = ref.frameId ? frames.get(ref.frameId.toLowerCase()) : undefined;
      if (ref.frameId && (!frame || jsonString(frame, 'storyboard_id')?.toLowerCase() !== ref.storyboardId.toLowerCase() || jsonString(frame, 'deleted_at'))) continue;
      const picture = frame ?? firstFrames.get(ref.storyboardId.toLowerCase());
      const idx = frame ? jsonInt(frame, 'idx') : null;
      out.set(refKeyOf(ref), {
        ref,
        available: true,
        title: jsonString(board, 'title'),
        version: jsonInt(board, 'version'),
        cut: idx == null ? null : idx + 1,
        scene: frame ? jsonString(frame, 'scene') : null,
        shot: frame ? jsonString(frame, 'shot') : null,
        thumbUrl: picture ? (mediaUrlOf(media, jsonString(picture, 'thumb_key')) ?? mediaUrlOf(media, jsonString(picture, 'storage_key'))) : null,
      });
    }
  }

  const reviewRefs = refs.filter((r): r is Extract<RoomRef, { kind: 'review' }> => r.kind === 'review');
  if (reviewRefs.length && (await tableExists(sql, 'brand_studio_reviews'))) {
    const ids = [...new Set(reviewRefs.map((r) => r.reviewId.toLowerCase()))];
    const rows = new Map(
      (
        await sql.query<{ id: string; row: Json; thumb: string | null }>(
          `select r.id::text as id, to_jsonb(r) as row,
                  coalesce(a.thumb_key, o.thumb_key, case when coalesce(a.kind, o.kind) = 'image' then coalesce(a.storage_key, o.storage_key) end) as thumb
             from brand_studio_reviews r
             left join brand_studio_assets a on a.id = r.asset_id and a.deleted_at is null
             left join brand_studio_outputs o on o.id = r.output_id and o.deleted_at is null
            where r.id = any($1::uuid[]) and r.organization_id = $2`,
          [ids, organizationId],
        )
      ).rows.map((r) => [r.id, r]),
    );
    const commentIds = [...new Set(reviewRefs.map((r) => r.commentId?.toLowerCase()).filter((id): id is string => Boolean(id)))];
    // A team note (0093) never gives a card its words: no line names one, and if one did it reads as gone.
    const comments =
      commentIds.length && (await tableExists(sql, 'brand_studio_review_comments'))
        ? new Map(
            (
              await sql.query<{ id: string; row: Json }>(
                `select c.id::text as id, to_jsonb(c) as row from brand_studio_review_comments c
                  where c.id = any($1::uuid[]) and c.organization_id = $2${publicNotesOnly('c', await teamNotesReady(sql))}`,
                [commentIds, organizationId],
              )
            ).rows.map((r) => [r.id, r.row]),
          )
        : new Map<string, Json>();
    for (const ref of reviewRefs) {
      const hit = rows.get(ref.reviewId.toLowerCase());
      if (!hit || jsonString(hit.row, 'deleted_at')) continue;
      // Only a deliverable of this project (the column arrives with slice R; before it, the organization's own).
      if ('project_id' in hit.row && jsonString(hit.row, 'project_id')?.toLowerCase() !== projectId) continue;
      const note = ref.commentId ? comments.get(ref.commentId.toLowerCase()) : undefined;
      const validNote =
        note && !jsonString(note, 'deleted_at') && jsonString(note, 'review_id')?.toLowerCase() === ref.reviewId.toLowerCase() ? note : undefined;
      const rawBody = validNote ? jsonString(validNote, 'body')?.replace(/\s+/g, ' ').trim() : null;
      const strokes = validNote?.strokes;
      out.set(refKeyOf(ref), {
        ref,
        available: true,
        title: jsonString(hit.row, 'title'),
        version: jsonInt(hit.row, 'version'),
        cut: null,
        scene: null,
        shot: null,
        thumbUrl: mediaUrlOf(media, hit.thumb),
        ...(validNote
          ? {
              noteBody: rawBody ? rawBody.slice(0, 120) : null,
              atMs: jsonInt(validNote, 'at_ms'),
              endMs: jsonInt(validNote, 'end_ms'),
              hasSpot: validNote.x !== null && validNote.x !== undefined,
              hasDrawing: Array.isArray(strokes) && strokes.length > 0,
            }
          : {}),
      });
    }
  }
  return out;
}

/** A ref a new line may carry: a live storyboard (and cut) or review item (and note) of this project. */
async function requireRefInProject(sql: SqlRunner, organizationId: string, projectId: string, ref: RoomRef): Promise<void> {
  if (ref.kind === 'storyboard') {
    if (!(await tableExists(sql, 'brand_storyboards'))) throw new MessageDenied('not_found');
    const board = (
      await sql.query<{ row: Json }>('select to_jsonb(s) as row from brand_storyboards s where s.id = $1 and s.organization_id = $2', [ref.storyboardId, organizationId])
    ).rows[0]?.row;
    if (!board || jsonString(board, 'deleted_at') || jsonString(board, 'project_id')?.toLowerCase() !== projectId) throw new MessageDenied('not_found');
    if (ref.frameId) {
      const frame = (
        await sql.query<{ row: Json }>('select to_jsonb(f) as row from brand_storyboard_frames f where f.id = $1 and f.storyboard_id = $2 and f.organization_id = $3', [
          ref.frameId,
          ref.storyboardId,
          organizationId,
        ])
      ).rows[0]?.row;
      if (!frame || jsonString(frame, 'deleted_at')) throw new MessageDenied('not_found');
    }
    return;
  }
  const review = (
    await sql.query<{ row: Json }>('select to_jsonb(r) as row from brand_studio_reviews r where r.id = $1 and r.organization_id = $2', [ref.reviewId, organizationId])
  ).rows[0]?.row;
  if (!review || jsonString(review, 'deleted_at')) throw new MessageDenied('not_found');
  if ('project_id' in review && jsonString(review, 'project_id')?.toLowerCase() !== projectId) throw new MessageDenied('not_found');
  if (ref.commentId) {
    // The conversation is the brand's to read: a line may not point at a team note (0093), whoever writes it.
    const comment = (
      await sql.query(
        `select 1 from brand_studio_review_comments c where c.id = $1 and c.review_id = $2 and c.organization_id = $3${publicNotesOnly('c', await teamNotesReady(sql))}`,
        [ref.commentId, ref.reviewId, organizationId],
      )
    ).rows[0];
    if (!comment) throw new MessageDenied('not_found');
  }
}

/* ------------------------------------------------------------ views */

async function reactionsOf(sql: SqlRunner, ids: readonly string[], viewerId: string): Promise<Map<string, RoomReactionView[]>> {
  const out = new Map<string, RoomReactionView[]>();
  if (ids.length === 0) return out;
  const rows = (
    await sql.query<{ message_id: string; emoji: RoomReaction; n: number; mine: boolean }>(
      `select message_id::text as message_id, emoji, count(*)::int as n, bool_or(user_id = $2::uuid) as mine
         from brand_room_reactions where message_id = any($1::uuid[]) group by message_id, emoji`,
      [ids, viewerId],
    )
  ).rows;
  for (const row of rows) {
    const list = out.get(row.message_id) ?? [];
    list.push({ emoji: row.emoji, count: Number(row.n), mine: row.mine === true });
    out.set(row.message_id, list);
  }
  for (const list of out.values()) list.sort((a, b) => ROOM_REACTIONS.indexOf(a.emoji) - ROOM_REACTIONS.indexOf(b.emoji));
  return out;
}

async function views(sql: SqlRunner, media: StudioMediaStore, reader: Reader, rows: readonly MessageRow[]): Promise<RoomMessage[]> {
  const ids = rows.map((r) => String(r.id));
  const reactions = await reactionsOf(sql, ids, reader.viewerId);
  const refs = rows.filter((r) => r.ref && r.ref_key && !r.deleted_at).map((r) => parseRefKey(r.ref_key)).filter((r): r is RoomRef => Boolean(r));
  const cards = await refViews(sql, media, reader.organizationId, reader.projectId, refs);
  const guests = await guestNoteNames(sql, reader.organizationId, rows);
  const threaded = rows.filter((r) => Number(r.reply_count ?? 0) > 0).map((r) => String(r.id));
  const lastReplyBy = new Map(
    threaded.length
      ? (
          await sql.query<{ parent_id: string; author_id: string | null }>(
            `select distinct on (parent_id) parent_id::text as parent_id, author_id::text as author_id from brand_room_messages
              where parent_id = any($1::uuid[]) and deleted_at is null order by parent_id, created_at desc, id desc`,
            [threaded],
          )
        ).rows.map((r) => [r.parent_id, r.author_id])
      : [],
  );
  return rows.map((row) => {
    const deleted = row.deleted_at != null;
    const ref = !deleted && row.ref_key ? (cards.get(row.ref_key) ?? null) : null;
    const detail = row.kind === 'event' ? eventDetail(row.detail) : null;
    return {
      id: String(row.id),
      channel: String(row.channel),
      projectId: row.project_id ? String(row.project_id) : null,
      parentId: row.parent_id ? String(row.parent_id) : null,
      kind: row.kind,
      event: row.kind === 'event' ? (row.event as RoomEventKind) : null,
      detail: detail ? { ...(detail.title ? { title: detail.title } : {}), ...(detail.version != null ? { version: detail.version } : {}) } : null,
      authorId: row.author_id ? String(row.author_id) : null,
      authorRole: row.author_role,
      authorName: deleted ? null : guests.has(String(row.id)) ? (guests.get(String(row.id)) ?? null) : nameOf(row),
      ...(guests.has(String(row.id)) ? { guest: true as const } : {}),
      mine: !deleted && row.kind === 'text' && row.author_id != null && String(row.author_id) === reader.viewerId,
      body: deleted ? '' : String(row.body ?? ''),
      attachments: deleted ? [] : storedAttachments(row.attachments).map((a) => attachmentView(a, media)),
      mentions: deleted ? [] : (row.mentions ?? []).map(String),
      mentionsTeam: !deleted && row.mentions_team === true,
      ref,
      reactions: deleted ? [] : (reactions.get(String(row.id)) ?? []),
      replyCount: Number(row.reply_count ?? 0),
      lastReplyAt: isoOrNull(row.last_reply_at),
      lastReplyMine: lastReplyBy.get(String(row.id)) === reader.viewerId,
      pinned: !deleted && row.pinned_at != null,
      edited: row.edited_at != null,
      deleted,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
    };
  });
}

async function messageRow(sql: SqlRunner, reader: Pick<Reader, 'organizationId' | 'channel'>, messageId: string, lock = false): Promise<MessageRow | null> {
  if (!UUID.test(messageId)) return null;
  if (lock) {
    const locked = (await sql.query('select id from brand_room_messages where id = $1 and organization_id = $2 and channel = $3 for update', [messageId, reader.organizationId, reader.channel])).rows[0];
    if (!locked) return null;
  }
  return (await sql.query<MessageRow>(`${MESSAGE_SELECT} where m.id = $1 and m.organization_id = $2 and m.channel = $3`, [messageId, reader.organizationId, reader.channel])).rows[0] ?? null;
}

async function oneView(sql: SqlRunner, media: StudioMediaStore, reader: Reader, messageId: string): Promise<RoomMessage> {
  const row = await messageRow(sql, reader, messageId);
  if (!row) throw new MessageDenied('not_found');
  return (await views(sql, media, reader, [row]))[0]!;
}

async function dbNow(sql: SqlRunner): Promise<string> {
  return iso((await sql.query<{ now: Date | string }>('select now() as now')).rows[0]!.now);
}

function cursorOf(rows: readonly MessageRow[], fallback: string): string {
  let best = fallback;
  for (const row of rows) {
    const at = iso(row.updated_at);
    if (at > best) best = at;
  }
  return best;
}

/* ------------------------------------------------------------ reads */

async function legacyOf(sql: SqlRunner, organizationId: string, projectId: string): Promise<RoomLegacyMessage[]> {
  const rows = (
    await sql.query<{ id: string; author_role: 'brand' | 'studio'; body: string; created_at: Date | string; display_name: string | null; email: string | null }>(
      `select b.id, b.author_role, b.body, b.created_at, p.display_name, p.email
         from brand_messages b left join profiles p on p.id = b.created_by
        where b.organization_id = $1 and b.project_id = $2 order by b.created_at, b.id limit $3`,
      [organizationId, projectId, ROOM_LIMITS.legacyMax],
    )
  ).rows;
  return rows.map((r) => ({
    id: String(r.id),
    authorRole: r.author_role,
    authorName: roomAuthorName(r.author_role, r.display_name, r.email),
    body: String(r.body),
    createdAt: iso(r.created_at),
  }));
}

/** Who a line may mention: the organization's active members and, in a project channel, that project's guests. */
async function peopleOf(sql: SqlRunner, organizationId: string, projectId: string | null): Promise<RoomPerson[]> {
  const rows = (
    await sql.query<{ user_id: string; role: RoomPerson['role']; display_name: string | null; email: string | null }>(
      `select m.user_id::text as user_id, m.role, p.display_name, p.email
         from brand_memberships m join profiles p on p.id = m.user_id
        where m.organization_id = $1 and m.status = 'active'
       union all
       select g.user_id::text, 'guest', p.display_name, p.email
         from brand_project_members g join profiles p on p.id = g.user_id
        where $2::uuid is not null and g.organization_id = $1 and g.project_id = $2::uuid and g.status = 'active'
          and not exists (select 1 from brand_memberships m where m.organization_id = $1 and m.user_id = g.user_id and m.status = 'active')`,
      [organizationId, projectId],
    )
  ).rows;
  return rows
    .map((r) => ({ id: r.user_id, role: r.role, name: roomAuthorName('brand', r.display_name, r.email) ?? '' }))
    .filter((p) => p.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

interface StreamOptions {
  since?: string | null;
  before?: string | null;
  limit?: number | null;
}

async function readStream(sql: SqlRunner, media: StudioMediaStore, reader: Reader, options: StreamOptions): Promise<RoomStreamPage> {
  const base = {
    ok: true as const,
    channel: reader.channel,
    projectId: reader.projectId,
    title: reader.title,
    canTalk: reader.canTalk,
    canPin: reader.canPin,
    team: reader.team,
  };
  if (options.since) {
    const rows = (
      await sql.query<MessageRow>(
        `${MESSAGE_SELECT}
          where m.organization_id = $1 and m.channel = $2 and m.parent_id is null
            and m.updated_at > $3::timestamptz - $4::int * interval '1 millisecond'
          order by m.updated_at, m.id limit $5`,
        [reader.organizationId, reader.channel, options.since, ROOM_LIMITS.overlapMs, ROOM_LIMITS.changesMax],
      )
    ).rows;
    const messages = await views(sql, media, reader, rows);
    return { ...base, messages, hasMore: false, cursor: cursorOf(rows, options.since), lastReadAt: null, legacy: [], people: [], pinned: [] };
  }
  const limit = Math.min(options.limit ?? ROOM_LIMITS.pageDefault, ROOM_LIMITS.pageMax);
  const now = await dbNow(sql);
  const rows = (
    await sql.query<MessageRow>(
      `${MESSAGE_SELECT}
        where m.organization_id = $1 and m.channel = $2 and m.parent_id is null
          and (m.deleted_at is null or exists (select 1 from brand_room_messages r where r.parent_id = m.id and r.deleted_at is null))
          and ($3::timestamptz is null or m.created_at < $3::timestamptz)
        order by m.created_at desc, m.id desc limit $4`,
      [reader.organizationId, reader.channel, options.before ?? null, limit + 1],
    )
  ).rows;
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const messages = await views(sql, media, reader, page);
  const first = !options.before;
  const legacy = !hasMore && reader.projectId ? await legacyOf(sql, reader.organizationId, reader.projectId) : [];
  let people: RoomPerson[] = [];
  let pinned: RoomMessage[] = [];
  let lastReadAt: string | null = null;
  if (first) {
    people = await peopleOf(sql, reader.organizationId, reader.projectId);
    const pinnedRows = (
      await sql.query<MessageRow>(
        `${MESSAGE_SELECT} where m.organization_id = $1 and m.channel = $2 and m.pinned_at is not null and m.deleted_at is null
          order by m.pinned_at desc limit 50`,
        [reader.organizationId, reader.channel],
      )
    ).rows;
    pinned = await views(sql, media, reader, pinnedRows);
    lastReadAt = isoOrNull(
      (
        await sql.query<{ at: Date | string }>('select last_read_at as at from brand_room_reads where organization_id = $1 and channel = $2 and user_id = $3', [
          reader.organizationId,
          reader.channel,
          reader.viewerId,
        ])
      ).rows[0]?.at,
    );
  }
  return { ...base, messages, hasMore, cursor: now, lastReadAt, legacy, people, pinned };
}

async function readThread(sql: SqlRunner, media: StudioMediaStore, reader: Reader, parentId: string, since: string | null | undefined): Promise<RoomThreadPage> {
  const parentRow = await messageRow(sql, reader, parentId);
  if (!parentRow || parentRow.parent_id) throw new MessageDenied('not_found');
  const now = await dbNow(sql);
  const rows = (
    await sql.query<MessageRow>(
      `${MESSAGE_SELECT}
        where m.parent_id = $1 and m.organization_id = $2 and m.channel = $3
          and ($4::timestamptz is null or m.updated_at > $4::timestamptz - $5::int * interval '1 millisecond')
        order by m.created_at, m.id limit $6`,
      [parentRow.id, reader.organizationId, reader.channel, since ?? null, ROOM_LIMITS.overlapMs, ROOM_LIMITS.threadMax],
    )
  ).rows;
  const [parent, ...replies] = await views(sql, media, reader, [parentRow, ...rows]);
  return {
    ok: true,
    parent: parent!,
    replies: since ? replies : replies.filter((r) => !r.deleted),
    cursor: since ? cursorOf(rows, since) : now,
    people: since ? [] : await peopleOf(sql, reader.organizationId, reader.projectId),
  };
}

async function readRef(sql: SqlRunner, media: StudioMediaStore, reader: Reader, rawRef: string, since: string | null | undefined): Promise<RoomRefPage> {
  const ref = parseRefKey(rawRef);
  if (!ref || !reader.projectId) throw new MessageDenied('invalid');
  const key = refKeyOf(ref);
  const narrow = ref.kind === 'storyboard' ? Boolean(ref.frameId) : Boolean(ref.commentId);
  const now = await dbNow(sql);
  const rows = (
    await sql.query<MessageRow>(
      `select * from (${MESSAGE_SELECT}
        where m.organization_id = $1 and m.channel = $2
          and (m.ref_key = $3 or ($4::boolean and m.ref_key like $3 || ':%'))
          and ($5::timestamptz is null or m.updated_at > $5::timestamptz - $6::int * interval '1 millisecond')
          and ($5::timestamptz is not null or m.deleted_at is null)
        order by m.created_at desc, m.id desc limit $7) page order by created_at, id`,
      [reader.organizationId, reader.channel, key, !narrow, since ?? null, ROOM_LIMITS.overlapMs, ROOM_LIMITS.refMax],
    )
  ).rows;
  return {
    ok: true,
    messages: await views(sql, media, reader, rows),
    cursor: since ? cursorOf(rows, since) : now,
    people: since ? [] : await peopleOf(sql, reader.organizationId, reader.projectId),
    canTalk: reader.canTalk,
  };
}

export type RoomReadResult = RoomStreamPage | RoomThreadPage | RoomRefPage | RoomFailure;

/** `GET /api/brand-rooms/messages?organizationId=&projectId=(id|general)[&since=|&before=|&thread=|&ref=]` */
export async function loadRoomMessages(deps: RoomMessageDeps, viewer: Viewer, query: Record<string, string | null | undefined>): Promise<RoomReadResult> {
  const organizationId = query.organizationId ?? '';
  // The gate before any query detail is judged: a closed organization gets the same 404 whatever it asked.
  if (!UUID.test(organizationId)) return failure('invalid');
  const gate = await guard(() => deps.sql.transaction((sql) => roomSeat(sql, viewer.userId, organizationId)));
  if ('ok' in gate) return gate;
  const parsed = StreamQuerySchema.safeParse(query);
  if (!parsed.success) return failure('invalid');
  const q = parsed.data;
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, q.organizationId);
      const reader = await brandReader(sql, seat, q.projectId);
      if (q.thread) return readThread(sql, deps.media, reader, q.thread, q.since);
      if (q.ref) return readRef(sql, deps.media, reader, q.ref, q.since);
      return readStream(sql, deps.media, reader, { since: q.since, before: q.before, limit: q.limit });
    }),
  );
}

/* ------------------------------------------------------------ writes */

interface SendBy {
  role: 'brand' | 'studio';
  /** Brand members only: lines per minute. */
  rateLimited: boolean;
}

async function insertMessage(sql: SqlRunner, media: StudioMediaStore, reader: Reader, raw: unknown, by: SendBy): Promise<{ message: RoomMessage; created: boolean }> {
  const parsed = MessageSendSchema.safeParse(raw);
  if (!parsed.success) throw new MessageDenied('invalid');
  const v = parsed.data;
  if (!reader.canTalk) throw new MessageDenied('forbidden');
  const prior = (
    await sql.query<{ id: string; channel: string }>('select id, channel from brand_room_messages where organization_id = $1 and author_id = $2 and request_id = $3', [
      reader.organizationId,
      reader.viewerId,
      v.requestId,
    ])
  ).rows[0];
  if (prior) {
    if (prior.channel !== reader.channel) throw new MessageDenied('conflict');
    return { message: await oneView(sql, media, reader, String(prior.id)), created: false };
  }
  if (by.rateLimited) {
    const recent = (
      await sql.query<{ n: number }>(
        "select count(*)::int as n from brand_room_messages where author_id = $1 and organization_id = $2 and kind = 'text' and created_at > now() - interval '1 minute'",
        [reader.viewerId, reader.organizationId],
      )
    ).rows[0]!.n;
    if (Number(recent) >= ROOM_LIMITS.messagesPerMinute) throw new MessageDenied('rate_limited');
  }
  let ref: RoomRef | null = null;
  let parentId: string | null = null;
  if (v.parentId) {
    const parent = await messageRow(sql, reader, v.parentId, true);
    if (!parent || parent.deleted_at) throw new MessageDenied('not_found');
    // One level of threads: answering a reply answers its thread.
    if (parent.parent_id) throw new MessageDenied('invalid');
    parentId = String(parent.id);
    // A reply belongs to what its thread is about.
    ref = parent.ref_key ? parseRefKey(parent.ref_key) : null;
  } else if (v.ref) {
    if (!reader.projectId) throw new MessageDenied('invalid');
    await requireRefInProject(sql, reader.organizationId, reader.projectId, v.ref);
    ref = v.ref;
  }
  const people = new Set((await peopleOf(sql, reader.organizationId, reader.projectId)).map((p) => p.id.toLowerCase()));
  const mentions = [...new Set(v.mentions.map((id) => id.toLowerCase()))].filter((id) => people.has(id));
  const attachments: StoredAttachment[] = v.attachments.map((a) => ({
    key: a.key,
    name: a.name,
    mime: attachmentMimeOfKey(a.key)!,
    size: a.size,
    width: a.width ?? null,
    height: a.height ?? null,
  }));
  let gatedSend = false;
  if (
    attachments.length > 0 &&
    !(await isRoomStaffActor(sql, reader, by.role)) &&
    !(await isOrganizationUploadApproved(sql, reader.organizationId))
  ) {
    gatedSend = true;
    await sql.query('select id from brand_organizations where id = $1 for update', [reader.organizationId]);
    const existingRows = (
      await sql.query<{ attachments: unknown }>(
        `select m.attachments
           from brand_room_messages m
           left join profiles p on p.id = m.author_id
          where m.organization_id = $1
            and m.deleted_at is null
            and m.author_role = 'brand'
            and coalesce(p.is_admin, false) = false
            and jsonb_typeof(m.attachments) = 'array'
            and jsonb_array_length(m.attachments) > 0`,
        [reader.organizationId],
      )
    ).rows;
    const existingKeys = new Set<string>();
    for (const row of existingRows) {
      for (const item of storedAttachments(row.attachments)) existingKeys.add(item.key);
    }
    const newKeys: string[] = [];
    const seenIncoming = new Set<string>();
    let newBytes = 0;
    for (const a of attachments) {
      if (existingKeys.has(a.key) || seenIncoming.has(a.key)) continue;
      seenIncoming.add(a.key);
      newKeys.push(a.key);
      newBytes += a.size;
    }
    if (newKeys.length > 0) {
      const quota = await checkStorageQuotaForUpload(sql, reader.organizationId, newBytes, undefined, newKeys.length, {
        excludePendingRoomKeys: newKeys,
      });
      if (!quota.allowed) throw new MessageDenied('storage_quota_exceeded', quota.reason);
    }
  }
  const id = (
    await sql.query<{ id: string }>(
      `insert into brand_room_messages (organization_id, project_id, channel, parent_id, author_id, author_role, kind, body, ref, ref_key,
                                        attachments, mentions, mentions_team, request_id)
         values ($1, $2, $3, $4, $5, $6, 'text', $7, $8::jsonb, $9, $10::jsonb, $11::uuid[], $12, $13) returning id`,
      [
        reader.organizationId,
        reader.projectId,
        reader.channel,
        parentId,
        reader.viewerId,
        by.role,
        v.body,
        ref ? JSON.stringify(ref) : null,
        ref ? refKeyOf(ref) : null,
        JSON.stringify(attachments),
        mentions,
        by.role === 'brand' && v.mentionsTeam,
        v.requestId,
      ],
    )
  ).rows[0]!.id;
  if (parentId) await sql.query('update brand_room_messages set updated_at = now() where id = $1', [parentId]);
  if (attachments.length > 0) {
    const totalBytes = attachments.reduce((sum, a) => sum + a.size, 0);
    await adjustOrganizationStorageBytes(sql, reader.organizationId, totalBytes);
    if (gatedSend) {
      await consumePendingRoomUploadKeys(sql, reader.organizationId, attachments.map((a) => a.key));
    }
  }
  return { message: await oneView(sql, media, reader, String(id)), created: true };
}

async function editMessage(sql: SqlRunner, media: StudioMediaStore, reader: Reader, raw: unknown): Promise<RoomMessage> {
  const parsed = MessageEditSchema.safeParse(raw);
  if (!parsed.success) throw new MessageDenied('invalid');
  // Rewriting a line is writing: a guest invited to view only may delete their old lines, not edit them.
  if (!reader.canTalk) throw new MessageDenied('forbidden');
  const row = await messageRow(sql, reader, parsed.data.messageId, true);
  if (!row || row.deleted_at || row.kind !== 'text') throw new MessageDenied('not_found');
  if (String(row.author_id) !== reader.viewerId) throw new MessageDenied('forbidden');
  if (!parsed.data.body && storedAttachments(row.attachments).length === 0) throw new MessageDenied('invalid');
  if (parsed.data.body !== row.body) {
    await sql.query('update brand_room_messages set body = $2, edited_at = now(), updated_at = now() where id = $1', [row.id, parsed.data.body]);
  }
  return oneView(sql, media, reader, String(row.id));
}

async function deleteMessage(sql: SqlRunner, reader: Reader, messageId: string, anyAuthor: boolean): Promise<{ messageId: string; keys: string[] }> {
  const row = await messageRow(sql, reader, messageId, true);
  if (!row) throw new MessageDenied('not_found');
  if (row.deleted_at) return { messageId: String(row.id), keys: [] };
  if (!anyAuthor && (row.kind !== 'text' || String(row.author_id) !== reader.viewerId)) throw new MessageDenied('forbidden');
  const keys = storedAttachments(row.attachments).map((a) => a.key);
  await sql.query('update brand_room_messages set deleted_at = now(), deleted_by = $2, pinned_at = null, pinned_by = null, updated_at = now() where id = $1', [
    row.id,
    reader.viewerId,
  ]);
  if (row.parent_id) await sql.query('update brand_room_messages set updated_at = now() where id = $1', [row.parent_id]);
  if (keys.length > 0) await reconcileOrganizationStorage(sql, reader.organizationId);
  return { messageId: String(row.id), keys };
}

async function pinMessage(sql: SqlRunner, media: StudioMediaStore, reader: Reader, messageId: string, pinned: boolean): Promise<RoomMessage> {
  if (!reader.canPin) throw new MessageDenied('forbidden');
  const row = await messageRow(sql, reader, messageId, true);
  if (!row || row.deleted_at) throw new MessageDenied('not_found');
  if (pinned !== (row.pinned_at != null)) {
    await sql.query(
      pinned
        ? 'update brand_room_messages set pinned_at = now(), pinned_by = $2, updated_at = now() where id = $1'
        : 'update brand_room_messages set pinned_at = null, pinned_by = null, updated_at = now() where id = $1',
      pinned ? [row.id, reader.viewerId] : [row.id],
    );
  }
  return oneView(sql, media, reader, String(row.id));
}

async function toggleReaction(sql: SqlRunner, reader: Reader, raw: unknown): Promise<RoomReactionsDone> {
  const parsed = ReactionToggleSchema.safeParse(raw);
  if (!parsed.success) throw new MessageDenied('invalid');
  if (!reader.canTalk) throw new MessageDenied('forbidden');
  const row = await messageRow(sql, reader, parsed.data.messageId, true);
  if (!row || row.deleted_at) throw new MessageDenied('not_found');
  const gone = await sql.query('delete from brand_room_reactions where message_id = $1 and user_id = $2 and emoji = $3 returning message_id', [row.id, reader.viewerId, parsed.data.emoji]);
  if (!gone.rows[0]) {
    await sql.query('insert into brand_room_reactions (message_id, organization_id, user_id, emoji) values ($1, $2, $3, $4)', [row.id, reader.organizationId, reader.viewerId, parsed.data.emoji]);
  }
  await sql.query('update brand_room_messages set updated_at = now() where id = $1', [row.id]);
  return { ok: true, messageId: String(row.id), reactions: (await reactionsOf(sql, [String(row.id)], reader.viewerId)).get(String(row.id)) ?? [] };
}

async function markRead(sql: SqlRunner, reader: Reader, at: string | null | undefined): Promise<RoomReadDone> {
  const row = (
    await sql.query<{ at: Date | string }>(
      `insert into brand_room_reads (organization_id, channel, user_id, last_read_at)
         values ($1, $2, $3, least(coalesce($4::timestamptz, now()), now()))
       on conflict (organization_id, channel, user_id)
         do update set last_read_at = greatest(brand_room_reads.last_read_at, excluded.last_read_at)
       returning last_read_at as at`,
      [reader.organizationId, reader.channel, reader.viewerId, at ?? null],
    )
  ).rows[0]!;
  return { ok: true, lastReadAt: iso(row.at) };
}

/* ------------------------------------------------------------ files */

/** Local mode only: the browser POSTs the bytes of a reservation here. */
export const ROOM_LOCAL_UPLOAD_ROUTE = '/api/brand-rooms/messages/upload';

function stagingKeyFor(organizationId: string, userId: string): string {
  return `brand-rooms/${organizationId.toLowerCase()}/${userId.toLowerCase()}/${randomBytes(16).toString('hex')}`;
}

/** The staging key belongs to this organization and this person. */
function ownsStagingKey(key: string, organizationId: string, userId: string): boolean {
  const match = ROOM_STAGING_KEY.exec(key);
  return Boolean(match && match[1] === organizationId.toLowerCase() && match[2] === userId.toLowerCase());
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean => bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);

/**
 * What the bytes really are, against what the browser said. Pictures and films must be a type of the
 * same kind (their bytes decide png or jpeg, mp4 or mov); documents must carry their format's signature;
 * plain text and csv must be UTF-8 with no NUL bytes.
 */
export function roomFileVerdict(bytes: Uint8Array, declared: string): { ok: true; mime: string } | { ok: false; code: 'file_too_large' | 'unsupported_file' } {
  if (bytes.byteLength > ROOM_LIMITS.attachmentBytesMax) return { ok: false, code: 'file_too_large' };
  const type = ROOM_ATTACHMENT_TYPES[declared];
  if (!type || bytes.byteLength === 0) return { ok: false, code: 'unsupported_file' };
  if (type.kind === 'image' || type.kind === 'video') {
    const actual = sniffMime(bytes);
    if (!actual || ROOM_ATTACHMENT_TYPES[actual]?.kind !== type.kind) return { ok: false, code: 'unsupported_file' };
    return { ok: true, mime: actual };
  }
  switch (type.ext) {
    case 'pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? { ok: true, mime: declared } : { ok: false, code: 'unsupported_file' };
    case 'docx':
    case 'xlsx':
    case 'pptx':
    case 'hwpx':
    case 'zip':
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ? { ok: true, mime: declared } : { ok: false, code: 'unsupported_file' };
    case 'hwp':
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) ? { ok: true, mime: declared } : { ok: false, code: 'unsupported_file' };
    case 'txt':
    case 'csv': {
      if (bytes.includes(0)) return { ok: false, code: 'unsupported_file' };
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        return { ok: true, mime: declared };
      } catch {
        return { ok: false, code: 'unsupported_file' };
      }
    }
    default:
      return { ok: false, code: 'unsupported_file' };
  }
}

async function isRoomStaffActor(sql: SqlRunner, reader: Reader, role?: 'brand' | 'studio'): Promise<boolean> {
  if (reader.team || role === 'studio') return true;
  const row = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1', [reader.viewerId])).rows[0];
  return row?.is_admin === true;
}

async function reserveUpload(sql: SqlRunner, deps: RoomMessageDeps, reader: Reader, raw: unknown): Promise<RoomUploadReserved> {
  const parsed = AttachmentReserveSchema.safeParse(raw);
  if (!parsed.success) throw new MessageDenied('invalid');
  if (!reader.canTalk) throw new MessageDenied('forbidden');
  if (parsed.data.size > ROOM_LIMITS.attachmentBytesMax) throw new MessageDenied('file_too_large');
  if (!deps.staging) throw new MessageDenied('provider_unavailable');
  const isStaff = await isRoomStaffActor(sql, reader);
  let gated = false;
  if (!isStaff) {
    gated = !(await isOrganizationUploadApproved(sql, reader.organizationId));
    if (gated) await sql.query('select id from brand_organizations where id = $1 for update', [reader.organizationId]);
    const quota = await checkStorageQuotaForUpload(sql, reader.organizationId, parsed.data.size, undefined, 1);
    if (!quota.allowed) throw new MessageDenied('storage_quota_exceeded', quota.reason);
  }
  const stagingKey = stagingKeyFor(reader.organizationId, reader.viewerId);
  const url = await deps.staging.signedUploadUrl(stagingKey, parsed.data.mime);
  if (url) {
    if (gated) await reservePendingRoomUpload(sql, reader.organizationId, { key: stagingKey, sizeBytes: parsed.data.size });
    return { ok: true, stagingKey, url, direct: true };
  }
  if (deps.staging.servesSignedUrls) throw new MessageDenied('failed');
  if (gated) await reservePendingRoomUpload(sql, reader.organizationId, { key: stagingKey, sizeBytes: parsed.data.size });
  const params = new URLSearchParams({
    organizationId: reader.organizationId,
    projectId: reader.channel,
    key: stagingKey,
    size: String(parsed.data.size),
  });
  return { ok: true, stagingKey, url: `${ROOM_LOCAL_UPLOAD_ROUTE}?${params.toString()}`, direct: false };
}

async function completeUpload(sql: SqlRunner, deps: RoomMessageDeps, reader: Reader, raw: unknown): Promise<RoomAttachmentDone> {
  const parsed = AttachmentCompleteSchema.safeParse(raw);
  if (!parsed.success) throw new MessageDenied('invalid');
  if (!reader.canTalk) throw new MessageDenied('forbidden');
  if (!ownsStagingKey(parsed.data.stagingKey, reader.organizationId, reader.viewerId)) throw new MessageDenied('not_found');
  if (!deps.staging) throw new MessageDenied('provider_unavailable');
  let bytes: Uint8Array;
  try {
    bytes = await deps.staging.read(STAGING_BUCKET, parsed.data.stagingKey);
  } catch {
    throw new MessageDenied('not_found');
  }
  if (bytes.byteLength !== parsed.data.size) throw new MessageDenied(bytes.byteLength > ROOM_LIMITS.attachmentBytesMax ? 'file_too_large' : 'invalid');
  const verdict = roomFileVerdict(bytes, parsed.data.mime);
  if (!verdict.ok) throw new MessageDenied(verdict.code);
  const isStaff = await isRoomStaffActor(sql, reader);
  let gated = false;
  if (!isStaff) {
    gated = !(await isOrganizationUploadApproved(sql, reader.organizationId));
    if (gated) await sql.query('select id from brand_organizations where id = $1 for update', [reader.organizationId]);
    const quota = await checkStorageQuotaForUpload(
      sql,
      reader.organizationId,
      bytes.byteLength,
      undefined,
      1,
      gated ? { excludePendingRoomKeys: [parsed.data.stagingKey] } : undefined,
    );
    if (!quota.allowed) throw new MessageDenied('storage_quota_exceeded', quota.reason);
  }
  let width: number | null = null;
  let height: number | null = null;
  const kind = attachmentKindOf(verdict.mime);
  if (kind === 'image') {
    const size = await imageInfo(bytes);
    if (!size) throw new MessageDenied('unsupported_file');
    ({ width, height } = size);
  } else if (kind === 'video') {
    const info = videoInfo(bytes);
    width = info?.width ?? null;
    height = info?.height ?? null;
  }
  const { key } = await deps.media.put(bytes, verdict.mime);
  if (gated) {
    await completePendingRoomUpload(sql, reader.organizationId, {
      stagingKey: parsed.data.stagingKey,
      completedKey: key,
      sizeBytes: bytes.byteLength,
    });
  }
  if (deps.staging.releaseStaging) {
    await deps.staging.releaseStaging(parsed.data.stagingKey).catch(() => undefined);
  } else if (deps.purgeStagingKey) {
    await deps.purgeStagingKey(parsed.data.stagingKey).catch(() => undefined);
  }
  return {
    ok: true,
    attachment: attachmentView({ key, name: parsed.data.name, mime: verdict.mime, size: bytes.byteLength, width, height }, deps.media),
  };
}

/**
 * The local gateway's question: may this viewer post bytes for this staging key, and how many? Null when
 * not. (Cloud storage answers with a signed URL instead and never reaches the gateway.)
 */
export async function localUploadAllowed(
  deps: RoomMessageDeps,
  viewer: Viewer,
  query: { organizationId: string; projectId: string; key: string },
): Promise<boolean> {
  if (!viewer.userId || !UUID.test(query.organizationId) || !ownsStagingKey(query.key, query.organizationId, viewer.userId)) return false;
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, query.organizationId);
      const reader = await brandReader(sql, seat, query.projectId.toLowerCase());
      return reader.canTalk;
    }),
  );
  return result === true;
}

/* ------------------------------------------------------------ team notice */

export function roomAdminPath(organizationId: string, channel?: string | null): string {
  return `/admin/brand-rooms/${organizationId}${channel ? `?channel=${encodeURIComponent(channel)}` : ''}`;
}

/** The internal line the team reads (never shown to a customer). */
export function roomNoticePreview(
  where: { title: string | null },
  message: Pick<RoomMessage, 'body' | 'parentId' | 'mentionsTeam' | 'attachments'>,
): string {
  const head = `[프로젝트 룸] ${where.title ?? '일반 문의'}${message.parentId ? ' · 스레드 답글' : ''}${message.mentionsTeam ? ' · 야기 팀 호출' : ''}`;
  const lines = [head];
  if (message.body) lines.push(message.body.slice(0, 1200));
  if (message.attachments.length) lines.push(`첨부 ${message.attachments.length}개: ${message.attachments.map((a) => a.name).join(', ').slice(0, 300)}`);
  return lines.join('\n');
}

export function roomNoticeBody(
  where: { organizationId: string; channel: string; title: string | null },
  message: Pick<RoomMessage, 'body' | 'parentId' | 'mentionsTeam' | 'attachments'>,
): string {
  return `${roomNoticePreview(where, message)}\n관리자 화면: ${adminUrl(roomAdminPath(where.organizationId, where.channel))}`;
}

/* ------------------------------------------------------------ brand writes */

export interface RoomOperationOutcome {
  result: RoomOperationResult;
  /** Set when the team should hear about it (a brand member's new line). */
  notice: RoomNotice | null;
}

/** One `POST /api/brand-rooms/messages` operation. Unknown names are `invalid`. */
export async function runRoomOperation(deps: RoomMessageDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<RoomOperationOutcome> {
  const quiet = (result: RoomOperationResult): RoomOperationOutcome => ({ result, notice: null });
  if (!isRoomOperation(operation)) return quiet(failure('invalid'));
  // The gate before any input detail is judged: a closed organization gets the same 404 whatever it sent.
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return quiet(failure('invalid'));
  const gate = await guard(() => deps.sql.transaction((sql) => roomSeat(sql, viewer.userId, organizationId)));
  if ('ok' in gate) return quiet(gate);
  const channel = (input as { projectId?: unknown }).projectId;
  if (typeof channel !== 'string') return quiet(failure('invalid'));
  const channelId = channel.trim().toLowerCase();
  if (channelId !== GENERAL_CHANNEL && !UUID.test(channelId)) return quiet(failure('invalid'));

  let notice: RoomNotice | null = null;
  let deletedAttachmentInfo: { messageId: string; keys: string[] } | null = null;
  const result = await guard<RoomOperationResult>(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, organizationId);
      const reader = await brandReader(sql, seat, channelId);
      switch (operation) {
        case 'message.send': {
          const { message, created } = await insertMessage(sql, deps.media, reader, input, { role: 'brand', rateLimited: true });
          if (created) {
            const noticeBody = roomNoticeBody(reader, message);
            notice = { organizationId, userId: seat.userId, messageId: message.id, body: noticeBody };
            await enqueueTeamNotice(sql, 'room_message', {
              organizationId,
              sourceTable: 'brand_room_messages',
              sourceId: message.id,
              actorUserId: seat.userId,
              surface: reader.projectId ? 'project_room' : 'general_room',
              preview: roomNoticePreview(reader, message),
              adminPath: roomAdminPath(organizationId, reader.channel),
            });
            // Colleagues this line names hear about it (./notices.ts; best effort, never fails the send).
            await enqueueNotices(sql, { type: 'message', organizationId, projectId: reader.projectId, messageId: message.id, actorId: seat.userId, actorRole: 'brand', mentions: message.mentions });
          }
          return { ok: true as const, message } satisfies RoomMessageDone;
        }
        case 'message.edit':
          return { ok: true as const, message: await editMessage(sql, deps.media, reader, input) } satisfies RoomMessageDone;
        case 'message.delete': {
          const parsed = MessageRefSchema.safeParse(input);
          if (!parsed.success) throw new MessageDenied('invalid');
          deletedAttachmentInfo = await deleteMessage(sql, reader, parsed.data.messageId, false);
          return { ok: true as const } satisfies RoomDone;
        }
        case 'message.pin': {
          const parsed = MessagePinSchema.safeParse(input);
          if (!parsed.success) throw new MessageDenied('invalid');
          return { ok: true as const, message: await pinMessage(sql, deps.media, reader, parsed.data.messageId, parsed.data.pinned) } satisfies RoomMessageDone;
        }
        case 'reaction.toggle':
          return toggleReaction(sql, reader, input);
        case 'channel.read': {
          const parsed = ChannelReadSchema.safeParse(input);
          if (!parsed.success) throw new MessageDenied('invalid');
          return markRead(sql, reader, parsed.data.at);
        }
        case 'attachment.reserve':
          return reserveUpload(sql, deps, reader, input);
        case 'attachment.complete':
          return completeUpload(sql, deps, reader, input);
      }
    }),
  );
  const dropped = deletedAttachmentInfo as { messageId: string; keys: string[] } | null;
  if (result.ok && dropped && dropped.keys.length > 0) {
    await dropUnreferencedStudioKeys(deps.sql, deps.media, dropped.keys, { messageId: dropped.messageId });
  }
  return { result, notice: result.ok ? notice : null };
}

/* ------------------------------------------------------------ summary */

interface ChannelRow {
  channel: string;
  project_id: string | null;
  title: string | null;
  last_at: Date | string | null;
  last_line: string | null;
  unread: number;
  created_at: Date | string | null;
}

/** Channels of one organization with this person's unread count, their last activity and last line. */
async function channelRows(sql: SqlRunner, organizationId: string, viewerId: string, options: { projectIds: string[] | null; general: boolean }): Promise<ChannelRow[]> {
  return (
    await sql.query<ChannelRow>(
      `with chans as (
         select p.id::text as channel, p.id as project_id, p.title, p.created_at
           from brand_projects p
          where p.organization_id = $1 and p.client_visible and ($2::uuid[] is null or p.id = any($2::uuid[]))
         union all
         select 'general', null, null, null where $3::boolean
       )
       select c.channel, c.project_id::text as project_id, c.title, c.created_at,
              greatest(
                (select max(m.created_at) from brand_room_messages m where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null),
                (select max(b.created_at) from brand_messages b where b.organization_id = $1 and c.project_id is not null and b.project_id = c.project_id)
              ) as last_at,
              coalesce(
                (select coalesce(nullif(m.body, ''), m.attachments -> 0 ->> 'name') from brand_room_messages m
                  where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null and m.kind = 'text'
                  order by m.created_at desc limit 1),
                (select b.body from brand_messages b where b.organization_id = $1 and c.project_id is not null and b.project_id = c.project_id
                  order by b.created_at desc limit 1)
              ) as last_line,
              (select count(*)::int from brand_room_messages m
                where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null
                  and m.author_id is distinct from $4::uuid
                  and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)) as unread
         from chans c
         left join brand_room_reads r on r.organization_id = $1 and r.channel = c.channel and r.user_id = $4::uuid`,
      [organizationId, options.projectIds, options.general, viewerId],
    )
  ).rows;
}

function sortChannels<T extends { channel: string; last_at: Date | string | null; created_at: Date | string | null }>(rows: T[]): T[] {
  const time = (v: Date | string | null) => (v == null ? 0 : new Date(v).getTime());
  return [...rows].sort((a, b) => {
    if (a.channel === GENERAL_CHANNEL) return -1;
    if (b.channel === GENERAL_CHANNEL) return 1;
    return time(b.last_at) - time(a.last_at) || time(b.created_at) - time(a.created_at);
  });
}

const lastLineOf = (line: string | null): string | null => {
  const flat = line?.replace(/\s+/g, ' ').trim();
  return flat ? flat.slice(0, 120) : null;
};

async function loadRoomAlerts(
  sql: SqlRunner,
  organizationId: string,
  channels: ReadonlyArray<{ projectId: string | null; title: string }>,
): Promise<RoomAlertItem[]> {
  const projectTitles = new Map<string, string>();
  for (const c of channels) if (c.projectId) projectTitles.set(c.projectId.toLowerCase(), c.title);
  const projectIds = [...projectTitles.keys()];
  if (projectIds.length === 0) return [];
  const alerts: RoomAlertItem[] = [];
  let sp = false;
  try {
    await sql.query('savepoint brand_room_alerts');
    sp = true;
  } catch {
    sp = false;
  }
  try {
    if (await tableExists(sql, 'brand_storyboards')) {
      const boards = (
        await sql.query<{ id: string; project_id: string; title: string; version: number; status: string; updated_at: Date | string }>(
          `select distinct on (coalesce(s.lineage_id, s.id))
                  s.id::text as id, s.project_id::text as project_id, s.title, s.version, s.status, s.updated_at
             from brand_storyboards s
            where s.organization_id = $1 and s.project_id = any($2::uuid[]) and s.deleted_at is null and s.status <> 'draft'
            order by coalesce(s.lineage_id, s.id), s.version desc`,
          [organizationId, projectIds],
        )
      ).rows;
      for (const b of boards) {
        if (b.status !== 'shared') continue;
        alerts.push({
          id: `storyboard:${b.id}`,
          kind: 'storyboard',
          projectId: b.project_id.toLowerCase(),
          projectTitle: projectTitles.get(b.project_id.toLowerCase()) ?? '',
          targetId: b.id,
          title: b.title,
          version: Number(b.version ?? 1),
          status: b.status,
          openNotes: 0,
          updatedAt: iso(b.updated_at),
        });
      }
    }
    if (await tableExists(sql, 'brand_studio_reviews')) {
      const hasComments = await tableExists(sql, 'brand_studio_review_comments');
      // The brand's open notes: team notes (0093) are not theirs to answer and never counted here.
      const shown = hasComments ? publicNotesOnly('c', await teamNotesReady(sql)) : '';
      const reviews = (
        await sql.query<{ id: string; project_id: string; title: string; version: number | null; status: string; open_notes: number; updated_at: Date | string }>(
          `select distinct on (coalesce(r.stack_id, r.id))
                  r.id::text as id, r.project_id::text as project_id, r.title, r.version, r.status, r.updated_at,
                  ${
                    hasComments
                      ? `(select count(*)::int from brand_studio_review_comments c
                          where c.review_id = r.id and c.parent_id is null and c.deleted_at is null and c.resolved_at is null${shown})`
                      : '0'
                  } as open_notes
             from brand_studio_reviews r
            where r.organization_id = $1 and r.project_id = any($2::uuid[]) and r.deleted_at is null
            order by coalesce(r.stack_id, r.id), coalesce(r.version, 1) desc`,
          [organizationId, projectIds],
        )
      ).rows;
      for (const r of reviews) {
        const openNotes = Number(r.open_notes ?? 0);
        if (r.status !== 'open' && openNotes === 0) continue;
        alerts.push({
          id: `review:${r.id}`,
          kind: 'review',
          projectId: r.project_id.toLowerCase(),
          projectTitle: projectTitles.get(r.project_id.toLowerCase()) ?? '',
          targetId: r.id,
          title: r.title,
          version: Number(r.version ?? 1),
          status: r.status,
          openNotes,
          updatedAt: iso(r.updated_at),
        });
      }
    }
    if (sp) await sql.query('release savepoint brand_room_alerts');
  } catch {
    if (sp) await sql.query('rollback to savepoint brand_room_alerts').catch(() => undefined);
    return [];
  }
  return alerts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20);
}

/** `GET /api/brand-rooms/summary?organizationId=` — what the rail and the inbox's channel list read. */
export async function loadRoomSummary(deps: Pick<RoomMessageDeps, 'sql'>, viewer: Viewer, organizationId: string): Promise<RoomSummary | RoomFailure> {
  if (!UUID.test(organizationId)) return failure('invalid');
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, organizationId);
      const rows = sortChannels(await channelRows(sql, organizationId, seat.userId, { projectIds: seat.projectIds, general: seat.role !== 'guest' })).slice(0, ROOM_LIMITS.channelsMax);
      const channels = rows.map((r) => ({
        projectId: r.project_id,
        title: r.title ?? '',
        unread: Number(r.unread ?? 0),
        lastAt: isoOrNull(r.last_at),
        lastLine: lastLineOf(r.last_line),
      }));
      const alerts = await loadRoomAlerts(sql, organizationId, channels);
      return { ok: true as const, unread: channels.reduce((n, c) => n + c.unread, 0), channels, alerts };
    }),
  );
}

/**
 * Messages in each cut's or item's thread, by exact `ref_key` (`storyboard:<board>:<frame>`, …). For slice S
 * (a cut's thread count) and slice R; the caller has already checked the seat for this organization.
 */
export async function refThreadCounts(sql: SqlRunner, organizationId: string, refKeys: readonly string[]): Promise<Record<string, number>> {
  const keys = [...new Set(refKeys.map((k) => k.toLowerCase()))];
  if (keys.length === 0) return {};
  const rows = (
    await sql.query<{ ref_key: string; n: number }>(
      `select ref_key, count(*)::int as n from brand_room_messages
        where organization_id = $1 and ref_key = any($2::text[]) and deleted_at is null and kind = 'text' group by ref_key`,
      [organizationId, keys],
    )
  ).rows;
  return Object.fromEntries(rows.map((r) => [r.ref_key, Number(r.n)]));
}

/* ------------------------------------------------------------ team side */

/** The admin flag, re-read from the profile row inside the transaction (never the session's word). */
async function requireStaff(sql: SqlRunner, viewer: Viewer): Promise<string> {
  if (!viewer.userId || !UUID.test(viewer.userId)) throw new MessageDenied('sign_in_required');
  const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
  if (!profile) throw new MessageDenied('sign_in_required');
  if (profile.is_admin !== true) throw new MessageDenied('forbidden');
  return viewer.userId;
}

/** A client organization the team may talk with: it exists and is neither sandboxed nor generation-closed. */
async function staffOrganization(sql: SqlRunner, organizationId: string): Promise<{ id: string; name: string }> {
  if (!UUID.test(organizationId)) throw new MessageDenied('not_found');
  const org = (await sql.query<{ id: string; name: string }>('select id::text as id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org || isSandboxedClientOrganization(org)) throw new MessageDenied('not_found');
  const denied = (await loadFeaturePolicies(sql, [org.id]))[org.id] ?? [];
  if (featureDenied(denied, 'generative_media')) throw new MessageDenied('not_found');
  return { id: org.id.toLowerCase(), name: String(org.name) };
}

async function staffReader(sql: SqlRunner, viewer: Viewer, organizationId: string, channel: string): Promise<Reader & { organizationName: string }> {
  const userId = await requireStaff(sql, viewer);
  const org = await staffOrganization(sql, organizationId);
  const base = { organizationId: org.id, organizationName: org.name, viewerId: userId, team: true, canTalk: true, canPin: true, member: true };
  const key = channel.trim().toLowerCase();
  if (key === GENERAL_CHANNEL) return { ...base, channel: GENERAL_CHANNEL, projectId: null, title: null };
  if (!UUID.test(key)) throw new MessageDenied('not_found');
  const project = (await sql.query<{ id: string; title: string }>('select id::text as id, title from brand_projects where id = $1 and organization_id = $2 and client_visible', [key, org.id])).rows[0];
  if (!project) throw new MessageDenied('not_found');
  return { ...base, channel: project.id.toLowerCase(), projectId: project.id.toLowerCase(), title: project.title };
}

/**
 * The customer's moves on the work that wait for the team (docs/BRAND-ROOMS-FEEDBACK.md §3): a note, a
 * change request, an approval. A guest's note through a share link is stored with `actorRole = 'brand'`
 * too (lib/brand-rooms/shares.ts). What the customer is only told about (a new version, a shared board)
 * is not here, and a team note (§5) leaves no line at all.
 */
export const TEAM_WAITING_EVENTS = ['review_commented', 'review_changes_requested', 'review_approved', 'storyboard_approved', 'storyboard_changes_requested'] as const;

const WAITING_EVENT_LIST = TEAM_WAITING_EVENTS.map((e) => `'${e}'`).join(', ');

/** A line by the team: its own text line, or an event the team caused (a reply on a note, a new version, a shared board). */
const teamAnswer = (s: string) => `(${s}.author_role = 'studio' or (${s}.kind = 'event' and ${s}.detail ->> 'actorRole' = 'studio'))`;

/** A line the team owes an answer for: a customer's live line, or a customer's note or decision on the work. */
const waitingLine = (m: string) =>
  `(${m}.deleted_at is null and (${m}.author_role = 'brand'
     or (${m}.kind = 'event' and ${m}.author_role = 'system' and ${m}.detail ->> 'actorRole' = 'brand' and ${m}.event in (${WAITING_EVENT_LIST}))))`;

/**
 * The team's 확인함 marks on a channel: an admin's row in `brand_room_reads`. Since 2026-11-18 only the desk's
 * 확인함 button writes a team member's row (`brand_rooms.channel.ack`); opening a conversation, its drawer or a
 * thread writes nothing on the team side. The brand never reads these rows (each member reads only their own).
 */
const teamAckRows = (organization: string, channel: string) =>
  `brand_room_reads r join profiles ap on ap.id = r.user_id and ap.is_admin where r.organization_id = ${organization} and r.channel = ${channel}`;

/**
 * Where the team caught up on a channel: its newest live team line or team event (a reply, a note the brand can
 * see, a new version, a shared board), or its newest 확인함. A team note (§5) leaves no line, so it is not here.
 */
const teamCaughtUp = (m: string) => `
  greatest(
    coalesce((select max(r.last_read_at) from ${teamAckRows(`${m}.organization_id`, `${m}.channel`)}), '-infinity'::timestamptz),
    coalesce((select max(s.created_at) from brand_room_messages s
               where s.organization_id = ${m}.organization_id and s.channel = ${m}.channel and s.deleted_at is null and ${teamAnswer('s')}), '-infinity'::timestamptz)
  )`;

/**
 * Team "waiting" (docs/BRAND-ROOMS-FEEDBACK.md §3, as changed 2026-11-18): the customer's lines the team has not
 * answered yet — the waiting lines after the team's newest answer and its newest 확인함. Reading does not clear
 * them. `m` is the counted alias.
 */
const teamWaiting = (m: string) => `${waitingLine(m)} and ${m}.created_at > ${teamCaughtUp(m)}`;

/** The newest 확인함 on a channel, as two columns (`ack_at`, `ack_by`) for a select list. */
const teamAckColumns = (organization: string, channel: string) => `
  (select max(r.last_read_at) from ${teamAckRows(organization, channel)}) as ack_at,
  (select coalesce(nullif(btrim(ap.display_name), ''), split_part(ap.email, '@', 1)) from ${teamAckRows(organization, channel)}
    order by r.last_read_at desc limit 1) as ack_by`;

/** Who pressed 확인함 last on a channel, and when. Team pages only. */
export interface StaffAcknowledgement {
  at: string;
  /** The team member's display name, else the part of their address before the @. */
  by: string | null;
}

/** "확인함 · 이름 · 시각" (or without the name) for the team pages; null when nobody has pressed it. */
export function acknowledgementLine(
  ack: StaffAcknowledgement | null | undefined,
  words: { acknowledged: string; acknowledgedAt: string },
  time: (iso: string) => string,
): string | null {
  if (!ack) return null;
  return ack.by ? interpolate(words.acknowledged, { name: ack.by, time: time(ack.at) }) : interpolate(words.acknowledgedAt, { time: time(ack.at) });
}

function acknowledgementOf(row: { ack_at?: Date | string | null; ack_by?: string | null }): StaffAcknowledgement | null {
  const at = isoOrNull(row.ack_at ?? null);
  if (!at) return null;
  const by = typeof row.ack_by === 'string' ? row.ack_by.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return { at, by: by || null };
}

export interface StaffRoomChannel {
  organizationId: string;
  organizationName: string;
  channel: string;
  projectId: string | null;
  title: string | null;
  lastAt: string | null;
  lastLine: string | null;
  lastRole: RoomAuthorRole | null;
  /** The customer's lines the team has not answered or acknowledged yet. */
  teamUnread: number;
  /** The newest 확인함 (one organization's channel list only; the cross-brand overview leaves it out). */
  acknowledged?: StaffAcknowledgement | null;
}

interface StaffChannelRow {
  organization_id: string;
  organization_name: string;
  channel: string;
  project_id: string | null;
  title: string | null;
  last_at: Date | string | null;
  last_line: string | null;
  last_role: RoomAuthorRole | null;
  team_unread: number;
  created_at: Date | string | null;
  ack_at?: Date | string | null;
  ack_by?: string | null;
}

function staffChannelView(r: StaffChannelRow): StaffRoomChannel {
  return {
    organizationId: String(r.organization_id),
    organizationName: String(r.organization_name),
    channel: String(r.channel),
    projectId: r.project_id ? String(r.project_id) : null,
    title: r.title,
    lastAt: isoOrNull(r.last_at),
    lastLine: lastLineOf(r.last_line),
    lastRole: r.last_role,
    teamUnread: Number(r.team_unread ?? 0),
    ...('ack_at' in r ? { acknowledged: acknowledgementOf(r) } : {}),
  };
}

async function openOrganizations(sql: SqlRunner): Promise<Array<{ id: string; name: string }>> {
  const orgs = (await sql.query<{ id: string; name: string }>('select id::text as id, name from brand_organizations order by name')).rows.filter((o) => !isSandboxedClientOrganization(o));
  const policies = await loadFeaturePolicies(sql, orgs.map((o) => o.id));
  return orgs.filter((o) => !featureDenied(policies[o.id] ?? [], 'generative_media')).map((o) => ({ id: o.id.toLowerCase(), name: String(o.name) }));
}

/** A project the team has not said anything in yet (docs/BRAND-ROOMS-FEEDBACK.md §3): a commission leaves no line. */
export interface StaffNewRequest extends StaffRoomChannel {
  projectId: string;
  status: string;
  createdAt: string;
}

/** Project statuses a "new request" can still have: closed work is not waiting for a first word. */
const NEW_REQUEST_STATUSES = ['requested', 'active'] as const;

/**
 * `/admin/brand-rooms` — the team's project list. `newRequests`: client-visible projects of open
 * organizations with no team line and no team event in their channel yet, newest first. `channels`: every
 * channel with a line in it (project channels and each organization's general conversation; a new request
 * the brand already wrote in is here too, the page lists it once), waiting ones first, then by last
 * activity. Sandboxed and generation-closed organizations are in neither.
 */
export async function staffRoomOverview(
  deps: Pick<RoomMessageDeps, 'sql'>,
  viewer: Viewer,
): Promise<{ ok: true; channels: StaffRoomChannel[]; newRequests: StaffNewRequest[]; organizations: Array<{ id: string; name: string }> } | RoomFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const organizations = await openOrganizations(sql);
      const open = new Set(organizations.map((o) => o.id));
      const fresh = (
        await sql.query<StaffChannelRow & { status: string }>(
          `select p.organization_id::text as organization_id, g.name as organization_name, p.id::text as channel, p.id::text as project_id, p.title,
                  p.status, p.created_at,
                  (select max(m.created_at) from brand_room_messages m where m.organization_id = p.organization_id and m.channel = p.id::text and m.deleted_at is null) as last_at,
                  (select coalesce(nullif(l.body, ''), l.attachments -> 0 ->> 'name') from brand_room_messages l
                    where l.organization_id = p.organization_id and l.channel = p.id::text and l.deleted_at is null and l.kind = 'text'
                    order by l.created_at desc limit 1) as last_line,
                  (select l.author_role from brand_room_messages l
                    where l.organization_id = p.organization_id and l.channel = p.id::text and l.deleted_at is null and l.kind = 'text'
                    order by l.created_at desc limit 1) as last_role,
                  (select count(*)::int from brand_room_messages m0
                    where m0.organization_id = p.organization_id and m0.channel = p.id::text and ${teamWaiting('m0')}) as team_unread
             from brand_projects p
             join brand_organizations g on g.id = p.organization_id
            where p.client_visible and p.status = any($1::text[])
              and not exists (select 1 from brand_room_messages s where s.organization_id = p.organization_id and s.channel = p.id::text and ${teamAnswer('s')})
            order by p.created_at desc, p.id
            limit 100`,
          [[...NEW_REQUEST_STATUSES]],
        )
      ).rows;
      const newRequests = fresh
        .filter((r) => open.has(String(r.organization_id).toLowerCase()))
        .map((r) => ({ ...staffChannelView(r), projectId: String(r.project_id), status: String(r.status), createdAt: isoOrNull(r.created_at) ?? '' }));
      const rows = (
        await sql.query<StaffChannelRow>(
          `select m0.organization_id::text as organization_id, g.name as organization_name, m0.channel, m0.project_id::text as project_id, p.title,
                  null::timestamptz as created_at,
                  max(m0.created_at) as last_at,
                  (select coalesce(nullif(l.body, ''), l.attachments -> 0 ->> 'name') from brand_room_messages l
                    where l.organization_id = m0.organization_id and l.channel = m0.channel and l.deleted_at is null and l.kind = 'text'
                    order by l.created_at desc limit 1) as last_line,
                  (select l.author_role from brand_room_messages l
                    where l.organization_id = m0.organization_id and l.channel = m0.channel and l.deleted_at is null and l.kind = 'text'
                    order by l.created_at desc limit 1) as last_role,
                  count(*) filter (where ${teamWaiting('m0')})::int as team_unread
             from brand_room_messages m0
             join brand_organizations g on g.id = m0.organization_id
             left join brand_projects p on p.id = m0.project_id
            where m0.project_id is null or p.client_visible
            group by m0.organization_id, g.name, m0.channel, m0.project_id, p.title
            order by max(m0.created_at) desc
            limit 300`,
        )
      ).rows;
      const channels = rows
        .filter((r) => open.has(String(r.organization_id).toLowerCase()))
        .map(staffChannelView)
        .sort((a, b) => Number(b.teamUnread > 0) - Number(a.teamUnread > 0) || (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
      return { ok: true as const, channels, newRequests, organizations };
    }),
  );
}

export interface StaffProjectDesk {
  ok: true;
  organization: { id: string; name: string };
  project: { id: string; title: string; status: string; createdAt: string | null };
  /** The customer's lines the team has not answered or acknowledged yet. */
  teamUnread: number;
  /** The newest 확인함 on the project's conversation, or null. */
  acknowledged: StaffAcknowledgement | null;
}

/**
 * `/admin/brand-rooms/[organizationId]/[projectId]` — the team's desk for one project: the same gate as the
 * project's conversation (an admin re-read on the profile row, an open organization, a client-visible
 * project of that organization; anything else `not_found`), its status, the waiting count and the last 확인함.
 */
export async function staffProjectDesk(deps: Pick<RoomMessageDeps, 'sql'>, viewer: Viewer, organizationId: string, projectId: string): Promise<StaffProjectDesk | RoomFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const reader = await staffReader(sql, viewer, organizationId, projectId);
      if (!reader.projectId) throw new MessageDenied('not_found');
      const row = (
        await sql.query<{ status: string; created_at: Date | string | null; team_unread: number; ack_at: Date | string | null; ack_by: string | null }>(
          `select p.status, p.created_at,
                  (select count(*)::int from brand_room_messages m0
                    where m0.organization_id = p.organization_id and m0.channel = p.id::text and ${teamWaiting('m0')}) as team_unread,
                  ${teamAckColumns('p.organization_id', 'p.id::text')}
             from brand_projects p where p.id = $1 and p.organization_id = $2`,
          [reader.projectId, reader.organizationId],
        )
      ).rows[0];
      if (!row) throw new MessageDenied('not_found');
      return {
        ok: true as const,
        organization: { id: reader.organizationId, name: reader.organizationName },
        project: { id: reader.projectId, title: String(reader.title ?? ''), status: String(row.status), createdAt: isoOrNull(row.created_at) },
        teamUnread: Number(row.team_unread ?? 0),
        acknowledged: acknowledgementOf(row),
      };
    }),
  );
}

/** `/admin/brand-rooms/[organizationId]` — that organization's channels (general first) with team unread counts. */
export async function staffRoomChannels(
  deps: Pick<RoomMessageDeps, 'sql'>,
  viewer: Viewer,
  organizationId: string,
): Promise<{ ok: true; organization: { id: string; name: string }; channels: StaffRoomChannel[] } | RoomFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const org = await staffOrganization(sql, organizationId);
      const rows = (
        await sql.query<StaffChannelRow>(
          `with chans as (
             select p.id::text as channel, p.id as project_id, p.title, p.created_at from brand_projects p
              where p.organization_id = $1 and p.client_visible
             union all
             select 'general', null, null, null
           )
           select $1::text as organization_id, $2::text as organization_name, c.channel, c.project_id::text as project_id, c.title, c.created_at,
                  (select max(m.created_at) from brand_room_messages m where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null) as last_at,
                  (select coalesce(nullif(m.body, ''), m.attachments -> 0 ->> 'name') from brand_room_messages m
                    where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null and m.kind = 'text'
                    order by m.created_at desc limit 1) as last_line,
                  (select m.author_role from brand_room_messages m
                    where m.organization_id = $1 and m.channel = c.channel and m.deleted_at is null and m.kind = 'text'
                    order by m.created_at desc limit 1) as last_role,
                  (select count(*)::int from brand_room_messages m0
                    where m0.organization_id = $1 and m0.channel = c.channel and ${teamWaiting('m0')}) as team_unread,
                  ${teamAckColumns('$1::uuid', 'c.channel')}
             from chans c`,
          [org.id, org.name],
        )
      ).rows;
      return { ok: true as const, organization: org, channels: sortChannels(rows).slice(0, ROOM_LIMITS.channelsMax).map(staffChannelView) };
    }),
  );
}

/** The team's `GET` (the admin page's feed route): the same pages the brand reads, every channel of the organization. */
export async function staffLoadRoomMessages(deps: RoomMessageDeps, viewer: Viewer, query: Record<string, string | null | undefined>): Promise<RoomReadResult> {
  const parsed = StreamQuerySchema.safeParse(query);
  if (!parsed.success) return failure('invalid');
  const q = parsed.data;
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const reader = await staffReader(sql, viewer, q.organizationId, q.projectId);
      if (q.thread) return readThread(sql, deps.media, reader, q.thread, q.since);
      if (q.ref) return readRef(sql, deps.media, reader, q.ref, q.since);
      return readStream(sql, deps.media, reader, { since: q.since, before: q.before, limit: q.limit });
    }),
  );
}

/** A team line or thread reply (`brand_rooms.message.send`), stored with `author_role = 'studio'`. */
export async function staffSendMessage(deps: RoomMessageDeps, viewer: Viewer, input: MessageSendInputLoose): Promise<RoomMessageDone | RoomFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const reader = await staffReader(sql, viewer, String(input.organizationId ?? ''), String(input.projectId ?? ''));
      const { message, created } = await insertMessage(sql, deps.media, reader, { ...input, organizationId: reader.organizationId, projectId: reader.channel, mentionsTeam: false }, { role: 'studio', rateLimited: false });
      // The room's members hear about a team line (./notices.ts; best effort, never fails the send).
      if (created) {
        await enqueueNotices(sql, { type: 'message', organizationId: reader.organizationId, projectId: reader.projectId, messageId: message.id, actorId: reader.viewerId, actorRole: 'studio', mentions: message.mentions });
      }
      return { ok: true as const, message };
    }),
  );
}

/** Pin or unpin any line (`brand_rooms.message.pin`). */
export async function staffPinMessage(
  deps: RoomMessageDeps,
  viewer: Viewer,
  input: { organizationId: string; projectId: string; messageId: string; pinned: boolean },
): Promise<RoomMessageDone | RoomFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const reader = await staffReader(sql, viewer, input.organizationId, input.projectId);
      return { ok: true as const, message: await pinMessage(sql, deps.media, reader, input.messageId, input.pinned) };
    }),
  );
}

/** Take down any line, the team's own or a brand's (`brand_rooms.message.delete`). `deleted_by` is the audit. */
export async function staffDeleteMessage(deps: RoomMessageDeps, viewer: Viewer, input: { organizationId: string; projectId: string; messageId: string }): Promise<RoomDone | RoomFailure> {
  let deletedAttachmentInfo: { messageId: string; keys: string[] } | null = null;
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const reader = await staffReader(sql, viewer, input.organizationId, input.projectId);
      deletedAttachmentInfo = await deleteMessage(sql, reader, input.messageId, true);
      return { ok: true as const };
    }),
  );
  const dropped = deletedAttachmentInfo as { messageId: string; keys: string[] } | null;
  if (result.ok && dropped && dropped.keys.length > 0) {
    await dropUnreferencedStudioKeys(deps.sql, deps.media, dropped.keys, { messageId: dropped.messageId });
  }
  return result;
}

/**
 * 확인함 (`brand_rooms.channel.ack`, the desk's button): a team member has looked at what waits in a channel and
 * owes no answer for now, so its waiting count starts again after this moment. Stored as that member's row in
 * `brand_room_reads` at the database's now (who and when; the row only moves forward). Team-only: no line in
 * the conversation, no notice, nothing a brand member or a share guest reads. Opening a conversation no longer
 * writes this row for the team (the admin transport has no read mark).
 */
export async function staffAcknowledge(
  deps: Pick<RoomMessageDeps, 'sql'>,
  viewer: Viewer,
  input: { organizationId: string; projectId: string },
): Promise<{ ok: true; acknowledgedAt: string } | RoomFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const reader = await staffReader(sql, viewer, input.organizationId, input.projectId);
      const done = await markRead(sql, reader, null);
      return { ok: true as const, acknowledgedAt: done.lastReadAt };
    }),
  );
}

/** The team's send input, before parsing (an admin form's fields). */
export type MessageSendInputLoose = Record<string, unknown> & { organizationId?: unknown; projectId?: unknown };
