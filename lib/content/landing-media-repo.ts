import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicContentUrl } from '@/lib/content/asset-url';
import { landingMediaSlot, type LandingMedia } from './landing-media';

/**
 * Landing media overrides (lib/content/landing-media.ts) — the rows and the URLs they become.
 *
 * Rows live in `landing_media` (0067). Before that migration reaches a database the table is simply
 * missing, and that is read as "no overrides": the pages keep their files exactly as before. The
 * cached projection the pages use is `getLandingMedia()` in ./landing-media-server.
 */

export interface LandingMediaRow {
  slot: string;
  objectKey: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  originalName: string | null;
  updatedAt: string;
}

const missingTable = (error: unknown) => (error as { code?: string }).code === '42P01';

export async function loadLandingMediaRows(sql: SqlRunner): Promise<LandingMediaRow[]> {
  try {
    const { rows } = await sql.query<{
      slot: string; object_key: string; mime: string; width: number; height: number;
      size_bytes: number; original_name: string | null; updated_at: Date | string;
    }>('select slot, object_key, mime, width, height, size_bytes, original_name, updated_at from landing_media order by slot');
    return rows.map((row) => ({
      slot: row.slot,
      objectKey: row.object_key,
      mime: row.mime,
      width: row.width,
      height: row.height,
      sizeBytes: row.size_bytes,
      originalName: row.original_name,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  } catch (error) {
    if (missingTable(error)) return [];
    throw error;
  }
}

/** The admin says so when 0067 has not reached this database yet, instead of failing on save. */
export async function landingMediaTableExists(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ present: boolean }>("select to_regclass('public.landing_media') is not null as present");
  return Boolean(rows[0]?.present);
}

/**
 * Where the browser fetches an override. On a Supabase project that is the public bucket itself
 * (content-addressed, so it never goes stale); in local mode nothing serves `.storage/` over HTTP,
 * so the same-origin route streams it, versioned by the content hash.
 */
export function landingMediaUrl(row: Pick<LandingMediaRow, 'slot' | 'objectKey'>, baseUrl?: string): string {
  const cdn = baseUrl === undefined ? publicContentUrl(row.objectKey) : publicContentUrl(row.objectKey, baseUrl);
  return cdn ?? `/api/landing-media/${row.slot}?v=${row.objectKey.slice(0, 12)}`;
}

/** Rows → `{ slot: url }`, keeping only slots the registry still knows. */
export function landingMediaMap(rows: readonly LandingMediaRow[], baseUrl?: string): LandingMedia {
  const map: Record<string, string> = {};
  for (const row of rows) if (landingMediaSlot(row.slot)) map[row.slot] = landingMediaUrl(row, baseUrl);
  return Object.freeze(map);
}

