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

/**
 * Public paths carry a locale prefix; everything else is app surface.
 *
 * `/prompts/submit` is the §13.2 outlier and is listed DEEP on purpose: the gallery
 * (`/[locale]/prompts`) is public and locale-prefixed, while the submission form is login-gated,
 * `no-store` and `noindex`. Prefix matching is `=== p || startsWith(p + '/')`, so listing the two
 * segments gates the form without ever catching an unprefixed `/prompts`, which still 308s into
 * the reader's locale.
 */
export const APP_PREFIXES = [
  '/library',
  '/account',
  '/billing',
  '/admin',
  '/prompts/submit',
] as const;

/**
 * §14.2 — `/contests/{slug}/submit`, the one app path that cannot be expressed as a prefix.
 *
 * The entry form is scoped to a contest, so its slug sits in the MIDDLE of the path: everything
 * around it (`/{locale}/contests`, `/{locale}/contests/{slug}`) is public, locale-prefixed
 * marketing surface, and only the leaf is login-gated. A prefix entry would have to be `/contests`,
 * which would swallow the whole tab.
 *
 * Anchored at both ends on purpose: `/contests/x/submit/anything` is not this route and must not
 * inherit its gate by accident.
 */
const CONTEST_SUBMIT_PATTERN = /^\/contests\/[^/]+\/submit\/?$/;

export function isContestSubmitPath(pathname: string): boolean {
  return CONTEST_SUBMIT_PATTERN.test(pathname);
}

export function isAppPath(pathname: string): boolean {
  return (
    APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    isContestSubmitPath(pathname)
  );
}

/**
 * `/p/[slug]` is the one locale-prefixed PUBLIC route that is shaped per viewer (§3.3).
 *
 * It is therefore indexable (showcase revisions are the SEO surface, §3.9) but must never be
 * cached: §3.4 puts every viewer-shaped surface on `private, no-store`, and a shared cache holding
 * one reader's unlocked render is the exact leak the cache contract exists to prevent.
 * Takes the path with the locale prefix already stripped (`splitLocale().rest`).
 */
export function isPlaybookDetailPath(rest: string): boolean {
  return rest === '/p' || rest.startsWith('/p/');
}

/**
 * §13.2 — `/[locale]/prompts/[slug]`, the prompts surface's viewer-shaped route.
 *
 * The same two independent properties as the playbook detail: indexable (a Pro-gated prompt page is
 * still public marketing surface — only the text is gated) and never stored (its HTML differs by
 * tier). The GALLERY is deliberately excluded: `/{locale}/prompts` is static, cached and identical
 * for everyone, which is the whole reason the card projection carries no text.
 *
 * `/prompts/submit` never reaches here — it is unprefixed app surface (`APP_PREFIXES`).
 */
export function isPromptDetailPath(rest: string): boolean {
  return rest.startsWith('/prompts/');
}

/**
 * §14.2 — `/[locale]/contests/[slug]`, the THIRD never-stored public route.
 *
 * The reason differs from the other two and is worth writing down: this page's HTML does not vary
 * by reader (there is no tier gate anywhere on the contests surface), it varies by CLOCK. Phase,
 * D-day and "submissions closed" all move on their own, and a shared cache holding "D-3" is a page
 * that tells a reader they have three days left on the morning after the deadline.
 *
 * The LISTING is deliberately excluded: `/{locale}/contests` is static and tag-revalidated, and its
 * countdown is calendar-day precision for exactly that reason (`lib/contests/phase.ts`).
 * `/contests/{slug}/submit` never reaches here — it is unprefixed app surface.
 */
export function isContestDetailPath(rest: string): boolean {
  return rest.startsWith('/contests/');
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
