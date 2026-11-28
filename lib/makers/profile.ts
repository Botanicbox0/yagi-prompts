import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  CITY_MAX, DISPLAY_NAME_MAX, HEADLINE_MAX, countryOf, emailOf, lineOf, linksOf, storedLinks, toolsOf, type MakerLink,
} from './fields';

/**
 * docs/PLATFORM-2.0.md §7.5·§14.1·§20 — an AI creative's public identity: a handle, a short bio and
 * an explicit opt-in (0060), and since 0065 a name, a one-line headline, where they work, their
 * links, an optional public email, their tools, whether they take brand work and an avatar, and since
 * 0071 a cover image. All of it reaches a public page only while `public_profile` is on; `user_id` and
 * the account email never do.
 *
 * `prompt_items.author_handle` follows the opt-in in the database itself (0060's triggers), so this
 * module only writes `platform_creators` and the catalogue only reads the column.
 */

export const MAKER_HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
export const MAKER_BIO_MAX = 200;

/** Names that would read as the studio speaking. Not a moderation list — just no impersonation (`@yagi` is the founder's own creative handle). */
const RESERVED_HANDLES = new Set(['admin', 'administrator', 'twings', 'yagiworkshop', 'studio', 'official', 'support', 'help', 'staff', 'makers', 'maker', 'creative', 'creatives']);

export type MakerProfileErrorCode =
  | 'invalid_handle' | 'reserved_handle' | 'invalid_bio' | 'handle_required' | 'handle_taken' | 'not_maker' | 'unavailable'
  | 'invalid_name' | 'invalid_headline' | 'invalid_country' | 'invalid_city' | 'invalid_links' | 'invalid_email' | 'invalid_tools';

export class MakerProfileError extends Error {
  constructor(readonly code: MakerProfileErrorCode) {
    super(code);
    this.name = 'MakerProfileError';
  }
}

/** `@Jun_01 ` → `jun_01`. Anything outside 3–20 lowercase letters, digits and underscores is null. */
export function makerHandleOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const handle = value.trim().replace(/^@/, '').toLowerCase();
  return MAKER_HANDLE_PATTERN.test(handle) ? handle : null;
}

export function isReservedMakerHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle);
}

/** Empty means "no bio" (null). Control characters other than a line break are refused. */
export function makerBioOf(value: unknown): { ok: true; bio: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, bio: null };
  if (typeof value !== 'string') return { ok: false };
  const bio = value.trim().replace(/\r\n?/g, '\n');
  if (bio === '') return { ok: true, bio: null };
  if ([...bio].length > MAKER_BIO_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(bio)) return { ok: false };
  return { ok: true, bio };
}

/** 0060 is applied separately from the code. Every caller must keep working without it. */
export async function makerProfilesReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(
    `select (select count(*) from pg_attribute where attrelid = to_regclass('public.platform_creators')
               and attname in ('handle', 'public_profile', 'bio') and not attisdropped) = 3 as ready`,
  );
  return rows[0]?.ready === true;
}

/** 0071 — the cover image. Readers see the column through `to_jsonb`; only a write needs this probe. */
export async function creativeCoverReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(
    `select exists (select 1 from pg_attribute where attrelid = to_regclass('public.platform_creators')
               and attname = 'cover_key' and not attisdropped) as ready`,
  );
  return rows[0]?.ready === true;
}

/** 0065 — the full creative profile, works, recipe opens and access tokens. Probed, never assumed. */
export async function creativeProfilesReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(
    `select (select count(*) from pg_attribute where attrelid = to_regclass('public.platform_creators')
               and attname in ('display_name', 'links', 'avatar_key') and not attisdropped) = 3
            and to_regclass('public.maker_works') is not null and to_regclass('public.maker_tokens') is not null
            and to_regclass('public.recipe_unlocks') is not null as ready`,
  );
  return rows[0]?.ready === true;
}

export interface MakerSettings {
  handle: string | null;
  bio: string | null;
  publicProfile: boolean;
  displayName: string | null;
  headline: string | null;
  country: string | null;
  city: string | null;
  links: MakerLink[];
  publicEmail: string | null;
  tools: string[];
  openToBrands: boolean;
  /** The avatar's cache key (hex), or null with none. The storage key itself never leaves the server. */
  avatarVersion: string | null;
  /** The cover's cache key (hex), or null with none (0071). */
  coverVersion: string | null;
  /** False until 0071 is applied: the studio then offers no cover. */
  coverReady: boolean;
  /** False until 0065 is applied: the studio then offers only handle, bio and the opt-in. */
  extended: boolean;
}

interface SettingsRow {
  handle: string | null; bio: string | null; public_profile: boolean;
  display_name?: string | null; headline?: string | null; country?: string | null; city?: string | null; links?: unknown;
  public_email?: string | null; tools?: string[] | null; open_to_brands?: boolean; avatar_key?: string | null;
  cover_key?: string | null; cover_ready?: boolean;
}

