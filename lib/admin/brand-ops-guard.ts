import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Re-reads `profiles.is_admin` from the database before returning any admin read model.
 * Never trusts caller-supplied flags alone (`docs/ADMIN.md §1`).
 */
export async function isDbAdmin(sql: SqlRunner, viewer: Viewer | null | undefined): Promise<boolean> {
  if (!viewer || !viewer.userId || !UUID_RE.test(viewer.userId)) return false;
  const row = (
    await sql.query<{ is_admin: boolean | null }>('select is_admin from profiles where id = $1 limit 1', [
      viewer.userId,
    ])
  ).rows[0];
  return row?.is_admin === true;
}

export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function escapeLike(query: string): string {
  return query.replace(/[!%_\\]/g, '!$&');
}

export function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}
