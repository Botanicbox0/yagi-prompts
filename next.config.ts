import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
      {
        // §3.4 cache contract, belt-and-braces: route handlers set these themselves, and
        // middleware covers /library, /account, /billing/*, /admin/* — but /api/* is excluded
        // from the middleware matcher, so pin it here too.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store' }],
      },
    ];
  },
};

export default nextConfig;
