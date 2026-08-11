import { NextResponse, type NextRequest } from 'next/server';
import { createAuthServerClient } from '@/lib/supabase/auth-client';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localizedPath } from '@/lib/i18n/config';

/** `POST /auth/signout` — ends the session and returns to the public landing in the same locale. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  try {
    const supabase = await createAuthServerClient();
    await supabase.auth.signOut();
  } catch {
    // Nothing to sign out of (placeholder env) — the redirect below is still the right answer.
  }

  return NextResponse.redirect(new URL(localizedPath(locale, '/'), url.origin), { status: 303 });
}
