/**
 * Review space service (docs/BRAND-STUDIO-V3.md §7): a piece of studio work (an uploaded asset or a
 * result), feedback tied to moments in the film and spots in the frame, one level of replies, and a
 * status the brand sets (open -> changes requested | approved).
 *
 * Brand side: every read and write passes the studio seat first (membership -> Morphic hardline +
 * feature policy -> role, lib/brand-studio/access.ts). Owners and editors write, viewers read, a
 * campaign-only guest sees nothing. Team side (`staff*`): the admin flag is re-read from the profile
 * row inside the transaction, like `setStudioAllowance`; team comments carry `author_role = 'studio'`.
 *
 * Customer-visible text does not exist here: failures are `REVIEW_ERROR_CODES` only. The one sentence
 * this module writes is the internal team notice (`ReviewNotice`), which the route hands to the team
 * notifier after the answer has gone out and which never reaches a customer.
 */
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import { loadFeaturePolicies } from '@/lib/brands/entitlements';
import { adjustOrganizationStorageBytes } from '@/lib/brands/storage-quota';
import { RoomDenied, requireEdit, requireRoomProject, roomSeat, type RoomSeat } from '@/lib/brand-rooms/access';
import { postRoomEvent, type RoomEventInput } from '@/lib/brand-rooms/events';
import { brandRoomsOpen } from '@/lib/flags';
import { requireCreate, StudioDenied, studioSeat, type StudioSeat } from './access';
import type { StudioMediaStore } from './media-store';
import {
  CommentAddSchema,
  CommentRefSchema,
  REVIEW_ERROR_CODES,
  REVIEW_LIMITS,
  REVIEW_OPERATIONS,
  REVIEW_STATUSES,
  ROOM_REVIEW_OPERATIONS,
  ReviewCreateSchema,
  ReviewRefSchema,
  ReviewStatusSchema,
  ReviewVersionSchema,
  RoomReviewCreateSchema,
  RoomScopeSchema,
  formatTimecode,
  type ReviewComment,
  type ReviewCommentAdded,
  type ReviewCreated,
  type ReviewDetail,
  type ReviewDone,
  type ReviewErrorCode,
  type ReviewFailure,
  type ReviewItem,
  type ReviewList,
  type ReviewListItem,
  type ReviewOperation,
  type ReviewOperationResult,
  type ReviewRole,
  type ReviewSource,
  type ReviewStack,
  type ReviewStatus,
  type ReviewStroke,
  type ReviewVersion,
  type RoomReviewDetail,
  type RoomReviewList,
  type RoomReviewOperation,
} from './review-contracts';

export interface ReviewDeps {
  sql: SqlRunner;
  media: StudioMediaStore;
}

/** What the team is told after a brand member comments or moves the status. Internal only. */
export interface ReviewNotice {
  organizationId: string;
  userId: string;
  messageId: string;
  body: string;
}

export class ReviewDenied extends Error {
  constructor(readonly code: ReviewErrorCode) {
    super(code);
    this.name = 'ReviewDenied';
  }
}

const failure = (code: ReviewErrorCode): ReviewFailure => ({ ok: false, code });

/** Run `fn`; a refusal becomes its code, a unique-key race becomes `conflict`. Anything else propagates. */
async function guard<T>(fn: () => Promise<T>): Promise<T | ReviewFailure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ReviewDenied) return failure(error.code);
    if (error instanceof StudioDenied) return failure((REVIEW_ERROR_CODES as readonly string[]).includes(error.code) ? (error.code as ReviewErrorCode) : 'failed');
    if (error instanceof RoomDenied) return failure(error.code);
    if ((error as { code?: string } | null)?.code === '23505') return failure('conflict');
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* --------------------------------------------------------------- rooms schema probe */

/**
 * True once 0084 is applied: the review columns rooms add and the share table exist. The studio review
 * screen is live in production, so every read and write below works on a database without them and only
 * touches the new columns when this says so. A positive answer is remembered (a schema does not go back);
 * a negative one is asked again, so applying 0084 needs no redeploy.
 */
let roomColumnsSeen = false;
export async function roomReviewReady(sql: SqlRunner): Promise<boolean> {
  if (roomColumnsSeen) return true;
  const { rows } = await sql.query<{ ready: boolean }>(
    `select (select count(*) from pg_attribute where attrelid = to_regclass('public.brand_studio_reviews')
               and attname in ('project_id', 'stack_id', 'version', 'source') and not attisdropped) = 4
        and (select count(*) from pg_attribute where attrelid = to_regclass('public.brand_studio_review_comments')
               and attname in ('end_ms', 'strokes', 'guest_name', 'share_id', 'carried_from') and not attisdropped) = 5
        and to_regclass('public.brand_room_shares') is not null as ready`,
  );
  roomColumnsSeen = rows[0]?.ready === true;
  return roomColumnsSeen;
}

/** Ranges, drawings and versions show on a screen only when the columns exist AND rooms are switched on. */
async function extendedScreen(sql: SqlRunner): Promise<boolean> {
  return brandRoomsOpen() && (await roomReviewReady(sql));
}

