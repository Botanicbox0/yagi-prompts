import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { adminRouteAllowed, authReturnPath, brandRouteAllowed, isBrandPath } from '@/lib/routing/surfaces';

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({
    user: null,
    response: NextResponse.next({ request: { headers } }),
  }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));

import { middleware } from '@/middleware';

const req = (host: string, path: string, method = 'GET') =>
  new NextRequest(`https://${host}${path}`, { method, headers: { host } });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('campaign ops routes in brand surface allow-list (W2)', () => {
  it('with BRAND_CAMPAIGN_OPS off/unset, matches main: not brand paths, 404 on brand hosts, and 308 locale redirect on consumer host', async () => {
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'off');
    for (const path of ['/brand/campaigns', '/brand/production']) {
      expect(isBrandPath(path), path).toBe(false);
      expect(brandRouteAllowed(path, 'GET'), `GET ${path}`).toBe(false);
      expect(authReturnPath(path, 'brand.twings.app', '/')).toBe('/brand/start');
      expect((await middleware(req('brand.twings.app', path))).status).toBe(404);
      expect((await middleware(req('brands.twings.app', path))).status).toBe(404);

      const consumerRes = await middleware(req('twings.app', path));
      expect(consumerRes.status).toBe(308);
      expect(consumerRes.headers.get('location')).toBe(`https://twings.app/en${path}`);

      const koConsumerRes = await middleware(
        new NextRequest(`https://twings.app${path}`, { headers: { host: 'twings.app', 'accept-language': 'ko' } }),
      );
      expect(koConsumerRes.status).toBe(308);
      expect(koConsumerRes.headers.get('location')).toBe(`https://twings.app/ko${path}`);
    }
  });

  it('when BRAND_CAMPAIGN_OPS=on, allows GET and HEAD on /brand/campaigns and /brand/production, and refuses mutations or unknown siblings', () => {
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    for (const path of ['/brand/campaigns', '/brand/production']) {
      expect(isBrandPath(path), path).toBe(true);
      expect(brandRouteAllowed(path, 'GET'), `GET ${path}`).toBe(true);
      expect(brandRouteAllowed(path, 'HEAD'), `HEAD ${path}`).toBe(true);
      expect(brandRouteAllowed(path, 'POST'), `POST ${path}`).toBe(false);
      expect(brandRouteAllowed(path, 'DELETE'), `DELETE ${path}`).toBe(false);
      expect(adminRouteAllowed(path, 'GET'), `admin ${path}`).toBe(false);
      expect(authReturnPath(path, 'brand.twings.app', '/')).toBe(path);
    }

    for (const madeUp of ['/brand/campaignsx', '/brand/productionx', '/brand/campaign-ops', '/brand/unknown-page']) {
      expect(isBrandPath(madeUp), madeUp).toBe(false);
      expect(brandRouteAllowed(madeUp, 'GET'), madeUp).toBe(false);
      expect(authReturnPath(madeUp, 'brand.twings.app', '/')).toBe('/brand/start');
    }
  });

  it('when BRAND_CAMPAIGN_OPS=on, redirects anonymous requests to /brand/campaigns and /brand/production through brand auth on brand.twings.app', async () => {
    vi.stubEnv('BRAND_CAMPAIGN_OPS', 'on');
    for (const path of ['/brand/campaigns?organizationId=a1', '/brand/production?organizationId=a1']) {
      const response = await middleware(req('brand.twings.app', path));
      const destination = new URL(response.headers.get('location')!);
      expect(destination.pathname).toBe('/auth/choose');
      expect(destination.searchParams.get('next')).toBe(path);
    }
  });
});
