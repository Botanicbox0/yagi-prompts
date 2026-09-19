import { NextResponse, type NextRequest } from 'next/server';
import { updateSession, withCookies } from '@/lib/supabase/middleware';
import { devIdentityUserId } from '@/lib/auth/dev-identity';
import { chooseProviderHref } from '@/lib/auth/providers';
import {
  adminRouteAllowed,
  bypassConsumerLocale,
  isAdminPath,
  REQUEST_ORIGIN_HEADER,
  resolveRequestUrl,
  resolveSurface,
  sameOriginMutation,
  SURFACE_HEADER,
} from '@/lib/routing/surfaces';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_HEADER,
  isAppPath,
  isPlaybookDetailPath,
  localizedPath,
  resolveLocale,
  splitLocale,
} from '@/lib/i18n/config';

/**
 * Edge middleware first checks the host/path boundary, including API/auth/static requests.
 * Routes that need the locale/session pipeline then follow the existing PLAN §7 contract:
 *   1. resolve the locale and publish it to the render as `x-playbook-locale`
 *   2. refresh the Supabase session (@supabase/ssr contract, lib/supabase/middleware.ts)
 *   3. hard-gate the app surface on session presence; 308-redirect unprefixed PUBLIC urls
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
  const requestUrl = resolveRequestUrl(new URL(request.url), request.headers);
  const surface = resolveSurface(new URL(request.url), request.headers);
  const privateHeaders = { 'Cache-Control': NO_STORE, 'X-Robots-Tag': 'noindex, nofollow' };
  if (surface === 'unknown' || requestUrl === null) return new NextResponse(null, { status: 404, headers: privateHeaders });
  if ((surface === 'admin' || surface === 'brands') && pathname === '/robots.txt' && ['GET', 'HEAD'].includes(request.method)) {
    return new NextResponse(request.method === 'HEAD' ? null : 'User-agent: *\nDisallow: /\n', {
      headers: { ...privateHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  // Brand organization membership and the real workspace are not implemented yet.
  if (surface === 'brands') return new NextResponse(null, { status: 404, headers: privateHeaders });
  if (surface === 'admin') {
    if (pathname === '/' && ['GET', 'HEAD'].includes(request.method)) {
      const target = new URL(requestUrl); target.pathname = '/admin'; target.search = '';
      return NextResponse.redirect(target, { status: 307, headers: privateHeaders });
    }
    if (!adminRouteAllowed(pathname, request.method) ||
      (!['GET', 'HEAD'].includes(request.method) && !sameOriginMutation(requestUrl, request.headers))) {
      return new NextResponse(null, { status: 404, headers: privateHeaders });
    }
  }
  const { locale: urlLocale, rest } = splitLocale(pathname);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value ?? null;
  const locale = resolveLocale({
    urlLocale,
    cookieLocale,
    acceptLanguage: request.headers.get('accept-language'),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  // Overwrite client-supplied context. Server components may use these for same-host auth links.
  requestHeaders.set(SURFACE_HEADER, surface);
  requestHeaders.set(REQUEST_ORIGIN_HEADER, requestUrl.origin);

  // No locale/session work for OAuth exchanges, APIs, public render tokens or asset bytes.
  // Unlike the old matcher exclusion, this cannot bypass the workspace host policy above.
  if (bypassConsumerLocale(pathname) || (surface === 'admin' && !isAdminPath(pathname))) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (surface === 'admin') for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
    return response;
  }

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
      const target = new URL(requestUrl);
      if (surface === 'admin') {
        if (!['GET', 'HEAD'].includes(request.method)) return withCookies(new NextResponse(null, { status: 404, headers: privateHeaders }), response);
        const chooser = new URL(chooseProviderHref(`${pathname}${search}`, locale), target.origin);
        return withCookies(NextResponse.redirect(chooser, { headers: privateHeaders }), response);
      }
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
    const target = new URL(requestUrl);
    target.pathname = localizedPath(locale, rest);
    // 308: permanent + method-preserving, so the canonical URL is unambiguous for crawlers.
    return withCookies(NextResponse.redirect(target, 308), response);
  }

  // §3.4: the one public route still shaped per viewer never enters a cache. Indexable, but
  // never stored: the two are independent properties and §3.3/§3.9 ask for both. (The prompt and
  // contest details that shared this branch left with the prompt site, 2026-09-05.)
  if (isPlaybookDetailPath(rest)) {
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
  // Every request must pass the host boundary; the old exclusions live in bypassConsumerLocale.
  matcher: ['/:path*'],
};
