/**
 * Shot-sheet (`brand_studio_assets.film_sheets`) cache lifecycle (docs/STUDIO-PRO-SUITE-V4.md §1.3).
 *
 * Keeps reference-video reading fast without unbounded JSONB growth:
 *  - Stores compact structured `FilmSheet` JSON only (never base64 frame galleries).
 *  - 14-day sliding TTL (`film_sheets_expires_at = now() + 14 days`) refreshed on every cache hit.
 *  - Expired entries are cleared on read and via opportunistic `sweepExpiredFilmSheets`.
 *  - Completing, archiving, or deleting a Video Studio project calls `purgeProjectFilmSheets`, which
 *    immediately clears `film_sheets` on that project's reference videos unless another active project
 *    still references the same asset ID in its `timeline`.
 *  - Tolerates older DB schemas where `film_sheets_expires_at` / `film_sheets_updated_at` (or `film_sheets`)
 *    have not been migrated yet.
 */
import type { FilmDepth, FilmSheet } from '@/lib/brand-studio/contracts';
import type { SqlRunner } from '@/lib/db/sql-runner';

export const FILM_SHEET_TTL_DAYS = 14;
export const FILM_SHEET_TTL_MS = FILM_SHEET_TTL_DAYS * 24 * 60 * 60 * 1000;

const UNDEFINED_COLUMN = '42703';
const UNDEFINED_TABLE = '42P01';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA_URI_RE = /data:(?:image|video|audio)\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi;

function isMissingColumn(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === UNDEFINED_COLUMN) return true;
  const message = error instanceof Error ? error.message : '';
  return /column .* does not exist/i.test(message);
}

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === UNDEFINED_TABLE) return true;
  const message = error instanceof Error ? error.message : '';
  return /relation .* does not exist/i.test(message);
}

function parseTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function scrubBase64(text: string | undefined): string {
  if (!text) return '';
  return text.replace(DATA_URI_RE, '').replace(/\s+/g, ' ').trim();
}

export function filmSheetCacheKey(locale: 'ko' | 'en', depth: FilmDepth = 'basic'): string {
  return depth === 'basic' ? locale : `${depth}:${locale}`;
}

export function nextFilmSheetExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + FILM_SHEET_TTL_MS);
}

export function isFilmSheetExpired(expiresAt: unknown, now: Date = new Date()): boolean {
  const parsed = parseTimestamp(expiresAt);
  return parsed !== null && parsed.getTime() < now.getTime();
}

/**
 * Strips any accidental base64 data URIs or extra frame-gallery properties so only compact structured
 * shot-sheet JSON is persisted in `brand_studio_assets.film_sheets`.
 */
export function compactFilmSheet(sheet: FilmSheet): FilmSheet {
  const shots = sheet.shots.map((shot) => ({
    start: shot.start,
    end: shot.end,
    framing: scrubBase64(shot.framing),
    camera: scrubBase64(shot.camera),
    action: scrubBase64(shot.action),
    ...(shot.transition ? { transition: scrubBase64(shot.transition) } : {}),
    ...(shot.move
      ? {
          move: {
            travel: scrubBase64(shot.move.travel),
            turn: scrubBase64(shot.move.turn),
            zoom: scrubBase64(shot.move.zoom),
          },
        }
      : {}),
  }));

  const subjects = sheet.subjects
    ?.map((subject) => ({
      id: scrubBase64(subject.id),
      what: scrubBase64(subject.what),
      count: subject.count,
    }))
    .filter((subject) => subject.what.length > 0);

  const setting = scrubBase64(sheet.setting);

  return {
    seconds: sheet.seconds,
    aspect: scrubBase64(sheet.aspect),
    shots,
    look: {
      lighting: scrubBase64(sheet.look.lighting),
      palette: scrubBase64(sheet.look.palette),
      texture: scrubBase64(sheet.look.texture),
    },
    audio: {
      music: Boolean(sheet.audio.music),
      speech: Boolean(sheet.audio.speech),
      effects: scrubBase64(sheet.audio.effects),
    },
    summary: scrubBase64(sheet.summary),
    ...(subjects && subjects.length > 0 ? { subjects } : {}),
    ...(setting ? { setting } : {}),
  };
}

