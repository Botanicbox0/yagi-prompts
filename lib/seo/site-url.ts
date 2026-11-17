/**
 * The deployment's own absolute origin, in one place.
 *
 * Three surfaces need it and none of them has a `Request` to read it from:
 *   · `app/sitemap.ts` / `app/robots.ts` — a sitemap of relative URLs is not a sitemap (§8 M5);
 *   · the notification emails — an inbox has no origin to resolve `/en/p/…` against (§3.5);
 *   · the unsubscribe link inside them.
 *
 * PLAN §7 names the variable `APP_URL`; the app has been reading `NEXT_PUBLIC_APP_URL` since M0
 * (`app/(marketing)/[locale]/layout.tsx` builds `metadataBase` from it). Both are accepted, the
 * public one first, so a deployment that sets either — or both — is correct. `lib/billing/service.ts`
 * keeps its own `appOrigin(request)` because it CAN see the request and should prefer it; this is
 * the fallback that path already ends at.
 */

const DEFAULT_ORIGIN = 'http://localhost:3000';

function usable(value: string | undefined): value is string {
  return Boolean(value && value.startsWith('http') && !value.includes('YOUR-'));
}

export function siteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = usable(env.NEXT_PUBLIC_APP_URL)
    ? env.NEXT_PUBLIC_APP_URL
    : usable(env.APP_URL)
      ? env.APP_URL
      : DEFAULT_ORIGIN;
  return configured.replace(/\/+$/, '');
}

/** The brand workspace's own host in production (lib/routing/surfaces.ts serves `/brand/*` there). */
const BRAND_ORIGIN = 'https://brand.twings.app';

/**
 * The origin a mail's link into the brand workspace starts with (docs/BRAND-ROOMS-FEEDBACK.md §2).
 * Production (`siteUrl()` on twings.app) answers the brand host; local and preview deployments serve
 * `/brand` from their own origin, so a test mail never sends anyone to production.
 */
export function brandSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const site = siteUrl(env);
  let host = '';
  try {
    host = new URL(site).hostname.toLowerCase();
  } catch {
    return site;
  }
  return host === 'twings.app' || host.endsWith('.twings.app') ? BRAND_ORIGIN : site;
}

/** `absoluteUrl('/en/pricing')` → `https://…/en/pricing`. Already-absolute input is returned as is. */
export function absoluteUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${siteUrl(env)}${path.startsWith('/') ? path : `/${path}`}`;
}