/** A room line, after the write committed. Best effort by contract (lib/brand-rooms/events.ts). */
export async function sendRoomEvent(sql: SqlRunner, event: RoomEventInput | null, log?: (event: string, detail?: Record<string, unknown>) => void): Promise<void> {
  if (!event) return;
  try {
    await postRoomEvent(sql, event);
  } catch (error) {
    log?.('room_event_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
  }
}

/** The studio seat, minus campaign-only guests: the review screen is not theirs (the page 404s them too). */
async function reviewSeat(sql: SqlRunner, userId: string | null | undefined, organizationId: string): Promise<StudioSeat> {
  const seat = await studioSeat(sql, userId, organizationId);
  if (seat.role === 'guest') throw new StudioDenied('not_found');
  return seat;
}

/* --------------------------------------------------------------- rows */

interface ReviewRow {
  id: string;
  organization_id: string;
  asset_id: string | null;
  output_id: string | null;
  title: string;
  status: ReviewStatus;
  created_role: ReviewRole;
  status_changed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  s_kind: string | null;
  s_key: string | null;
  s_thumb: string | null;
  s_width: number | null;
  s_height: number | null;
  s_ms: number | null;
  s_live: boolean | null;
  open_count: number;
  total_count: number;
  organization_name: string;
  /** 0084 only. */
  project_id?: string | null;
  stack_id?: string;
  version?: number;
  source?: ReviewSource;
}

interface CommentRow {
  id: string;
  review_id: string;
  parent_id: string | null;
  author_id: string | null;
  author_role: ReviewRole;
  body: string;
  at_ms: number | null;
  x: number | null;
  y: number | null;
  resolved_at: Date | string | null;
  created_at: Date | string;
  deleted_at: Date | string | null;
  display_name: string | null;
  email: string | null;
  /** 0084 only. */
  end_ms?: number | null;
  strokes?: unknown;
  guest_name?: string | null;
  carried_from?: string | null;
  carried_version?: number | null;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: Date | string | null): string | null => (v == null ? null : iso(v));

/** The review select, with the room columns once 0084 exists. Callers append `and …` conditions. */
async function reviewSelect(sql: SqlRunner): Promise<string> {
  return (await roomReviewReady(sql)) ? REVIEW_SELECT.replace('r.created_at, r.updated_at,', `r.created_at, r.updated_at, ${ROOM_REVIEW_COLUMNS},`) : REVIEW_SELECT;
}
const ROOM_REVIEW_COLUMNS = 'r.project_id, coalesce(r.stack_id, r.id) as stack_id, r.version, r.source';

const REVIEW_SELECT = `
  select r.id, r.organization_id, r.asset_id, r.output_id, r.title, r.status, r.created_role, r.status_changed_at,
         r.created_at, r.updated_at,
         coalesce(a.kind, o.kind) as s_kind,
         coalesce(a.storage_key, o.storage_key) as s_key,
         coalesce(a.thumb_key, o.thumb_key) as s_thumb,
         coalesce(a.width, o.width) as s_width,
         coalesce(a.height, o.height) as s_height,
         coalesce(a.duration_ms, o.duration_ms) as s_ms,
         case when r.asset_id is not null then (a.id is not null and a.deleted_at is null and a.status = 'ready')
              else (o.id is not null and o.deleted_at is null and o.status = 'ready' and o.storage_key is not null) end as s_live,
         (select count(*)::int from brand_studio_review_comments c
           where c.review_id = r.id and c.deleted_at is null and c.parent_id is null and c.resolved_at is null) as open_count,
         (select count(*)::int from brand_studio_review_comments c where c.review_id = r.id and c.deleted_at is null) as total_count,
         g.name as organization_name
    from brand_studio_reviews r
    join brand_organizations g on g.id = r.organization_id
    left join brand_studio_assets a on a.id = r.asset_id
    left join brand_studio_outputs o on o.id = r.output_id
   where r.deleted_at is null`;

function listItem(row: ReviewRow, media: StudioMediaStore): ReviewListItem {
  const kind = row.s_kind === 'video' ? 'video' : 'image';
  const available = row.s_live === true && Boolean(row.s_key);
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    title: String(row.title),
    status: row.status,
    kind,
    thumbUrl: !available ? null : row.s_thumb ? media.url(row.s_thumb) : kind === 'image' ? media.url(row.s_key!) : null,
    available,
    commentsOpen: Number(row.open_count ?? 0),
    commentsTotal: Number(row.total_count ?? 0),
    lastActivityAt: iso(row.updated_at),
    createdAt: iso(row.created_at),
    ...(row.version != null
      ? { projectId: row.project_id ? String(row.project_id) : null, stackId: String(row.stack_id ?? row.id), version: Number(row.version), source: row.source === 'delivery' ? 'delivery' : 'studio' }
      : {}),
  };
}

function versionView(row: ReviewRow, media: StudioMediaStore): ReviewVersion {
  const item = itemView(row, media);
  return {
    id: item.id,
    version: Number(row.version ?? 1),
    title: item.title,
    status: item.status,
    kind: item.kind,
    available: item.available,
    mediaUrl: item.mediaUrl,
    thumbUrl: item.thumbUrl,
    width: item.width,
    height: item.height,
    seconds: item.seconds,
    commentsOpen: item.commentsOpen,
    createdAt: item.createdAt,
  };
}

/** A stored drawing back to the wire shape; anything malformed is dropped rather than shown. */
function strokesOf(value: unknown): ReviewStroke[] | null {
  if (!Array.isArray(value)) return null;
  const lines: ReviewStroke[] = [];
  for (const line of value) {
    const l = line as { tool?: unknown; color?: unknown; points?: unknown };
    if ((l.tool !== 'pen' && l.tool !== 'arrow') || (l.color !== 'blue' && l.color !== 'white') || !Array.isArray(l.points)) continue;
    const points = (l.points as unknown[])
      .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && n >= 0 && n <= 1))
      .map(([x, y]) => [x, y] as [number, number]);
    if (points.length >= 2) lines.push({ tool: l.tool, color: l.color, points });
  }
  return lines.length ? lines : null;
}

function itemView(row: ReviewRow, media: StudioMediaStore): ReviewItem {
  const base = listItem(row, media);
  return {
    ...base,
    subject: row.asset_id ? { assetId: String(row.asset_id) } : { outputId: String(row.output_id) },
    mediaUrl: base.available ? media.url(row.s_key!) : null,
    width: row.s_width == null ? null : Number(row.s_width),
    height: row.s_height == null ? null : Number(row.s_height),
    seconds: row.s_ms == null ? null : Math.round(Number(row.s_ms) / 100) / 10,
    createdRole: row.created_role,
    statusChangedAt: isoOrNull(row.status_changed_at),
  };
}

/** A display name: the profile's own name, else (brand members only) the part of the address before the @. */
export function authorNameOf(role: ReviewRole, displayName: string | null, email: string | null): string | null {
  const name = displayName?.replace(/\s+/g, ' ').trim();
  if (name) return name.slice(0, 60);
  if (role === 'studio') return null;
  const local = email?.split('@')[0]?.trim();
  return local ? local.slice(0, 60) : null;
}

/**
 * `outside`: the reader is someone a share link was sent to. They see a member's own display name or only
 * the role, never a part of an email address.
 */
