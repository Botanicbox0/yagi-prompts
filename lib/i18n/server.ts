import { cookies, headers } from 'next/headers';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  isLocale,
  resolveLocale,
  type Locale,
} from './config';

/**
 * The server-side half of the §3.9 precedence chain.
 *
 * Middleware already resolved `URL > cookie > Accept-Language` and published the answer as a
 * request header. This adds the one signal the edge cannot cheaply see — `profile.locale` — and
 * runs the SAME `resolveLocale()` so there is still only one rule.
 */
export async function getRequestLocale(profileLocale?: string | null): Promise<Locale> {
  const [headerList, cookieStore] = await Promise.all([headers(), cookies()]);
  const fromMiddleware = headerList.get(LOCALE_HEADER);

  // A URL prefix or an explicit cookie always wins; middleware has already applied both.
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value ?? null;
  if (isLocale(cookieLocale)) return cookieLocale;

  return resolveLocale({
    urlLocale: isLocale(fromMiddleware) ? fromMiddleware : null,
    profileLocale: profileLocale ?? null,
    acceptLanguage: headerList.get('accept-language'),
  });
}

export async function getLocaleFromHeaders(): Promise<Locale> {
  const headerList = await headers();
  const value = headerList.get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
