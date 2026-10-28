import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { StorageDriver } from '@/lib/storage';
import type { BrandFailureCode, BrandOutcome } from '@/lib/brands/workspace/types';
import { brandLogoMime, brandProjectSeat } from '@/lib/brands/workspace/service';
import {
  SHORTLIST_AVATAR_MAX_BYTES, SHORTLIST_METRIC_KEYS, ShortlistImportSchema, ShortlistPickSchema, ShortlistRemoveSchema,
  ShortlistShareSchema, type ShortlistMetrics,
} from './schema';

/**
 * A brand campaign's creator shortlist (docs/BRAND-SHORTLIST.md). The studio imports candidates
 * (admin file or the import worker), shares them when ready, and the brand compares the shared ones
 * on its campaign page and may mark the ones it prefers. Booking stays a TWINGS decision.
 *
 * Nothing here knows where a candidate was found: the import contract has no field for it, and the
 * brand sees only identity and public profile figures.
 */
export interface ShortlistCandidate {
  id: string;
  platform: 'instagram';
  handle: string;
  displayName: string | null;
  category: string | null;
  /** Private, re-authorized route; null when no picture was imported. */
  avatarUrl: string | null;
  metrics: ShortlistMetrics;
  measuredOn: string | null;
  picked: boolean;
}
export interface StudioShortlistCandidate extends ShortlistCandidate { shared: boolean; pickedAt: string | null; updatedAt: string }
export interface BrandShortlistView { candidates: ShortlistCandidate[]; canPick: boolean }
export interface StudioShortlistView { candidates: StudioShortlistCandidate[] }
export interface ShortlistImportResult { id: string; added: number; updated: number }
export interface ShortlistAvatarAccess { key: string; mime: string; sizeBytes: number; sha256: string }
export type ShortlistActor = { kind: 'studio'; viewer: Viewer } | { kind: 'worker' };

type Row = Record<string, unknown>;
class Denied extends Error { constructor(readonly code: BrandFailureCode) { super(code); } }
const fail = (code: BrandFailureCode, field?: string) => ({ ok: false as const, code, ...(field ? { field } : {}) });
const uuid = (value: unknown): value is string => z.uuid().safeParse(value).success;
const stamp = (v: unknown): string => v instanceof Date ? v.toISOString() : String(v);
const day = (v: unknown): string | null => v == null ? null : stamp(v).slice(0, 10);
/** 0066 not applied yet: the campaign page shows no shortlist instead of failing. */
const missingTable = (error: unknown) => (error as { code?: string }).code === '42P01';

const COLUMNS = 'id,handle,display_name,category,metrics,measured_on,avatar_key,avatar_sha256,shared_at,picked_at,updated_at';
const ORDER = "order by nullif(metrics->>'followers','')::numeric desc nulls last, handle";

export const shortlistAvatarPath = (id: string, sha256: string) => `/api/brand-workspace/shortlist/${id}/avatar?v=${sha256.slice(0, 12)}`;

