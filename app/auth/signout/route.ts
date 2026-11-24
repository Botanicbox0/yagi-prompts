import { NextResponse, type NextRequest } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase/auth-client';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localizedPath } from '@/lib/i18n/config';
import { chooseProviderHref } from '@/lib/auth/providers';
import { resolveRequestUrl } from '@/lib/routing/surfaces';
import { CONCIERGE_UID_COOKIE } from '@/lib/support/concierge-scope';
import { templateLookOpen } from '@/lib/flags';
import { LOOK_COOKIE } from '@/lib/template-look/look';

/** `POST /auth/signout` — ends the session and returns to the public landing in the same locale. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const url = resolveRequestUrl(new URL(request.url), request.headers);
  if (url === null) return new NextResponse(null, { status: 404 });
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  try {
    const supabase = await createAuthServerClient();
    await supabase.auth.signOut();
  } catch {
    // Nothing to sign out of (placeholder env) — the redirect below is still the right answer.
  }

  const destination = url.hostname === 'admin.twings.app' ? chooseProviderHref('/admin', locale) : url.hostname === 'brand.twings.app' ? chooseProviderHref('/brand', locale) : localizedPath(locale, '/');
  const response = NextResponse.redirect(new URL(destination, url.origin), { status: 303 });
  response.cookies.delete(CONCIERGE_UID_COOKIE);
  // docs/PERSONAL-STUDIO.md §3.4.10 — a signed-out browser keeps no template style (switch on only).
  if (templateLookOpen()) response.cookies.delete(LOOK_COOKIE);
  return response;
}