const BASE_COLUMNS = 'handle, bio, public_profile';
// 0071's cover through to_jsonb (the table is aliased `c`): no probe, and a database without the column reads "no cover".
const EXTENDED_COLUMNS = `${BASE_COLUMNS}, display_name, headline, country, city, links, public_email, tools, open_to_brands, avatar_key,
  to_jsonb(c.*)->>'cover_key' as cover_key, (to_jsonb(c.*) -> 'cover_key') is not null as cover_ready`;

/** `{uuid}/avatar_<hex>.jpg` → `<hex>`: a public cache key that says nothing about the account. */
export function avatarVersionOf(key: string | null | undefined): string | null {
  const match = key ? /\/avatar_([0-9a-f]{16,32})\.[a-z0-9]{2,5}$/.exec(key) : null;
  return match ? match[1]! : null;
}

/** `{uuid}/cover_<hex>.jpg` → `<hex>`, like the avatar's. */
export function coverVersionOf(key: string | null | undefined): string | null {
  const match = key ? /\/cover_([0-9a-f]{16,32})\.jpg$/.exec(key) : null;
  return match ? match[1]! : null;
}

function toSettings(row: SettingsRow, extended: boolean): MakerSettings {
  return {
    handle: row.handle,
    bio: row.bio,
    publicProfile: row.public_profile,
    displayName: row.display_name ?? null,
    headline: row.headline ?? null,
    country: row.country ?? null,
    city: row.city ?? null,
    links: storedLinks(row.links),
    publicEmail: row.public_email ?? null,
    tools: Array.isArray(row.tools) ? row.tools : [],
    openToBrands: row.open_to_brands === true,
    avatarVersion: avatarVersionOf(row.avatar_key),
    coverVersion: coverVersionOf(row.cover_key),
    coverReady: row.cover_ready === true,
    extended,
  };
}

/** The maker's own settings. Null when the account is not an active maker (or 0060 is missing). */
export async function loadMakerSettings(sql: SqlRunner, userId: string): Promise<MakerSettings | null> {
  if (!(await makerProfilesReady(sql))) return null;
  const extended = await creativeProfilesReady(sql);
  const { rows } = await sql.query<SettingsRow>(
    `select ${extended ? EXTENDED_COLUMNS : BASE_COLUMNS} from platform_creators c where user_id = $1 and active`,
    [userId],
  );
  const row = rows[0];
  return row ? toSettings(row, extended) : null;
}

export interface MakerProfileInput {
  handle?: unknown; bio?: unknown; publicProfile?: unknown;
  displayName?: unknown; headline?: unknown; country?: unknown; city?: unknown; links?: unknown;
  publicEmail?: unknown; tools?: unknown; openToBrands?: unknown;
}

function must<T>(value: T | false, code: MakerProfileErrorCode): T {
  if (value === false) throw new MakerProfileError(code);
  return value;
}

/**
 * Every field re-validated here; the caller supplies only a server-verified user id. Turning the
 * profile on needs a handle; turning it off keeps the handle reserved for the maker. Fields 0065
 * adds are written only once 0065 exists, and are otherwise ignored rather than refused.
 */
