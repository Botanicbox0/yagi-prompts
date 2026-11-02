import type { NextConfig } from 'next';
import type { Redirect } from 'next/dist/lib/load-custom-routes';

// Next config redirects run before middleware. Restrict them to exact consumer/deployment
// hosts so workspace and unknown hosts reach the fail-closed middleware boundary instead.
const consumerHosts = ['twings.app', 'www.twings.app', 'yagi-prompts.vercel.app', 'localhost', '127.0.0.1',
  process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL,
].filter((value): value is string => Boolean(value));
const consumerHostPattern = `(?:${consumerHosts.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;

/** Must match `LOCALE_COOKIE` in lib/i18n/config.ts (a config file cannot import app modules). */
const LOCALE_COOKIE = 'playbook.locale';

function retiredSubscriptionRedirects(): Array<Redirect & { permanent: boolean }> {
  const source = '/billing/:page(upgrade|success|cancelled)';
  const locale = '(?<locale>en|ko)';
  return [
    { source, destination: '/:locale/pricing', permanent: true, has: [{ type: 'query' as const, key: 'locale', value: locale }] },
    { source, destination: '/:locale/pricing', permanent: true, has: [{ type: 'cookie' as const, key: LOCALE_COOKIE, value: locale }] },
    { source, destination: '/pricing', permanent: true },
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Public locale, app and admin surfaces have separate roots; use the routing-level 404.
  experimental: { globalNotFound: true },
  /**
   * Both SqlRunner drivers (lib/db/connect.ts) are native/WASM-backed and must be `require`d at
   * runtime rather than bundled: `pg` loads optional native bindings, PGlite ships a .wasm sidecar.
   */
  serverExternalPackages: ['pg', '@electric-sql/pglite'],
  /**
   * No `images.remotePatterns`, deliberately (M7 checked). Nothing in the tree uses `next/image`:
   * every media surface — `components/prompts/card-media.tsx`, `detail-media.tsx`,
   * `components/landing/playbook-card.tsx`, the §6.1 block renderers — renders a plain `<img>` or
   * `<video>` so the same markup serves an absolute `public-content` URL in cloud mode and a
   * relative gateway path in local mode without a loader in between. The moment anything adopts
   * `next/image`, the Supabase project host has to be allow-listed here or it will 400 in prod.
   */
  async headers() {
    return [
      { source: '/:path*', headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        { key: 'Content-Security-Policy', value: "base-uri 'self'; object-src 'none'; frame-ancestors 'self'" },
      ] },
      { source: '/workers/photo-advice-v1.js', headers: [
        { key: 'Content-Security-Policy', value: "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'" },
        { key: 'Cache-Control', value: 'no-cache' },
      ] },
      {
        source: '/auth/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // §3.4 cache contract, belt-and-braces: route handlers set these themselves, and
        // middleware covers /library, /account, /billing/*, /admin/*; API handlers still own
        // their session behavior, so pin the cache contract here too.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
  /**
   * docs/TEMPLATES-IA.md §2 — the prompt site's URLs, 308'd onto the template site's (2026-09-05).
   *
   * Config redirects are evaluated BEFORE middleware, which is what lets the two unprefixed app
   * leaves (`/prompts/submit`, `/contests/{slug}/submit`) land on a public page instead of on the
   * session gate that used to guard them. Permanent, because the old pages are gone for good and a
   * crawler should move its index rather than keep asking.
   */
  async redirects() {
    const redirects: Array<Redirect & { permanent: boolean }> = [
      { source: '/:locale(en|ko)/studio', destination: '/:locale/video', permanent: true },
      { source: '/:locale(en|ko)/prompts', destination: '/:locale/video', permanent: true },
      { source: '/:locale(en|ko)/prompts/:slug', destination: '/:locale/t/:slug', permanent: true },
      { source: '/:locale(en|ko)/contests', destination: '/:locale/campaigns', permanent: true },
      { source: '/:locale(en|ko)/contests/:slug', destination: '/:locale/campaigns', permanent: true },
      { source: '/prompts/submit', destination: '/en/video', permanent: true },
      { source: '/contests/:slug/submit', destination: '/en/campaigns', permanent: true },
      // Audit P1-4 (대표: subscriptions on hold, one payment per template): the $9/month entry and
      // its Stripe return pages land on the localized pricing page, BEFORE the session gate, in
      // the reader's language — the explicit `?locale=` the old links carried, then the locale
      // cookie, then unprefixed `/pricing`, which middleware localizes from Accept-Language.
      ...retiredSubscriptionRedirects(),
    ];
    return redirects.flatMap(route => [
      { ...route, has: [...(route.has ?? []), { type: 'host' as const, value: consumerHostPattern }] },
      // Next's host matcher splits at ':' and cannot parse IPv6 loopback. Match that exact
      // authority in the original Host header instead; all other unknown hosts stay closed.
      { ...route, has: [...(route.has ?? []), { type: 'header' as const, key: 'host', value:'\\[::1\\](?::[0-9]+)?' }] },
    ]);
  },
};

export default nextConfig;
