import { createClient } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { authenticateReviewAccount } from '@/lib/auth/review-login';
import { createAuthServerClient, isAuthConfigured, supabaseAnonKey, supabaseUrl } from '@/lib/supabase/auth-client';
import { createDataClient } from '@/lib/supabase/data-client';
import { allowReviewLogin } from '@/lib/auth/review-login-limit';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from '@/lib/i18n/config';
import { resolveRequestUrl, resolveSurface, sameOriginMutation } from '@/lib/routing/surfaces';

export const dynamic = 'force-dynamic';
function privateResponse(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawUrl = new URL(request.url);
  const url = resolveRequestUrl(rawUrl, request.headers);
  if (!url || resolveSurface(rawUrl, request.headers) !== 'consumer') return privateResponse(new NextResponse(null, { status: 404 }));
  if (request.headers.get('origin') !== url.origin || !sameOriginMutation(url, request.headers)) return privateResponse(new NextResponse(null, { status: 403 }));
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return privateResponse(new NextResponse(null, { status: 415 }));
  // Bound the actual streamed body as well as Content-Length; do not buffer untrusted input.
  const reader = request.body?.getReader();
  let body = ''; let size = 0;
  if (!reader) return privateResponse(new NextResponse(null, { status: 400 }));
  const decoder = new TextDecoder();
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 4096) { await reader.cancel(); return privateResponse(new NextResponse(null, { status: 413 })); }
    body += decoder.decode(chunk.value, { stream: true });
  }
  body += decoder.decode();
  const form = new URLSearchParams(body);
  const locale = isLocale(form.get('locale')) ? form.get('locale')! : 'ko';
  let success = false;
  const clientAddress = process.env.VERCEL === '1' ? request.headers.get('x-vercel-forwarded-for') ?? 'unknown' : 'unknown';
  if (isAuthConfigured() && allowReviewLogin(clientAddress, form.get('email') ?? '')) {
    const isolated = createClient(supabaseUrl(), supabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    success = await authenticateReviewAccount({ email: form.get('email'), password: form.get('password') }, {
      authenticate: async credentials => {
        const { data, error } = await isolated.auth.signInWithPassword(credentials);
        return !error && data.user && data.session ? { user: data.user, session: data.session } : null;
      },
      ordinaryProfile: async id => {
        const { data, error } = await createDataClient().from('profiles').select('is_admin').eq('id', id).maybeSingle();
        return !error && data?.is_admin === false;
      },
      commit: async session => {
        const client = await createAuthServerClient();
        const { error } = await client.auth.setSession(session);
        if (error) { await client.auth.signOut({ scope: 'local' }); return false; }
        return true;
      },
    });
    // Revoke only the newly minted session if a later check failed.
    if (!success) { try { await isolated.auth.signOut({ scope: 'local' }); } catch { /* no tokens are exposed */ } }
  }
  const response = privateResponse(NextResponse.redirect(new URL(success ? '/account' : `/auth/review?locale=${locale}&error=invalid`, url.origin), { status: 303 }));
  response.cookies.set(LOCALE_COOKIE, locale, { path: '/', sameSite: 'lax', maxAge: LOCALE_COOKIE_MAX_AGE });
  return response;
}
