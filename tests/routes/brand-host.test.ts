import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { adminRouteAllowed, authReturnPath, brandRouteAllowed } from '@/lib/routing/surfaces';
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({ user: null, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
import { middleware } from '@/middleware';
const req = (host: string, path: string, method = 'GET', origin?: string) => new NextRequest(`https://${host}${path}`, { method, headers: { host, ...(origin ? {origin} : {}) } });
describe('brand host boundary', () => {
  it('keeps the campaign wizard, its tabs and the former pages on the brand host (docs/PLATFORM-2.0.md §16.6)', () => {
    const id = '22222222-2222-4222-8222-222222222222';
    for (const path of ['/brand/projects/new', `/brand/projects/${id}`, `/brand/projects/${id}/participants`, `/brand/projects/${id}/participants/${id}`, `/brand/projects/${id}/funding`]) expect(brandRouteAllowed(path, 'GET'), path).toBe(true);
    // The brief goes through the workspace API; the applicant preference through the collaboration API.
    expect(brandRouteAllowed('/api/brand-workspace', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/campaign-collaboration', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/campaign-collaboration', 'DELETE')).toBe(false);
  });
  it('keeps the creator pool and its invitation API on the brand host (docs/PLATFORM-2.0.md §16.6, §17.3)', async () => {
    expect(brandRouteAllowed('/brand/creators', 'GET')).toBe(true);
    expect(brandRouteAllowed('/api/brand-creators', 'POST')).toBe(true);
    expect(brandRouteAllowed('/api/brand-creators', 'GET')).toBe(false);
    expect(brandRouteAllowed('/api/brand-creators', 'DELETE')).toBe(false);
    expect(brandRouteAllowed('/brand/creatorsx', 'GET')).toBe(false);
    expect(adminRouteAllowed('/brand/creators', 'GET')).toBe(false);
    expect(authReturnPath('/brand/creators?platform=tiktok', 'brand.twings.app', '/')).toBe('/brand/creators?platform=tiktok');
    const r = await middleware(req('brand.twings.app', '/brand/creators'));
    expect(new URL(r.headers.get('location')!).searchParams.get('next')).toBe('/brand/creators');
    expect((await middleware(req('brand.twings.app', '/api/brand-creators', 'POST', 'https://brand.twings.app'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('admin.twings.app', '/api/brand-creators', 'POST', 'https://admin.twings.app'))).status).toBe(404);
  });
  it('routes settings and library through brand authentication and allows guarded support reads',async()=>{
    for(const path of ['/brand/settings','/brand/library']) {
      const r=await middleware(req('brand.twings.app',path));
      expect(new URL(r.headers.get('location')!).searchParams.get('next')).toBe(path);
      expect(authReturnPath(path,'brand.twings.app','/')).toBe(path);
    }
    expect((await middleware(req('brand.twings.app','/api/brand-workspace'))).headers.get('x-middleware-next')).toBe('1');
  });
  it('lets the empty invitation landing clear its fragment before starting OAuth', async () => {
    const response = await middleware(req('brand.twings.app', '/brand/invite'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect((await middleware(req('brand.twings.app', '/brand/members'))).headers.get('location')).toContain('/auth/choose');
  });
  it('opens the studio campaign preparation door on the brand host for same-origin POSTs only (docs/BRAND-STAFF-ACCESS.md)', async () => {
    expect(brandRouteAllowed('/api/brand-workspace/studio', 'POST')).toBe(true);
    for (const method of ['GET', 'HEAD', 'PUT', 'DELETE']) expect(brandRouteAllowed('/api/brand-workspace/studio', method)).toBe(false);
    expect(brandRouteAllowed('/api/brand-workspace/studio/extra', 'POST')).toBe(false);
    // `/admin/do` itself stays closed on the brand host.
    expect(brandRouteAllowed('/admin/do', 'POST')).toBe(false);
    expect((await middleware(req('brand.twings.app','/admin/do','POST','https://brand.twings.app'))).status).toBe(404);
    expect((await middleware(req('brand.twings.app','/api/brand-workspace/studio','POST','https://brand.twings.app'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('brand.twings.app','/api/brand-workspace/studio','POST','https://twings.app'))).status).toBe(404);
    expect((await middleware(req('brand.twings.app','/api/brand-workspace/studio'))).status).toBe(404);
  });
  it('allows only the guarded studio upload transport on the admin host', async () => {
    expect((await middleware(req('admin.twings.app','/api/admin/brand-workspace','POST','https://admin.twings.app'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('admin.twings.app','/api/admin/brand-workspace','GET'))).status).toBe(404);
    expect((await middleware(req('admin.twings.app','/api/admin/brand-workspace','POST','https://brand.twings.app'))).status).toBe(404);
    expect((await middleware(req('brand.twings.app','/api/admin/brand-workspace','POST','https://brand.twings.app'))).status).toBe(404);
    expect((await middleware(req('admin.twings.app','/api/admin/brand-workspace/attachments/example','POST','https://admin.twings.app'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('admin.twings.app','/api/admin/brand-workspace/attachments/example','GET'))).status).toBe(404);
  });
  it('opens a private same-host brand entry and retains the return path at sign in', async () => {
    expect((await middleware(req('brand.twings.app','/'))).headers.get('location')).toBe('https://brand.twings.app/brand');
    const destination = new URL((await middleware(req('brand.twings.app','/brand/projects/example'))).headers.get('location')!);
    expect(destination.origin).toBe('https://brand.twings.app');
    expect(destination.pathname).toBe('/auth/choose');
    expect(destination.searchParams.get('next')).toBe('/brand/projects/example');
  });
  it('redirects the plural alias only for navigations and never forwards auth codes or writes', async () => {
    expect((await middleware(req('brands.twings.app','/'))).headers.get('location')).toBe('https://brand.twings.app/brand');
    expect((await middleware(req('brands.twings.app','/brand/projects/abc?tab=report'))).headers.get('location')).toBe('https://brand.twings.app/brand/projects/abc?tab=report');
    expect((await middleware(req('brands.twings.app','/auth/callback?code=secret'))).status).toBe(404);
    expect((await middleware(req('brands.twings.app','/api/brand-workspace','POST'))).status).toBe(404);
  });
  it('blocks unrelated routes, methods, and cross-origin writes before handlers', async () => {
    for(const path of ['/admin','/account','/api/admin/staging-url','/api/billing/checkout','/ko/campaigns','/sitemap.xml','/sw.js']) expect((await middleware(req('brand.twings.app',path))).status).toBe(404);
    expect((await middleware(req('brand.twings.app','/api/brand-workspace','POST','https://twings.app'))).status).toBe(404);
    expect((await middleware(req('brand.twings.app','/api/brand-workspace','POST','https://brand.twings.app'))).headers.get('x-middleware-next')).toBe('1');
  });
  it('normalizes brand return paths and keeps consumer assets distinct from the workspace', () => {
    expect(authReturnPath('/brand/../admin','brand.twings.app','/')).toBe('/brand');
    expect(authReturnPath('/brand/projects/abc','brand.twings.app','/')).toBe('/brand/projects/abc');
    expect(authReturnPath('/brand/twings.svg','brand.twings.app','/')).toBe('/brand');
  });
  it('allows the narrow locale and production transports without opening other server actions', async()=>{
    expect((await middleware(req('brand.twings.app','/api/workspace-locale','POST','https://brand.twings.app'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('brand.twings.app','/api/workspace-locale','POST','https://evil.test'))).status).toBe(404);
    expect((await middleware(req('brand.twings.app','/api/brand-production','POST','https://brand.twings.app'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('brand.twings.app','/brand/studio','POST','https://brand.twings.app'))).status).toBe(404);
    expect(authReturnPath('/brand/studio','brand.twings.app','/')).toBe('/brand/studio');
  });
  // The self-serve studio's public example media (components/brand-workspace/studio-showcase.tsx).
  const STUDIO_DEMO = ['designed-format.jpg','designed-format.mp4','different-person.jpg','different-person.mp4','reference-selfie.jpeg'].map(f=>`/reel/studio-demo/${f}`);
  it('serves exactly the five studio demo files on the brand host, read-only', async () => {
    for (const path of STUDIO_DEMO) for (const method of ['GET','HEAD']) {
      expect(brandRouteAllowed(path, method), `${method} ${path}`).toBe(true);
      expect((await middleware(req('brand.twings.app', path, method))).headers.get('x-middleware-next'), `${method} ${path}`).toBe('1');
    }
  });
  it('keeps every other reel path, extension, method and the admin host closed', async () => {
    const other = ['/reel/studio-demo/designed-format.webm','/reel/studio-demo/designed-format.mp4/x','/reel/studio-demo/unknown.mp4','/reel/studio-demo/','/reel/studio-demo','/reel/probe.mp4','/reel/campaigns/probe.mp4','/reel/studio-demo/../probe.mp4','/reel/studio-demo/DESIGNED-FORMAT.MP4','/brand/../reel/studio-demo/designed-format.mp4x'];
    for (const path of other) {
      expect(brandRouteAllowed(path, 'GET'), path).toBe(false);
      expect((await middleware(req('brand.twings.app', path))).status, path).toBe(404);
    }
    for (const path of STUDIO_DEMO) {
      for (const method of ['POST','PUT','DELETE','PATCH','OPTIONS']) {
        expect(brandRouteAllowed(path, method), `${method} ${path}`).toBe(false);
        expect((await middleware(req('brand.twings.app', path, method, 'https://brand.twings.app'))).status, `${method} ${path}`).toBe(404);
      }
      expect(adminRouteAllowed(path, 'GET'), path).toBe(false);
      expect((await middleware(req('admin.twings.app', path))).status, `admin ${path}`).toBe(404);
      expect((await middleware(req('brands.twings.app', path))).status, `brands ${path}`).toBe(404);
    }
  });
});
