'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { getSessionUser } from '@/lib/supabase/auth-client';
import { createDataClient } from '@/lib/supabase/data-client';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from '@/lib/i18n/config';
import { safeReturnPath } from '@/lib/auth/return-path';

/**
 * The cookie controls the next navigation. Mirror it to the verified user's profile after the
 * response so a slow auth/profile service cannot hold the language switch open.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const locale = String(formData.get('locale') ?? '');
  const requested = String(formData.get('next') ?? '/');

  // Same-origin relative paths only — never let a form field become an open redirect.
  const target = safeReturnPath(requested);

  if (!isLocale(locale)) redirect(target);

  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });

  after(async () => {
    try {
      const user = await getSessionUser();
      if (user) await createDataClient().from('profiles').update({ locale }).eq('id', user.id);
    } catch {
      // The cookie already carries the choice; profile storage must not break navigation.
    }
  });

  redirect(target);
}
