import { NextResponse, type NextRequest } from 'next/server';
import { createAuthServerClient, getSessionUser } from '@/lib/supabase/auth-client';
import { isEmbeddedWebView } from '@/lib/auth/webview';
import { chooseProviderHref, isAuthProvider, needsRealBrowser } from '@/lib/auth/providers';
import { authFailurePath, authReturnPath, isBrandPath, resolveRequestUrl } from '@/lib/routing/surfaces';
import {
  resolveLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from '@/lib/i18n/config';

/**
 * `GET /auth/signin?provider=kakao&next=/library&locale=ko` — starts the OAuth round trip (§3.7).
 *
 * Two providers since 2026-09-06 (docs/TEMPLATES-IA.md §8): Google and Kakao. A request that names
 * neither is sent to `/auth/choose`, the page with the two doors — every static surface links
 * `/auth/signin?next=…` and none of them has to know which doors exist. `{next, locale}` ride
 * along so the return trip lands on the originating page in the right language; Supabase owns the
 * opaque `state` parameter itself, so the carry happens through the `redirectTo` query string.
 *
 * NOTE (PLAN §11 open item): the real round trip is a deferred manual gate — it cannot run until
 * the Supabase cloud project and the Google OAuth client exist. The code path is complete.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  if (url === null) return new NextResponse(null, { status: 404 });
  const rawLocale = url.searchParams.get('locale');
  const locale = resolveLocale({
    urlLocale: rawLocale,
    cookieLocale: request.cookies.get(LOCALE_COOKIE)?.value,
    countryCode: url.hostname === 'brand.twings.app' || isBrandPath(url.searchParams.get('next') ?? '') ? request.headers.get('x-vercel-ip-country') : null,
    acceptLanguage: request.headers.get('accept-language'),
  });
  // A sign-in with nowhere to go returns to the video templates (docs/TEMPLATES-IA.md).
  const fallback = `/${locale}/video`;
  const next = authReturnPath(url.searchParams.get('next'), url.hostname, fallback);

  // Already signed in ⇒ this is a return-to, not a login. M3 makes `/auth/signin?next=…` the CTA
  // for every STATIC surface (the marketing tree may not read the session, §3.1 cache mode), so it
  // has to be a no-op for a reader who already has one rather than a redundant OAuth round trip.
  const existing = await getSessionUser();
  if (existing) return NextResponse.redirect(new URL(next, url.origin), { status: 303 });

  // No door named → the chooser. (The chooser's own links come back here with `provider=`.)
  const rawProvider = url.searchParams.get('provider');
  if (!isAuthProvider(rawProvider)) {
    return NextResponse.redirect(new URL(chooseProviderHref(next, locale), url.origin), { status: 303 });
  }
  const provider = rawProvider;

  // F1 — Google refuses OAuth inside embedded WebViews (`disallowed_useragent`), and the bio
  // link on Instagram/KakaoTalk is how readers arrive. A detected reader gets the
  // open-in-browser interstitial instead of Google's dead end. Kakao is exempt: its login works
  // inside KakaoTalk's own browser. After the signed-in short-circuit on purpose.
  if (needsRealBrowser(provider) && isEmbeddedWebView(request.headers.get('user-agent') ?? '')) {
    const interstitial = new URL('/auth/open-in-browser', url.origin);
    interstitial.searchParams.set('next', next);
    interstitial.searchParams.set('locale', locale);
    const response = NextResponse.redirect(interstitial);
    // Auth skips middleware session/locale redirects, so the (app) layout resolves `<html lang>` from the
    // locale cookie — written here from the same explicit signal a locale-prefixed visit sets.
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    });
    return response;
  }

  const callback = new URL('/auth/callback', url.origin);
  callback.searchParams.set('next', next);
  callback.searchParams.set('locale', locale);

  try {
    const supabase = await createAuthServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });
    if (error || !data.url) {
      return NextResponse.redirect(new URL(authFailurePath(url.hostname, locale, 'oauth', next), url.origin));
    }
    return NextResponse.redirect(data.url);
  } catch {
    // Placeholder env (no Supabase project yet) — fail visibly but without a 500 page.
    return NextResponse.redirect(new URL(authFailurePath(url.hostname, locale, 'oauth_unconfigured', next), url.origin));
  }
}
