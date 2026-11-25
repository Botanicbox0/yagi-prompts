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
 * Prefix matching is `=== p || startsWith(p + '/')`. The campaigns leaves that cannot be prefixes
 * (`/campaigns/{slug}/apply`, `/campaigns/mine`) are matched by pattern below. (`/prompts/submit`
 * and `/contests/{slug}/submit` were listed here until the prompt site retired, 2026-09-05; both
 * now 308 to public pages from `next.config.ts`.)
 */
export const APP_PREFIXES = [
  '/library',
  '/account',
  '/billing',
  '/admin',
  // docs/TEMPLATES-IA.md §8 — the owner's renders. The 3-day link (`/r/…`) is NOT here: it is
  // public by token and excluded from middleware altogether, like `/auth/*`.
  '/renders',
  // docs/TEMPLATES-IA.md §8.2 — the one-time face check.
  '/identity',
  '/community',
] as const;

/**
 * docs/CAMPAIGNS.md §6 — the campaigns surface has the same shape as contests: `/{locale}/campaigns`
 * and `/{locale}/campaigns/{slug}` are public marketing pages, and two unprefixed leaves are
 * login-gated app surface — the apply form (slug in the middle, like the contest entry) and the
 * creator's own `/campaigns/mine` — and `/campaigns/open`, the signed-in list shaped per viewer
 * (docs/PLATFORM-2.0.md §17.2). Anchored at both ends for the same reason as the contest pattern.
 */
const CAMPAIGN_APPLY_PATTERN = /^\/campaigns\/[^/]+\/(?:apply|make|join)\/?$/;
const CAMPAIGN_PARTICIPATION_PATTERN = /^\/campaigns\/participations\/[^/]+\/?$/;
const MY_CAMPAIGNS_PATTERN = /^\/campaigns\/(?:mine|open)\/?$/;

/**
 * docs/CREATOR-PLATFORM.md — the format creator program: `/{locale}/creators` is public, and its
 * login-gated leaves (application, workspace, the recipe editor `workspace/formats/{new|id}`) are
 * unprefixed app surface. Anchored like the campaigns.
 */
const CREATOR_PROGRAM_PATTERN = /^\/creators\/(?:apply|workspace(?:\/(?:formats|posts)\/(?:new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))?)\/?$/;

export function isCreatorProgramAppPath(pathname: string): boolean {
  return CREATOR_PROGRAM_PATTERN.test(pathname);
}

export function isCampaignAppPath(pathname: string): boolean {
  return CAMPAIGN_APPLY_PATTERN.test(pathname) || CAMPAIGN_PARTICIPATION_PATTERN.test(pathname) || MY_CAMPAIGNS_PATTERN.test(pathname);
}

export function isAppPath(pathname: string): boolean {
  return (
    APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    isCampaignAppPath(pathname) ||
    isCreatorProgramAppPath(pathname)
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
  /** Opt-in for brand entry only: Vercel's coarse IP country, never stored. */
  countryCode?: string | null;
  acceptLanguage?: string | null;
}

/** The precedence chain, in one place, used by middleware and by server components alike. */
export function resolveLocale(signals: LocaleSignals): Locale {
  if (isLocale(signals.urlLocale)) return signals.urlLocale;
  if (isLocale(signals.cookieLocale)) return signals.cookieLocale;
  if (isLocale(signals.profileLocale)) return signals.profileLocale;
  const country = signals.countryCode?.trim().toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country) && !['XX', 'ZZ', 'T1'].includes(country)) return country === 'KR' ? 'ko' : 'en';
  return parseAcceptLanguage(signals.acceptLanguage) ?? DEFAULT_LOCALE;
}