function commentView(row: CommentRow, viewerId: string | null, outside = false): ReviewComment {
  const deleted = row.deleted_at != null;
  const guest = Boolean(row.guest_name);
  const name = guest
    ? String(row.guest_name).slice(0, 60)
    : outside
      ? row.display_name?.replace(/\s+/g, ' ').trim().slice(0, 60) || null
      : authorNameOf(row.author_role, row.display_name, row.email);
  const view: ReviewComment = {
    id: String(row.id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    authorName: deleted ? null : name,
    authorRole: row.author_role,
    body: deleted ? '' : String(row.body),
    atMs: row.at_ms == null ? null : Number(row.at_ms),
    x: deleted || row.x == null ? null : Number(row.x),
    y: deleted || row.y == null ? null : Number(row.y),
    resolved: row.resolved_at != null,
    createdAt: iso(row.created_at),
    deleted,
    mine: !deleted && viewerId != null && row.author_id === viewerId,
  };
  if (row.end_ms !== undefined) {
    view.endMs = row.end_ms == null ? null : Number(row.end_ms);
    view.strokes = deleted ? null : strokesOf(row.strokes);
    view.guest = guest;
    view.carriedFrom = row.carried_from ? { version: Number(row.carried_version ?? 1) } : null;
  }
  return view;
}

async function reviewRow(sql: SqlRunner, reviewId: string, organizationId: string | null, lock = false): Promise<ReviewRow | null> {
  if (!UUID.test(reviewId)) return null;
  if (lock) {
    const locked = (
      await sql.query('select id from brand_studio_reviews where id = $1 and deleted_at is null for update', [reviewId])
    ).rows[0];
    if (!locked) return null;
  }
  const params: unknown[] = [reviewId];
  let where = ' and r.id = $1';
  if (organizationId) {
    params.push(organizationId);
    where += ' and r.organization_id = $2';
  }
  return (await sql.query<ReviewRow>(`${await reviewSelect(sql)}${where}`, params)).rows[0] ?? null;
}

const ROOM_COMMENT_COLUMNS = ', c.end_ms, c.strokes, c.guest_name, c.carried_from, sr.version as carried_version';
const ROOM_COMMENT_JOINS = `
         left join brand_studio_review_comments sc on sc.id = c.carried_from
         left join brand_studio_reviews sr on sr.id = sc.review_id`;

async function commentsOf(sql: SqlRunner, reviewId: string, viewerId: string | null, outside = false): Promise<ReviewComment[]> {
  const ready = await roomReviewReady(sql);
  const rows = (
    await sql.query<CommentRow>(
      `select c.id, c.review_id, c.parent_id, c.author_id, c.author_role, c.body, c.at_ms, c.x, c.y, c.resolved_at,
              c.created_at, c.deleted_at, p.display_name, p.email${ready ? ROOM_COMMENT_COLUMNS : ''}
         from brand_studio_review_comments c
         left join profiles p on p.id = c.author_id${ready ? ROOM_COMMENT_JOINS : ''}
        where c.review_id = $1
        order by c.created_at, c.id`,
      [reviewId],
    )
  ).rows;
  return rows.map((r) => commentView(r, viewerId, outside));
}

/** Every live version of a stack, newest first. */
async function stackVersions(sql: SqlRunner, stackId: string, organizationId: string, media: StudioMediaStore): Promise<ReviewVersion[]> {
  if (!(await roomReviewReady(sql))) return [];
  const rows = (
    await sql.query<ReviewRow>(
      `${await reviewSelect(sql)} and coalesce(r.stack_id, r.id) = $1 and r.organization_id = $2 order by r.version desc limit 50`,
      [stackId, organizationId],
    )
  ).rows;
  return rows.map((r) => versionView(r, media));
}

async function commentRow(sql: SqlRunner, reviewId: string, commentId: string): Promise<CommentRow | null> {
  return (
    (
      await sql.query<CommentRow>(
        `select c.*, p.display_name, p.email from brand_studio_review_comments c left join profiles p on p.id = c.author_id
          where c.id = $1 and c.review_id = $2 and c.deleted_at is null for update of c`,
        [commentId, reviewId],
      )
    ).rows[0] ?? null
  );
}

const touch = (sql: SqlRunner, reviewId: string) => sql.query('update brand_studio_reviews set updated_at = now() where id = $1', [reviewId]);

/* --------------------------------------------------------------- shared writes */

/** The live, ready, image-or-video asset or result of this organization that a review may point at. */
async function subjectOf(sql: SqlRunner, organizationId: string, ref: { assetId?: string; outputId?: string }): Promise<void> {
  const row = ref.assetId
    ? (
        await sql.query<{ kind: string }>(
          "select kind from brand_studio_assets where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null",
          [ref.assetId, organizationId],
        )
      ).rows[0]
    : (
        await sql.query<{ kind: string }>(
          "select kind from brand_studio_outputs where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null and storage_key is not null",
          [ref.outputId, organizationId],
        )
      ).rows[0];
  if (!row) throw new ReviewDenied('not_found');
  if (row.kind !== 'image' && row.kind !== 'video') throw new ReviewDenied('invalid');
}

/** Where a new review sits in a room (0084 only): its project, its stack and version, who put it up. */
interface RoomPlacement {
  projectId: string | null;
  stackId?: string | null;
  version?: number;
  source: ReviewSource;
}

async function insertReview(
  sql: SqlRunner,
  media: StudioMediaStore,
  input: Pick<z.output<typeof ReviewCreateSchema>, 'organizationId' | 'title' | 'assetId' | 'outputId'>,
  by: { userId: string | null; role: ReviewRole },
  room?: RoomPlacement,
): Promise<ReviewCreated> {
  await subjectOf(sql, input.organizationId, input);
  const column = input.assetId ? 'asset_id' : 'output_id';
  const subjectId = input.assetId ?? input.outputId!;
  const roomColumns = room ? ', project_id, stack_id, version, source' : '';
  const roomValues = room ? ', $6, $7, $8, $9' : '';
  const inserted = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_reviews (organization_id, ${column}, title, created_by, created_role${roomColumns})
         values ($1, $2, $3, $4, $5${roomValues})
       on conflict (organization_id, ${column}) where deleted_at is null and ${column} is not null do nothing
       returning id`,
      [
        input.organizationId,
        subjectId,
        input.title,
        by.userId,
        by.role,
        ...(room ? [room.projectId, room.stackId ?? null, room.version ?? 1, room.source] : []),
      ],
    )
  ).rows[0];
  const id =
    inserted?.id ??
    (
      await sql.query<{ id: string }>(
        `select id from brand_studio_reviews where organization_id = $1 and ${column} = $2 and deleted_at is null`,
        [input.organizationId, subjectId],
      )
    ).rows[0]?.id;
  if (!id) throw new ReviewDenied('conflict');
  const row = await reviewRow(sql, String(id), input.organizationId);
  if (!row) throw new ReviewDenied('conflict');
  return { ok: true, review: listItem(row, media), existing: !inserted };
}

/** Who writes a comment: a signed-in member or team member, or a guest through a share link (0084). */
type CommentAuthor = { userId: string; role: ReviewRole } | { guestName: string; shareId: string };

async function insertComment(
  sql: SqlRunner,
  review: ReviewRow,
  input: z.output<typeof CommentAddSchema>,
  by: CommentAuthor,
): Promise<ReviewComment> {
  const ready = await roomReviewReady(sql);
  if ('guestName' in by && !ready) throw new ReviewDenied('provider_unavailable');
  if (input.parentId) {
    const parent = (
      await sql.query<{ parent_id: string | null; deleted_at: unknown; carried_from?: string | null }>(
        `select parent_id, deleted_at${ready ? ', carried_from' : ''} from brand_studio_review_comments where id = $1 and review_id = $2`,
        [input.parentId, review.id],
      )
    ).rows[0];
    if (!parent || parent.deleted_at != null) throw new ReviewDenied('not_found');
    // One level of replies: answering a reply answers its thread.
    if (parent.parent_id) throw new ReviewDenied('invalid');
    // A note carried over from an earlier version is read-only here: its thread lives on that version.
    if (parent.carried_from) throw new ReviewDenied('invalid');
  }
  // A still has no timeline: its spots carry no moment (and no range).
  const video = review.s_kind === 'video';
  const atMs = video ? (input.atMs ?? null) : null;
  const userId = 'userId' in by ? by.userId : null;
  const role: ReviewRole = 'role' in by ? by.role : 'brand';
  const columns = ['review_id', 'organization_id', 'parent_id', 'author_id', 'author_role', 'body', 'at_ms', 'x', 'y'];
  const values: unknown[] = [review.id, review.organization_id, input.parentId ?? null, userId, role, input.body, atMs, input.x ?? null, input.y ?? null];
  if (ready) {
    columns.push('end_ms', 'strokes', 'guest_name', 'share_id');
    values.push(
      video && atMs != null ? (input.endMs ?? null) : null,
      input.strokes ? JSON.stringify(input.strokes) : null,
      'guestName' in by ? by.guestName : null,
      'shareId' in by ? by.shareId : null,
    );
  }
  const row = (
    await sql.query<CommentRow>(
      `insert into brand_studio_review_comments (${columns.join(', ')})
         values (${columns.map((column, i) => (column === 'strokes' ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')})
       returning *, null::text as display_name, null::text as email`,
      values,
    )
  ).rows[0]!;
  await touch(sql, review.id);
  const profile = userId
    ? (await sql.query<{ display_name: string | null; email: string | null }>('select display_name, email from profiles where id = $1', [userId])).rows[0]
    : undefined;
  return commentView({ ...row, display_name: profile?.display_name ?? null, email: profile?.email ?? null }, userId, 'guestName' in by);
}

/**
 * Resolve or reopen a thread. A carried note and the note it came from are one piece of feedback:
 * resolving either resolves the original and every copy of it; reopening touches only the row asked.
 */
async function toggleResolved(sql: SqlRunner, review: ReviewRow, commentId: string, userId: string): Promise<boolean> {
  const row = await commentRow(sql, review.id, commentId);
  if (!row) throw new ReviewDenied('not_found');
  const resolve = row.resolved_at == null;
  if (resolve && (await roomReviewReady(sql))) {
    const origin = row.carried_from ?? row.id;
    await sql.query(
      `update brand_studio_review_comments set resolved_at = now(), resolved_by = $2
        where resolved_at is null and deleted_at is null and (id = $1 or id = $3 or carried_from = $3)`,
      [commentId, userId, origin],
    );
  } else {
    await sql.query(
      resolve
        ? 'update brand_studio_review_comments set resolved_at = now(), resolved_by = $2 where id = $1'
        : 'update brand_studio_review_comments set resolved_at = null, resolved_by = null where id = $1',
      resolve ? [commentId, userId] : [commentId],
    );
  }
  await touch(sql, review.id);
  return resolve;
}

async function moveStatus(sql: SqlRunner, review: ReviewRow, status: ReviewStatus, userId: string): Promise<boolean> {
  if (review.status === status) return false;
  await sql.query(
    'update brand_studio_reviews set status = $2, status_changed_by = $3, status_changed_at = now(), updated_at = now() where id = $1',
    [review.id, status, userId],
  );
  return true;
}

/* --------------------------------------------------------------- team notice */

const STATUS_WORDS: Record<ReviewStatus, string> = { open: '다시 열기', changes_requested: '수정 요청', approved: '승인' };

export function reviewAdminPath(reviewId: string): string {
  return `/admin/brand-studio/reviews/${reviewId}`;
}

/** The internal line the team reads (never shown to a customer). */
export function reviewNoticeBody(
  review: { id: string; title: string },
  event: { kind: 'comment'; body: string; atMs: number | null; spot: boolean; reply: boolean } | { kind: 'status'; status: ReviewStatus },
): string {
  const head =
    event.kind === 'comment'
      ? `[리뷰 ${event.reply ? '답글' : '의견'}] ${review.title}${event.atMs != null ? ` · ${formatTimecode(event.atMs)}` : ''}${event.spot ? ' · 화면 위치 표시' : ''}`
      : `[리뷰 상태] ${review.title} → ${STATUS_WORDS[event.status]}`;
  const lines = [head];
  if (event.kind === 'comment') lines.push(event.body.slice(0, 1200));
  lines.push(`관리자 화면: ${reviewAdminPath(review.id)}`);
  return lines.join('\n');
}

/* --------------------------------------------------------------- brand reads */

/** `GET /api/brand-studio/review?organizationId=…` */
export async function loadReviewList(deps: ReviewDeps, viewer: Viewer, organizationId: string): Promise<ReviewList | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await reviewSeat(sql, viewer.userId, organizationId);
      const rows = (
        await sql.query<ReviewRow>(`${await reviewSelect(sql)} and r.organization_id = $1 order by r.updated_at desc, r.id limit $2`, [organizationId, REVIEW_LIMITS.listMax])
      ).rows;
      return { ok: true as const, canWrite: seat.canCreate, reviews: rows.map((r) => listItem(r, deps.media)) };
    }),
  );
}

/** The extended fields of a detail: present only when the screen may show ranges, drawings and versions. */
async function extension(sql: SqlRunner, row: ReviewRow, media: StudioMediaStore): Promise<Pick<ReviewDetail, 'extended' | 'versions'>> {
  if (!(await extendedScreen(sql))) return {};
  return { extended: true, versions: await stackVersions(sql, String(row.stack_id ?? row.id), String(row.organization_id), media) };
}

/** `GET /api/brand-studio/review?organizationId=…&review=…` */
export async function loadReviewDetail(deps: ReviewDeps, viewer: Viewer, organizationId: string, reviewId: string): Promise<ReviewDetail | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await reviewSeat(sql, viewer.userId, organizationId);
      const row = await reviewRow(sql, reviewId, organizationId);
      if (!row) throw new ReviewDenied('not_found');
      return {
        ok: true as const,
        canWrite: seat.canCreate,
        review: itemView(row, deps.media),
        comments: await commentsOf(sql, row.id, viewer.userId ?? null),
        ...(await extension(sql, row, deps.media)),
      };
    }),
  );
}

/** Delete one's own note. A carried note is read-only on the newer version. */
async function deleteOwnComment(sql: SqlRunner, review: ReviewRow, commentId: string, userId: string): Promise<void> {
  const row = await commentRow(sql, review.id, commentId);
  if (!row) throw new ReviewDenied('not_found');
  if (row.author_id !== userId || row.carried_from) throw new ReviewDenied('forbidden');
  await sql.query('update brand_studio_review_comments set deleted_at = now() where id = $1', [row.id]);
  await touch(sql, review.id);
}

/* --------------------------------------------------------------- brand writes */

export function isReviewOperation(value: unknown): value is ReviewOperation {
  return typeof value === 'string' && (REVIEW_OPERATIONS as readonly string[]).includes(value);
}

export interface ReviewOperationOutcome {
  result: ReviewOperationResult;
  /** Set when the team should hear about it (a brand member's comment or status move). */
  notice: ReviewNotice | null;
}

/** One `POST /api/brand-studio/review` operation. Unknown names are `invalid`. */
export async function runReviewOperation(deps: ReviewDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<ReviewOperationOutcome> {
  const quiet = (result: ReviewOperationResult): ReviewOperationOutcome => ({ result, notice: null });
  if (!isReviewOperation(operation)) return quiet(failure('invalid'));
  // The gate before any input detail is judged: a closed organization gets the same 404 whatever it sent.
  const organizationId = (input as { organizationId?: unknown } | null)?.organizationId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId)) return quiet(failure('invalid'));
  const gate = await guard(() => deps.sql.transaction((sql) => reviewSeat(sql, viewer.userId, organizationId)));
  if ('ok' in gate) return quiet(gate);

  let notice: ReviewNotice | null = null;
  let event: RoomEventInput | null = null;
  const result = await guard<ReviewOperationResult>(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await reviewSeat(sql, viewer.userId, organizationId);
      requireCreate(seat);
      const userId = seat.userId;
      switch (operation) {
        case 'review.create': {
          const parsed = ReviewCreateSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          return insertReview(sql, deps.media, parsed.data, { userId, role: 'brand' });
        }
        case 'review.status': {
          const parsed = ReviewStatusSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await reviewRow(sql, parsed.data.reviewId, organizationId, true);
          if (!review) throw new ReviewDenied('not_found');
          if (await moveStatus(sql, review, parsed.data.status, userId)) {
            notice = { organizationId, userId, messageId: review.id, body: reviewNoticeBody(review, { kind: 'status', status: parsed.data.status }) };
            event = statusEvent(review, parsed.data.status, userId, 'brand');
          }
          return { ok: true as const } satisfies ReviewDone;
        }
        case 'review.delete': {
          const parsed = ReviewRefSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const gone = await sql.query(
            'update brand_studio_reviews set deleted_at = now(), updated_at = now() where id = $1 and organization_id = $2 and deleted_at is null returning id',
            [parsed.data.reviewId, organizationId],
          );
          if (!gone.rows[0]) throw new ReviewDenied('not_found');
          return { ok: true as const } satisfies ReviewDone;
        }
        case 'comment.add': {
          const parsed = CommentAddSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await reviewRow(sql, parsed.data.reviewId, organizationId, true);
          if (!review) throw new ReviewDenied('not_found');
          const recent = (
            await sql.query<{ n: number }>(
              "select count(*)::int as n from brand_studio_review_comments where author_id = $1 and created_at > now() - interval '1 minute'",
              [userId],
            )
          ).rows[0]!.n;
          if (Number(recent) >= REVIEW_LIMITS.commentsPerMinute) throw new ReviewDenied('rate_limited');
          const comment = await insertComment(sql, review, parsed.data, { userId, role: 'brand' });
          notice = {
            organizationId,
            userId,
            messageId: comment.id,
            body: reviewNoticeBody(review, { kind: 'comment', body: comment.body, atMs: comment.atMs, spot: comment.x != null, reply: comment.parentId != null }),
          };
          return { ok: true as const, comment } satisfies ReviewCommentAdded;
        }
        case 'comment.resolve': {
          const parsed = CommentRefSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await reviewRow(sql, parsed.data.reviewId, organizationId, true);
          if (!review) throw new ReviewDenied('not_found');
          await toggleResolved(sql, review, parsed.data.commentId, userId);
          return { ok: true as const } satisfies ReviewDone;
        }
        case 'comment.delete': {
          const parsed = CommentRefSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await reviewRow(sql, parsed.data.reviewId, organizationId, true);
          if (!review) throw new ReviewDenied('not_found');
          await deleteOwnComment(sql, review, parsed.data.commentId, userId);
          return { ok: true as const } satisfies ReviewDone;
        }
      }
    }),
  );
  if (result.ok) await sendRoomEvent(deps.sql, event);
  return { result, notice: result.ok ? notice : null };
}

/* --------------------------------------------------------------- team side */

/** The admin flag, re-read from the profile row inside the transaction (never the session's word). */
async function requireStaff(sql: SqlRunner, viewer: Viewer): Promise<string> {
  if (!viewer.userId || !UUID.test(viewer.userId)) throw new ReviewDenied('sign_in_required');
  const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
  if (!profile) throw new ReviewDenied('sign_in_required');
  if (profile.is_admin !== true) throw new ReviewDenied('forbidden');
  return viewer.userId;
}

export interface StaffReviewListItem extends ReviewListItem {
  organizationName: string;
}

/** Every live review across organizations, newest activity first (`/admin/brand-studio/reviews`). */
export async function staffReviewList(
  deps: ReviewDeps,
  viewer: Viewer,
  options: { status?: ReviewStatus | null } = {},
): Promise<{ ok: true; reviews: StaffReviewListItem[] } | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const status = options.status && (REVIEW_STATUSES as readonly string[]).includes(options.status) ? options.status : null;
      const rows = (
        await sql.query<ReviewRow>(
          `${await reviewSelect(sql)} and ($1::text is null or r.status = $1) order by r.updated_at desc, r.id limit $2`,
          [status, REVIEW_LIMITS.listMax],
        )
      ).rows;
      return { ok: true as const, reviews: rows.map((r) => ({ ...listItem(r, deps.media), organizationName: String(r.organization_name) })) };
    }),
  );
}

export async function staffReviewDetail(
  deps: ReviewDeps,
  viewer: Viewer,
  reviewId: string,
): Promise<(ReviewDetail & { organizationName: string }) | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const row = await reviewRow(sql, reviewId, null);
      if (!row) throw new ReviewDenied('not_found');
      return {
        ok: true as const,
        canWrite: true,
        review: itemView(row, deps.media),
        comments: await commentsOf(sql, row.id, userId),
        organizationName: String(row.organization_name),
        ...(await extension(sql, row, deps.media)),
      };
    }),
  );
}

async function staffReview(sql: SqlRunner, reviewId: unknown): Promise<ReviewRow> {
  const row = typeof reviewId === 'string' ? await reviewRow(sql, reviewId, null, true) : null;
  if (!row) throw new ReviewDenied('not_found');
  return row;
}

/** A team comment or reply (`brand_studio.review.reply`). */
export async function staffAddComment(
  deps: ReviewDeps,
  viewer: Viewer,
  input: {
    reviewId: string;
    body: string;
    parentId?: string | null;
    atMs?: number | null;
    endMs?: number | null;
    x?: number | null;
    y?: number | null;
    strokes?: unknown;
  },
): Promise<ReviewCommentAdded | ReviewFailure> {
  let event: RoomEventInput | null = null;
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const review = await staffReview(sql, input.reviewId);
      const parsed = CommentAddSchema.safeParse({ ...input, organizationId: review.organization_id });
      if (!parsed.success) throw new ReviewDenied('invalid');
      const comment = await insertComment(sql, review, parsed.data, { userId, role: 'studio' });
      event = commentEvent(review, comment.id, userId, 'studio');
      return { ok: true as const, comment };
    }),
  );
  if (result.ok) await sendRoomEvent(deps.sql, event);
  return result;
}

/** Resolve or reopen a thread (`brand_studio.review.resolve`). */
export async function staffResolveComment(deps: ReviewDeps, viewer: Viewer, input: { reviewId: string; commentId: string }): Promise<ReviewDone | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const review = await staffReview(sql, input.reviewId);
      if (!UUID.test(input.commentId ?? '')) throw new ReviewDenied('invalid');
      await toggleResolved(sql, review, input.commentId, userId);
      return { ok: true as const };
    }),
  );
}

/** Move the status for the brand (`brand_studio.review.status`). */
export async function staffSetStatus(deps: ReviewDeps, viewer: Viewer, input: { reviewId: string; status: string }): Promise<ReviewDone | ReviewFailure> {
  let event: RoomEventInput | null = null;
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const review = await staffReview(sql, input.reviewId);
      if (!(REVIEW_STATUSES as readonly string[]).includes(input.status)) throw new ReviewDenied('invalid');
      if (await moveStatus(sql, review, input.status as ReviewStatus, userId)) event = statusEvent(review, input.status as ReviewStatus, userId, 'studio');
      return { ok: true as const };
    }),
  );
  if (result.ok) await sendRoomEvent(deps.sql, event);
  return result;
}

/**
 * Open a review on an existing asset or result of an organization (`brand_studio.review.create`).
 * The Morphic hardline holds here too: a sandboxed client or a brand whose policy closes generative
 * media gets no review, because it has no studio to see it in.
 */
export async function staffCreateReview(
  deps: ReviewDeps,
  viewer: Viewer,
  input: { organizationId: string; title: string; assetId?: string; outputId?: string },
): Promise<ReviewCreated | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const parsed = ReviewCreateSchema.safeParse(input);
      if (!parsed.success) throw new ReviewDenied('invalid');
      const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [parsed.data.organizationId])).rows[0];
      if (!org) throw new ReviewDenied('not_found');
      if (isSandboxedClientOrganization(org)) throw new ReviewDenied('feature_unavailable');
      const denied = (await loadFeaturePolicies(sql, [org.id]))[org.id] ?? [];
      if (featureDenied(denied, 'generative_media')) throw new ReviewDenied('feature_unavailable');
      return insertReview(sql, deps.media, parsed.data, { userId, role: 'studio' });
    }),
  );
}

/* =============================================================== project rooms (docs/BRAND-ROOMS.md §6) */

/** The room line a status move leaves, for a review that belongs to a project. */
function statusEvent(review: ReviewRow, status: ReviewStatus, actorId: string, actorRole: 'brand' | 'studio'): RoomEventInput | null {
  if (!review.project_id || (status !== 'approved' && status !== 'changes_requested')) return null;
  return {
    organizationId: String(review.organization_id),
    projectId: String(review.project_id),
    event: status === 'approved' ? 'review_approved' : 'review_changes_requested',
    ref: { kind: 'review', reviewId: String(review.id) },
    actorId,
    actorRole,
    detail: { title: String(review.title), version: Number(review.version ?? 1) },
  };
}

function commentEvent(review: ReviewRow, commentId: string, actorId: string | null, actorRole: 'brand' | 'studio'): RoomEventInput | null {
  if (!review.project_id) return null;
  return {
    organizationId: String(review.organization_id),
    projectId: String(review.project_id),
    event: 'review_commented',
    ref: { kind: 'review', reviewId: String(review.id), commentId },
    actorId,
    actorRole,
    detail: { title: String(review.title), version: Number(review.version ?? 1) },
  };
}

function postedEvent(created: ReviewCreated, actorId: string | null, actorRole: 'brand' | 'studio'): RoomEventInput | null {
  const r = created.review;
  if (created.existing || !r.projectId) return null;
  const version = r.version ?? 1;
  return {
    organizationId: r.organizationId,
    projectId: r.projectId,
    event: version > 1 ? 'review_version' : 'review_posted',
    ref: { kind: 'review', reviewId: r.id },
    actorId,
    actorRole,
    detail: { title: r.title, version },
  };
}

/**
 * A new version of the stack `baseId` belongs to, on another asset or result of the organization. The
 * stack's first row is locked so two uploads cannot both become v3. The previous version's open notes
 * are copied onto the new one with `carried_from` (the original note), read-only there until resolved.
 * The piece already under live review: the same stack answers with that review; another stack is a conflict.
 */
async function postVersion(
  sql: SqlRunner,
  media: StudioMediaStore,
  input: { organizationId: string; baseId: string; projectId: string | null; title?: string; assetId?: string; outputId?: string },
  by: { userId: string | null; role: ReviewRole },
  source: ReviewSource,
): Promise<ReviewCreated> {
  if (!(await roomReviewReady(sql))) throw new ReviewDenied('provider_unavailable');
  const base = await reviewRow(sql, input.baseId, input.organizationId);
  if (!base || (input.projectId !== null && base.project_id !== input.projectId)) throw new ReviewDenied('not_found');
  const stackId = String(base.stack_id ?? base.id);
  await sql.query('select id from brand_studio_reviews where id = $1 for update', [stackId]);
  const latest = (
    await sql.query<{ id: string; version: number; title: string }>(
      'select id, version, title from brand_studio_reviews where coalesce(stack_id, id) = $1 and deleted_at is null order by version desc limit 1',
      [stackId],
    )
  ).rows[0];
  if (!latest) throw new ReviewDenied('not_found');
  const version = Number(latest.version) + 1;
  if (version > REVIEW_LIMITS.versionMax) throw new ReviewDenied('invalid');
  const created = await insertReview(
    sql,
    media,
    { organizationId: input.organizationId, title: input.title ?? String(latest.title), assetId: input.assetId, outputId: input.outputId },
    by,
    { projectId: base.project_id ?? null, stackId, version, source },
  );
  if (created.existing) {
    if (created.review.stackId !== stackId) throw new ReviewDenied('conflict');
    return created;
  }
  const video = created.review.kind === 'video';
  await sql.query(
    `insert into brand_studio_review_comments
       (review_id, organization_id, parent_id, author_id, author_role, body, at_ms, end_ms, x, y, strokes, guest_name, share_id, carried_from, created_at)
     select $1, organization_id, null, author_id, author_role, body,
            case when $3::boolean then at_ms end, case when $3::boolean then end_ms end, x, y, strokes, guest_name, share_id,
            coalesce(carried_from, id), created_at
       from brand_studio_review_comments
      where review_id = $2 and parent_id is null and deleted_at is null and resolved_at is null
     on conflict do nothing`,
    [created.review.id, latest.id, video],
  );
  const row = await reviewRow(sql, created.review.id, input.organizationId);
  return { ok: true, review: row ? listItem(row, media) : created.review, existing: false };
}

/** Seat the viewer in the project's room (lib/brand-rooms/access.ts), then require 0084. */
async function roomGate(sql: SqlRunner, viewer: Viewer, organizationId: string, projectId: string): Promise<RoomSeat> {
  const seat = await roomSeat(sql, viewer.userId, organizationId);
  await requireRoomProject(sql, seat, projectId);
  if (!(await roomReviewReady(sql))) throw new ReviewDenied('provider_unavailable');
  return seat;
}

/** A live review of this organization that belongs to this project. */
async function roomReview(sql: SqlRunner, reviewId: string, organizationId: string, projectId: string, lock = false): Promise<ReviewRow> {
  const row = await reviewRow(sql, reviewId, organizationId, lock);
  if (!row || row.project_id !== projectId) throw new ReviewDenied('not_found');
  return row;
}

/** The deliverables of a project as stacks, the most recently active first. */
function stacksOf(rows: ReviewRow[], media: StudioMediaStore): ReviewStack[] {
  const byStack = new Map<string, ReviewListItem[]>();
  for (const row of rows) {
    const key = String(row.stack_id ?? row.id);
    const list = byStack.get(key) ?? [];
    list.push(listItem(row, media));
    byStack.set(key, list);
  }
  const stacks = [...byStack.entries()].map(([stackId, versions]) => ({
    stackId,
    versions: versions.sort((a, b) => (b.version ?? 1) - (a.version ?? 1)),
  }));
  const last = (s: ReviewStack) => s.versions.reduce((m, v) => (v.lastActivityAt > m ? v.lastActivityAt : m), '');
  return stacks.sort((a, b) => last(b).localeCompare(last(a)) || a.stackId.localeCompare(b.stackId));
}

/** `GET /api/brand-rooms/reviews?organizationId=…&projectId=…` */
export async function loadRoomReviews(deps: ReviewDeps, viewer: Viewer, organizationId: string, projectId: string): Promise<RoomReviewList | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomGate(sql, viewer, organizationId, projectId);
      const rows = (
        await sql.query<ReviewRow>(
          `${await reviewSelect(sql)} and r.organization_id = $1 and r.project_id = $2 order by r.updated_at desc, r.id limit $3`,
          [organizationId, projectId, REVIEW_LIMITS.listMax],
        )
      ).rows;
      return { ok: true as const, canEdit: seat.canEdit, canTalk: seat.canTalk, stacks: stacksOf(rows, deps.media) };
    }),
  );
}

/** `GET /api/brand-rooms/reviews?organizationId=…&projectId=…&review=…` */
export async function loadRoomReviewDetail(
  deps: ReviewDeps,
  viewer: Viewer,
  organizationId: string,
  projectId: string,
  reviewId: string,
): Promise<RoomReviewDetail | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomGate(sql, viewer, organizationId, projectId);
      const row = await roomReview(sql, reviewId, organizationId, projectId);
      return {
        ok: true as const,
        canWrite: seat.canEdit,
        canEdit: seat.canEdit,
        canTalk: seat.canTalk,
        review: itemView(row, deps.media),
        comments: await commentsOf(sql, row.id, viewer.userId ?? null),
        extended: true,
        versions: await stackVersions(sql, String(row.stack_id ?? row.id), organizationId, deps.media),
      };
    }),
  );
}

export function isRoomReviewOperation(value: unknown): value is RoomReviewOperation {
  return typeof value === 'string' && (ROOM_REVIEW_OPERATIONS as readonly string[]).includes(value);
}

/**
 * One `POST /api/brand-rooms/reviews` operation. The seat comes first (flag at the route, then sign-in ->
 * membership or this project's invitation -> sandbox hardline + generation policy -> 404), then the role:
 * owners and editors add, version, move the status and resolve; everyone seated may comment and delete
 * their own note. Room lines go out after the write commits.
 */
export async function runRoomReviewOperation(deps: ReviewDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<ReviewOperationOutcome> {
  const quiet = (result: ReviewOperationResult): ReviewOperationOutcome => ({ result, notice: null });
  if (!isRoomReviewOperation(operation)) return quiet(failure('invalid'));
  const scope = RoomScopeSchema.safeParse(input);
  if (!scope.success) return quiet(failure('invalid'));
  const { organizationId, projectId } = scope.data;
  const gate = await guard(() => deps.sql.transaction((sql) => roomGate(sql, viewer, organizationId, projectId)));
  if ('ok' in gate) return quiet(gate);

  let notice: ReviewNotice | null = null;
  let event: RoomEventInput | null = null;
  const result = await guard<ReviewOperationResult>(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomGate(sql, viewer, organizationId, projectId);
      const userId = seat.userId;
      switch (operation) {
        case 'review.create': {
          requireEdit(seat);
          const parsed = RoomReviewCreateSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const created = await insertReview(sql, deps.media, parsed.data, { userId, role: 'brand' }, { projectId, source: 'studio' });
          if (created.existing) {
            // A studio review of the same piece joins this room; one already in another room stays there.
            if (created.review.projectId && created.review.projectId !== projectId) throw new ReviewDenied('conflict');
            if (!created.review.projectId) {
              await sql.query('update brand_studio_reviews set project_id = $2, updated_at = now() where id = $1', [created.review.id, projectId]);
              const row = await roomReview(sql, created.review.id, organizationId, projectId);
              const joined: ReviewCreated = { ok: true, review: listItem(row, deps.media), existing: false };
              event = postedEvent(joined, userId, 'brand');
              return joined;
            }
          }
          event = postedEvent(created, userId, 'brand');
          return created;
        }
        case 'review.version': {
          requireEdit(seat);
          const parsed = ReviewVersionSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const created = await postVersion(
            sql,
            deps.media,
            { organizationId, baseId: parsed.data.reviewId, projectId, title: parsed.data.title, assetId: parsed.data.assetId, outputId: parsed.data.outputId },
            { userId, role: 'brand' },
            'studio',
          );
          event = postedEvent(created, userId, 'brand');
          return created;
        }
        case 'review.status': {
          requireEdit(seat);
          const parsed = ReviewStatusSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await roomReview(sql, parsed.data.reviewId, organizationId, projectId, true);
          if (await moveStatus(sql, review, parsed.data.status, userId)) {
            notice = { organizationId, userId, messageId: review.id, body: reviewNoticeBody(review, { kind: 'status', status: parsed.data.status }) };
            event = statusEvent(review, parsed.data.status, userId, 'brand');
          }
          return { ok: true as const } satisfies ReviewDone;
        }
        case 'comment.add': {
          if (!seat.canTalk) throw new ReviewDenied('forbidden');
          const parsed = CommentAddSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await roomReview(sql, parsed.data.reviewId, organizationId, projectId, true);
          const recent = (
            await sql.query<{ n: number }>(
              "select count(*)::int as n from brand_studio_review_comments where author_id = $1 and created_at > now() - interval '1 minute'",
              [userId],
            )
          ).rows[0]!.n;
          if (Number(recent) >= REVIEW_LIMITS.commentsPerMinute) throw new ReviewDenied('rate_limited');
          const comment = await insertComment(sql, review, parsed.data, { userId, role: 'brand' });
          notice = {
            organizationId,
            userId,
            messageId: comment.id,
            body: reviewNoticeBody(review, { kind: 'comment', body: comment.body, atMs: comment.atMs, spot: comment.x != null, reply: comment.parentId != null }),
          };
          event = commentEvent(review, comment.id, userId, 'brand');
          return { ok: true as const, comment } satisfies ReviewCommentAdded;
        }
        case 'comment.resolve': {
          requireEdit(seat);
          const parsed = CommentRefSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await roomReview(sql, parsed.data.reviewId, organizationId, projectId, true);
          await toggleResolved(sql, review, parsed.data.commentId, userId);
          return { ok: true as const } satisfies ReviewDone;
        }
        case 'comment.delete': {
          const parsed = CommentRefSchema.safeParse(input);
          if (!parsed.success) throw new ReviewDenied('invalid');
          const review = await roomReview(sql, parsed.data.reviewId, organizationId, projectId, true);
          await deleteOwnComment(sql, review, parsed.data.commentId, userId);
          return { ok: true as const } satisfies ReviewDone;
        }
      }
    }),
  );
  if (result.ok) await sendRoomEvent(deps.sql, event);
  return { result, notice: result.ok ? notice : null };
}

/* ------------------------------------------------------------- team: deliveries */

/** The organization may have rooms at all: not sandboxed, generation not closed (the same 404 the brand gets). */
async function openOrganization(sql: SqlRunner, organizationId: string): Promise<void> {
  if (!UUID.test(organizationId)) throw new ReviewDenied('invalid');
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org) throw new ReviewDenied('not_found');
  if (isSandboxedClientOrganization(org)) throw new ReviewDenied('feature_unavailable');
  const denied = (await loadFeaturePolicies(sql, [org.id]))[org.id] ?? [];
  if (featureDenied(denied, 'generative_media')) throw new ReviewDenied('feature_unavailable');
}

/** A file the team delivers, already checked, measured and stored under a fresh media key. */
export interface DeliveredFile {
  key: string;
  thumbKey: string | null;
  kind: 'image' | 'video';
  mime: string;
  sizeBytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  name: string;
}

export interface DeliveryOutcome {
  ok: true;
  created: ReviewCreated;
  /** Media keys the caller should delete (the same bytes were already in the organization's library). */
  unusedKeys: string[];
}

/**
 * The YAGI team delivers a file into a project room (`brand_rooms.delivery.add`): it becomes a studio
 * asset of the organization with `source = 'delivery'` (the same bytes already there are reused), then a
 * review item with `source = 'delivery'` in the project: a new stack, or the next version of
 * `stackReviewId`'s stack. The same hardline as everywhere: a sandboxed or generation-closed brand gets none.
 */
export async function staffDeliver(
  deps: ReviewDeps,
  actor: DeliveryActor,
  input: { organizationId: string; projectId: string; title: string; stackReviewId?: string | null; file: DeliveredFile },
): Promise<DeliveryOutcome | ReviewFailure> {
  const unusedKeys: string[] = [];
  let actorId: string | null = null;
  const created = await guard(() =>
    deps.sql.transaction(async (sql) => {
      await staffDeliveryGate(sql, actor, input.organizationId, input.projectId);
      const userId = 'viewer' in actor ? actor.viewer.userId! : null;
      actorId = userId;
      if (input.stackReviewId != null && !UUID.test(input.stackReviewId)) throw new ReviewDenied('invalid');
      const title = input.title.replace(/\s+/g, ' ').trim().slice(0, REVIEW_LIMITS.titleMax);
      if (!title) throw new ReviewDenied('invalid');
      const f = input.file;
      let assetId = (
        await sql.query<{ id: string }>(
          "select id from brand_studio_assets where organization_id = $1 and sha256 = $2 and status = 'ready' and deleted_at is null",
          [input.organizationId, f.sha256],
        )
      ).rows[0]?.id;
      if (assetId) unusedKeys.push(f.key, ...(f.thumbKey ? [f.thumbKey] : []));
      else {
        assetId = (
          await sql.query<{ id: string }>(
            `insert into brand_studio_assets (organization_id, kind, name, mime, size_bytes, width, height, duration_ms, storage_key, thumb_key, sha256, source, status, created_by)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'delivery', 'ready', $12) returning id`,
            [input.organizationId, f.kind, (f.name.trim() || title).slice(0, 80), f.mime, f.sizeBytes, f.width, f.height, f.durationMs, f.key, f.thumbKey, f.sha256, userId],
          )
        ).rows[0]!.id;
        await adjustOrganizationStorageBytes(sql, input.organizationId, f.sizeBytes);
      }
      const result = input.stackReviewId
        ? await postVersion(
            sql,
            deps.media,
            { organizationId: input.organizationId, baseId: input.stackReviewId, projectId: input.projectId, title, assetId },
            { userId, role: 'studio' },
            'delivery',
          )
        : await insertReview(sql, deps.media, { organizationId: input.organizationId, title, assetId }, { userId, role: 'studio' }, { projectId: input.projectId, source: 'delivery' });
      if (result.existing && result.review.projectId !== input.projectId) throw new ReviewDenied('conflict');
      return result;
    }),
  );
  if (!created.ok) return created;
  await sendRoomEvent(deps.sql, postedEvent(created, actorId, 'studio'));
  return { ok: true, created, unusedKeys };
}

/**
 * Who delivers: a team member signed in to /admin (the admin flag is re-read here), or the command line
 * after the ingest route checked `BRAND_ROOM_INGEST_SECRET` (lib/brand-rooms/ingest.ts). Nothing else.
 */
export type DeliveryActor = { viewer: Viewer } | { ingest: true };

/** Team or command line, 0084 applied, an open organization, and the project is that organization's. */
export async function staffDeliveryGate(sql: SqlRunner, actor: DeliveryActor, organizationId: string, projectId: string): Promise<void> {
  if ('viewer' in actor) await requireStaff(sql, actor.viewer);
  else if (actor.ingest !== true) throw new ReviewDenied('forbidden');
  if (!(await roomReviewReady(sql))) throw new ReviewDenied('provider_unavailable');
  await openOrganization(sql, organizationId);
  if (!UUID.test(projectId)) throw new ReviewDenied('invalid');
  const project = (await sql.query('select id from brand_projects where id = $1 and organization_id = $2', [projectId, organizationId])).rows[0];
  if (!project) throw new ReviewDenied('not_found');
}

/** The pre-check before any bytes are read, in its own short transaction. */
export async function checkDeliveryGate(deps: ReviewDeps, actor: DeliveryActor, organizationId: string, projectId: string): Promise<{ ok: true } | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await staffDeliveryGate(sql, actor, organizationId, projectId);
      return { ok: true as const };
    }),
  );
}

export interface DeliveryProject {
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectTitle: string;
}

/** Projects the team may deliver into: open brands only (never a sandboxed or generation-closed one). */
export async function staffDeliveryProjects(deps: ReviewDeps, viewer: Viewer): Promise<{ ok: true; projects: DeliveryProject[] } | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const rows = (
        await sql.query<{ project_id: string; project_title: string; organization_id: string; organization_name: string }>(
          `select p.id as project_id, p.title as project_title, o.id as organization_id, o.name as organization_name
             from brand_projects p join brand_organizations o on o.id = p.organization_id
            where p.status <> 'cancelled'
            order by o.name, p.created_at desc limit 500`,
        )
      ).rows;
      const policies = await loadFeaturePolicies(sql, [...new Set(rows.map((r) => String(r.organization_id)))]);
      const projects = rows
        .filter((r) => !isSandboxedClientOrganization({ id: r.organization_id, name: r.organization_name }) && !featureDenied(policies[r.organization_id] ?? [], 'generative_media'))
        .map((r) => ({ organizationId: String(r.organization_id), organizationName: String(r.organization_name), projectId: String(r.project_id), projectTitle: String(r.project_title) }));
      return { ok: true as const, projects };
    }),
  );
}

/** The team's desk: one project's deliverables as stacks (`/admin/brand-rooms/reviews`). */
export async function staffProjectStacks(
  deps: ReviewDeps,
  viewer: Viewer,
  input: { organizationId: string; projectId: string },
): Promise<{ ok: true; stacks: ReviewStack[] } | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      if (!(await roomReviewReady(sql))) throw new ReviewDenied('provider_unavailable');
      if (!UUID.test(input.organizationId) || !UUID.test(input.projectId)) throw new ReviewDenied('invalid');
      const rows = (
        await sql.query<ReviewRow>(
          `${await reviewSelect(sql)} and r.organization_id = $1 and r.project_id = $2 order by r.updated_at desc, r.id limit $3`,
          [input.organizationId, input.projectId, REVIEW_LIMITS.listMax],
        )
      ).rows;
      return { ok: true as const, stacks: stacksOf(rows, deps.media) };
    }),
  );
}

/* ------------------------------------------------------------- share links (lib/brand-rooms/shares.ts) */

/** A live review of the organization, as the share page shows it: names without any part of an email. */
export async function sharedReviewView(
  sql: SqlRunner,
  media: StudioMediaStore,
  organizationId: string,
  reviewId: string,
): Promise<{ review: ReviewItem; comments: ReviewComment[] } | null> {
  const row = await reviewRow(sql, reviewId, organizationId);
  if (!row) return null;
  return { review: itemView(row, media), comments: await commentsOf(sql, row.id, null, true) };
}

/** A guest's note through a share link. The caller checked the link allows comments and the rate. */
export async function addGuestComment(
  sql: SqlRunner,
  input: { organizationId: string; reviewId: string; shareId: string; guestName: string; comment: Record<string, unknown> },
): Promise<ReviewCommentAdded | ReviewFailure> {
  return guard(async () => {
    const review = await reviewRow(sql, input.reviewId, input.organizationId, true);
    if (!review) throw new ReviewDenied('not_found');
    const parsed = CommentAddSchema.safeParse({ ...input.comment, organizationId: input.organizationId, reviewId: input.reviewId });
    if (!parsed.success) throw new ReviewDenied('invalid');
    return { ok: true as const, comment: await insertComment(sql, review, parsed.data, { guestName: input.guestName, shareId: input.shareId }) };
  });
}

/** A live review of this organization, and the project it sits in (share creation checks the room). */
export async function reviewTarget(sql: SqlRunner, organizationId: string, reviewId: string): Promise<{ id: string; projectId: string | null; title: string } | null> {
  const row = await reviewRow(sql, reviewId, organizationId);
  return row ? { id: String(row.id), projectId: row.project_id ? String(row.project_id) : null, title: String(row.title) } : null;
}
