/**
 * Project room storyboards (docs/BRAND-ROOMS.md §5, §8): a board is one version of a project's
 * storyboard, its cuts are a picture with a scene/shot label, a description and optional camera,
 * sound and length. The brand reads, discusses each cut (slice M's thread, keyed by `ref`) and
 * approves or asks for changes; it may also make its own boards. The YAGI team makes boards on the
 * admin screen (`staff*`) or from the command line (`ingest*`, lib/brand-rooms/ingest.ts).
 *
 * Brand side: every read and write passes the room seat first (sign-in -> membership or a project
 * invitation -> the sandbox hardline and the generation policy, 404 -> role), then the project
 * (`requireRoomProject`). Owners and editors write, viewers and guests read. A draft the team made is
 * invisible to the brand until it is shared. Cuts change only while their board is a draft; after
 * that a new version carries the change ("바뀐 컷" compares a version with the one before it).
 *
 * Team side: the admin flag is re-read from the profile row inside the transaction, and the
 * organization's hardline is checked on every write (a sandboxed client gets no storyboard). Boards
 * the team makes carry `created_role = 'studio'`.
 *
 * Pictures: jpg/png/webp up to 25 MB, checked by their bytes, stored in the studio media store under a
 * fresh random key with a 768 px thumbnail. A cut taken from a studio asset or result gets its own
 * copy, so deleting the asset never breaks a storyboard. Versions share their pictures; an object is
 * deleted only when no cut points at it any more.
 *
 * Customer-visible text does not exist here: failures are `STORYBOARD_ERROR_CODES` only.
 */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { featureDenied, isSandboxedClientOrganization } from '@/lib/brands/features';
import type { UploadLimitReason } from '@/lib/brands/upload-limits-format';
import { STAGING_BUCKET } from '@/lib/storage';
import { loadFeaturePolicies } from '@/lib/brands/entitlements';
import {
  adjustOrganizationStorageBytes,
  checkStorageQuotaForUpload,
  reconcileOrganizationStorage,
} from '@/lib/brands/storage-quota';
import { imageInfo, sha256Hex, sniffMime, thumbnailWebp } from '@/lib/brand-studio/files';
import { isStudioMediaKey, type StudioMediaStore } from '@/lib/brand-studio/media-store';
import { dropUnreferencedStudioKeys } from '@/lib/brand-studio/physical-cleanup';
import type { StudioStaging } from '@/lib/brand-studio/types';
import { canTalkIn, RoomDenied, requireEdit, requireRoomProject, roomSeat, type RoomSeat } from './access';
import { postRoomEvent, type RoomEventInput, type RoomEventKind } from './events';
import { storyboardDecisionNotice, type RoomTeamNotice, type RoomTeamNotify } from './team-notice';
import {
  BoardCreateSchema,
  BoardRefSchema,
  BoardStatusSchema,
  BoardUpdateSchema,
  FrameAddSchema,
  FrameCompleteSchema,
  FrameRefSchema,
  FrameReorderSchema,
  FrameReserveSchema,
  FrameTextSchema,
  FrameUpdateSchema,
  STORYBOARD_LIMITS,
  STORYBOARD_UPLOAD_MIMES,
  StoryboardTitle,
  changedFrames,
  isStoryboardOperation,
  orderBoards,
  type FrameText,
  type FrameTextInput,
  type StoryboardBoardSaved,
  type StoryboardBoardView,
  type StoryboardDecision,
  type StoryboardDetail,
  type StoryboardDone,
  type StoryboardErrorCode,
  type StoryboardFailure,
  type StoryboardFrameDetail,
  type StoryboardFrameReserved,
  type StoryboardFrameSaved,
  type StoryboardList,
  type StoryboardListItem,
  type StoryboardOperationResult,
  type StoryboardRole,
  type StoryboardSource,
  type StoryboardStatus,
  type StoryboardUploadMime,
  type StoryboardVersionItem,
} from './storyboard-contracts';
import type { StoryboardView } from '@/components/brand-rooms/seams';

export interface StoryboardDeps {
  sql: SqlRunner;
  media: StudioMediaStore;
  /** The private staging bucket uploads land in before they are checked (lib/storage). */
  staging: StudioStaging;
  /** Server log line; never shown to a customer, never a secret. */
  log?: (event: string, detail?: Record<string, unknown>) => void;
  /** The team's internal notice for a brand's approval or change request (./team-notice.ts); the route sends it after the answer. */
  notify?: RoomTeamNotify;
}

/** Local mode: the browser POSTs a reserved cut's bytes here (app/api/brand-rooms/storyboards/upload/[id]). */
export const STORYBOARD_LOCAL_UPLOAD_ROUTE = '/api/brand-rooms/storyboards/upload';
/** Local mode: the command line POSTs a reserved cut's bytes here (`?upload=<frameId>`). */
export const INGEST_LOCAL_UPLOAD_ROUTE = '/api/brand-rooms/ingest';

export class StoryboardDenied extends Error {
  constructor(
    readonly code: StoryboardErrorCode,
    readonly reason?: UploadLimitReason,
  ) {
    super(code);
    this.name = 'StoryboardDenied';
  }
}

const failure = (code: StoryboardErrorCode, reason?: UploadLimitReason): StoryboardFailure =>
  reason ? { ok: false, code, reason } : { ok: false, code };

/** Run `fn`; a refusal becomes its code, a unique-key race becomes `conflict`. Anything else propagates. */
async function guard<T>(fn: () => Promise<T>): Promise<T | StoryboardFailure> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StoryboardDenied) return failure(error.code, error.reason);
    if (error instanceof RoomDenied) return failure(error.code);
    if ((error as { code?: string } | null)?.code === '23505') return failure('conflict');
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoryboardActor {
  /** A profile id; null for the command line (the team's secret, no person). */
  userId: string | null;
  role: StoryboardRole;
}

/* --------------------------------------------------------------- rows */

interface BoardRow {
  id: string;
  organization_id: string;
  project_id: string;
  lineage_id: string;
  version: number;
  title: string;
  status: StoryboardStatus;
  created_by: string | null;
  created_role: StoryboardRole;
  source: StoryboardSource;
  shared_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  cuts: number;
  run_seconds: number | string | null;
  cover_key: string | null;
}

interface FrameRow {
  id: string;
  storyboard_id: string;
  organization_id: string;
  idx: number;
  status: 'pending' | 'ready';
  scene: string | null;
  shot: string | null;
  description: string;
  camera: string | null;
  audio: string | null;
  seconds: number | string | null;
  storage_key: string | null;
  thumb_key: string | null;
  staging_key: string | null;
  mime: string | null;
  size_bytes: number | string | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  source: string;
  source_asset_id: string | null;
  created_at: Date | string;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const isoOrNull = (v: Date | string | null): string | null => (v == null ? null : iso(v));
const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

const BOARD_SELECT = `
  select b.id, b.organization_id, b.project_id, b.lineage_id, b.version, b.title, b.status, b.created_by, b.created_role,
         b.source, b.shared_at, b.created_at, b.updated_at,
         (select count(*)::int from brand_storyboard_frames f where f.storyboard_id = b.id and f.status = 'ready') as cuts,
         (select coalesce(sum(case when f.seconds > 0 then f.seconds else ${STORYBOARD_LIMITS.defaultSeconds} end), 0)::float8
            from brand_storyboard_frames f where f.storyboard_id = b.id and f.status = 'ready') as run_seconds,
         (select coalesce(f.thumb_key, f.storage_key) from brand_storyboard_frames f
           where f.storyboard_id = b.id and f.status = 'ready' order by f.idx limit 1) as cover_key
    from brand_storyboards b
   where b.deleted_at is null`;

/** A brand never sees a draft the team is still making. */
const BRAND_VISIBLE = `and (b.created_role = 'brand' or b.status <> 'draft')`;

function listItem(row: BoardRow, media: StudioMediaStore): StoryboardListItem {
  return {
    id: String(row.id),
    lineageId: String(row.lineage_id),
    projectId: String(row.project_id),
    title: String(row.title),
    version: Number(row.version),
    status: row.status,
    createdRole: row.created_role,
    source: row.source,
    cuts: Number(row.cuts ?? 0),
    seconds: Math.round(Number(row.run_seconds ?? 0) * 10) / 10,
    coverUrl: row.cover_key && isStudioMediaKey(row.cover_key) ? media.url(row.cover_key) : null,
    updatedAt: iso(row.updated_at),
    sharedAt: isoOrNull(row.shared_at),
  };
}

function frameView(row: FrameRow, position: number, media: StudioMediaStore, threads: ReadonlyMap<string, number>): StoryboardFrameDetail {
  return {
    id: String(row.id),
    idx: position,
    scene: row.scene,
    shot: row.shot,
    url: media.url(row.storage_key!),
    thumbUrl: row.thumb_key ? media.url(row.thumb_key) : null,
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    description: String(row.description ?? ''),
    camera: row.camera,
    audio: row.audio,
    seconds: num(row.seconds),
    threadCount: threads.get(String(row.id)) ?? 0,
    sourceAssetId: row.source_asset_id ? String(row.source_asset_id) : null,
  };
}

function boardView(row: BoardRow, frames: FrameRow[], media: StudioMediaStore, threads: ReadonlyMap<string, number>): StoryboardBoardView {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    lineageId: String(row.lineage_id),
    title: String(row.title),
    version: Number(row.version),
    status: row.status,
    createdRole: row.created_role,
    source: row.source,
    sharedAt: isoOrNull(row.shared_at),
    frames: frames.map((f, i) => frameView(f, i, media, threads)),
    updatedAt: iso(row.updated_at),
  };
}

