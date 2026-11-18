/**
 * A film's frame rate on its studio asset (migration 0096, docs/BRAND-ROOMS-FEEDBACK.md §11). The code ships
 * before the column exists in production, so every read and write asks here first and leaves the column
 * alone until it is there. A positive answer is remembered (a schema does not go back); a negative one is
 * asked again, so applying 0096 needs no redeploy.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { FPS_MAX, FPS_MIN } from './review-frames';

let fpsSeen = false;
export async function assetFpsReady(sql: SqlRunner): Promise<boolean> {
  if (fpsSeen) return true;
  const { rows } = await sql.query<{ ready: boolean }>(
    `select exists (select 1 from pg_attribute where attrelid = to_regclass('public.brand_studio_assets')
                      and attname = 'fps' and not attisdropped) as ready`,
  );
  fpsSeen = rows[0]?.ready === true;
  return fpsSeen;
}

/** A rate the column accepts, or null (the check is 1–240). */
export function storableFps(fps: number | null | undefined): number | null {
  return fps != null && Number.isFinite(fps) && fps >= FPS_MIN && fps <= FPS_MAX ? Math.round(fps * 1000) / 1000 : null;
}

/**
 * Write the measured rate onto an asset when the column exists and the asset has none yet (a file
 * delivered again keeps the first measurement). The value is held to the column's range first, so this
 * update cannot trip the check inside the caller's transaction.
 */
export async function recordAssetFps(sql: SqlRunner, assetId: string, fps: number | null | undefined): Promise<void> {
  const value = storableFps(fps);
  if (value == null || !(await assetFpsReady(sql))) return;
  await sql.query('update brand_studio_assets set fps = $2 where id = $1 and fps is null', [assetId, value]);
}