export function extractStoredFilmSheet(
  filmSheets: unknown,
  locale: 'ko' | 'en',
  depth: FilmDepth = 'basic',
): FilmSheet | null {
  if (!filmSheets || typeof filmSheets !== 'object') return null;
  const candidate = (filmSheets as Record<string, unknown>)[filmSheetCacheKey(locale, depth)];
  if (!candidate || typeof candidate !== 'object') return null;
  const typed = candidate as Partial<FilmSheet>;
  if (typeof typed.summary !== 'string' || !Array.isArray(typed.shots)) return null;
  return compactFilmSheet(typed as FilmSheet);
}

async function clearAssetFilmSheetColumns(sql: SqlRunner, assetId: string, organizationId: string): Promise<void> {
  try {
    await sql.query(
      `update brand_studio_assets
          set film_sheets = null,
              film_sheets_updated_at = null,
              film_sheets_expires_at = null
        where id = $1 and organization_id = $2`,
      [assetId, organizationId],
    );
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    try {
      await sql.query(
        'update brand_studio_assets set film_sheets = null where id = $1 and organization_id = $2',
        [assetId, organizationId],
      );
    } catch (innerError) {
      if (!isMissingColumn(innerError)) throw innerError;
    }
  }
}

/**
 * Reads a cached `FilmSheet` from `brand_studio_assets`:
 *  - Tolerates pre-0087 / pre-0077 schemas where TTL or `film_sheets` columns are absent.
 *  - Clears the cache and returns `null` when `film_sheets_expires_at < now`.
 *  - Slides `film_sheets_expires_at` forward by 14 days on a valid cache hit.
 */
export async function readCachedFilmSheet(
  sql: SqlRunner,
  input: {
    organizationId: string;
    assetId: string;
    locale: 'ko' | 'en';
    depth?: FilmDepth;
    now?: Date;
  },
): Promise<FilmSheet | null> {
  const now = input.now ?? new Date();
  const depth = input.depth ?? 'basic';
  let hasTtlColumns = true;
  let row: { film_sheets?: unknown; film_sheets_expires_at?: unknown } | undefined;

  try {
    row = (
      await sql.query<{ film_sheets: unknown; film_sheets_expires_at: unknown }>(
        `select film_sheets, film_sheets_expires_at
           from brand_studio_assets
          where id = $1 and organization_id = $2`,
        [input.assetId, input.organizationId],
      )
    ).rows[0];
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    hasTtlColumns = false;
    try {
      row = (
        await sql.query<{ film_sheets: unknown }>(
          'select film_sheets from brand_studio_assets where id = $1 and organization_id = $2',
          [input.assetId, input.organizationId],
        )
      ).rows[0];
    } catch (innerError) {
      if (isMissingColumn(innerError)) return null;
      throw innerError;
    }
  }

  if (!row || row.film_sheets == null) return null;

  if (hasTtlColumns && isFilmSheetExpired(row.film_sheets_expires_at, now)) {
    await clearAssetFilmSheetColumns(sql, input.assetId, input.organizationId);
    return null;
  }

  const sheet = extractStoredFilmSheet(row.film_sheets, input.locale, depth);
  if (!sheet) return null;

  if (hasTtlColumns) {
    const nextExpires = nextFilmSheetExpiry(now).toISOString();
    try {
      await sql.query(
        `update brand_studio_assets
            set film_sheets_expires_at = $3::timestamptz
          where id = $1 and organization_id = $2`,
        [input.assetId, input.organizationId, nextExpires],
      );
    } catch (error) {
      if (!isMissingColumn(error)) throw error;
    }
  }

  return sheet;
}

/**
 * Stores a newly analyzed compact `FilmSheet` and stamps `film_sheets_updated_at = now` and
 * `film_sheets_expires_at = now + 14 days` (falling back cleanly on pre-0087 schemas).
 */
