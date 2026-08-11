import { NextResponse, type NextRequest } from 'next/server';
import { createAuthServerClient, getSessionUser } from '@/lib/supabase/auth-client';
import { DEFAULT_LOCALE, isLocale, localizedPath } from '@/lib/i18n/config';

/**
 * `GET /auth/signin?next=/library&locale=ko` — starts the Google OAuth round trip (§3.7).
 *
 * Google is the only provider in v1. `{origin, locale}` rides along so the return trip lands on
 * the originating page in the right language; Supabase owns the opaque `state` parameter itself,
 * so the carry happens through the `redirectTo` query string, which is the documented seam.
 *
 * NOTE (PLAN §11 open item): the real round trip is a deferred manual gate — it cannot run until
 * the Supabase cloud project and the Google OAuth client exist. The code path is complete.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const requested = url.searchParams.get('next') ?? '/library';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/library';
  const rawLocale = url.searchParams.get('locale');
  const locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;

  // Already signed in ⇒ this is a return-to, not a login. M3 makes `/auth/signin?next=…` the CTA
  // for every STATIC surface (the marketing tree may not read the session, §3.1 cache mode), so it
  // has to be a no-op for a reader who already has one rather than a redundant OAuth round trip.
  const existing = await getSessionUser();
  if (existing) return NextResponse.redirect(new URL(next, url.origin), { status: 303 });

  const callback = new URL('/auth/callback', url.origin);
  callback.searchParams.set('next', next);
  callback.searchParams.set('locale', locale);

  try {
    const supabase = await createAuthServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    });
    if (error || !data.url) {
      return NextResponse.redirect(new URL(`${localizedPath(locale, '/')}?error=oauth`, url.origin));
    }
    return NextResponse.redirect(data.url);
  } catch {
    // Placeholder env (no Supabase project yet) — fail visibly but without a 500 page.
    return NextResponse.redirect(new URL(`${localizedPath(locale, '/')}?error=oauth_unconfigured`, url.origin));
  }
}