async function boardRow(
  sql: SqlRunner,
  boardId: string,
  where: { organizationId?: string; projectId?: string; brandVisible?: boolean },
  lock = false,
): Promise<BoardRow | null> {
  if (!UUID.test(boardId)) return null;
  if (lock) {
    const locked = (await sql.query('select id from brand_storyboards where id = $1 and deleted_at is null for update', [boardId])).rows[0];
    if (!locked) return null;
  }
  const params: unknown[] = [boardId];
  let clause = ' and b.id = $1';
  if (where.organizationId) {
    params.push(where.organizationId);
    clause += ` and b.organization_id = $${params.length}`;
  }
  if (where.projectId) {
    params.push(where.projectId);
    clause += ` and b.project_id = $${params.length}`;
  }
  if (where.brandVisible) clause += ` ${BRAND_VISIBLE}`;
  return (await sql.query<BoardRow>(`${BOARD_SELECT}${clause}`, params)).rows[0] ?? null;
}

async function readyFrames(sql: SqlRunner, boardId: string): Promise<FrameRow[]> {
  return (await sql.query<FrameRow>("select * from brand_storyboard_frames where storyboard_id = $1 and status = 'ready' order by idx, id", [boardId])).rows;
}

/**
 * Messages in each cut's thread, read from slice M's `brand_room_messages` by `ref`. The table may not
 * exist yet (or have another shape): then every count is 0, and the savepoint keeps the transaction.
 */
async function threadCounts(sql: SqlRunner, organizationId: string, storyboardId: string): Promise<Map<string, number>> {
  const present = (await sql.query<{ present: boolean }>("select to_regclass('public.brand_room_messages') is not null as present")).rows[0]?.present;
  if (!present) return new Map();
  await sql.query('savepoint storyboard_threads');
  try {
    const rows = (
      await sql.query<{ frame_id: string; n: number }>(
        `select ref->>'frameId' as frame_id, count(*)::int as n from brand_room_messages
          where organization_id = $1 and ref->>'kind' = 'storyboard' and ref->>'storyboardId' = $2 and ref->>'frameId' is not null
            and deleted_at is null and kind <> 'event'
          group by 1`,
        [organizationId, storyboardId],
      )
    ).rows;
    await sql.query('release savepoint storyboard_threads');
    return new Map(rows.map((r) => [String(r.frame_id), Number(r.n)]));
  } catch {
    await sql.query('rollback to savepoint storyboard_threads');
    return new Map();
  }
}

const signatureOf = (f: FrameRow) => ({
  id: String(f.id),
  picture: f.sha256 ?? f.storage_key ?? '',
  scene: f.scene,
  shot: f.shot,
  description: String(f.description ?? ''),
  camera: f.camera,
  audio: f.audio,
  seconds: num(f.seconds),
});

/** The versions, the one before this board and what changed since it. */
async function lineageFacts(
  sql: SqlRunner,
  board: BoardRow,
  frames: FrameRow[],
  brandVisible: boolean,
): Promise<Pick<StoryboardDetail, 'versions' | 'previous' | 'changedFrameIds' | 'removedCount'>> {
  const versions = (
    await sql.query<{ id: string; version: number; status: StoryboardStatus; updated_at: Date | string }>(
      `select b.id, b.version, b.status, b.updated_at from brand_storyboards b
        where b.lineage_id = $1 and b.organization_id = $2 and b.deleted_at is null ${brandVisible ? BRAND_VISIBLE : ''}
        order by b.version desc`,
      [board.lineage_id, board.organization_id],
    )
  ).rows.map((r): StoryboardVersionItem => ({ id: String(r.id), version: Number(r.version), status: r.status, updatedAt: iso(r.updated_at) }));
  const before = versions.find((v) => v.version < Number(board.version)) ?? null;
  if (!before) return { versions, previous: null, changedFrameIds: [], removedCount: 0 };
  const prior = await readyFrames(sql, before.id);
  const { changed, removed } = changedFrames(prior.map(signatureOf), frames.map(signatureOf));
  return { versions, previous: { id: before.id, version: before.version }, changedFrameIds: changed, removedCount: removed };
}

/* --------------------------------------------------------------- pictures */

export type PictureVerdict = { ok: true; mime: StoryboardUploadMime } | { ok: false; code: 'unsupported_file' | 'file_too_large' };

/** jpg, png or webp by their bytes, within 25 MB, and (when reserved) exactly the size reserved. */
export function checkPicture(bytes: Uint8Array, reservedBytes?: number | null): PictureVerdict {
  if (bytes.byteLength > STORYBOARD_LIMITS.imageBytesMax) return { ok: false, code: 'file_too_large' };
  if (bytes.byteLength === 0) return { ok: false, code: 'unsupported_file' };
  if (reservedBytes != null && bytes.byteLength !== Number(reservedBytes)) return { ok: false, code: 'unsupported_file' };
  const mime = sniffMime(bytes);
  if (!mime || !(STORYBOARD_UPLOAD_MIMES as readonly string[]).includes(mime)) return { ok: false, code: 'unsupported_file' };
  return { ok: true, mime: mime as StoryboardUploadMime };
}

interface StoredPicture {
  key: string;
  thumbKey: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  width: number;
  height: number;
}

/** Check, measure, thumbnail and store the picture. `stored` collects every key written, for cleanup. */
async function storePicture(media: StudioMediaStore, bytes: Uint8Array, reservedBytes: number | null, stored: string[]): Promise<StoredPicture> {
  const verdict = checkPicture(bytes, reservedBytes);
  if (!verdict.ok) throw new StoryboardDenied(verdict.code);
  const size = await imageInfo(bytes);
  if (!size) throw new StoryboardDenied('unsupported_file');
  const thumbKey = (await media.put(await thumbnailWebp(bytes, 768), 'image/webp')).key;
  stored.push(thumbKey);
  const { key } = await media.put(bytes, verdict.mime);
  stored.push(key);
  return { key, thumbKey, mime: verdict.mime, sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes), width: size.width, height: size.height };
}

async function dropStored(media: StudioMediaStore, keys: readonly string[]): Promise<void> {
  for (const key of keys) await media.delete(key).catch(() => undefined);
}

/** Delete the objects no live cut, asset, output, or message points at any more. Best effort, after commit. */
async function dropUnusedKeys(
  deps: Pick<StoryboardDeps, 'sql' | 'media'> & { log?: StoryboardDeps['log'] },
  keys: ReadonlyArray<string | null | undefined>,
): Promise<void> {
  await dropUnreferencedStudioKeys(deps.sql, deps.media, keys, {}, deps.log);
}

/* --------------------------------------------------------------- shared writes */

const touch = (sql: SqlRunner, boardId: string) => sql.query('update brand_storyboards set updated_at = now() where id = $1', [boardId]);

function requireDraft(board: BoardRow): void {
  if (board.status !== 'draft') throw new StoryboardDenied('not_editable');
}

