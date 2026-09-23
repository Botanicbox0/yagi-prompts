import { cache } from 'react';
import { getSessionUser } from '@/lib/supabase/auth-client';
import { verifiedEmailOf } from '@/lib/brands/workspace/staff';

/**
 * The signed-in account's email as confirmed by the auth server (Supabase `getUser()`), or undefined.
 * Only for the same user id `getViewer()` resolved, and only when `email_confirmed_at` is set. Never
 * `profiles.email` or `Viewer.email`. The local dev identity has no session, so it has no verified email.
 *
 * Deduplicated per server render; route handlers simply call through.
 */
export const getVerifiedEmail = cache(async (userId: string | null | undefined): Promise<string | undefined> => {
  if (!userId) return undefined;
  return verifiedEmailOf(await getSessionUser(), userId);
});
