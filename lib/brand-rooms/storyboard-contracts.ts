/**
 * Storyboard wire contract (docs/BRAND-ROOMS.md §5, §8).
 *
 * The one place the room's storyboard tab, the team editor, the ingest door and the service agree on
 * shapes. The API route parses every request with these schemas; the screens import the same file.
 *
 * Client-safe: zod, types and pure helpers only (no env, no db).
 */
import { z } from 'zod';
import type { StoryboardFrameView, StoryboardView } from '@/components/brand-rooms/seams';

/* ---------------------------------------------------------------- vocab */

export const STORYBOARD_STATUSES = ['draft', 'shared', 'changes_requested', 'approved'] as const;
export type StoryboardStatus = (typeof STORYBOARD_STATUSES)[number];

/** Who made a board: the brand's own members, or the YAGI team (admin screen or the command line). */
export const STORYBOARD_ROLES = ['brand', 'studio'] as const;
export type StoryboardRole = (typeof STORYBOARD_ROLES)[number];

export const STORYBOARD_SOURCES = ['manual', 'cli'] as const;
export type StoryboardSource = (typeof STORYBOARD_SOURCES)[number];

/** The moves a brand may make on a board the team shared (승인 / 수정 요청 / 다시 열기). */
export const STORYBOARD_DECISIONS = ['approved', 'changes_requested', 'shared'] as const;
export type StoryboardDecision = (typeof STORYBOARD_DECISIONS)[number];

export const STORYBOARD_OPERATIONS = [
  'board.create',
  'board.update',
  'board.share',
  'board.status',
  'board.version',
  'board.delete',
  'frame.reserve',
  'frame.complete',
  'frame.add',
  'frame.update',
  'frame.reorder',
  'frame.delete',
] as const;
export type StoryboardOperation = (typeof STORYBOARD_OPERATIONS)[number];

export const STORYBOARD_ERROR_CODES = [
  'sign_in_required',
  'forbidden',
  'not_found',
  'invalid',
  'conflict',
  /** A shared or decided board: its cuts change only in a new version. */
  'not_editable',
  /** Sharing a board with no cut. */
  'empty',
  /** 200 cuts per board, 50 boards per project. */
  'limit_reached',
  'unsupported_file',
  'file_too_large',
  'provider_unavailable',
  'failed',
] as const;
export type StoryboardErrorCode = (typeof STORYBOARD_ERROR_CODES)[number];

export const STORYBOARD_UPLOAD_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type StoryboardUploadMime = (typeof STORYBOARD_UPLOAD_MIMES)[number];

export const STORYBOARD_LIMITS = {
  framesPerBoard: 200,
  boardsPerProject: 50,
  titleMax: 120,
  labelMax: 20,
  descriptionMax: 2000,
  noteMax: 300,
  secondsMax: 600,
  /** A cut with no length plays this long in the animatic and counts this long in the running time. */
  defaultSeconds: 2,
  imageBytesMax: 25 * 1024 * 1024,
  /** File names the client may send with a reservation (only for the team's log; never shown). */
  nameMax: 120,
  /** A reservation whose bytes never arrived is dropped after this long. */
  pendingHours: 24,
  /** Cuts one `storyboard.finish` call completes before it answers (the command line asks again). */
  finishBatch: 12,
  /** The team's list. */
  listMax: 200,
} as const;

export function isStoryboardErrorCode(value: unknown): value is StoryboardErrorCode {
  return typeof value === 'string' && (STORYBOARD_ERROR_CODES as readonly string[]).includes(value);
}

/** HTTP status per code. A closed room, a closed brand and a missing board are all 404. */
export function storyboardHttpStatus(code: StoryboardErrorCode): number {
  switch (code) {
    case 'sign_in_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'invalid':
      return 400;
    case 'conflict':
    case 'not_editable':
    case 'limit_reached':
      return 409;
    case 'empty':
      return 422;
    case 'file_too_large':
      return 413;
    case 'unsupported_file':
      return 415;
    case 'provider_unavailable':
      return 503;
    default:
      return 500;
  }
}

export function isStoryboardOperation(value: unknown): value is StoryboardOperation {
  return typeof value === 'string' && (STORYBOARD_OPERATIONS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------- inputs */

const Id = z.uuid();
const oneLine = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, ' ').trim())
    .pipe(z.string().max(max));

