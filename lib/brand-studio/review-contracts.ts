/**
 * Review space wire contract (docs/BRAND-STUDIO-V3.md §7).
 *
 * The one place the review screen, the admin screen and the service agree on shapes. The route
 * parses every request with these schemas; the screens import the same file.
 *
 * Client-safe: zod, types and pure helpers only (no env, no db).
 */
import { z } from 'zod';

/* ---------------------------------------------------------------- vocab */

export const REVIEW_STATUSES = ['open', 'changes_requested', 'approved'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Who wrote a comment or opened a review: the brand's own members, or the YAGI team. */
export const REVIEW_ROLES = ['brand', 'studio'] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];

export const REVIEW_OPERATIONS = ['review.create', 'review.status', 'review.delete', 'comment.add', 'comment.resolve', 'comment.delete'] as const;
export type ReviewOperation = (typeof REVIEW_OPERATIONS)[number];

export const REVIEW_ERROR_CODES = [
  'sign_in_required',
  'forbidden',
  'not_found',
  'feature_unavailable',
  'studio_closed',
  'invalid',
  'conflict',
  'rate_limited',
  'provider_unavailable',
  'failed',
] as const;
export type ReviewErrorCode = (typeof REVIEW_ERROR_CODES)[number];

export const REVIEW_LIMITS = {
  titleMax: 120,
  bodyMax: 2000,
  /** Comments one member may post per minute (the brand messages rule). */
  commentsPerMinute: 10,
  /** The longest moment a comment can point at (a day; films are seconds long). */
  atMsMax: 86_400_000,
  /** How many reviews the list returns. */
  listMax: 200,
} as const;

/** About one frame at 24 fps: the ←/→ step on the player. */
export const REVIEW_FRAME_MS = Math.round(1000 / 24);

/* -------------------------------------------------------------- inputs */

const Id = z.uuid();
const Title = z
  .string()
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1).max(REVIEW_LIMITS.titleMax));
const Body = z
  .string()
  .transform((s) => s.replace(/\r\n/g, '\n').trim())
  .pipe(z.string().min(1).max(REVIEW_LIMITS.bodyMax));
const Unit = z.number().finite().min(0).max(1);

export const ReviewCreateSchema = z
  .object({
    organizationId: Id,
    title: Title,
    assetId: Id.optional(),
    outputId: Id.optional(),
  })
  .refine((v) => Number(Boolean(v.assetId)) + Number(Boolean(v.outputId)) === 1, { message: 'exactly one of assetId and outputId', path: ['assetId'] });

export const ReviewRefSchema = z.object({ organizationId: Id, reviewId: Id });

export const ReviewStatusSchema = z.object({ organizationId: Id, reviewId: Id, status: z.enum(REVIEW_STATUSES) });

export const CommentAddSchema = z
  .object({
    organizationId: Id,
    reviewId: Id,
    body: Body,
    parentId: Id.nullish(),
    atMs: z.number().int().min(0).max(REVIEW_LIMITS.atMsMax).nullish(),
    x: Unit.nullish(),
    y: Unit.nullish(),
  })
  .refine((v) => (v.x == null) === (v.y == null), { message: 'x and y together', path: ['x'] })
  // A reply answers its thread; the moment and the spot belong to the thread's first comment.
  .refine((v) => !v.parentId || (v.atMs == null && v.x == null), { message: 'a reply has no moment or spot', path: ['parentId'] });

export const CommentRefSchema = z.object({ organizationId: Id, reviewId: Id, commentId: Id });

export type ReviewCreateInput = z.input<typeof ReviewCreateSchema>;
export type ReviewStatusInput = z.input<typeof ReviewStatusSchema>;
export type CommentAddInput = z.input<typeof CommentAddSchema>;

/* --------------------------------------------------------------- views */

export type ReviewKind = 'image' | 'video';

/** One row of the list (brand screen and the team's list). */
export interface ReviewListItem {
  id: string;
  organizationId: string;
  title: string;
  status: ReviewStatus;
  kind: ReviewKind;
  thumbUrl: string | null;
  /** False when the piece was deleted from the studio after the review started. */
  available: boolean;
  commentsOpen: number;
  commentsTotal: number;
  /** The newest of: the review's own change, the newest comment. */
  lastActivityAt: string;
  createdAt: string;
}

/** The piece under review, as the stage shows it. */
export interface ReviewItem extends ReviewListItem {
  subject: { assetId: string } | { outputId: string };
  /** Null when the piece is no longer available. */
  mediaUrl: string | null;
  width: number | null;
  height: number | null;
  seconds: number | null;
  createdRole: ReviewRole;
  statusChangedAt: string | null;
}

