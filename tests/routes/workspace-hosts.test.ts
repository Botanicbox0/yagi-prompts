import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { adminRouteAllowed, brandRouteAllowed, authReturnPath, resolveRequestUrl, resolveSurface } from '@/lib/routing/surfaces';
import { normalizeReturnPath, safeReturnPath } from '@/lib/auth/return-path';

const session = vi.hoisted(() => ({ user: null as { id: string } | null, calls: 0 }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_request: NextRequest, headers: Headers) => { session.calls++; return { user: session.user, response: NextResponse.next({ request: { headers } }) }; },
  withCookies: (target: NextResponse) => target,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
import { config, middleware } from '@/middleware';

const request = (host: string, path: string, init: { method?: string; headers?: HeadersInit } = {}) => new NextRequest(`https://${host}${path}`, { ...init, headers: { host, ...Object.fromEntries(new Headers(init.headers)) } });
it('allows authenticated campaign OUTPUT reads on workspaces without opening creator generation there', () => {
  const media = '/api/campaign-production/a0000000-0000-4000-8000-000000000001/media';
  for (const allowed of [adminRouteAllowed, brandRouteAllowed]) { expect(allowed(media, 'GET')).toBe(true); expect(allowed(media, 'HEAD')).toBe(true); expect(allowed(media, 'POST')).toBe(false); expect(allowed('/api/campaign-production', 'POST')).toBe(false); }
});

describe('same-origin path normalization', () => {
  it.each(['/\\evil.example', '/\t/evil.example', '/\n/evil.example', '/%5cevil.example', '/%2fevil.example', '//evil.example', 'https://evil.example', 'javascript:alert(1)', ' /admin', '/admin\u0000', '/bad%path'])('rejects %j', value => {
    expect(normalizeReturnPath(value)).toBeNull();
  });
  it('normalizes dot segments before enforcing the surface, preserving valid query values', () => {
    expect(normalizeReturnPath('/admin/a/../prompts?url=https%3A%2F%2Fexample.com#top')).toBe('/admin/prompts?url=https%3A%2F%2Fexample.com#top');
    expect(authReturnPath('/admin/../../ko', 'admin.twings.app', '/')).toBe('/admin');
    expect(safeReturnPath(null, '//evil.example')).toBe('/');
  });
});

describe('exact host routing authority', () => {
  it('allows only exact deployment hosts and keeps forwarded headers from changing the surface', () => {
    const headers = new Headers({ host: 'twings.app', 'x-forwarded-host': 'admin.twings.app' });
    expect(resolveSurface(new URL('https://twings.app/admin'), headers, [])).toBe('consumer');
    expect(resolveSurface(new URL('https://unrelated.vercel.app/'), new Headers(), ['expected.vercel.app'])).toBe('unknown');
    expect(resolveSurface(new URL('https://expected.vercel.app/'), new Headers(), ['expected.vercel.app'])).toBe('consumer');
    expect(resolveSurface(new URL('https://yagi-prompts.vercel.app/'), new Headers(), [])).toBe('consumer');
    expect(resolveSurface(new URL('https://twings.app/'), new Headers({ host: 'admin.twings.app' }), [])).toBe('unknown');
    expect(resolveSurface(new URL('https://admin.twings.app.evil.example/'), new Headers(), [])).toBe('unknown');
  });
  it('accounts for actual NextRequest loopback normalization without accepting arbitrary Host', () => {
    for (const host of ['localhost:3001', '127.0.0.1:3001', '[::1]:3001']) {
      const incoming = new NextRequest(`http://${host}/auth/choose`, { headers: { host } });
      expect(resolveSurface(new URL(incoming.url), incoming.headers, [])).toBe('consumer');
      expect(resolveRequestUrl(new URL(incoming.url), incoming.headers, [])?.host).toBe(host);
    }
    const local = new URL('http://localhost:3001/');
    expect(resolveSurface(local, new Headers({ host: 'localhost:4000' }), [])).toBe('unknown');
    expect(resolveSurface(local, new Headers({ host: 'evil.example' }), [])).toBe('unknown');
    expect(resolveRequestUrl(local, new Headers({ host: 'admin.twings.app' }), [])?.origin).toBe('http://admin.twings.app');
  });
});

describe('workspace middleware boundary', () => {
  beforeEach(() => { session.user = null; session.calls = 0; });
  it('matches API, auth and static requests before any bypass', () => { expect(config.matcher).toEqual(['/:path*']); });
  it('routes only the admin root and sessionless admin pages to their same-host destinations', async () => {
    const root = await middleware(request('admin.twings.app', '/'));
    expect(root.status).toBe(307); expect(root.headers.get('location')).toBe('https://admin.twings.app/admin');
    const page = await middleware(request('admin.twings.app', '/admin/prompts?tab=pending'));
    const destination = new URL(page.headers.get('location')!);
    expect(destination.origin).toBe('https://admin.twings.app'); expect(destination.pathname).toBe('/auth/choose');
    expect(destination.searchParams.get('next')).toBe('/admin/prompts?tab=pending');
    expect(page.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it('keeps the admin server role gate downstream and rejects anonymous mutation redirects', async () => {
    session.user = { id: 'regular-user' };
    const page = await middleware(request('admin.twings.app', '/admin'));
    expect(page.headers.get('x-middleware-next')).toBe('1'); // requireAdmin in layout/handlers still decides role.
    session.user = null;
    expect((await middleware(request('admin.twings.app', '/admin/do', { method: 'POST' }))).status).toBe(404);
  });
  it.each(['/ko/video', '/account', '/api/billing/toss/order', '/api/renders/callback', '/api/renders/tick', '/api/brands/inquiries/tick', '/api/public-media/tick', '/api/brands/inquiries/result', '/r/id/token', '/auth/unknown', '/sitemap.xml', '/sw.js', '/brand/preview.html', '/api/anything.jpg', '/_next/image'])('blocks consumer or unknown surface %s on admin', async path => {
    const response = await middleware(request('admin.twings.app', path));
    expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(session.calls).toBe(0);
  });
  it.each(['/auth/choose', '/auth/signin', '/auth/callback', '/auth/open-in-browser', '/_next/static/chunks/app.js', '/fonts/pretendard/pretendard-dynamic-subset.css', '/brand/twings-mark-mask.png', '/icon.png', '/api/admin/media/ref'])('allows only required admin GET routes %s', async path => {
    const response = await middleware(request('admin.twings.app', path));
    expect(response.headers.get('x-middleware-next')).toBe('1'); expect(session.calls).toBe(0);
  });
  it('refuses cross-subdomain POST even if Sec-Fetch-Site claims same-origin', async () => {
    for (const path of ['/api/admin/staging-url', '/admin/do', '/auth/signout']) {
      const response = await middleware(request('admin.twings.app', path, { method: 'POST', headers: { origin: 'https://twings.app', 'sec-fetch-site': 'same-origin' } }));
      expect(response.status).toBe(404);
    }
    expect(adminRouteAllowed('/api/admin/staging-url', 'GET')).toBe(false);
    const allowed = await middleware(request('admin.twings.app', '/api/admin/staging-url', { method: 'POST', headers: { origin: 'https://admin.twings.app', 'sec-fetch-site': 'same-origin' } }));
    expect(allowed.headers.get('x-middleware-next')).toBe('1');
  });
  it.each(['/admin', '/auth/signin', '/api/admin/staging-url', '/api/billing/checkout', '/_next/static/app.js', '/brand/twings.svg'])('rejects non-navigation paths on the plural brand alias at %s', async path => {
    const response = await middleware(request('brands.twings.app', path));
    expect(response.status).toBe(404); expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow'); expect(session.calls).toBe(0);
  });
  it('returns workspace robots with no sitemap and a full disallow', async () => {
    for (const host of ['brands.twings.app', 'admin.twings.app']) {
      const response = await middleware(request(host, '/robots.txt'));
      expect(response.status).toBe(200); expect(await response.text()).toBe('User-agent: *\nDisallow: /\n');
    }
  });
  it('preserves consumer locale routing and skips session work for existing API/auth/static/token URLs', async () => {
    const root = await middleware(request('twings.app', '/video'));
    expect(root.status).toBe(308); expect(root.headers.get('location')).toBe('https://twings.app/en/video');
    session.calls = 0;
    for (const path of ['/api/renders/tick', '/api/brands/inquiries/tick', '/api/public-media/tick', '/api/brands/inquiries/result', '/auth/signin', '/r/id/token', '/_next/static/app.js', '/sw.js', '/sitemap.xml']) {
      expect((await middleware(request('twings.app', path))).headers.get('x-middleware-next')).toBe('1');
    }
    expect(session.calls).toBe(0);
  });
  it.each(['/llms.txt', '/llms-full.txt'])('serves public reader aid %s without locale or session routing', async path => {
    for (const host of ['twings.app', 'www.twings.app', 'localhost:3000']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await middleware(request(host, path, { method, headers: { 'accept-language': 'ko' } }));
        expect(response.status).toBe(200);
        expect(response.headers.get('x-middleware-next')).toBe('1');
        expect(response.headers.get('location')).toBeNull();
      }
    }
    expect(session.calls).toBe(0);
  });
  it.each(['/account', '/renders', '/admin/brand-workspace/00000000-0000-4000-8000-000000000000'])('keeps anonymous consumer app redirect private at %s', async path => {
    const response = await middleware(request('twings.app', path));
    expect(response.status).toBe(307);
    const target = new URL(response.headers.get('location')!);
    expect(target.origin).toBe('https://twings.app');
    expect(target.searchParams.get('signin')).toBe('1');
    expect(target.searchParams.get('next')).toBe(path);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });
  it.each(['/llms.txt', '/llms-full.txt'])('keeps public reader aid %s outside every workspace and unknown host', async path => {
    for (const host of ['admin.twings.app', 'brand.twings.app', 'brands.twings.app', 'unknown.example']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await middleware(request(host, path, { method }));
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
      }
    }
    expect(session.calls).toBe(0);
  });
  it.each(['/llms.txt.extra', '/llms-full.txt/', '/notes.txt'])('does not widen the reader-aid bypass to %s', async path => {
    const response = await middleware(request('twings.app', path));
    expect(response.status).toBe(308);
    expect(response.headers.get('location')).toBe(`https://twings.app/en${path}`);
  });
  it('overwrites spoofed internal context headers', async () => {
    const response = await middleware(request('twings.app', '/auth/choose', { headers: { 'x-twings-surface': 'admin', 'x-twings-request-origin': 'https://evil.example' } }));
    expect(response.headers.get('x-middleware-request-x-twings-surface')).toBe('consumer');
    expect(response.headers.get('x-middleware-request-x-twings-request-origin')).toBe('https://twings.app');
  });
});