export const StoryboardTitle = oneLine(STORYBOARD_LIMITS.titleMax).pipe(z.string().min(1));

/** A short label ("1", "3A"); empty clears it. */
const Label = z.union([z.null(), oneLine(STORYBOARD_LIMITS.labelMax).transform((s) => s || null)]);
/** Camera or sound note; empty clears it. */
const Note = z.union([
  z.null(),
  z
    .string()
    .transform((s) => s.replace(/\r\n/g, '\n').trim())
    .pipe(z.string().max(STORYBOARD_LIMITS.noteMax))
    .transform((s) => s || null),
]);
const Description = z
  .string()
  .transform((s) => s.replace(/\r\n/g, '\n').trim())
  .pipe(z.string().max(STORYBOARD_LIMITS.descriptionMax));
const Seconds = z.union([
  z.null(),
  z
    .number()
    .finite()
    .min(0)
    .max(STORYBOARD_LIMITS.secondsMax)
    .transform((n) => Math.round(n * 10) / 10),
]);

/** The text of one cut. Every field optional: absent keeps what is there, null (or '') clears it. */
export const FrameTextSchema = z.object({
  scene: Label.optional(),
  shot: Label.optional(),
  description: Description.optional(),
  camera: Note.optional(),
  audio: Note.optional(),
  seconds: Seconds.optional(),
});
export type FrameTextInput = z.input<typeof FrameTextSchema>;
export type FrameText = z.output<typeof FrameTextSchema>;

const Scope = { organizationId: Id, projectId: Id };
const Board = { ...Scope, storyboardId: Id };

export const BoardCreateSchema = z.object({ ...Scope, title: StoryboardTitle });
export const BoardRefSchema = z.object(Board);
export const BoardUpdateSchema = z.object({ ...Board, title: StoryboardTitle });
export const BoardStatusSchema = z.object({ ...Board, status: z.enum(STORYBOARD_DECISIONS) });

export const FrameReserveSchema = z.object({
  ...Board,
  name: z.string().max(400).transform((s) => s.trim().slice(0, STORYBOARD_LIMITS.nameMax)),
  mime: z.enum(STORYBOARD_UPLOAD_MIMES),
  sizeBytes: z.number().int().min(1),
  text: FrameTextSchema.optional(),
});
export const FrameCompleteSchema = z.object({ ...Board, frameId: Id });
export const FrameAddSchema = z
  .object({ ...Board, assetId: Id.optional(), outputId: Id.optional(), text: FrameTextSchema.optional() })
  .refine((v) => Number(Boolean(v.assetId)) + Number(Boolean(v.outputId)) === 1, { message: 'exactly one of assetId and outputId', path: ['assetId'] });
export const FrameUpdateSchema = z.object({
  ...Board,
  frames: z
    .array(FrameTextSchema.extend({ frameId: Id }))
    .min(1)
    .max(STORYBOARD_LIMITS.framesPerBoard)
    .refine((list) => new Set(list.map((f) => f.frameId)).size === list.length, { message: 'each cut once' }),
});
export const FrameReorderSchema = z.object({
  ...Board,
  frameIds: z
    .array(Id)
    .max(STORYBOARD_LIMITS.framesPerBoard)
    .refine((list) => new Set(list).size === list.length, { message: 'each cut once' }),
});
export const FrameRefSchema = z.object({ ...Board, frameId: Id });

export const STORYBOARD_OPERATION_SCHEMAS = {
  'board.create': BoardCreateSchema,
  'board.update': BoardUpdateSchema,
  'board.share': BoardRefSchema,
  'board.status': BoardStatusSchema,
  'board.version': BoardRefSchema,
  'board.delete': BoardRefSchema,
  'frame.reserve': FrameReserveSchema,
  'frame.complete': FrameCompleteSchema,
  'frame.add': FrameAddSchema,
  'frame.update': FrameUpdateSchema,
  'frame.reorder': FrameReorderSchema,
  'frame.delete': FrameRefSchema,
} as const satisfies Record<StoryboardOperation, z.ZodType>;

/* --------------------------------------------------------------- views */

