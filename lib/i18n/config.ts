/**
 * PLAN §3.9 — one locale rule, everywhere.
 *
 *   URL prefix > explicit cookie > profile.locale > Accept-Language > 'en'
 *
 * Public routes are locale-prefixed (`/[locale]`, `/[locale]/pricing`, `/[locale]/p/[slug]`) and
 * unprefixed public URLs 308-redirect to the resolved locale. App routes (/library, /account,
 * /billing/*, /admin/*) are unprefixed + noindex and take their locale from the same chain.
 */

export const LOCALES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'playbook.locale';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Middleware publishes the resolved locale to the render through this request header. */
export const LOCALE_HEADER = 'x-playbook-locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Public paths carry a locale prefix; everything else is app surface. */
export const APP_PREFIXES = ['/library', '/account', '/billing', '/admin'] as const;

export function isAppPath(pathname: string): boolean {
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Splits `/ko/pricing` into `{ locale: 'ko', rest: '/pricing' }`; `null` locale when unprefixed. */
export function splitLocale(pathname: string): { locale: Locale | null; rest: string } {
  const [, maybeLocale = '', ...restParts] = pathname.split('/');
  if (isLocale(maybeLocale)) {
    const rest = restParts.length > 0 ? `/${restParts.join('/')}` : '/';
    return { locale: maybeLocale, rest };
  }
  return { locale: null, rest: pathname === '' ? '/' : pathname };
}

export function localizedPath(locale: Locale, rest: string): string {
  const suffix = rest === '/' ? '' : rest.startsWith('/') ? rest : `/${rest}`;
  return `/${locale}${suffix}`;
}

/** First supported language in a q-ordered Accept-Language header, else null. */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2);
      return { tag: tag.trim().toLowerCase(), q: q === undefined ? 1 : Number(q) };
    })
    .filter((entry) => entry.tag.length > 0 && !Number.isNaN(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return null;
}

export interface LocaleSignals {
  urlLocale?: string | null;
  cookieLocale?: string | null;
  profileLocale?: string | null;
  acceptLanguage?: string | null;
}

/** The precedence chain, in one place, used by middleware and by server components alike. */
export function resolveLocale(signals: LocaleSignals): Locale {
  if (isLocale(signals.urlLocale)) return signals.urlLocale;
  if (isLocale(signals.cookieLocale)) return signals.cookieLocale;
  if (isLocale(signals.profileLocale)) return signals.profileLocale;
  return parseAcceptLanguage(signals.acceptLanguage) ?? DEFAULT_LOCALE;
}