/** A brand member changes only a board the brand made. */
function requireBrandBoard(board: BoardRow): void {
  if (board.created_role !== 'brand') throw new StoryboardDenied('forbidden');
}

async function lockProject(sql: SqlRunner, organizationId: string, projectId: string): Promise<void> {
  const row = (await sql.query('select id from brand_projects where id = $1 and organization_id = $2 for update', [projectId, organizationId])).rows[0];
  if (!row) throw new StoryboardDenied('not_found');
}

async function boardsInProject(sql: SqlRunner, projectId: string): Promise<number> {
  return Number((await sql.query<{ n: number }>('select count(*)::int as n from brand_storyboards where project_id = $1 and deleted_at is null', [projectId])).rows[0]?.n ?? 0);
}

async function insertBoard(
  sql: SqlRunner,
  input: { organizationId: string; projectId: string; title: string; source: StoryboardSource; lineageId?: string; version?: number },
  actor: StoryboardActor,
): Promise<string> {
  await lockProject(sql, input.organizationId, input.projectId);
  if ((await boardsInProject(sql, input.projectId)) >= STORYBOARD_LIMITS.boardsPerProject) throw new StoryboardDenied('limit_reached');
  return (
    await sql.query<{ id: string }>(
      `insert into brand_storyboards (organization_id, project_id, lineage_id, version, title, created_by, created_role, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [input.organizationId, input.projectId, input.lineageId ?? randomUUID(), input.version ?? 1, input.title, actor.userId, actor.role, input.source],
    )
  ).rows[0]!.id;
}

async function savedBoard(sql: SqlRunner, media: StudioMediaStore, boardId: string): Promise<StoryboardBoardSaved> {
  const row = await boardRow(sql, boardId, {});
  if (!row) throw new StoryboardDenied('conflict');
  return { ok: true, board: listItem(row, media) };
}

/** Draft -> shared. Drops any reservation whose bytes never came. Returns the event to post. */
async function shareBoard(sql: SqlRunner, board: BoardRow, actor: StoryboardActor): Promise<RoomEventKind> {
  if (board.status !== 'draft') throw new StoryboardDenied('conflict');
  await sql.query("delete from brand_storyboard_frames where storyboard_id = $1 and status = 'pending'", [board.id]);
  if (Number(board.cuts ?? 0) < 1) throw new StoryboardDenied('empty');
  await sql.query(
    `update brand_storyboards set status = 'shared', shared_at = now(), shared_by = $2, status_changed_by = $2, status_changed_at = now(), updated_at = now()
      where id = $1`,
    [board.id, actor.userId],
  );
  return Number(board.version) > 1 ? 'storyboard_version' : 'storyboard_shared';
}

const DECISION_EVENTS: Partial<Record<StoryboardDecision, RoomEventKind>> = {
  approved: 'storyboard_approved',
  changes_requested: 'storyboard_changes_requested',
};

async function decide(sql: SqlRunner, board: BoardRow, status: StoryboardDecision, actor: StoryboardActor): Promise<RoomEventKind | null> {
  if (board.status === 'draft') throw new StoryboardDenied('conflict');
  if (board.status === status) return null;
  await sql.query('update brand_storyboards set status = $2, status_changed_by = $3, status_changed_at = now(), updated_at = now() where id = $1', [
    board.id,
    status,
    actor.userId,
  ]);
  return DECISION_EVENTS[status] ?? null;
}

/** A new draft version of the same storyboard, with a copy of every cut (the pictures are shared). */
async function newVersion(sql: SqlRunner, board: BoardRow, actor: StoryboardActor): Promise<string> {
  const next = Number(
    (await sql.query<{ n: number }>('select coalesce(max(version), 0)::int + 1 as n from brand_storyboards where lineage_id = $1', [board.lineage_id])).rows[0]?.n ?? 1,
  );
  if (next > 999) throw new StoryboardDenied('limit_reached');
  const id = await insertBoard(
    sql,
    { organizationId: board.organization_id, projectId: board.project_id, title: board.title, source: 'manual', lineageId: board.lineage_id, version: next },
    actor,
  );
  await sql.query(
    `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status, scene, shot, description, camera, audio, seconds,
        storage_key, thumb_key, mime, size_bytes, sha256, width, height, source, source_asset_id, source_output_id, created_by)
     select $1, organization_id, (row_number() over (order by idx, id) - 1)::int, 'ready', scene, shot, description, camera, audio, seconds,
        storage_key, thumb_key, mime, size_bytes, sha256, width, height, source, source_asset_id, source_output_id, $3
       from brand_storyboard_frames where storyboard_id = $2 and status = 'ready'`,
    [id, board.id, actor.userId],
  );
  return id;
}

/** Text fields as columns: only the ones present in `text`. */
function textAssignments(text: FrameText | undefined, start: number): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (!text) return { sets, values };
  for (const column of ['scene', 'shot', 'description', 'camera', 'audio', 'seconds'] as const) {
    if (text[column] === undefined) continue;
    values.push(text[column]);
    sets.push(`${column} = $${start + values.length - 1}`);
  }
  return { sets, values };
}

/** Count every cut (pending ones too) against the limit and find the next free place, compacting if needed. */
async function nextPlace(sql: SqlRunner, boardId: string): Promise<number> {
  const facts = (await sql.query<{ n: number; top: number | null }>('select count(*)::int as n, max(idx) as top from brand_storyboard_frames where storyboard_id = $1', [boardId])).rows[0]!;
  if (Number(facts.n) >= STORYBOARD_LIMITS.framesPerBoard) throw new StoryboardDenied('limit_reached');
  const next = facts.top == null ? 0 : Number(facts.top) + 1;
  if (next <= 999) return next;
  await sql.query(
    `update brand_storyboard_frames f set idx = o.place from (
       select id, (row_number() over (order by idx, id) - 1)::int as place from brand_storyboard_frames where storyboard_id = $1) o
     where f.id = o.id`,
    [boardId],
  );
  return Number(facts.n);
}

async function insertReadyFrame(
  sql: SqlRunner,
  board: BoardRow,
  picture: StoredPicture,
  text: FrameText | undefined,
  origin: { source: 'upload' | 'asset' | 'output'; assetId?: string | null; outputId?: string | null },
  actor: StoryboardActor,
): Promise<FrameRow> {
  const idx = await nextPlace(sql, board.id);
  const row = (
    await sql.query<FrameRow>(
      `insert into brand_storyboard_frames (storyboard_id, organization_id, idx, status, storage_key, thumb_key, mime, size_bytes, sha256, width, height,
          source, source_asset_id, source_output_id, created_by, scene, shot, description, camera, audio, seconds)
       values ($1, $2, $3, 'ready', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, coalesce($17, ''), $18, $19, $20) returning *`,
      [
        board.id,
        board.organization_id,
        idx,
        picture.key,
        picture.thumbKey,
        picture.mime,
        picture.sizeBytes,
        picture.sha256,
        picture.width,
        picture.height,
        origin.source,
        origin.assetId ?? null,
        origin.outputId ?? null,
        actor.userId,
        text?.scene ?? null,
        text?.shot ?? null,
        text?.description ?? null,
        text?.camera ?? null,
        text?.audio ?? null,
        text?.seconds ?? null,
      ],
    )
  ).rows[0]!;
  await touch(sql, board.id);
  return row;
}

const stagingKeyFor = (organizationId: string, frameId: string) => `brand-rooms/storyboards/${organizationId}/${frameId}`;

/** A pending cut: where its bytes go and what they must be. Drops this board's stale reservations first. */
async function reserveFrame(
  sql: SqlRunner,
  board: BoardRow,
  input: { mime: string; sizeBytes: number; text?: FrameText },
  actor: StoryboardActor,
): Promise<{ frameId: string; stagingKey: string; mime: string }> {
  if (input.sizeBytes > STORYBOARD_LIMITS.imageBytesMax) throw new StoryboardDenied('file_too_large');
  if (!(STORYBOARD_UPLOAD_MIMES as readonly string[]).includes(input.mime)) throw new StoryboardDenied('unsupported_file');
  if (actor.role === 'brand') {
    const isAdmin = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1', [actor.userId])).rows[0]?.is_admin === true;
    if (!isAdmin) {
      const quota = await checkStorageQuotaForUpload(sql, board.organization_id, input.sizeBytes, undefined, 1);
      if (!quota.allowed) throw new StoryboardDenied('storage_quota_exceeded', quota.reason);
    }
  }
  await sql.query(
    `delete from brand_storyboard_frames where storyboard_id = $1 and status = 'pending' and created_at < now() - make_interval(hours => $2)`,
    [board.id, STORYBOARD_LIMITS.pendingHours],
  );
  const idx = await nextPlace(sql, board.id);
  const frameId = randomUUID();
  const stagingKey = stagingKeyFor(board.organization_id, frameId);
  const text = input.text;
  await sql.query(
    `insert into brand_storyboard_frames (id, storyboard_id, organization_id, idx, status, staging_key, mime, size_bytes, created_by,
        scene, shot, description, camera, audio, seconds)
     values ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10, coalesce($11, ''), $12, $13, $14)`,
    [frameId, board.id, board.organization_id, idx, stagingKey, input.mime, input.sizeBytes, actor.userId, text?.scene ?? null, text?.shot ?? null, text?.description ?? null, text?.camera ?? null, text?.audio ?? null, text?.seconds ?? null],
  );
  await adjustOrganizationStorageBytes(sql, board.organization_id, input.sizeBytes);
  return { frameId, stagingKey, mime: input.mime };
}

/** Where the bytes of a reserved cut go: a signed staging address, or this host's local gateway. */
async function uploadTarget(deps: StoryboardDeps, reserved: { frameId: string; stagingKey: string; mime: string }, localPath: string): Promise<{ direct: boolean; url: string }> {
  const url = await deps.staging.signedUploadUrl(reserved.stagingKey, reserved.mime);
  if (url) return { direct: true, url };
  if (deps.staging.servesSignedUrls) throw new StoryboardDenied('failed');
  return { direct: false, url: localPath };
}

/** Turn a pending cut ready: read its staged bytes, check, measure and store them. */
async function completeFrame(deps: StoryboardDeps, sql: SqlRunner, board: BoardRow, frameId: string, stored: string[]): Promise<FrameRow> {
  if (!UUID.test(frameId)) throw new StoryboardDenied('not_found');
  const row = (await sql.query<FrameRow>('select * from brand_storyboard_frames where id = $1 and storyboard_id = $2 for update', [frameId, board.id])).rows[0];
  if (!row) throw new StoryboardDenied('not_found');
  if (row.status === 'ready') return row;
  const stagedKey = row.staging_key!;
  let bytes: Uint8Array;
  try {
    bytes = await deps.staging.read(STAGING_BUCKET, stagedKey);
  } catch {
    throw new StoryboardDenied('invalid');
  }
  const picture = await storePicture(deps.media, bytes, num(row.size_bytes), stored);
  const ready = (
    await sql.query<FrameRow>(
      `update brand_storyboard_frames set status = 'ready', storage_key = $2, thumb_key = $3, mime = $4, size_bytes = $5, sha256 = $6,
          width = $7, height = $8, staging_key = null, updated_at = now() where id = $1 returning *`,
      [row.id, picture.key, picture.thumbKey, picture.mime, picture.sizeBytes, picture.sha256, picture.width, picture.height],
    )
  ).rows[0]!;
  await touch(sql, board.id);
  await deps.staging.releaseStaging?.(stagedKey).catch(() => undefined);
  return ready;
}

/** A cut from a studio asset or result of the same organization: its picture is copied, never shared. */
async function addFromStudio(
  deps: StoryboardDeps,
  sql: SqlRunner,
  board: BoardRow,
  input: { assetId?: string; outputId?: string; text?: FrameText },
  actor: StoryboardActor,
  stored: string[],
): Promise<FrameRow> {
  const source = input.assetId
    ? (
        await sql.query<{ kind: string; storage_key: string | null }>(
          "select kind, storage_key from brand_studio_assets where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null",
          [input.assetId, board.organization_id],
        )
      ).rows[0]
    : (
        await sql.query<{ kind: string; storage_key: string | null }>(
          "select kind, storage_key from brand_studio_outputs where id = $1 and organization_id = $2 and status = 'ready' and deleted_at is null and storage_key is not null",
          [input.outputId, board.organization_id],
        )
      ).rows[0];
  if (!source?.storage_key) throw new StoryboardDenied('not_found');
  if (source.kind !== 'image') throw new StoryboardDenied('unsupported_file');
  let bytes: Uint8Array;
  try {
    bytes = await deps.media.read(source.storage_key);
  } catch {
    throw new StoryboardDenied('not_found');
  }
  if (actor.role === 'brand') {
    const isAdmin = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1', [actor.userId])).rows[0]?.is_admin === true;
    if (!isAdmin) {
      const quota = await checkStorageQuotaForUpload(sql, board.organization_id, bytes.byteLength, undefined, 0);
      if (!quota.allowed) throw new StoryboardDenied('storage_quota_exceeded', quota.reason);
    }
  }
  const picture = await storePicture(deps.media, bytes, null, stored);
  const inserted = await insertReadyFrame(
    sql,
    board,
    picture,
    input.text,
    input.assetId ? { source: 'asset', assetId: input.assetId } : { source: 'output', outputId: input.outputId },
    actor,
  );
  await adjustOrganizationStorageBytes(sql, board.organization_id, picture.sizeBytes);
  return inserted;
}

async function updateFrameTexts(sql: SqlRunner, board: BoardRow, updates: Array<FrameText & { frameId: string }>): Promise<FrameRow[]> {
  const out: FrameRow[] = [];
  for (const update of updates) {
    const { sets, values } = textAssignments(update, 3);
    const row = sets.length
      ? (
          await sql.query<FrameRow>(
            `update brand_storyboard_frames set ${sets.join(', ')}, updated_at = now() where id = $1 and storyboard_id = $2 and status = 'ready' returning *`,
            [update.frameId, board.id, ...values],
          )
        ).rows[0]
      : (await sql.query<FrameRow>("select * from brand_storyboard_frames where id = $1 and storyboard_id = $2 and status = 'ready'", [update.frameId, board.id])).rows[0];
    if (!row) throw new StoryboardDenied('not_found');
    out.push(row);
  }
  await touch(sql, board.id);
  return out;
}

/** `frameIds` must be every ready cut exactly once; pending cuts keep their order after them. */
async function reorderFrames(sql: SqlRunner, board: BoardRow, frameIds: readonly string[]): Promise<void> {
  const rows = (await sql.query<{ id: string; status: string }>('select id, status from brand_storyboard_frames where storyboard_id = $1 order by idx, id', [board.id])).rows;
  const ready = rows.filter((r) => r.status === 'ready').map((r) => String(r.id));
  const pending = rows.filter((r) => r.status !== 'ready').map((r) => String(r.id));
  if (ready.length !== frameIds.length || !frameIds.every((id) => ready.includes(id))) throw new StoryboardDenied('conflict');
  const order = [...frameIds, ...pending];
  await sql.query(
    `update brand_storyboard_frames f set idx = o.place - 1, updated_at = now()
       from unnest($2::uuid[]) with ordinality as o(id, place)
      where f.id = o.id and f.storyboard_id = $1`,
    [board.id, order],
  );
  await touch(sql, board.id);
}

async function deleteFrame(sql: SqlRunner, board: BoardRow, frameId: string): Promise<Array<string | null>> {
  const gone = (
    await sql.query<{ storage_key: string | null; thumb_key: string | null }>(
      'delete from brand_storyboard_frames where id = $1 and storyboard_id = $2 returning storage_key, thumb_key',
      [frameId, board.id],
    )
  ).rows[0];
  if (!gone) throw new StoryboardDenied('not_found');
  await touch(sql, board.id);
  await reconcileOrganizationStorage(sql, board.organization_id);
  return [gone.storage_key, gone.thumb_key];
}

function eventFor(board: BoardRow, event: RoomEventKind, actor: StoryboardActor): RoomEventInput {
  return {
    organizationId: String(board.organization_id),
    projectId: String(board.project_id),
    event,
    ref: { kind: 'storyboard', storyboardId: String(board.id) },
    actorId: actor.userId,
    actorRole: actor.role,
    detail: { title: String(board.title), version: Number(board.version) },
  };
}

/** Best effort by contract: a failure is logged and never undoes the write. */
async function postEvents(deps: StoryboardDeps, events: readonly RoomEventInput[]): Promise<void> {
  for (const event of events) {
    try {
      await postRoomEvent(deps.sql, event);
    } catch (error) {
      deps.log?.('storyboard_event_failed', { event: event.event, message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    }
  }
}

/* --------------------------------------------------------------- brand reads */

/** `GET /api/brand-rooms/storyboards?organizationId=&projectId=` */
export async function loadStoryboardList(deps: StoryboardDeps, viewer: Viewer, organizationId: string, projectId: string): Promise<StoryboardList | StoryboardFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, organizationId);
      await requireRoomProject(sql, seat, projectId);
      const rows = (await sql.query<BoardRow>(`${BOARD_SELECT} and b.organization_id = $1 and b.project_id = $2 ${BRAND_VISIBLE}`, [organizationId, projectId])).rows;
      return { ok: true as const, canEdit: seat.canEdit, canTalk: canTalkIn(seat, projectId), boards: orderBoards(rows.map((r) => listItem(r, deps.media))) };
    }),
  );
}

/** `GET /api/brand-rooms/storyboards?organizationId=&projectId=&board=<id>` */
export async function loadStoryboardDetail(
  deps: StoryboardDeps,
  viewer: Viewer,
  organizationId: string,
  projectId: string,
  boardId: string,
): Promise<StoryboardDetail | StoryboardFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, organizationId);
      await requireRoomProject(sql, seat, projectId);
      const row = await boardRow(sql, boardId, { organizationId, projectId, brandVisible: true });
      if (!row) throw new StoryboardDenied('not_found');
      return detailOf(sql, deps.media, row, { canEdit: seat.canEdit, canTalk: canTalkIn(seat, projectId) }, true);
    }),
  );
}

async function detailOf(sql: SqlRunner, media: StudioMediaStore, row: BoardRow, seat: Pick<RoomSeat, 'canEdit' | 'canTalk'>, brand: boolean): Promise<StoryboardDetail> {
  const frames = await readyFrames(sql, row.id);
  const threads = await threadCounts(sql, row.organization_id, row.id);
  const facts = await lineageFacts(sql, row, frames, brand);
  const editable = row.status === 'draft' && seat.canEdit && (brand ? row.created_role === 'brand' : true);
  return { ok: true, canEdit: seat.canEdit, canTalk: seat.canTalk, editable, board: boardView(row, frames, media, threads), ...facts };
}

/* --------------------------------------------------------------- brand writes */

/**
 * One `POST /api/brand-rooms/storyboards` operation. Unknown names are `invalid`. The seat and the
 * project are judged before any other part of the input, so a closed brand answers 404 whatever it sent.
 */
export async function runStoryboardOperation(deps: StoryboardDeps, viewer: Viewer, operation: unknown, input: unknown): Promise<StoryboardOperationResult> {
  if (!isStoryboardOperation(operation)) return failure('invalid');
  const scope = input as { organizationId?: unknown; projectId?: unknown } | null;
  const organizationId = scope?.organizationId;
  const projectId = scope?.projectId;
  if (typeof organizationId !== 'string' || !UUID.test(organizationId) || typeof projectId !== 'string' || !UUID.test(projectId)) return failure('invalid');
  const gate = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, organizationId);
      await requireRoomProject(sql, seat, projectId);
      requireEdit(seat);
      return seat;
    }),
  );
  if ('ok' in gate) return gate;

  const events: RoomEventInput[] = [];
  const stored: string[] = [];
  const after: { dropped: Array<string | null>; reserved: { frameId: string; stagingKey: string; mime: string } | null } = { dropped: [], reserved: null };
  const actor: StoryboardActor = { userId: gate.userId, role: 'brand' };
  let teamNotice: RoomTeamNotice | null = null;

  const result = await guard<StoryboardOperationResult>(() =>
    deps.sql.transaction(async (sql) => {
      const seat = await roomSeat(sql, viewer.userId, organizationId);
      await requireRoomProject(sql, seat, projectId);
      requireEdit(seat);
      const board = async (storyboardId: string) => {
        const row = await boardRow(sql, storyboardId, { organizationId, projectId, brandVisible: true }, true);
        if (!row) throw new StoryboardDenied('not_found');
        return row;
      };
      /** A cut-level write: the brand's own board, still a draft. */
      const draft = async (storyboardId: string) => {
        const row = await board(storyboardId);
        requireBrandBoard(row);
        requireDraft(row);
        return row;
      };
      switch (operation) {
        case 'board.create': {
          const v = parse(BoardCreateSchema, input);
          return savedBoard(sql, deps.media, await insertBoard(sql, { organizationId, projectId, title: v.title, source: 'manual' }, actor));
        }
        case 'board.update': {
          const v = parse(BoardUpdateSchema, input);
          const row = await board(v.storyboardId);
          requireBrandBoard(row);
          await sql.query('update brand_storyboards set title = $2, updated_at = now() where id = $1', [row.id, v.title]);
          return savedBoard(sql, deps.media, row.id);
        }
        case 'board.share': {
          const v = parse(BoardRefSchema, input);
          const row = await board(v.storyboardId);
          requireBrandBoard(row);
          events.push(eventFor(row, await shareBoard(sql, row, actor), actor));
          return savedBoard(sql, deps.media, row.id);
        }
        case 'board.status': {
          const v = parse(BoardStatusSchema, input);
          const row = await board(v.storyboardId);
          // The decision is about the team's work; a brand's own board waits for the team, not for itself.
          if (row.created_role !== 'studio') throw new StoryboardDenied('forbidden');
          const event = await decide(sql, row, v.status, actor);
          if (event) events.push(eventFor(row, event, actor));
          // The team hears about a decision on its board (docs/BRAND-ROOMS-FEEDBACK.md §3); a reopen is not one.
          if (event && (v.status === 'approved' || v.status === 'changes_requested')) {
            teamNotice = storyboardDecisionNotice({
              organizationId: String(row.organization_id),
              userId: gate.userId,
              board: { id: String(row.id), title: String(row.title), version: Number(row.version) },
              status: v.status,
            });
          }
          return savedBoard(sql, deps.media, row.id);
        }
        case 'board.version': {
          const v = parse(BoardRefSchema, input);
          const row = await board(v.storyboardId);
          requireBrandBoard(row);
          return savedBoard(sql, deps.media, await newVersion(sql, row, actor));
        }
        case 'board.delete': {
          const v = parse(BoardRefSchema, input);
          const row = await board(v.storyboardId);
          requireBrandBoard(row);
          const frameKeys = (
            await sql.query<{ storage_key: string | null; thumb_key: string | null }>(
              'select storage_key, thumb_key from brand_storyboard_frames where storyboard_id = $1',
              [row.id],
            )
          ).rows;
          await sql.query('update brand_storyboards set deleted_at = now(), updated_at = now() where id = $1', [row.id]);
          await reconcileOrganizationStorage(sql, row.organization_id);
          after.dropped = frameKeys.flatMap((f) => [f.storage_key, f.thumb_key]);
          return { ok: true as const } satisfies StoryboardDone;
        }
        case 'frame.reserve': {
          const v = parse(FrameReserveSchema, input);
          after.reserved = await reserveFrame(sql, await draft(v.storyboardId), v, actor);
          return { ok: true as const } satisfies StoryboardDone;
        }
        case 'frame.complete': {
          const v = parse(FrameCompleteSchema, input);
          const row = await draft(v.storyboardId);
          const frame = await completeFrame(deps, sql, row, v.frameId, stored);
          return frameSaved(sql, deps.media, row, frame.id);
        }
        case 'frame.add': {
          const v = parse(FrameAddSchema, input);
          const row = await draft(v.storyboardId);
          const frame = await addFromStudio(deps, sql, row, v, actor, stored);
          return frameSaved(sql, deps.media, row, frame.id);
        }
        case 'frame.update': {
          const v = parse(FrameUpdateSchema, input);
          const row = await draft(v.storyboardId);
          const rows = await updateFrameTexts(sql, row, v.frames);
          return frameSaved(sql, deps.media, row, rows[rows.length - 1]!.id);
        }
        case 'frame.reorder': {
          const v = parse(FrameReorderSchema, input);
          await reorderFrames(sql, await draft(v.storyboardId), v.frameIds);
          return { ok: true as const } satisfies StoryboardDone;
        }
        case 'frame.delete': {
          const v = parse(FrameRefSchema, input);
          after.dropped = await deleteFrame(sql, await draft(v.storyboardId), v.frameId);
          return { ok: true as const } satisfies StoryboardDone;
        }
      }
    }),
  ).catch(async (error) => {
    await dropStored(deps.media, stored);
    throw error;
  });
  if (!result.ok) {
    await dropStored(deps.media, stored);
    return result;
  }
  await dropUnusedKeys(deps, after.dropped);
  await postEvents(deps, events);
  const notice = teamNotice as RoomTeamNotice | null;
  if (notice && deps.notify) {
    try {
      deps.notify(notice);
    } catch (error) {
      deps.log?.('storyboard_notice_failed', { message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    }
  }
  const reserved = after.reserved;
  if (operation === 'frame.reserve' && reserved) {
    const target = await guard(() => uploadTarget(deps, reserved, `${STORYBOARD_LOCAL_UPLOAD_ROUTE}/${reserved.frameId}`));
    if ('ok' in target) return target;
    return { ok: true, frameId: reserved.frameId, ...target } satisfies StoryboardFrameReserved;
  }
  return result;
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new StoryboardDenied('invalid');
  return parsed.data;
}

async function frameSaved(sql: SqlRunner, media: StudioMediaStore, board: BoardRow, frameId: string): Promise<StoryboardFrameSaved> {
  const frames = await readyFrames(sql, board.id);
  const position = frames.findIndex((f) => String(f.id) === String(frameId));
  if (position < 0) throw new StoryboardDenied('conflict');
  const threads = await threadCounts(sql, board.organization_id, board.id);
  return { ok: true, frame: frameView(frames[position]!, position, media, threads) };
}

/** The local gateway's question: may this viewer post bytes for this reserved cut? */
export async function pendingFrameUpload(deps: StoryboardDeps, viewer: Viewer, frameId: string): Promise<{ key: string; mime: string; sizeBytes: number } | null> {
  if (!UUID.test(frameId) || !viewer.userId) return null;
  const outcome = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const row = (
        await sql.query<FrameRow & { project_id: string; board_status: string; created_role: string }>(
          `select f.*, b.project_id, b.status as board_status, b.created_role from brand_storyboard_frames f
             join brand_storyboards b on b.id = f.storyboard_id and b.deleted_at is null
            where f.id = $1 and f.status = 'pending'`,
          [frameId],
        )
      ).rows[0];
      if (!row || row.board_status !== 'draft' || row.created_role !== 'brand') return null;
      const seat = await roomSeat(sql, viewer.userId, row.organization_id);
      await requireRoomProject(sql, seat, row.project_id);
      if (!seat.canEdit) return null;
      return { key: String(row.staging_key), mime: String(row.mime), sizeBytes: Number(row.size_bytes) };
    }),
  );
  return outcome && !('ok' in outcome) ? outcome : null;
}

/* --------------------------------------------------------------- shared link (slice R) */

/**
 * The board a share link shows (slice R's `/s/[token]` page): only a board that has been shared, with
 * no thread counts and nothing else of the project. The hardline holds: a sandboxed client, or a
 * brand whose policy closes generation, gets null.
 */
export async function storyboardForShare(deps: Pick<StoryboardDeps, 'sql' | 'media'>, organizationId: string, boardId: string): Promise<StoryboardView | null> {
  if (!UUID.test(organizationId) || !UUID.test(boardId)) return null;
  return deps.sql.transaction(async (sql) => {
    if (!(await organizationOpen(sql, organizationId))) return null;
    const row = await boardRow(sql, boardId, { organizationId });
    if (!row || row.status === 'draft') return null;
    const view = boardView(row, await readyFrames(sql, row.id), deps.media, new Map());
    return view;
  });
}

/* --------------------------------------------------------------- team side */

/** The admin flag, re-read from the profile row inside the transaction (never the session's word). */
async function requireStaff(sql: SqlRunner, viewer: Viewer): Promise<string> {
  if (!viewer.userId || !UUID.test(viewer.userId)) throw new StoryboardDenied('sign_in_required');
  const profile = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id = $1 for share', [viewer.userId])).rows[0];
  if (!profile) throw new StoryboardDenied('sign_in_required');
  if (profile.is_admin !== true) throw new StoryboardDenied('forbidden');
  return viewer.userId;
}

/** The sandbox hardline (id or name) and the generation policy: a closed organization has no storyboards. */
async function organizationOpen(sql: SqlRunner, organizationId: string): Promise<boolean> {
  const org = (await sql.query<{ id: string; name: string }>('select id, name from brand_organizations where id = $1', [organizationId])).rows[0];
  if (!org || isSandboxedClientOrganization(org)) return false;
  const denied = (await loadFeaturePolicies(sql, [org.id]))[org.id] ?? [];
  return !featureDenied(denied, 'generative_media');
}

async function requireOpenOrganization(sql: SqlRunner, organizationId: string): Promise<void> {
  if (!(await organizationOpen(sql, organizationId))) throw new StoryboardDenied('not_found');
}

async function staffBoard(sql: SqlRunner, boardId: unknown): Promise<BoardRow> {
  const row = typeof boardId === 'string' ? await boardRow(sql, boardId, {}, true) : null;
  if (!row) throw new StoryboardDenied('not_found');
  await requireOpenOrganization(sql, row.organization_id);
  return row;
}

export interface StaffStoryboardListItem extends StoryboardListItem {
  organizationId: string;
  organizationName: string;
  projectTitle: string;
}

export interface StaffProjectOption {
  organizationId: string;
  organizationName: string;
  projectId: string;
  projectTitle: string;
}

/** Every live board of open organizations, newest activity first (`/admin/brand-rooms/storyboards`). */
export async function staffStoryboardList(
  deps: Pick<StoryboardDeps, 'sql' | 'media'>,
  viewer: Viewer,
  filter: { organizationId?: string | null; projectId?: string | null } = {},
): Promise<{ ok: true; boards: StaffStoryboardListItem[]; projects: StaffProjectOption[] } | StoryboardFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const organizationId = filter.organizationId && UUID.test(filter.organizationId) ? filter.organizationId : null;
      const projectId = filter.projectId && UUID.test(filter.projectId) ? filter.projectId : null;
      const projectRows = (
        await sql.query<{ project_id: string; project_title: string; organization_id: string; organization_name: string }>(
          `select p.id as project_id, p.title as project_title, o.id as organization_id, o.name as organization_name
             from brand_projects p join brand_organizations o on o.id = p.organization_id
            where p.status <> 'cancelled'
            order by o.name, p.created_at desc limit 500`,
        )
      ).rows;
      const policies = await loadFeaturePolicies(sql, [...new Set(projectRows.map((r) => String(r.organization_id)))]);
      const open = (row: { organization_id: string; organization_name: string }) =>
        !isSandboxedClientOrganization({ id: row.organization_id, name: row.organization_name }) && !featureDenied(policies[row.organization_id] ?? [], 'generative_media');
      const projects = projectRows.filter(open).map((r) => ({
        organizationId: String(r.organization_id),
        organizationName: String(r.organization_name),
        projectId: String(r.project_id),
        projectTitle: String(r.project_title),
      }));
      const rows = (
        await sql.query<BoardRow & { organization_name: string; project_title: string }>(
          `select * from (${BOARD_SELECT}
             and ($1::uuid is null or b.organization_id = $1) and ($2::uuid is null or b.project_id = $2)) s
             join lateral (select o.name as organization_name from brand_organizations o where o.id = s.organization_id) o on true
             join lateral (select p.title as project_title from brand_projects p where p.id = s.project_id) p on true
           order by s.updated_at desc, s.id limit $3`,
          [organizationId, projectId, STORYBOARD_LIMITS.listMax],
        )
      ).rows;
      const morePolicies = await loadFeaturePolicies(sql, [...new Set(rows.map((r) => String(r.organization_id)))]);
      const boards = rows
        .filter(
          (r) =>
            !isSandboxedClientOrganization({ id: r.organization_id, name: r.organization_name }) &&
            !featureDenied(morePolicies[r.organization_id] ?? [], 'generative_media'),
        )
        .map((r) => ({
          ...listItem(r, deps.media),
          organizationId: String(r.organization_id),
          organizationName: String(r.organization_name),
          projectTitle: String(r.project_title),
        }));
      return { ok: true as const, boards, projects };
    }),
  );
}

export async function staffStoryboardDetail(
  deps: Pick<StoryboardDeps, 'sql' | 'media'>,
  viewer: Viewer,
  boardId: string,
): Promise<(StoryboardDetail & { organizationId: string; organizationName: string; projectTitle: string; pendingCount: number }) | StoryboardFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const row = await staffBoard(sql, boardId);
      const names = (
        await sql.query<{ organization_name: string; project_title: string }>(
          'select o.name as organization_name, p.title as project_title from brand_organizations o join brand_projects p on p.organization_id = o.id where o.id = $1 and p.id = $2',
          [row.organization_id, row.project_id],
        )
      ).rows[0];
      const pending = Number(
        (await sql.query<{ n: number }>("select count(*)::int as n from brand_storyboard_frames where storyboard_id = $1 and status = 'pending'", [row.id])).rows[0]?.n ?? 0,
      );
      const detail = await detailOf(sql, deps.media, row, { canEdit: true, canTalk: true }, false);
      return {
        ...detail,
        organizationId: String(row.organization_id),
        organizationName: String(names?.organization_name ?? ''),
        projectTitle: String(names?.project_title ?? ''),
        pendingCount: pending,
      };
    }),
  );
}

/** A new draft board for a project (`brand_rooms.storyboard.create`). */
export async function staffCreateStoryboard(
  deps: Pick<StoryboardDeps, 'sql' | 'media'>,
  viewer: Viewer,
  input: { projectId: string; title: string },
): Promise<StoryboardBoardSaved | StoryboardFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const title = StoryboardTitle.safeParse(input.title);
      if (!title.success || !UUID.test(input.projectId ?? '')) throw new StoryboardDenied('invalid');
      const project = (await sql.query<{ organization_id: string }>('select organization_id from brand_projects where id = $1', [input.projectId])).rows[0];
      if (!project) throw new StoryboardDenied('not_found');
      await requireOpenOrganization(sql, project.organization_id);
      const id = await insertBoard(sql, { organizationId: project.organization_id, projectId: input.projectId, title: title.data, source: 'manual' }, { userId, role: 'studio' });
      return savedBoard(sql, deps.media, id);
    }),
  );
}

export async function staffUpdateStoryboard(
  deps: Pick<StoryboardDeps, 'sql' | 'media'>,
  viewer: Viewer,
  input: { storyboardId: string; title: string },
): Promise<StoryboardBoardSaved | StoryboardFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const row = await staffBoard(sql, input.storyboardId);
      const title = StoryboardTitle.safeParse(input.title);
      if (!title.success) throw new StoryboardDenied('invalid');
      await sql.query('update brand_storyboards set title = $2, updated_at = now() where id = $1', [row.id, title.data]);
      return savedBoard(sql, deps.media, row.id);
    }),
  );
}

export async function staffShareStoryboard(deps: StoryboardDeps, viewer: Viewer, input: { storyboardId: string }): Promise<StoryboardBoardSaved | StoryboardFailure> {
  const events: RoomEventInput[] = [];
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const row = await staffBoard(sql, input.storyboardId);
      const actor: StoryboardActor = { userId, role: 'studio' };
      events.push(eventFor(row, await shareBoard(sql, row, actor), actor));
      return savedBoard(sql, deps.media, row.id);
    }),
  );
  if (result.ok) await postEvents(deps, events);
  return result;
}

export async function staffNewVersion(deps: Pick<StoryboardDeps, 'sql' | 'media'>, viewer: Viewer, input: { storyboardId: string }): Promise<StoryboardBoardSaved | StoryboardFailure> {
  return guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const row = await staffBoard(sql, input.storyboardId);
      return savedBoard(sql, deps.media, await newVersion(sql, row, { userId, role: 'studio' }));
    }),
  );
}

export async function staffDeleteStoryboard(
  deps: Pick<StoryboardDeps, 'sql' | 'media'> & { log?: StoryboardDeps['log'] },
  viewer: Viewer,
  input: { storyboardId: string },
): Promise<StoryboardDone | StoryboardFailure> {
  let dropped: Array<string | null> = [];
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      await requireStaff(sql, viewer);
      const row = await staffBoard(sql, input.storyboardId);
      const frameKeys = (
        await sql.query<{ storage_key: string | null; thumb_key: string | null }>(
          'select storage_key, thumb_key from brand_storyboard_frames where storyboard_id = $1',
          [row.id],
        )
      ).rows;
      await sql.query('update brand_storyboards set deleted_at = now(), updated_at = now() where id = $1', [row.id]);
      await reconcileOrganizationStorage(sql, row.organization_id);
      dropped = frameKeys.flatMap((f) => [f.storage_key, f.thumb_key]);
      return { ok: true as const };
    }),
  );
  if (result.ok && dropped.length > 0) await dropUnusedKeys(deps, dropped);
  return result;
}

/** One cut in the team editor's save: an existing cut by id, or a new picture, with its text. */
export interface StaffFrameEntry {
  id?: string;
  /** A new picture's bytes (read by the operation from staging or the posted form). */
  picture?: Uint8Array;
  text: FrameTextInput;
}

/**
 * Replace a draft board's cuts with `frames`, in that order (`brand_rooms.storyboard.frames`): cuts
 * not listed are deleted, listed cuts get the new text, new pictures become new cuts. One transaction:
 * either the whole save lands or none of it.
 */
export async function staffReplaceFrames(
  deps: StoryboardDeps,
  viewer: Viewer,
  input: { storyboardId: string; title?: string | null; frames: StaffFrameEntry[] },
): Promise<StoryboardBoardSaved | StoryboardFailure> {
  if (!Array.isArray(input.frames) || input.frames.length > STORYBOARD_LIMITS.framesPerBoard) return failure(input.frames?.length ? 'limit_reached' : 'invalid');
  const stored: string[] = [];
  let dropped: Array<string | null> = [];
  const result = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const userId = await requireStaff(sql, viewer);
      const row = await staffBoard(sql, input.storyboardId);
      requireDraft(row);
      if (input.title != null && input.title !== '') {
        const title = StoryboardTitle.safeParse(input.title);
        if (!title.success) throw new StoryboardDenied('invalid');
        await sql.query('update brand_storyboards set title = $2 where id = $1', [row.id, title.data]);
      }
      const texts = input.frames.map((entry) => {
        const parsed = FrameTextSchema.safeParse(entry.text ?? {});
        if (!parsed.success) throw new StoryboardDenied('invalid');
        if (!entry.picture && !(entry.id && UUID.test(entry.id))) throw new StoryboardDenied('invalid');
        return parsed.data;
      });
      const existing = (await sql.query<{ id: string; storage_key: string | null; thumb_key: string | null }>(
        'select id, storage_key, thumb_key from brand_storyboard_frames where storyboard_id = $1',
        [row.id],
      )).rows;
      const known = new Set(existing.map((r) => String(r.id)));
      const keep = new Set(input.frames.filter((e) => !e.picture).map((e) => e.id!));
      if (keep.size !== input.frames.filter((e) => !e.picture).length) throw new StoryboardDenied('invalid');
      for (const id of keep) if (!known.has(id)) throw new StoryboardDenied('not_found');
      const gone = existing.filter((r) => !keep.has(String(r.id)));
      if (gone.length) {
        await sql.query('delete from brand_storyboard_frames where id = any($1::uuid[])', [gone.map((r) => r.id)]);
        dropped = gone.flatMap((r) => [r.storage_key, r.thumb_key]);
      }
      const actor: StoryboardActor = { userId, role: 'studio' };
      const order: string[] = [];
      for (const [i, entry] of input.frames.entries()) {
        const text = texts[i]!;
        if (entry.picture) {
          const picture = await storePicture(deps.media, entry.picture, null, stored);
          const frame = await insertReadyFrame(sql, row, picture, text, { source: 'upload' }, actor);
          order.push(String(frame.id));
        } else {
          await updateFrameTexts(sql, row, [{ ...text, frameId: entry.id! }]);
          order.push(entry.id!);
        }
      }
      await reorderFrames(sql, row, order);
      return savedBoard(sql, deps.media, row.id);
    }),
  ).catch(async (error) => {
    await dropStored(deps.media, stored);
    throw error;
  });
  if (!result.ok) {
    await dropStored(deps.media, stored);
    return result;
  }
  await dropUnusedKeys(deps, dropped);
  return result;
}

/* --------------------------------------------------------------- command line (lib/brand-rooms/ingest.ts) */

export interface IngestCut {
  text: FrameTextInput;
  mime: string;
  sizeBytes: number;
}

export interface IngestPushed {
  ok: true;
  storyboardId: string;
  organizationId: string;
  projectId: string;
  version: number;
  uploads: Array<{ frameId: string; idx: number; direct: boolean; url: string }>;
}

/**
 * `storyboard.push`: a draft board (or, with `versionOf`, the next draft version of that storyboard)
 * with one reserved cut per picture, made by the team (`created_role = 'studio'`, `source = 'cli'`).
 * The command line uploads each picture to its address, then calls `storyboard.finish`.
 */
export async function ingestPushStoryboard(
  deps: StoryboardDeps,
  input: { projectId: string; title: string; versionOf?: string | null; cuts: IngestCut[] },
): Promise<IngestPushed | StoryboardFailure> {
  if (!UUID.test(input.projectId ?? '')) return failure('invalid');
  const title = StoryboardTitle.safeParse(input.title);
  if (!title.success) return failure('invalid');
  if (!Array.isArray(input.cuts) || input.cuts.length === 0) return failure('empty');
  if (input.cuts.length > STORYBOARD_LIMITS.framesPerBoard) return failure('limit_reached');
  const texts = input.cuts.map((cut) => FrameTextSchema.safeParse(cut.text ?? {}));
  if (texts.some((t) => !t.success)) return failure('invalid');
  for (const cut of input.cuts) {
    if (!(STORYBOARD_UPLOAD_MIMES as readonly string[]).includes(cut.mime)) return failure('unsupported_file');
    if (!Number.isInteger(cut.sizeBytes) || cut.sizeBytes < 1) return failure('invalid');
    if (cut.sizeBytes > STORYBOARD_LIMITS.imageBytesMax) return failure('file_too_large');
  }
  const actor: StoryboardActor = { userId: null, role: 'studio' };
  const made = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const project = (await sql.query<{ organization_id: string }>('select organization_id from brand_projects where id = $1', [input.projectId])).rows[0];
      if (!project) throw new StoryboardDenied('not_found');
      await requireOpenOrganization(sql, project.organization_id);
      let boardId: string;
      if (input.versionOf) {
        const source = UUID.test(input.versionOf) ? await boardRow(sql, input.versionOf, { organizationId: project.organization_id, projectId: input.projectId }, true) : null;
        if (!source) throw new StoryboardDenied('not_found');
        const next = Number(
          (await sql.query<{ n: number }>('select coalesce(max(version), 0)::int + 1 as n from brand_storyboards where lineage_id = $1', [source.lineage_id])).rows[0]?.n ?? 1,
        );
        boardId = await insertBoard(
          sql,
          { organizationId: project.organization_id, projectId: input.projectId, title: title.data, source: 'cli', lineageId: source.lineage_id, version: next },
          actor,
        );
      } else {
        boardId = await insertBoard(sql, { organizationId: project.organization_id, projectId: input.projectId, title: title.data, source: 'cli' }, actor);
      }
      const board = (await boardRow(sql, boardId, {}))!;
      const reservations = [];
      for (const [i, cut] of input.cuts.entries()) {
        reservations.push(await reserveFrame(sql, board, { mime: cut.mime, sizeBytes: cut.sizeBytes, text: (texts[i] as { data: FrameText }).data }, actor));
      }
      return { board, reservations };
    }),
  );
  if ('ok' in made) return made;
  const uploads: IngestPushed['uploads'] = [];
  for (const [idx, reserved] of made.reservations.entries()) {
    const target = await guard(() => uploadTarget(deps, reserved, `${INGEST_LOCAL_UPLOAD_ROUTE}?upload=${reserved.frameId}`));
    if ('ok' in target) return target;
    uploads.push({ frameId: reserved.frameId, idx, ...target });
  }
  return {
    ok: true,
    storyboardId: String(made.board.id),
    organizationId: String(made.board.organization_id),
    projectId: String(made.board.project_id),
    version: Number(made.board.version),
    uploads,
  };
}

/** The local ingest gateway's question: is this a reserved cut of a team draft in an open organization? */
export async function ingestPendingUpload(deps: Pick<StoryboardDeps, 'sql'>, frameId: string): Promise<{ key: string; mime: string; sizeBytes: number } | null> {
  if (!UUID.test(frameId)) return null;
  return deps.sql.transaction(async (sql) => {
    const row = (
      await sql.query<FrameRow & { board_status: string; created_role: string }>(
        `select f.*, b.status as board_status, b.created_role from brand_storyboard_frames f
           join brand_storyboards b on b.id = f.storyboard_id and b.deleted_at is null
          where f.id = $1 and f.status = 'pending'`,
        [frameId],
      )
    ).rows[0];
    if (!row || row.board_status !== 'draft' || row.created_role !== 'studio') return null;
    if (!(await organizationOpen(sql, row.organization_id))) return null;
    return { key: String(row.staging_key), mime: String(row.mime), sizeBytes: Number(row.size_bytes) };
  });
}

export interface IngestFinished {
  ok: true;
  storyboardId: string;
  status: StoryboardStatus;
  cuts: number;
  /** Cuts still waiting for their picture; call again while above zero. */
  remaining: number;
  /** Cuts dropped because their picture never arrived or was not a picture. */
  failed: Array<{ frameId: string; code: StoryboardErrorCode }>;
}

/**
 * `storyboard.finish`: complete up to `finishBatch` reserved cuts (each in its own transaction, so one
 * bad file costs only its cut), and once none is left and `share` is set, share the board.
 */
export async function ingestFinishStoryboard(deps: StoryboardDeps, input: { storyboardId: string; share?: boolean }): Promise<IngestFinished | StoryboardFailure> {
  if (!UUID.test(input.storyboardId ?? '')) return failure('invalid');
  const head = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const row = await boardRow(sql, input.storyboardId, {});
      if (!row || row.created_role !== 'studio') throw new StoryboardDenied('not_found');
      await requireOpenOrganization(sql, row.organization_id);
      if (row.status !== 'draft') throw new StoryboardDenied('not_editable');
      return (
        await sql.query<{ id: string }>("select id from brand_storyboard_frames where storyboard_id = $1 and status = 'pending' order by idx limit $2", [
          row.id,
          STORYBOARD_LIMITS.finishBatch,
        ])
      ).rows.map((r) => String(r.id));
    }),
  );
  if ('ok' in head) return head;
  const failed: IngestFinished['failed'] = [];
  for (const frameId of head) {
    const stored: string[] = [];
    const done = await guard(() =>
      deps.sql.transaction(async (sql) => {
        const row = await boardRow(sql, input.storyboardId, {}, true);
        if (!row) throw new StoryboardDenied('not_found');
        await completeFrame(deps, sql, row, frameId, stored);
        return true as const;
      }),
    ).catch(async (error) => {
      await dropStored(deps.media, stored);
      throw error;
    });
    if (done !== true) {
      await dropStored(deps.media, stored);
      failed.push({ frameId, code: done.code });
      await deps.sql.query("delete from brand_storyboard_frames where id = $1 and status = 'pending'", [frameId]);
    }
  }
  const events: RoomEventInput[] = [];
  const tail = await guard(() =>
    deps.sql.transaction(async (sql) => {
      const row = await boardRow(sql, input.storyboardId, {}, true);
      if (!row) throw new StoryboardDenied('not_found');
      const remaining = Number(
        (await sql.query<{ n: number }>("select count(*)::int as n from brand_storyboard_frames where storyboard_id = $1 and status = 'pending'", [row.id])).rows[0]?.n ?? 0,
      );
      let status = row.status;
      if (remaining === 0 && input.share && row.status === 'draft') {
        const actor: StoryboardActor = { userId: null, role: 'studio' };
        events.push(eventFor(row, await shareBoard(sql, row, actor), actor));
        status = 'shared';
      }
      return { ok: true as const, storyboardId: String(row.id), status, cuts: Number(row.cuts ?? 0), remaining, failed };
    }),
  );
  if (tail.ok) await postEvents(deps, events);
  return tail;
}
