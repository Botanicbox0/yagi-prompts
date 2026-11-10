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
  /** A drawing: lines per note, points per line, points per note (docs/BRAND-ROOMS.md §6). */
  strokesMax: 24,
  pointsPerStroke: 240,
  pointsMax: 1200,
  /** Versions of one deliverable. */
  versionMax: 999,
} as const;

/** Where a review item came from: put up from the studio, or delivered by the YAGI team (rooms). */
export const REVIEW_SOURCES = ['studio', 'delivery'] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** The drawing tools and their two colours (blue is the one TWINGS blue; white reads on dark footage). */
export const STROKE_TOOLS = ['pen', 'arrow'] as const;
export type StrokeTool = (typeof STROKE_TOOLS)[number];
export const STROKE_COLORS = ['blue', 'white'] as const;
export type StrokeColor = (typeof STROKE_COLORS)[number];
export const STROKE_HEX: Record<StrokeColor, string> = { blue: '#3875C5', white: '#FFFFFF' };

/** One line drawn on the frame: points in 0..1 of the frame's width and height. An arrow has two points. */
export interface ReviewStroke {
  tool: StrokeTool;
  color: StrokeColor;
  points: Array<[number, number]>;
}

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

const Point = z.tuple([Unit, Unit]).transform(([x, y]) => [Math.round(x * 10_000) / 10_000, Math.round(y * 10_000) / 10_000] as [number, number]);

export const StrokeSchema = z
  .object({
    tool: z.enum(STROKE_TOOLS),
    color: z.enum(STROKE_COLORS),
    points: z.array(Point).min(2).max(REVIEW_LIMITS.pointsPerStroke),
  })
  .strict()
  .refine((s) => s.tool !== 'arrow' || s.points.length === 2, { message: 'an arrow is two points', path: ['points'] });

export const StrokesSchema = z
  .array(StrokeSchema)
  .min(1)
  .max(REVIEW_LIMITS.strokesMax)
  .refine((lines) => lines.reduce((n, l) => n + l.points.length, 0) <= REVIEW_LIMITS.pointsMax, { message: 'too many points' });

const AtMs = z.number().int().min(0).max(REVIEW_LIMITS.atMsMax);

export const CommentAddSchema = z
  .object({
    organizationId: Id,
    reviewId: Id,
    body: Body,
    parentId: Id.nullish(),
    atMs: AtMs.nullish(),
    /** A range ends here (rooms, 0084). */
    endMs: AtMs.nullish(),
    x: Unit.nullish(),
    y: Unit.nullish(),
    /** A drawing on the frame (rooms, 0084). */
    strokes: StrokesSchema.nullish(),
  })
  .refine((v) => (v.x == null) === (v.y == null), { message: 'x and y together', path: ['x'] })
  // A reply answers its thread; the moment and the spot belong to the thread's first comment.
  .refine((v) => !v.parentId || (v.atMs == null && v.x == null && v.endMs == null && v.strokes == null), { message: 'a reply has no moment or spot', path: ['parentId'] })
  .refine((v) => v.endMs == null || (v.atMs != null && v.endMs > v.atMs), { message: 'a range ends after it starts', path: ['endMs'] });

export const CommentRefSchema = z.object({ organizationId: Id, reviewId: Id, commentId: Id });

export type ReviewCreateInput = z.input<typeof ReviewCreateSchema>;
export type ReviewStatusInput = z.input<typeof ReviewStatusSchema>;
export type CommentAddInput = z.input<typeof CommentAddSchema>;

/* ------------------------------------------------- project rooms (0084) */

/**
 * `POST /api/brand-rooms/reviews` (docs/BRAND-ROOMS.md §6). Every input names the project; the route
 * seats the viewer in the room first. `review.version` posts a new version of the stack `reviewId`
 * belongs to, from another asset or result of the organization.
 */
export const ROOM_REVIEW_OPERATIONS = ['review.create', 'review.version', 'review.status', 'comment.add', 'comment.resolve', 'comment.delete'] as const;
export type RoomReviewOperation = (typeof ROOM_REVIEW_OPERATIONS)[number];

const InProject = { organizationId: Id, projectId: Id };

export const RoomReviewCreateSchema = z
  .object({ ...InProject, title: Title, assetId: Id.optional(), outputId: Id.optional() })
  .refine((v) => Number(Boolean(v.assetId)) + Number(Boolean(v.outputId)) === 1, { message: 'exactly one of assetId and outputId', path: ['assetId'] });

export const ReviewVersionSchema = z
  .object({ ...InProject, reviewId: Id, title: Title.optional(), assetId: Id.optional(), outputId: Id.optional() })
  .refine((v) => Number(Boolean(v.assetId)) + Number(Boolean(v.outputId)) === 1, { message: 'exactly one of assetId and outputId', path: ['assetId'] });

export type RoomReviewCreateInput = z.input<typeof RoomReviewCreateSchema>;
export type ReviewVersionInput = z.input<typeof ReviewVersionSchema>;

/** Every room input names its project; the rest of each input is the studio shape above. */
export const RoomScopeSchema = z.object(InProject);

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
  /** Rooms (0084): the project it belongs to, its stack, its place in the stack and who put it up. */
  projectId?: string | null;
  stackId?: string;
  version?: number;
  source?: ReviewSource;
}

/** One version of a deliverable, as the version switcher and "나란히 비교" need it. */
export interface ReviewVersion {
  id: string;
  version: number;
  title: string;
  status: ReviewStatus;
  kind: ReviewKind;
  available: boolean;
  mediaUrl: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  seconds: number | null;
  commentsOpen: number;
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
  /** Rooms (0084): a range ends here. */
  endMs?: number | null;
  /** Rooms (0084): a drawing on the frame, replayed when the note is selected. */
  strokes?: ReviewStroke[] | null;
  /** Rooms (0084): left through a share link by someone outside the workspace (`authorRole` is 'brand'). */
  guest?: boolean;
  /** Rooms (0084): an open note of an earlier version, shown here read-only until resolved. */
  carriedFrom?: { version: number } | null;
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
  /**
   * Rooms (0084 applied and BRAND_ROOMS on): ranges and drawings may be written, and `versions` lists the
   * stack newest first. Absent or false: the screen is exactly the v3 studio review.
   */
  extended?: boolean;
  versions?: ReviewVersion[];
}

/** One deliverable of a project room: its versions, newest first (`versions[0]` is the one to open). */
export interface ReviewStack {
  stackId: string;
  versions: ReviewListItem[];
}

/** `GET /api/brand-rooms/reviews?organizationId=&projectId=` */
export interface RoomReviewList {
  ok: true;
  canEdit: boolean;
  canTalk: boolean;
  stacks: ReviewStack[];
}

/** `GET /api/brand-rooms/reviews?organizationId=&projectId=&review=` */
export interface RoomReviewDetail extends ReviewDetail {
  canEdit: boolean;
  canTalk: boolean;
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

/**
 * A deliverable in its project room (docs/BRAND-ROOMS.md §3: `/brand/rooms/[projectId]?tab=`), at one
 * moment. The room page (slice H) reads `review` and `t` and hands them to the deliverables tab.
 */
export function roomReviewHref(organizationId: string, projectId: string, reviewId?: string | null, atMs?: number | null): string {
  const params = new URLSearchParams({ organizationId, tab: 'review' });
  if (reviewId) params.set('review', reviewId);
  if (reviewId && atMs != null && Number.isFinite(atMs) && atMs > 0) params.set('t', String(Math.round(atMs)));
  return `/brand/rooms/${projectId}?${params.toString()}`;
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
