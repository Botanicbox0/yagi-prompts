/**
 * Cross-table physical cleanup for `StudioMediaStore` (`st/...` keys in R2 / local `.storage/content`).
 *
 * Keeps `StorageDriver` (`lib/storage/index.ts`) strictly write-once and never touches existing production
 * files in bulk: this module runs ONLY after a single customer/staff delete commits, checking every live
 * reference table (`brand_studio_assets`, `brand_studio_outputs`, `brand_studio_jobs` region patches for
 * live outputs, `brand_storyboard_frames` on non-deleted boards, and `brand_room_messages` attachments on
 * non-deleted messages) before deleting an unreferenced `st/...` object.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';
import { isStudioMediaKey, type StudioMediaStore } from './media-store';

export interface PhysicalCleanupExclusion {
  assetId?: string;
  outputId?: string;
  frameId?: string;
  storyboardId?: string;
  messageId?: string;
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

async function tableExists(sql: SqlRunner, table: string): Promise<boolean> {
  const row = (await sql.query<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`])).rows[0];
  return Boolean(row?.t);
}

/** True when any live record across Studio or Project Rooms still references `key`. */
export async function isStudioMediaKeyReferenced(
  sql: SqlRunner,
  key: string,
  except: PhysicalCleanupExclusion = {},
): Promise<boolean> {
  if (!key || !isStudioMediaKey(key)) return false;

  if (await tableExists(sql, 'brand_studio_assets')) {
    const assetHit = (
      await sql.query(
        `select 1 from brand_studio_assets
          where deleted_at is null
            and (storage_key = $1 or thumb_key = $1)
            and id <> coalesce($2::uuid, '${ZERO_UUID}'::uuid)
          limit 1`,
        [key, except.assetId ?? null],
      )
    ).rows[0];
    if (assetHit) return true;
  }

  if (await tableExists(sql, 'brand_studio_outputs')) {
    const outputHit = (
      await sql.query(
        `select 1 from brand_studio_outputs
          where deleted_at is null
            and (storage_key = $1 or thumb_key = $1)
            and id <> coalesce($2::uuid, '${ZERO_UUID}'::uuid)
          limit 1`,
        [key, except.outputId ?? null],
      )
    ).rows[0];
    if (outputHit) return true;

    if (await tableExists(sql, 'brand_studio_jobs')) {
      const patchHit = (
        await sql.query(
          `select 1
             from brand_studio_outputs o
             join brand_studio_jobs j on j.id = o.job_id
            where o.deleted_at is null
              and o.id <> coalesce($2::uuid, '${ZERO_UUID}'::uuid)
              and (
                j.work -> 'region' -> 'patches' -> (o.idx::text) ->> 'patchKey' = $1
                or j.work -> 'region' -> 'patches' -> (o.idx::text) ->> 'maskKey' = $1
              )
            limit 1`,
          [key, except.outputId ?? null],
        )
      ).rows[0];
      if (patchHit) return true;
    }
  }

  if ((await tableExists(sql, 'brand_storyboard_frames')) && (await tableExists(sql, 'brand_storyboards'))) {
    const frameHit = (
      await sql.query(
        `select 1
           from brand_storyboard_frames f
           join brand_storyboards b on b.id = f.storyboard_id
          where b.deleted_at is null
            and b.id <> coalesce($3::uuid, '${ZERO_UUID}'::uuid)
            and f.id <> coalesce($2::uuid, '${ZERO_UUID}'::uuid)
            and (f.storage_key = $1 or f.thumb_key = $1)
          limit 1`,
        [key, except.frameId ?? null, except.storyboardId ?? null],
      )
    ).rows[0];
    if (frameHit) return true;
  }

  if (await tableExists(sql, 'brand_room_messages')) {
    const msgHit = (
      await sql.query(
        `select 1
           from brand_room_messages m
          where m.deleted_at is null
            and m.id <> coalesce($2::uuid, '${ZERO_UUID}'::uuid)
            and exists (
              select 1
                from jsonb_array_elements(
                  case when jsonb_typeof(m.attachments) = 'array' then m.attachments else '[]'::jsonb end
                ) elem
               where elem ->> 'key' = $1
            )
          limit 1`,
        [key, except.messageId ?? null],
      )
    ).rows[0];
    if (msgHit) return true;
  }

  return false;
}

/**
 * Best-effort physical deletion for `st/...` keys after a DB delete transaction commits.
 * Logs transient storage errors without failing the caller's completed response.
 */
export async function dropUnreferencedStudioKeys(
  sql: SqlRunner,
  media: StudioMediaStore,
  keys: ReadonlyArray<string | null | undefined>,
  except: PhysicalCleanupExclusion = {},
  log?: (event: string, fields?: Record<string, unknown>) => void,
): Promise<string[]> {
  const deletedKeys: string[] = [];
  for (const key of new Set(keys)) {
    if (!key || !isStudioMediaKey(key)) continue;
    try {
      if (!(await isStudioMediaKeyReferenced(sql, key, except))) {
        await media.delete(key);
        deletedKeys.push(key);
      }
    } catch (error) {
      log?.('studio_media_delete_failed', {
        key,
        message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
      });
    }
  }
  return deletedKeys;
}
