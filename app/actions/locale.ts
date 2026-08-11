'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/supabase/auth-client';
import { createDataClient } from '@/lib/supabase/data-client';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from '@/lib/i18n/config';

/**
 * PLAN §3.9 — "the toggle writes cookie + profile (when logged in) atomically and navigates to the
 * equivalent URL". The cookie is what the edge reads on the next request; the profile is what
 * survives a new device (and what the OAuth callback reads back into the cookie at sign-in).
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  const requested = String(formData.get('next') ?? '/');

  // Same-origin relative paths only — never let a form field become an open redirect.
  const target = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/';

  if (!isLocale(locale)) redirect(target);

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });

  const user = await getSessionUser();
  if (user) {
    try {
      await createDataClient().from('profiles').update({ locale }).eq('id', user.id);
    } catch {
      // The cookie already carries the choice; a failed mirror write must not break navigation.
    }
  }

  redirect(target);
}
