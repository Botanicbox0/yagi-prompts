import { NextResponse, type NextRequest } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase/auth-client';
import { createDataClient } from '@/lib/supabase/data-client';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  localizedPath,
  type Locale,
} from '@/lib/i18n/config';

/**
 * OAuth return trip (§3.7 / §3.9).
 *
 *   1. exchange the code for a session (PKCE; @supabase/ssr holds the verifier in a cookie);
 *   2. create `profiles` on first login, with the locale of the UI the user started from;
 *   3. write the locale cookie FROM THE PROFILE — this is what lets the edge run the precedence
 *      chain without a service-role round trip on every request (see middleware.ts);
 *   4. land on the originating page.
 *
 * `is_admin` is never derived here. Admins are seeded manually (§3.7, docs/SETUP.md).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const requested = url.searchParams.get('next') ?? '/library';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/library';
  const uiLocaleRaw = url.searchParams.get('locale');
  const uiLocale: Locale = isLocale(uiLocaleRaw) ? uiLocaleRaw : DEFAULT_LOCALE;

  if (!code) {
    return NextResponse.redirect(new URL(`${localizedPath(uiLocale, '/')}?error=oauth`, url.origin));
  }

  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(new URL(`${localizedPath(uiLocale, '/')}?error=oauth`, url.origin));
  }

  let profileLocale: Locale = uiLocale;
  try {
    const db = createDataClient();
    const { data: existing } = await db
      .from('profiles')
      .select('locale')
      .eq('id', data.user.id)
      .maybeSingle<{ locale: Locale }>();

    if (existing) {
      profileLocale = isLocale(existing.locale) ? existing.locale : uiLocale;
    } else {
      await db.from('profiles').insert({
        id: data.user.id,
        email: data.user.email ?? '',
        display_name: (data.user.user_metadata?.['full_name'] as string | undefined) ?? null,
        locale: uiLocale,
      });
    }
  } catch {
    // A profile write failure must not strand the user mid-login; the session is already valid.
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  response.cookies.set(LOCALE_COOKIE, profileLocale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
  return response;
}
