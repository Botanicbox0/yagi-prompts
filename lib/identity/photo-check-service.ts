import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import type { PhotoChecker } from './photo-check';
import { parsePhotoCheck, type PhotoCheck } from './photo-check-view';

/**
 * One advisory check per saved photo (0089: `identity_selfies.photo_check`, `photo_checked_at`).
 * The first ask runs the checker and stores the verdict; every later ask reads it back. A failed
 * check (null) is not stored, so the next page visit may ask again — never this one (the client
 * remembers its answer and does not retry).
 *
 * Reading the bytes here is not "using" the photo for an order: `last_used_at` does not move.
 */
export interface PhotoCheckDeps { sql: SqlRunner; store: RenderStore; check: PhotoChecker | null; now?: Date }
export type PhotoCheckResult = { ok: true; check: PhotoCheck | null } | { ok: false; code: 'off' | 'not_found' };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True once 0089 is applied. Before that the check stays off and nothing is written. */
export async function photoCheckSchemaReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int n from information_schema.columns
      where table_schema = current_schema() and table_name = 'identity_selfies' and column_name in ('photo_check', 'photo_checked_at')`,
  );
  return rows[0]?.n === 2;
}

export async function selfiePhotoCheck(d: PhotoCheckDeps, userId: string, id: string): Promise<PhotoCheckResult> {
  if (!d.check) return { ok: false, code: 'off' };
  if (!uuid.test(id)) return { ok: false, code: 'not_found' };
  if (!await photoCheckSchemaReady(d.sql)) return { ok: false, code: 'off' };
  // Only an ACTIVE photo of its owner: a stranger's, a replaced or a deleted one is not found.
  const row = (await d.sql.query<{ id: string; input_key: string; photo_check: unknown }>(
    'select id, input_key, photo_check from identity_selfies where id=$1 and user_id=$2 and deleted_at is null and replaced_at is null',
    [id, userId],
  )).rows[0];
  if (!row) return { ok: false, code: 'not_found' };
  const stored = parsePhotoCheck(row.photo_check);
  if (stored) return { ok: true, check: stored };
  let bytes: Uint8Array;
  try { bytes = await d.store.read(row.input_key); } catch { return { ok: true, check: null }; }
  const check = await d.check(bytes);
  if (!check) return { ok: true, check: null };
  await d.sql.query(
    'update identity_selfies set photo_check=$3::jsonb, photo_checked_at=$4 where id=$1 and user_id=$2 and photo_check is null',
    [row.id, userId, JSON.stringify(check), d.now ?? new Date()],
  );
  return { ok: true, check };
}