export interface StoryboardFrameDetail extends StoryboardFrameView {
  /** A 768 px still for the grid; null for an older cut without one (use `url`). */
  thumbUrl: string | null;
  /** The studio asset this cut's picture was copied from, if any. */
  sourceAssetId: string | null;
}

export interface StoryboardBoardView extends StoryboardView {
  lineageId: string;
  source: StoryboardSource;
  sharedAt: string | null;
  frames: StoryboardFrameDetail[];
}

/** One board in the picker (one version of one storyboard). */
export interface StoryboardListItem {
  id: string;
  lineageId: string;
  projectId: string;
  title: string;
  version: number;
  status: StoryboardStatus;
  createdRole: StoryboardRole;
  source: StoryboardSource;
  cuts: number;
  /** Running time in seconds, cuts without a length counted at the default. */
  seconds: number;
  coverUrl: string | null;
  updatedAt: string;
  sharedAt: string | null;
}

export interface StoryboardVersionItem {
  id: string;
  version: number;
  status: StoryboardStatus;
  updatedAt: string;
}

export interface StoryboardFailure {
  ok: false;
  code: StoryboardErrorCode;
}

export interface StoryboardList {
  ok: true;
  canEdit: boolean;
  canTalk: boolean;
  boards: StoryboardListItem[];
}

export interface StoryboardDetail {
  ok: true;
  canEdit: boolean;
  canTalk: boolean;
  /** This viewer may change the cuts now (the board is theirs and still a draft). */
  editable: boolean;
  board: StoryboardBoardView;
  /** Every version of this storyboard the viewer may see, newest first. */
  versions: StoryboardVersionItem[];
  /** The version before this one that the viewer may see, if any. */
  previous: { id: string; version: number } | null;
  /** Cuts whose picture or text differs from `previous` (empty when there is none). */
  changedFrameIds: string[];
  /** Cuts of `previous` that have no match here. */
  removedCount: number;
}

export interface StoryboardBoardSaved {
  ok: true;
  board: StoryboardListItem;
}

export interface StoryboardFrameReserved {
  ok: true;
  frameId: string;
  /** True: PUT the bytes to `url` (signed). False: POST them to `url` on this host. */
  direct: boolean;
  url: string;
}

export interface StoryboardFrameSaved {
  ok: true;
  frame: StoryboardFrameDetail;
}

export interface StoryboardDone {
  ok: true;
}

export type StoryboardOperationResult = StoryboardFailure | StoryboardBoardSaved | StoryboardFrameReserved | StoryboardFrameSaved | StoryboardDone;

/* ------------------------------------------------------------- helpers */

/** How long a cut plays: its own length when it has one above zero, otherwise the default. */
export function frameSeconds(seconds: number | null | undefined): number {
  return seconds != null && Number.isFinite(seconds) && seconds > 0 ? seconds : STORYBOARD_LIMITS.defaultSeconds;
}

export function totalSeconds(frames: ReadonlyArray<{ seconds: number | null }>): number {
  return Math.round(frames.reduce((sum, f) => sum + frameSeconds(f.seconds), 0) * 10) / 10;
}

/** `m:ss` (tabular in CSS); tenths only below a minute when they are not zero ("4.5s" reads as 0:04.5). */
export function formatRunTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const whole = Math.floor(total);
  const tenths = Math.round((total - whole) * 10);
  const m = Math.floor(whole / 60);
  const s = String(whole % 60).padStart(2, '0');
  return tenths > 0 && tenths < 10 ? `${m}:${s}.${tenths}` : `${m}:${s}`;
}

/** Where each cut starts in the animatic, and the whole length, in milliseconds. */
export function animaticTimeline(frames: ReadonlyArray<{ seconds: number | null }>): { starts: number[]; total: number } {
  const starts: number[] = [];
  let at = 0;
  for (const f of frames) {
    starts.push(at);
    at += Math.round(frameSeconds(f.seconds) * 1000);
  }
  return { starts, total: at };
}

/** The cut on screen at `ms` (the last cut once the end is reached). */
export function frameIndexAt(starts: readonly number[], ms: number): number {
  if (starts.length === 0) return -1;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= ms) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The pieces of a cut's label: its scene if it has one, its shot or else its place in the board (1-based). */
export function cutLabelParts(frame: { scene: string | null; shot: string | null }, position: number): { scene: string | null; shot: string } {
  return { scene: frame.scene, shot: frame.shot ?? String(position + 1) };
}

