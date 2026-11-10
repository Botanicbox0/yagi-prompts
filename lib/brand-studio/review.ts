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
import { requireCreate, StudioDenied, studioSeat, type StudioSeat } from './access';
import type { StudioMediaStore } from './media-store';
import {
  CommentAddSchema,
  CommentRefSchema,
  REVIEW_ERROR_CODES,
  REVIEW_LIMITS,
  REVIEW_OPERATIONS,
  REVIEW_STATUSES,
  ReviewCreateSchema,
  ReviewRefSchema,
  ReviewStatusSchema,
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
  type ReviewStatus,
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
    if ((error as { code?: string } | null)?.code === '23505') return failure('conflict');
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: Date | string | null): string | null => (v == null ? null : iso(v));

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
  };
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

function commentView(row: CommentRow, viewerId: string | null): ReviewComment {
  const deleted = row.deleted_at != null;
  return {
    id: String(row.id),
    parentId: row.parent_id ? String(row.parent_id) : null,
    authorName: deleted ? null : authorNameOf(row.author_role, row.display_name, row.email),
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
  return (await sql.query<ReviewRow>(`${REVIEW_SELECT}${where}`, params)).rows[0] ?? null;
}

async function commentsOf(sql: SqlRunner, reviewId: string, viewerId: string | null): Promise<ReviewComment[]> {
  const rows = (
    await sql.query<CommentRow>(
      `select c.id, c.review_id, c.parent_id, c.author_id, c.author_role, c.body, c.at_ms, c.x, c.y, c.resolved_at,
              c.created_at, c.deleted_at, p.display_name, p.email
         from brand_studio_review_comments c
         left join profiles p on p.id = c.author_id
        where c.review_id = $1
        order by c.created_at, c.id`,
      [reviewId],
    )
  ).rows;
  return rows.map((r) => commentView(r, viewerId));
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

async function insertReview(
  sql: SqlRunner,
  media: StudioMediaStore,
  input: z.output<typeof ReviewCreateSchema>,
  by: { userId: string; role: ReviewRole },
): Promise<ReviewCreated> {
  await subjectOf(sql, input.organizationId, input);
  const column = input.assetId ? 'asset_id' : 'output_id';
  const subjectId = input.assetId ?? input.outputId!;
  const inserted = (
    await sql.query<{ id: string }>(
      `insert into brand_studio_reviews (organization_id, ${column}, title, created_by, created_role)
         values ($1, $2, $3, $4, $5)
       on conflict (organization_id, ${column}) where deleted_at is null and ${column} is not null do nothing
       returning id`,
      [input.organizationId, subjectId, input.title, by.userId, by.role],
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

async function insertComment(
  sql: SqlRunner,
  review: ReviewRow,
  input: z.output<typeof CommentAddSchema>,
  by: { userId: string; role: ReviewRole },
): Promise<ReviewComment> {
  if (input.parentId) {
    const parent = (
      await sql.query<{ parent_id: string | null; deleted_at: unknown }>(
        'select parent_id, deleted_at from brand_studio_review_comments where id = $1 and review_id = $2',
        [input.parentId, review.id],
      )
    ).rows[0];
    if (!parent || parent.deleted_at != null) throw new ReviewDenied('not_found');
    // One level of replies: answering a reply answers its thread.
    if (parent.parent_id) throw new ReviewDenied('invalid');
  }
  // A still has no timeline: its spots carry no moment.
  const atMs = review.s_kind === 'video' ? (input.atMs ?? null) : null;
  const row = (
    await sql.query<CommentRow>(
      `insert into brand_studio_review_comments (review_id, organization_id, parent_id, author_id, author_role, body, at_ms, x, y)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       returning *, null::text as display_name, null::text as email`,
      [review.id, review.organization_id, input.parentId ?? null, by.userId, by.role, input.body, atMs, input.x ?? null, input.y ?? null],
    )
  ).rows[0]!;
  await touch(sql, review.id);
  const profile = (await sql.query<{ display_name: string | null; email: string | null }>('select display_name, email from profiles where id = $1', [by.userId])).rows[0];
  return commentView({ ...row, display_name: profile?.display_name ?? null, email: profile?.email ?? null }, by.userId);
}

async function toggleResolved(sql: SqlRunner, review: ReviewRow, commentId: string, userId: string): Promise<boolean> {
  const row = await commentRow(sql, review.id, commentId);
  if (!row) throw new ReviewDenied('not_found');
  const resolve = row.resolved_at == null;
  await sql.query(
    resolve
      ? 'update brand_studio_review_comments set resolved_at = now(), resolved_by = $2 where id = $1'
      : 'update brand_studio_review_comments set resolved_at = null, resolved_by = null where id = $1',
    resolve ? [commentId, userId] : [commentId],
  );
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
        await sql.query<ReviewRow>(`${REVIEW_SELECT} and r.organization_id = $1 order by r.updated_at desc, r.id limit $2`, [organizationId, REVIEW_LIMITS.listMax])
      ).rows;
      return { ok: true as const, canWrite: seat.canCreate, reviews: rows.map((r) => listItem(r, deps.media)) };
    }),
  );
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
      };
    }),
  );
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
          const row = await commentRow(sql, review.id, parsed.data.commentId);
          if (!row) throw new ReviewDenied('not_found');
          if (row.author_id !== userId) throw new ReviewDenied('forbidden');
          await sql.query('update brand_studio_review_comments set deleted_at = now() where id = $1', [row.id]);
          await touch(sql, review.id);
          return { ok: true as const } satisfies ReviewDone;
        }
      }
    }),
  );
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
          `${REVIEW_SELECT} and ($1::text is null or r.status = $1) order by r.updated_at desc, r.id limit $2`,
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
  input: { reviewId: string; body: string; parentId?: string | null; atMs?: number | null; x?: number | null; y?: number | null },
): Promise<ReviewCommentAdded | ReviewFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const review = await staffReview(sql, input.reviewId);
      const parsed = CommentAddSchema.safeParse({ ...input, organizationId: review.organization_id });
      if (!parsed.success) throw new ReviewDenied('invalid');
      return { ok: true as const, comment: await insertComment(sql, review, parsed.data, { userId, role: 'studio' }) };
    }),
  );
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
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const review = await staffReview(sql, input.reviewId);
      if (!(REVIEW_STATUSES as readonly string[]).includes(input.status)) throw new ReviewDenied('invalid');
      await moveStatus(sql, review, input.status as ReviewStatus, userId);
      return { ok: true as const };
    }),
  );
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