function metricsOf(value: unknown): ShortlistMetrics {
  const source = (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown> | null;
  const out: ShortlistMetrics = {};
  for (const key of SHORTLIST_METRIC_KEYS) {
    const n = source?.[key];
    if (typeof n === 'number' && Number.isFinite(n)) out[key] = n;
  }
  return out;
}
function candidate(row: Row): ShortlistCandidate {
  return {
    id: String(row.id), platform: 'instagram', handle: String(row.handle),
    displayName: row.display_name == null ? null : String(row.display_name),
    category: row.category == null ? null : String(row.category),
    avatarUrl: row.avatar_key ? shortlistAvatarPath(String(row.id), String(row.avatar_sha256)) : null,
    metrics: metricsOf(row.metrics), measuredOn: day(row.measured_on), picked: row.picked_at != null,
  };
}
function studioCandidate(row: Row): StudioShortlistCandidate {
  return { ...candidate(row), shared: row.shared_at != null, pickedAt: row.picked_at == null ? null : stamp(row.picked_at), updatedAt: stamp(row.updated_at) };
}
/** Unknown figures are left out (never stored as 0); averages keep one decimal, rates two. */
function storedMetrics(metrics: Record<string, number | null | undefined>): ShortlistMetrics {
  const out: ShortlistMetrics = {};
  for (const key of SHORTLIST_METRIC_KEYS) {
    const n = metrics[key];
    if (n == null) continue;
    out[key] = /Rate$|Share$/.test(key) ? Math.round(n * 100) / 100 : Math.round(n * 10) / 10;
  }
  return out;
}
async function requireStudio(sql: SqlRunner, userId: string | null): Promise<void> {
  if (!uuid(userId)) throw new Denied('sign_in_required');
  const row = (await sql.query('select is_admin from profiles where id=$1', [userId])).rows[0];
  if (!row) throw new Denied('sign_in_required');
  if (row.is_admin !== true) throw new Denied('forbidden');
}
async function run<T>(sql: SqlRunner, perform: (tx: SqlRunner) => Promise<T>): Promise<BrandOutcome<T>> {
  try { return { ok: true as const, ...await sql.transaction(perform) }; }
  catch (error) {
    if (error instanceof Denied) return fail(error.code);
    if (missingTable(error)) return fail('storage_unavailable');
    throw error;
  }
}
const invalid = (error: z.ZodError) => fail('invalid', (error.issues[0]?.path ?? []).map(String).join('.'));

/**
 * A small square WebP made from the supplied picture: the bytes are sniffed first, then re-encoded,
 * which also drops any metadata. Anything that is not a PNG, JPEG or WebP is refused.
 */
async function avatarBytes(dataUrl: string): Promise<Buffer | null> {
  const [head, body] = dataUrl.split(',', 2);
  const bytes = Buffer.from(body ?? '', 'base64');
  if (bytes.byteLength === 0 || bytes.byteLength > SHORTLIST_AVATAR_MAX_BYTES) return null;
  const declared = head?.slice(5, head.indexOf(';'));
  if (brandLogoMime(bytes) !== declared) return null;
  try {
    return await sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' })
      .rotate().resize(192, 192, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  } catch { return null; }
}

/**
 * Add or refresh candidates by handle. A refresh replaces the figures (and their day) when new ones
 * are sent, keeps a known name/category/picture when the new reading has none, and never touches
 * whether a candidate is shared or picked. New candidates stay hidden until the studio shares them.
 */
export async function importShortlist(
  deps: { sql: SqlRunner; storage?: Pick<StorageDriver, 'putStaging'> },
  actor: ShortlistActor,
  input: unknown,
): Promise<BrandOutcome<ShortlistImportResult>> {
  const parsed = ShortlistImportSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  const avatars: Array<Buffer | null> = [];
  for (const [index, c] of v.candidates.entries()) {
    if (!c.avatar) { avatars.push(null); continue; }
    const bytes = await avatarBytes(c.avatar);
    if (!bytes) return fail('invalid', `candidates.${index}.avatar`);
    avatars.push(bytes);
  }
  if (avatars.some(Boolean) && !deps.storage) return fail('storage_unavailable');
  return run(deps.sql, async sql => {
    if (actor.kind === 'studio') await requireStudio(sql, actor.viewer.userId);
    const project = (await sql.query('select id,organization_id,status from brand_projects where id=$1 for update', [v.projectId])).rows[0];
    if (!project) throw new Denied('not_found');
    if (project.status === 'cancelled') throw new Denied('not_active');
    let added = 0, updated = 0;
    for (const [index, c] of v.candidates.entries()) {
      const existing = (await sql.query('select id,avatar_sha256 from brand_shortlist_candidates where project_id=$1 and platform=$2 and handle=$3 for update', [v.projectId, c.platform, c.handle])).rows[0];
      const id = existing ? String(existing.id) : randomUUID();
      const metrics = storedMetrics(c.metrics);
      const fresh = Object.keys(metrics).length > 0;
      let avatar: { key: string; size: number; sha256: string } | null = null;
      const bytes = avatars[index];
      if (bytes) {
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        avatar = { key: `brands/${String(project.organization_id)}/shortlist/${id}/${sha256}.webp`, size: bytes.byteLength, sha256 };
        if (existing?.avatar_sha256 !== sha256) await deps.storage!.putStaging(avatar.key, bytes, 'image/webp');
      }
      if (existing) {
        await sql.query(`update brand_shortlist_candidates set
            display_name=coalesce($2,display_name), category=coalesce($3,category),
            metrics=case when $4 then $5::jsonb else metrics end,
            measured_on=case when $4 then $6::date else measured_on end,
            avatar_key=coalesce($7,avatar_key), avatar_mime=case when $7::text is null then avatar_mime else 'image/webp' end,
            avatar_size=coalesce($8,avatar_size), avatar_sha256=coalesce($9,avatar_sha256), updated_at=now()
          where id=$1`,
          [id, c.displayName ?? null, c.category ?? null, fresh, JSON.stringify(metrics), v.measuredOn ?? null, avatar?.key ?? null, avatar?.size ?? null, avatar?.sha256 ?? null]);
        updated++;
      } else {
        await sql.query(`insert into brand_shortlist_candidates(id,project_id,platform,handle,display_name,category,metrics,measured_on,avatar_key,avatar_mime,avatar_size,avatar_sha256)
          values($1,$2,$3,$4,$5,$6,$7::jsonb,$8::date,$9,$10,$11,$12)`,
          [id, v.projectId, c.platform, c.handle, c.displayName ?? null, c.category ?? null, JSON.stringify(metrics), fresh ? v.measuredOn ?? null : null,
            avatar?.key ?? null, avatar ? 'image/webp' : null, avatar?.size ?? null, avatar?.sha256 ?? null]);
        added++;
      }
    }
    await sql.query('update brand_projects set updated_at=now() where id=$1', [v.projectId]);
    return { id: v.projectId, added, updated };
  });
}

/** What the brand (or the TWINGS team's read view) sees: shared candidates only, biggest first. */
export async function loadBrandShortlist(deps: { sql: SqlRunner; verifiedEmail?: string }, viewer: Viewer, projectId: string): Promise<BrandShortlistView | null> {
  if (!uuid(viewer.userId) || !uuid(projectId)) return null;
  try {
    return await deps.sql.transaction(async sql => {
      const seat = await brandProjectSeat(sql, viewer.userId!, projectId, deps.verifiedEmail);
      if (!seat) return null;
      const rows = (await sql.query(`select ${COLUMNS} from brand_shortlist_candidates where project_id=$1 and shared_at is not null ${ORDER}`, [projectId])).rows;
      return { candidates: rows.map(candidate), canPick: seat.role !== 'studio' && seat.canComment && seat.status !== 'cancelled' };
    });
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}

/** The studio's list for /admin: every candidate, hidden ones included. */
export async function loadStudioShortlist(deps: { sql: SqlRunner }, viewer: Viewer, projectId: string): Promise<StudioShortlistView | null> {
  if (!uuid(projectId)) return null;
  try {
    return await deps.sql.transaction(async sql => {
      await requireStudio(sql, viewer.userId);
      const rows = (await sql.query(`select ${COLUMNS} from brand_shortlist_candidates where project_id=$1 ${ORDER}`, [projectId])).rows;
      return { candidates: rows.map(studioCandidate) };
    });
  } catch (error) {
    if (error instanceof Denied || missingTable(error)) return null;
    throw error;
  }
}

/** Show or hide one candidate, or every candidate of the campaign at once. */
export async function setShortlistShared(deps: { sql: SqlRunner }, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; changed: number }>> {
  const parsed = ShortlistShareSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return run(deps.sql, async sql => {
    await requireStudio(sql, viewer.userId);
    const target = v.candidateId ? 'and id=$2' : '';
    const params: unknown[] = v.candidateId ? [v.projectId, v.candidateId] : [v.projectId];
    const rows = (await sql.query(v.shared
      ? `update brand_shortlist_candidates set shared_at=coalesce(shared_at,now()),updated_at=now() where project_id=$1 ${target} and shared_at is null returning id`
      : `update brand_shortlist_candidates set shared_at=null,updated_at=now() where project_id=$1 ${target} and shared_at is not null returning id`, params)).rows;
    if (v.candidateId && rows.length === 0) {
      const exists = (await sql.query('select 1 from brand_shortlist_candidates where project_id=$1 and id=$2', params)).rows[0];
      if (!exists) throw new Denied('not_found');
    }
    return { id: v.projectId, changed: rows.length };
  });
}

/** Take a candidate off the campaign. The stored picture stays (storage has no delete); nothing points at it. */
export async function removeShortlistCandidate(deps: { sql: SqlRunner }, viewer: Viewer, input: unknown): Promise<BrandOutcome> {
  const parsed = ShortlistRemoveSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  return run(deps.sql, async sql => {
    await requireStudio(sql, viewer.userId);
    const rows = (await sql.query('delete from brand_shortlist_candidates where project_id=$1 and id=$2 returning id', [v.projectId, v.candidateId])).rows;
    if (rows.length === 0) throw new Denied('not_found');
    return { id: v.projectId };
  });
}

/**
 * The brand's one control: mark or unmark a shared candidate as preferred. Owners, editors and
 * campaign guests invited to comment may; organization viewers, read-only guests and the TWINGS
 * team's view may not. A candidate the brand cannot see is `not_found`.
 */
export async function pickShortlistCandidate(deps: { sql: SqlRunner; verifiedEmail?: string }, viewer: Viewer, input: unknown): Promise<BrandOutcome<{ id: string; picked: boolean }>> {
  const parsed = ShortlistPickSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const v = parsed.data;
  if (!uuid(viewer.userId)) return fail('sign_in_required');
  return run(deps.sql, async sql => {
    const row = (await sql.query('select id,project_id,shared_at from brand_shortlist_candidates where id=$1 for update', [v.candidateId])).rows[0];
    if (!row || row.shared_at == null) throw new Denied('not_found');
    const seat = await brandProjectSeat(sql, viewer.userId!, String(row.project_id), deps.verifiedEmail);
    if (!seat) throw new Denied('not_found');
    if (seat.role === 'studio' || !seat.canComment) throw new Denied('forbidden');
    if (seat.status === 'cancelled') throw new Denied('not_active');
    if (v.picked) await sql.query('update brand_shortlist_candidates set picked_at=coalesce(picked_at,now()),picked_by=case when picked_at is null then $2 else picked_by end where id=$1', [v.candidateId, viewer.userId]);
    else await sql.query('update brand_shortlist_candidates set picked_at=null,picked_by=null where id=$1', [v.candidateId]);
    return { id: v.candidateId, picked: v.picked };
  });
}

/** The picture behind `shortlistAvatarPath`, re-authorized on every request. */
export async function loadShortlistAvatarAccess(deps: { sql: SqlRunner; verifiedEmail?: string }, viewer: Viewer, candidateId: string): Promise<ShortlistAvatarAccess | null> {
  if (!uuid(viewer.userId) || !uuid(candidateId)) return null;
  try {
    return await deps.sql.transaction(async sql => {
      const row = (await sql.query('select project_id,shared_at,avatar_key,avatar_mime,avatar_size,avatar_sha256 from brand_shortlist_candidates where id=$1', [candidateId])).rows[0];
      if (!row?.avatar_key) return null;
      const admin = (await sql.query('select is_admin from profiles where id=$1', [viewer.userId])).rows[0]?.is_admin === true;
      if (!admin) {
        if (row.shared_at == null) return null;
        if (!await brandProjectSeat(sql, viewer.userId!, String(row.project_id), deps.verifiedEmail)) return null;
      }
      return { key: String(row.avatar_key), mime: String(row.avatar_mime), sizeBytes: Number(row.avatar_size), sha256: String(row.avatar_sha256) };
    });
  } catch (error) {
    if (missingTable(error)) return null;
    throw error;
  }
}
