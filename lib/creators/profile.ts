import type { SqlRunner } from '@/lib/db/sql-runner';

export const DISPLAY_NAME_MAX = 80;
export interface CreatorProfile { displayName: string | null; snsUrl: string | null }

/** Display text only. This value is never a role, ownership check or verified SNS identity. */
export function displayNameOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= DISPLAY_NAME_MAX && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}

/** Existing private profile fields only; every caller supplies a server-verified user id. */
export async function loadCreatorProfile(sql: SqlRunner, userId: string): Promise<CreatorProfile | null> {
  const { rows } = await sql.query<{ display_name: string | null; sns_url: string | null }>(
    'select display_name, sns_url from profiles where id=$1', [userId],
  );
  const row = rows[0];
  return row ? { displayName: displayNameOf(row.display_name), snsUrl: row.sns_url } : null;
}

export async function saveCreatorDisplayName(sql: SqlRunner, userId: string, value: unknown): Promise<boolean> {
  const name = displayNameOf(value);
  if (name === null) return false;
  const { rows } = await sql.query<{ id: string }>(
    'update profiles set display_name=$2, updated_at=now() where id=$1 returning id', [userId, name],
  );
  return rows.length > 0;
}

/** Stored, user-entered links are unverified; never fetch them or render executable schemes. */
export function socialLinkHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