export async function saveMakerProfile(sql: SqlRunner, userId: string, input: MakerProfileInput): Promise<MakerSettings> {
  if (!(await makerProfilesReady(sql))) throw new MakerProfileError('unavailable');
  const rawHandle = typeof input.handle === 'string' ? input.handle.trim() : '';
  const handle = rawHandle === '' ? null : makerHandleOf(rawHandle);
  if (rawHandle !== '' && handle !== null) {
    if (isReservedMakerHandle(handle)) {
      const existing = (await sql.query<{ handle: string | null }>('select handle from platform_creators where user_id = $1', [userId])).rows[0];
      if (existing?.handle !== handle) throw new MakerProfileError('reserved_handle');
    }
  } else if (rawHandle !== '') {
    throw new MakerProfileError('invalid_handle');
  }
  const bio = makerBioOf(input.bio);
  if (!bio.ok) throw new MakerProfileError('invalid_bio');
  const publicProfile = input.publicProfile === true;
  if (publicProfile && handle === null) throw new MakerProfileError('handle_required');

  const extended = await creativeProfilesReady(sql);
  const more = extended ? {
    displayName: must(lineOf(input.displayName, DISPLAY_NAME_MAX), 'invalid_name'),
    headline: must(lineOf(input.headline, HEADLINE_MAX), 'invalid_headline'),
    country: must(countryOf(input.country), 'invalid_country'),
    city: must(lineOf(input.city, CITY_MAX), 'invalid_city'),
    links: must(linksOf(input.links), 'invalid_links'),
    publicEmail: must(emailOf(input.publicEmail), 'invalid_email'),
    tools: must(toolsOf(input.tools), 'invalid_tools'),
    openToBrands: input.openToBrands === true,
  } : null;

  const taken = handle === null ? [] : (await sql.query<{ user_id: string }>(
    'select user_id from platform_creators where handle = $1 and user_id <> $2', [handle, userId],
  )).rows;
  if (taken.length > 0) throw new MakerProfileError('handle_taken');

  try {
    const { rows } = more
      ? await sql.query<SettingsRow>(
        `update platform_creators c set handle = $2, bio = $3, public_profile = $4, display_name = $5, headline = $6, country = $7,
                city = $8, links = $9::jsonb, public_email = $10, tools = $11::text[], open_to_brands = $12, profile_updated_at = now()
          where user_id = $1 and active returning ${EXTENDED_COLUMNS}`,
        [userId, handle, bio.bio, publicProfile, more.displayName, more.headline, more.country, more.city,
          JSON.stringify(more.links), more.publicEmail, more.tools, more.openToBrands],
      )
      : await sql.query<SettingsRow>(
        `update platform_creators set handle = $2, bio = $3, public_profile = $4
          where user_id = $1 and active returning ${BASE_COLUMNS}`,
        [userId, handle, bio.bio, publicProfile],
      );
    const row = rows[0];
    if (!row) throw new MakerProfileError('not_maker');
    return toSettings(row, extended);
  } catch (error) {
    // Two makers racing for one handle: the unique index decides, and the loser hears "taken".
    if (error instanceof MakerProfileError) throw error;
    if ((error as { code?: string }).code === '23505') throw new MakerProfileError('handle_taken');
    throw error;
  }
}

/** A partial change (the MCP tool): every field not named keeps its saved value. */
export async function patchMakerProfile(sql: SqlRunner, userId: string, patch: MakerProfileInput): Promise<MakerSettings> {
  const current = await loadMakerSettings(sql, userId);
  if (!current) throw new MakerProfileError('not_maker');
  const pick = <K extends keyof MakerProfileInput>(key: K, saved: unknown) => (Object.hasOwn(patch, key) && patch[key] !== undefined ? patch[key] : saved);
  return saveMakerProfile(sql, userId, {
    handle: pick('handle', current.handle ?? ''),
    bio: pick('bio', current.bio),
    publicProfile: pick('publicProfile', current.publicProfile),
    displayName: pick('displayName', current.displayName),
    headline: pick('headline', current.headline),
    country: pick('country', current.country),
    city: pick('city', current.city),
    links: pick('links', current.links),
    publicEmail: pick('publicEmail', current.publicEmail),
    tools: pick('tools', current.tools),
    openToBrands: pick('openToBrands', current.openToBrands),
  });
}

/** Internal shape for the catalogue loader. `userId` is a join key and is dropped before any DTO. */
export interface PublicMakerRow {
  userId: string;
  handle: string;
  bio: string | null;
  /** The English bio (0069) for `/en` pages; null without one or before 0069. */
  bioEn: string | null;
  displayName: string | null;
  headline: string | null;
  country: string | null;
  city: string | null;
  links: MakerLink[];
  publicEmail: string | null;
  tools: string[];
  openToBrands: boolean;
  avatarVersion: string | null;
  coverVersion: string | null;
}

export async function loadPublicMakerRows(sql: SqlRunner): Promise<PublicMakerRow[]> {
  if (!(await makerProfilesReady(sql))) return [];
  const extended = await creativeProfilesReady(sql);
  // to_jsonb: 0069 is applied separately, so `bio_en` is read without naming it.
  const { rows } = await sql.query<SettingsRow & { user_id: string; handle: string; bio_en: string | null }>(
    `select user_id, ${extended ? EXTENDED_COLUMNS : BASE_COLUMNS}, to_jsonb(c.*)->>'bio_en' as bio_en from platform_creators c
      where active and public_profile and handle is not null order by handle`,
  );
  return rows.map((row) => {
    const settings = toSettings(row, extended);
    return {
      userId: row.user_id, handle: row.handle, bio: settings.bio, bioEn: row.bio_en ?? null, displayName: settings.displayName, headline: settings.headline,
      country: settings.country, city: settings.city, links: settings.links, publicEmail: settings.publicEmail, tools: settings.tools,
      openToBrands: settings.openToBrands, avatarVersion: settings.avatarVersion, coverVersion: settings.coverVersion,
    };
  });
}

/** The bio a page in `locale` shows: the English one on `/en` when the maker wrote it, else the bio. */
export function makerBioFor(maker: { bio: string | null; bioEn?: string | null }, locale: string): string | null {
  return (locale === 'en' ? maker.bioEn : null) ?? maker.bio;
}
