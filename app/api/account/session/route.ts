import { getSessionUser } from '@/lib/supabase/auth-client';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { displayNameOf, loadCreatorProfile } from '@/lib/creators/profile';
import { resolveSurface } from '@/lib/routing/surfaces';

export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
};

/** A private client island can personalize the nav without putting identity in cached HTML. */
export async function GET(request: Request): Promise<Response> {
  if (resolveSurface(new URL(request.url), request.headers) !== 'consumer') return new Response(null, { status: 404, headers });
  const user = await getSessionUser(); // getUser(), verified by the auth server; never trust cookie payloads.
  // Local render-verify must use the existing viewer gate, never a new fixture identity path.
  let devId: string | null = null;
  if (!user && process.env.NODE_ENV === 'development') {
    try { devId = (await getViewer()).userId; } catch { /* unavailable local profile => anonymous */ }
  }
  const userId = user?.id ?? devId;
  if (!userId) return Response.json({ signedIn: false }, { headers });
  let displayName = displayNameOf(user?.user_metadata?.full_name) ?? displayNameOf(user?.user_metadata?.name);
  try {
    const sql = await getSqlRunner();
    const profile = sql ? await loadCreatorProfile(sql, userId) : null;
    if (!user && !profile) return Response.json({ signedIn: false }, { headers });
    displayName = profile?.displayName ?? displayName;
  } catch {
    if (!user) return Response.json({ signedIn: false }, { headers });
    // An unavailable profile store must not make a valid Google/Kakao session look signed out.
  }
  return Response.json({ signedIn: true, displayName }, { headers });
}
