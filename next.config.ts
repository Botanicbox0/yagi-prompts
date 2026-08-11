import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