export interface ReviewComment {
  id: string;
  parentId: string | null;
  /** A display name; null for a team member without one (the screen then shows only the role). */
  authorName: string | null;
  authorRole: ReviewRole;
  /** Empty when deleted (a deleted comment stays only as the head of a thread with replies). */
  body: string;
  atMs: number | null;
  x: number | null;
  y: number | null;
  resolved: boolean;
  createdAt: string;
  deleted: boolean;
  /** The viewer wrote it (may delete it). */
  mine: boolean;
}

export interface ReviewFailure {
  ok: false;
  code: ReviewErrorCode;
}

export interface ReviewList {
  ok: true;
  canWrite: boolean;
  reviews: ReviewListItem[];
}

export interface ReviewDetail {
  ok: true;
  canWrite: boolean;
  review: ReviewItem;
  comments: ReviewComment[];
}

export interface ReviewCreated {
  ok: true;
  review: ReviewListItem;
  /** True when this piece already had a live review: that one is returned instead of a second. */
  existing: boolean;
}

export interface ReviewCommentAdded {
  ok: true;
  comment: ReviewComment;
}

export interface ReviewDone {
  ok: true;
}

export type ReviewOperationResult = ReviewFailure | ReviewCreated | ReviewCommentAdded | ReviewDone;

/* ------------------------------------------------------------- helpers */

export const REVIEW_PATH = '/brand/studio/review';

/** The brand screen's address for one review, at one moment (the "링크 복사" link). */
export function reviewHref(organizationId: string, reviewId?: string | null, atMs?: number | null): string {
  const params = new URLSearchParams({ organizationId });
  if (reviewId) params.set('review', reviewId);
  if (reviewId && atMs != null && Number.isFinite(atMs) && atMs > 0) params.set('t', String(Math.round(atMs)));
  return `${REVIEW_PATH}?${params.toString()}`;
}

/** `?t=` back to milliseconds; anything odd is ignored. */
export function parseReviewTime(value: string | string[] | null | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,8}$/.test(raw)) return null;
  const ms = Number(raw);
  return ms <= REVIEW_LIMITS.atMsMax ? ms : null;
}

/** `m:ss.t` (tenths), `h:mm:ss` past an hour. Tabular in CSS. */
export function formatTimecode(ms: number | null | undefined): string {
  const total = Math.max(0, Math.floor(Number(ms ?? 0)));
  const tenths = Math.floor((total % 1000) / 100);
  const s = Math.floor(total / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}.${tenths}`;
}

export interface ReviewThread {
  root: ReviewComment;
  replies: ReviewComment[];
}

/**
 * Comments as threads, in the order a reviewer reads a film: moments first by time, then the notes
 * about the whole piece by when they were written. Replies keep their writing order. A deleted
 * comment only survives as the head of a thread that still has replies.
 */
export function threadComments(comments: readonly ReviewComment[]): ReviewThread[] {
  const replies = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    if (!c.parentId || c.deleted) continue;
    const list = replies.get(c.parentId) ?? [];
    list.push(c);
    replies.set(c.parentId, list);
  }
  const byTime = (a: ReviewComment, b: ReviewComment) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const threads = comments
    .filter((c) => !c.parentId)
    .map((root) => ({ root, replies: (replies.get(root.id) ?? []).sort(byTime) }))
    .filter((t) => !t.root.deleted || t.replies.length > 0);
  return threads.sort((a, b) => {
    const at = a.root.atMs,
      bt = b.root.atMs;
    if (at != null && bt != null && at !== bt) return at - bt;
    if (at != null && bt == null) return -1;
    if (at == null && bt != null) return 1;
    return byTime(a.root, b.root);
  });
}

/** True when a spot pin belongs on the frame shown at `currentMs` (a still image shows every spot). */
export function spotVisibleAt(comment: Pick<ReviewComment, 'atMs' | 'x' | 'y'>, currentMs: number | null, windowMs = 400): boolean {
  if (comment.x == null || comment.y == null) return false;
  if (currentMs == null) return true;
  if (comment.atMs == null) return false;
  return Math.abs(comment.atMs - currentMs) <= windowMs;
}

/** The status moves a writer may make from `status` (수정 요청 / 승인 / 다시 열기). */
export function nextStatuses(status: ReviewStatus): ReviewStatus[] {
  switch (status) {
    case 'open':
      return ['changes_requested', 'approved'];
    case 'changes_requested':
      return ['approved', 'open'];
    case 'approved':
      return ['open'];
  }
}

export function isReviewErrorCode(value: unknown): value is ReviewErrorCode {
  return typeof value === 'string' && (REVIEW_ERROR_CODES as readonly string[]).includes(value);
}
