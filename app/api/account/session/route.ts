import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/supabase/auth-client';
import { getViewer } from '@/lib/auth/viewer';
import { getSqlRunner } from '@/lib/db/connect';
import { displayNameOf, loadCreatorProfile } from '@/lib/creators/profile';
import { resolveSurface } from '@/lib/routing/surfaces';
import { CONCIERGE_UID_COOKIE, conciergeUserScopeKey } from '@/lib/support/concierge-scope';
import { templateLookOpen } from '@/lib/flags';
import type { TemplateLook } from '@/lib/template-look/look';
import { requestHasLookCookie, syncLookCookie, writeLookCookie } from '@/lib/template-look/cookie';
import { loadViewerLook, templateLookSchemaReady } from '@/lib/template-look/repo';

export const dynamic = 'force-dynamic';
const headers = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
};

function anonSessionResponse(request: Request): Response {
  const hasCookie = request.headers.get('cookie')?.includes(`${CONCIERGE_UID_COOKIE}=`) ?? false;
  // docs/PERSONAL-STUDIO.md §3.4.10: a signed-out browser keeps no template style (switch on only).
  const staleLook = templateLookOpen() && requestHasLookCookie(request);
  if (!hasCookie && !staleLook) return Response.json({ signedIn: false }, { headers });
  const response = NextResponse.json({ signedIn: false }, { headers });
  if (hasCookie) response.cookies.set(CONCIERGE_UID_COOKIE, '', { path: '/', sameSite: 'lax', maxAge: 0 });
  if (staleLook) writeLookCookie(response, null);
  return response;
}

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — with the switch on, the stored template style rides on this answer (the one request
 * every page's header already makes), and the `tw_look` cookie is brought in line with it, which is how a second device
 * learns the choice. `undefined` (the key left out) = the switch off or 0190 not applied: the page then asks nothing.
 */
async function viewerLookField(userId: string): Promise<{ look?: TemplateLook | null }> {
  if (!templateLookOpen()) return {};
  try {
    const sql = await getSqlRunner();
    if (sql === null || !(await templateLookSchemaReady(sql))) return {};
    return { look: await loadViewerLook(sql, userId) };
  } catch {
    return {};
  }
}

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
  if (!userId) return anonSessionResponse(request);
  let displayName = displayNameOf(user?.user_metadata?.full_name) ?? displayNameOf(user?.user_metadata?.name);
  try {
    const sql = await getSqlRunner();
    const profile = sql ? await loadCreatorProfile(sql, userId) : null;
    if (!user && !profile) return anonSessionResponse(request);
    displayName = profile?.displayName ?? displayName;
  } catch {
    if (!user) return anonSessionResponse(request);
    // An unavailable profile store must not make a valid Google/Kakao session look signed out.
  }
  const lookField = await viewerLookField(userId);
  const response = NextResponse.json({ signedIn: true, displayName, ...lookField }, { headers });
  response.cookies.set(CONCIERGE_UID_COOKIE, conciergeUserScopeKey(userId), {
    path: '/',
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 86_400,
  });
  if (lookField.look !== undefined) syncLookCookie(request, response, lookField.look);
  return response;
}