/**
 * Text pasted into the editor, as one description per cut: paragraphs split at blank lines, each
 * trimmed and cut to the description limit. Single line breaks stay inside a paragraph.
 */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.slice(0, STORYBOARD_LIMITS.descriptionMax));
}

/** Pictures in the order their file names sort, numbers by value ("2.png" before "10.png"). */
export function byFileName<T extends { name: string }>(files: readonly T[]): T[] {
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}

/** What a cut is, for "바뀐 컷": its picture (by content) and every word on it. */
export interface FrameSignatureInput {
  id: string;
  picture: string;
  scene: string | null;
  shot: string | null;
  description: string;
  camera: string | null;
  audio: string | null;
  seconds: number | null;
}

export function frameSignature(f: FrameSignatureInput): string {
  return JSON.stringify([f.picture, f.scene, f.shot, f.description, f.camera, f.audio, f.seconds == null ? null : Number(f.seconds)]);
}

/**
 * Cuts of `current` with no identical cut in `previous` (each previous cut matches once), and how
 * many previous cuts are gone: those left without a match beyond the ones a changed cut stands in
 * for (a reworded cut is one change, not a change and a removal). Order alone is not a change.
 */
export function changedFrames(previous: readonly FrameSignatureInput[], current: readonly FrameSignatureInput[]): { changed: string[]; removed: number } {
  const pool = new Map<string, number>();
  for (const f of previous) {
    const key = frameSignature(f);
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  const changed: string[] = [];
  for (const f of current) {
    const key = frameSignature(f);
    const left = pool.get(key) ?? 0;
    if (left > 0) pool.set(key, left - 1);
    else changed.push(f.id);
  }
  let unmatched = 0;
  for (const n of pool.values()) unmatched += n;
  return { changed, removed: Math.max(0, unmatched - changed.length) };
}

/** The picker's order: storyboards by their latest activity, each one's versions newest first. */
export function orderBoards<T extends { lineageId: string; version: number; updatedAt: string }>(boards: readonly T[]): T[] {
  const latest = new Map<string, string>();
  for (const b of boards) {
    const seen = latest.get(b.lineageId);
    if (!seen || b.updatedAt > seen) latest.set(b.lineageId, b.updatedAt);
  }
  return [...boards].sort((a, b) => {
    if (a.lineageId !== b.lineageId) {
      const la = latest.get(a.lineageId)!;
      const lb = latest.get(b.lineageId)!;
      return la === lb ? a.lineageId.localeCompare(b.lineageId) : lb.localeCompare(la);
    }
    return b.version - a.version;
  });
}

/** Storyboards (lineages) with their versions, in picker order. */
export function groupLineages<T extends { lineageId: string; version: number; updatedAt: string }>(boards: readonly T[]): Array<{ lineageId: string; versions: T[] }> {
  const out: Array<{ lineageId: string; versions: T[] }> = [];
  for (const b of orderBoards(boards)) {
    const last = out[out.length - 1];
    if (last && last.lineageId === b.lineageId) last.versions.push(b);
    else out.push({ lineageId: b.lineageId, versions: [b] });
  }
  return out;
}

/** The decisions a brand may take on a shared board from where it is. */
export function nextDecisions(status: StoryboardStatus): StoryboardDecision[] {
  switch (status) {
    case 'draft':
      return [];
    case 'shared':
      return ['approved', 'changes_requested'];
    case 'changes_requested':
      return ['approved', 'shared'];
    case 'approved':
      return ['shared'];
  }
}

export const ROOM_PATH = '/brand/rooms';
export const STORYBOARD_ADMIN_PATH = '/admin/brand-rooms/storyboards';

/** The room's storyboard tab, opened on one board and one cut. */
export function storyboardRoomHref(organizationId: string, projectId: string, boardId?: string | null, frameId?: string | null): string {
  const params = new URLSearchParams({ organizationId, tab: 'storyboard' });
  if (boardId) params.set('board', boardId);
  if (boardId && frameId) params.set('frame', frameId);
  return `${ROOM_PATH}/${projectId}?${params.toString()}`;
}

export function storyboardAdminHref(boardId: string): string {
  return `${STORYBOARD_ADMIN_PATH}/${boardId}`;
}
