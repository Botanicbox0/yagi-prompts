import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * docs/PLATFORM-2.0.md §7.5·§14.1 — a template maker's public identity: a handle, a short bio and an
 * explicit opt-in (0060). The handle is the ONLY thing about a maker that reaches a public page;
 * `user_id`, email and contract terms never leave this module's private reads.
 *
 * `prompt_items.author_handle` follows the opt-in in the database itself (0060's triggers), so this
 * module only writes `platform_creators` and the catalogue only reads the column.
 */

export const MAKER_HANDLE_PATTERN = /^[a-z0-9_]{3,20}$/;
export const MAKER_BIO_MAX = 200;

/** Names that would read as the studio speaking. Not a moderation list — just no impersonation. */
const RESERVED_HANDLES = new Set(['admin', 'administrator', 'twings', 'yagi', 'yagiworkshop', 'studio', 'official', 'support', 'help', 'staff', 'makers', 'maker']);

export type MakerProfileErrorCode = 'invalid_handle' | 'reserved_handle' | 'invalid_bio' | 'handle_required' | 'handle_taken' | 'not_maker' | 'unavailable';

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

export interface MakerSettings {
  handle: string | null;
  bio: string | null;
  publicProfile: boolean;
}

/** The maker's own settings. Null when the account is not an active maker (or 0060 is missing). */
export async function loadMakerSettings(sql: SqlRunner, userId: string): Promise<MakerSettings | null> {
  if (!(await makerProfilesReady(sql))) return null;
  const { rows } = await sql.query<{ handle: string | null; bio: string | null; public_profile: boolean }>(
    'select handle, bio, public_profile from platform_creators where user_id = $1 and active',
    [userId],
  );
  const row = rows[0];
  return row ? { handle: row.handle, bio: row.bio, publicProfile: row.public_profile } : null;
}

/**
 * Every field re-validated here; the caller supplies only a server-verified user id. Turning the
 * profile on needs a handle; turning it off keeps the handle reserved for the maker.
 */
export async function saveMakerProfile(
  sql: SqlRunner,
  userId: string,
  input: { handle?: unknown; bio?: unknown; publicProfile?: unknown },
): Promise<MakerSettings> {
  if (!(await makerProfilesReady(sql))) throw new MakerProfileError('unavailable');
  const rawHandle = typeof input.handle === 'string' ? input.handle.trim() : '';
  const handle = rawHandle === '' ? null : makerHandleOf(rawHandle);
  if (rawHandle !== '' && handle === null) throw new MakerProfileError('invalid_handle');
  if (handle !== null && isReservedMakerHandle(handle)) throw new MakerProfileError('reserved_handle');
  const bio = makerBioOf(input.bio);
  if (!bio.ok) throw new MakerProfileError('invalid_bio');
  const publicProfile = input.publicProfile === true;
  if (publicProfile && handle === null) throw new MakerProfileError('handle_required');

  const taken = handle === null ? [] : (await sql.query<{ user_id: string }>(
    'select user_id from platform_creators where handle = $1 and user_id <> $2', [handle, userId],
  )).rows;
  if (taken.length > 0) throw new MakerProfileError('handle_taken');

  try {
    const { rows } = await sql.query<{ handle: string | null; bio: string | null; public_profile: boolean }>(
      `update platform_creators set handle = $2, bio = $3, public_profile = $4
        where user_id = $1 and active returning handle, bio, public_profile`,
      [userId, handle, bio.bio, publicProfile],
    );
    const row = rows[0];
    if (!row) throw new MakerProfileError('not_maker');
    return { handle: row.handle, bio: row.bio, publicProfile: row.public_profile };
  } catch (error) {
    // Two makers racing for one handle: the unique index decides, and the loser hears "taken".
    if (error instanceof MakerProfileError) throw error;
    if ((error as { code?: string }).code === '23505') throw new MakerProfileError('handle_taken');
    throw error;
  }
}

/** Internal shape for the catalogue loader. `userId` is a join key and is dropped before any DTO. */
export interface PublicMakerRow {
  userId: string;
  handle: string;
  bio: string | null;
}

export async function loadPublicMakerRows(sql: SqlRunner): Promise<PublicMakerRow[]> {
  if (!(await makerProfilesReady(sql))) return [];
  const { rows } = await sql.query<{ user_id: string; handle: string; bio: string | null }>(
    `select user_id, handle, bio from platform_creators
      where active and public_profile and handle is not null order by handle`,
  );
  return rows.map((row) => ({ userId: row.user_id, handle: row.handle, bio: row.bio }));
}