export async function writeCachedFilmSheet(
  sql: SqlRunner,
  input: {
    organizationId: string;
    assetId: string;
    locale: 'ko' | 'en';
    sheet: FilmSheet;
    depth?: FilmDepth;
    now?: Date;
  },
): Promise<void> {
  const now = input.now ?? new Date();
  const depth = input.depth ?? 'basic';
  const compact = compactFilmSheet(input.sheet);
  const key = filmSheetCacheKey(input.locale, depth);
  const payload = JSON.stringify(compact);
  const updatedAt = now.toISOString();
  const expiresAt = nextFilmSheetExpiry(now).toISOString();

  try {
    await sql.query(
      `update brand_studio_assets
          set film_sheets = coalesce(film_sheets, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb),
              film_sheets_updated_at = $5::timestamptz,
              film_sheets_expires_at = $6::timestamptz
        where id = $1 and organization_id = $2`,
      [input.assetId, input.organizationId, key, payload, updatedAt, expiresAt],
    );
  } catch (error) {
    if (!isMissingColumn(error)) throw error;
    try {
      await sql.query(
        `update brand_studio_assets
            set film_sheets = coalesce(film_sheets, '{}'::jsonb) || jsonb_build_object($3::text, $4::jsonb)
          where id = $1 and organization_id = $2`,
        [input.assetId, input.organizationId, key, payload],
      );
    } catch (innerError) {
      if (!isMissingColumn(innerError)) throw innerError;
    }
  }
}

/** Sweeps all expired `film_sheets` across `brand_studio_assets`. Returns the count cleared. */
export async function sweepExpiredFilmSheets(sql: SqlRunner, now: Date = new Date()): Promise<number> {
  try {
    const result = await sql.query<{ id: string }>(
      `update brand_studio_assets
          set film_sheets = null,
              film_sheets_updated_at = null,
              film_sheets_expires_at = null
        where film_sheets is not null
          and film_sheets_expires_at is not null
          and film_sheets_expires_at < $1::timestamptz
        returning id`,
      [now.toISOString()],
    );
    return result.rows.length;
  } catch (error) {
    if (isMissingColumn(error) || isMissingTable(error)) return 0;
    throw error;
  }
}

async function hasVideoProjectsTable(sql: SqlRunner): Promise<boolean> {
  try {
    const row = (
      await sql.query<{ t: string | null }>(
        "select to_regclass('public.brand_studio_video_projects')::text as t",
      )
    ).rows[0];
    return Boolean(row?.t);
  } catch {
    return false;
  }
}

/**
 * Purges cached `film_sheets` on `assetIds` when a Video Studio project completes, is archived, or is
 * deleted — unless another active, non-deleted `brand_studio_video_projects` row in the same organization
 * still references that asset ID in its `timeline`.
 */
export async function purgeProjectFilmSheets(
  sql: SqlRunner,
  organizationId: string,
  assetIds: readonly string[],
  completedProjectId?: string,
): Promise<number> {
  if (!UUID_RE.test(organizationId)) return 0;
  const validIds = [...new Set(assetIds.map((id) => id.trim()).filter((id) => UUID_RE.test(id)))];
  if (validIds.length === 0) return 0;
  const excludedProjectId = completedProjectId && UUID_RE.test(completedProjectId) ? completedProjectId : null;

  const projectsTableReady = await hasVideoProjectsTable(sql);

  const runClear = async (withTtlCols: boolean): Promise<number> => {
    const setClause = withTtlCols
      ? 'film_sheets = null, film_sheets_updated_at = null, film_sheets_expires_at = null'
      : 'film_sheets = null';

    if (projectsTableReady) {
      const res = await sql.query<{ id: string }>(
        `update brand_studio_assets a
            set ${setClause}
          where a.organization_id = $1
            and a.id = any($2::uuid[])
            and a.film_sheets is not null
            and not exists (
              select 1
                from brand_studio_video_projects p
               where p.organization_id = $1
                 and p.status = 'active'
                 and p.deleted_at is null
                 and ($3::uuid is null or p.id <> $3::uuid)
                 and strpos(lower(p.timeline::text), lower(a.id::text)) > 0
            )
          returning a.id`,
        [organizationId, validIds, excludedProjectId],
      );
      return res.rows.length;
    }

    const res = await sql.query<{ id: string }>(
      `update brand_studio_assets a
          set ${setClause}
        where a.organization_id = $1
          and a.id = any($2::uuid[])
          and a.film_sheets is not null
        returning a.id`,
      [organizationId, validIds],
    );
    return res.rows.length;
  };

  try {
    return await runClear(true);
  } catch (error) {
    if (isMissingTable(error)) return 0;
    if (!isMissingColumn(error)) throw error;
    try {
      return await runClear(false);
    } catch (innerError) {
      if (isMissingColumn(innerError) || isMissingTable(innerError)) return 0;
      throw innerError;
    }
  }
}
