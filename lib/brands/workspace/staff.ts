import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * Who may BROWSE every brand workspace without a membership: the TWINGS team.
 *
 *   · an account whose `profiles.is_admin` is true (the existing global studio right), or
 *   · an account whose email the auth server itself reports as confirmed and whose domain is exactly
 *     `@yagiworkshop.xyz` (no subdomain, no look-alike suffix).
 *
 * The email must come from the server-verified session (`lib/auth/verified-email.ts`: Supabase
 * `getUser()`, same user id, `email_confirmed_at` set). `profiles.email`, `Viewer.email`, a request body
 * or any display value never count: they are either user-editable or not proven.
 *
 * This is a READ right only. It creates no membership, never promotes anyone to `is_admin`, and no
 * mutation in the workspace or production service consults it: approving, uploading, generating and
 * every studio operation keep their own checks.
 */
export const TWINGS_STAFF_EMAIL_DOMAIN = 'yagiworkshop.xyz';

/** Exact-domain match on a single, well-formed address. Case and surrounding space are ignored. */
export function isStaffEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;
  const value = email.trim().toLowerCase();
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || /\s/.test(value)) return false;
  return value.slice(at + 1) === TWINGS_STAFF_EMAIL_DOMAIN;
}

/**
 * The confirmed email of a server-verified auth session, or undefined. `session` must be what the auth
 * server returned for this request; anything else (a mismatched user, an unconfirmed address) is ignored.
 */
export function verifiedEmailOf(
  session: { id?: string | null; email?: string | null; email_confirmed_at?: string | null } | null | undefined,
  userId: string | null | undefined,
): string | undefined {
  if (!session || !userId || session.id !== userId || !session.email_confirmed_at || !session.email) return undefined;
  return session.email;
}

/** The one server-side check: DB admin, or a verified exact-domain team email. Needs a profile row. */
export async function hasStaffReadAccess(sql: SqlRunner, userId: string, verifiedEmail?: string): Promise<boolean> {
  const row = (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1', [userId])).rows[0];
  if (!row) return false;
  return row.is_admin === true || isStaffEmail(verifiedEmail);
}
