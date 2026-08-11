import type { Locale } from '@/lib/i18n/config';
import type { Tier } from '@/lib/content/visibility';

/**
 * PLAN §3.4 — where the money CTAs point, as one pure module.
 *
 * Two surfaces have to agree and cannot share state:
 *   · the **static** marketing/pricing tree, which by contract may not read the session (§3.1 cache
 *     mode — see tests/routes/cache-contract.test.ts). It links to `/auth/signin` with a return-to,
 *     and `/auth/signin` short-circuits for an already-signed-in reader;
 *   · the **dynamic** detail page, which knows the viewer's tier and can therefore put a signed-in
 *     free reader one click from Stripe.
 *
 * Everything here is pure and string-in/string-out so both can use it and both are tested.
 */

export const CHECKOUT_ACTION = '/api/billing/checkout';
export const PORTAL_ACTION = '/api/billing/portal';
export const UPGRADE_PATH = '/billing/upgrade';

/** Slugs are `[a-z0-9-]` by construction (fixtures + admin). Anything else is not a slug. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function sanitizeSlug(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > 120) return null;
  return SLUG_PATTERN.test(value) ? value : null;
}

/** Where a completed (or abandoned) checkout should put the reader back. */
export function originPath(origin: { slug: string | null; locale: Locale }): string {
  return origin.slug === null ? '/library' : `/${origin.locale}/p/${origin.slug}`;
}

/** Same-origin relative paths only — never let a query parameter become an open redirect. */
export function safeInternalPath(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  return raw;
}

export function signInHref(next: string, locale: Locale): string {
  return `/auth/signin?next=${encodeURIComponent(next)}&locale=${locale}`;
}

/** The pricing page's CTA: sign in if needed, then land on the upgrade step. */
export function upgradeHrefFromStatic(locale: Locale): string {
  return signInHref(`${UPGRADE_PATH}?locale=${locale}`, locale);
}

// ---------------------------------------------------------------------------
// the locked-block / Pro CTA on the detail page
// ---------------------------------------------------------------------------

export type UpgradeIntent =
  /** Anonymous: start Journey A and come back to the same playbook. */
  | { kind: 'signin'; href: string }
  /** Signed in, not entitled: one click to Stripe (POST — creating a session is not a GET). */
  | { kind: 'checkout'; action: string; slug: string | null; locale: Locale; returnTo: string }
  /** No Stripe configured (§11): say so honestly rather than linking at a dead route. */
  | { kind: 'unavailable'; href: string };

export function upgradeIntent(args: {
  tier: Tier;
  slug: string | null;
  locale: Locale;
  billingConfigured: boolean;
}): UpgradeIntent {
  const returnTo = originPath({ slug: args.slug, locale: args.locale });
  if (args.tier === 'anon') return { kind: 'signin', href: signInHref(returnTo, args.locale) };
  if (!args.billingConfigured) return { kind: 'unavailable', href: `/${args.locale}/pricing` };
  return {
    kind: 'checkout',
    action: CHECKOUT_ACTION,
    slug: args.slug,
    locale: args.locale,
    returnTo,
  };
}

// ---------------------------------------------------------------------------
// Stripe's return URLs (§3.4)
// ---------------------------------------------------------------------------

/**
 * `{CHECKOUT_SESSION_ID}` is Stripe's own placeholder, substituted by the hosted page on return —
 * and by the fake gateway, so the contract is identical against either implementation.
 */
export function checkoutReturnUrls(
  appOrigin: string,
  origin: { slug: string | null; locale: Locale },
): { successUrl: string; cancelUrl: string } {
  const base = appOrigin.replace(/\/$/, '');
  const query = new URLSearchParams({ locale: origin.locale });
  if (origin.slug !== null) query.set('slug', origin.slug);
  return {
    successUrl: `${base}/billing/success?session_id={CHECKOUT_SESSION_ID}&${query.toString()}`,
    cancelUrl: `${base}/billing/cancelled?${query.toString()}`,
  };
}
