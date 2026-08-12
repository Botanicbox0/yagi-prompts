import { NextResponse, type NextRequest } from 'next/server';
import { updateSession, withCookies } from '@/lib/supabase/middleware';
import { devIdentityUserId } from '@/lib/auth/dev-identity';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_HEADER,
  isAppPath,
  isPlaybookDetailPath,
  isPromptDetailPath,
  localizedPath,
  resolveLocale,
  splitLocale,
} from '@/lib/i18n/config';

/**
 * Edge middleware does three jobs, in this order (PLAN §7):
 *   1. resolve the locale and publish it to the render as `x-playbook-locale`
 *   2. refresh the Supabase session (@supabase/ssr contract, lib/supabase/middleware.ts)
 *   3. hard-gate the app surface on the presence of a session; 308-redirect unprefixed PUBLIC urls
 *
 * Two deliberate omissions, both logged for the Director:
 *   · `profile.locale` is not consulted HERE. RLS is deny-all, so the edge would need a
 *     service-role round trip on every request. The same `resolveLocale()` chain runs server-side
 *     with the profile in hand (lib/i18n/server.ts), and the OAuth callback writes the cookie from
 *     the profile at sign-in, so the edge always has the right answer by the second request.
 *   · `is_admin` is not checked here either — see app/(admin)/layout.tsx / requireAdmin().
 */

const NO_STORE = 'private, no-store';

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const { locale: urlLocale, rest } = splitLocale(pathname);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value ?? null;
  const locale = resolveLocale({
    urlLocale,
    cookieLocale,
    acceptLanguage: request.headers.get('accept-language'),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);

  const { response, user } = await updateSession(request, requestHeaders);

  // --- app surface: session required, never cached, never indexed ---------
  if (isAppPath(pathname)) {
    response.headers.set('Cache-Control', NO_STORE);
    response.headers.set('X-Robots-Tag', 'noindex, nofollow');

    // The edge gate is on SESSION PRESENCE only (`is_admin`/tier are resolved server-side). The dev
    // identity has to be honoured here too, or `/account` and `/billing/*` would bounce during a
    // local render-verify even though every component below would resolve the right viewer. Same
    // fences as everywhere else: dead code under NODE_ENV=production, explicit env otherwise.
    if (!user && devIdentityUserId() === null) {
      const target = request.nextUrl.clone();
      target.pathname = localizedPath(locale, '/');
      target.search = '';
      target.searchParams.set('signin', '1');
      target.searchParams.set('next', `${pathname}${search}`);
      return withCookies(NextResponse.redirect(target), response);
    }
    return response;
  }

  // --- public surface: locale-prefixed, 308 on the unprefixed form --------
  if (urlLocale === null) {
    const target = request.nextUrl.clone();
    target.pathname = localizedPath(locale, rest);
    // 308: permanent + method-preserving, so the canonical URL is unambiguous for crawlers.
    return withCookies(NextResponse.redirect(target, 308), response);
  }

  // §3.4: the one public route that is shaped per viewer never enters a cache. Indexable, but
  // never stored — the two are independent properties and §3.3/§3.9 asks for both.
  if (isPlaybookDetailPath(rest) || isPromptDetailPath(rest)) {
    response.headers.set('Cache-Control', NO_STORE);
  }

  // A visited prefix is an explicit choice — remember it so the chain short-circuits next time.
  if (cookieLocale !== urlLocale) {
    response.cookies.set(LOCALE_COOKIE, urlLocale, {
      path: '/',
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: 'lax',
    });
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   _next/static, _next/image, favicon, /fonts, /.storage (local storage driver in dev)
     *   /api/*   — route handlers set their own no-store headers and are not locale-prefixed
     *   /auth/*  — the OAuth callback must not be redirected mid-exchange
     *   sitemap.xml, robots.txt (M5) — crawler endpoints live at the ROOT by specification. They
     *     are unprefixed public URLs, which is exactly what the 308 below rewrites, so without
     *     this exclusion `/sitemap.xml` answers 308 → `/en/sitemap.xml` → 404 and the site has no
     *     sitemap at all. (Found by the M5 sweep, not by a unit test — which is why the sweep runs
     *     against a real server.)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap\\.xml|robots\\.txt|fonts/|\\.storage/|api/|auth/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|woff2?)$).*)',
  ],
};
