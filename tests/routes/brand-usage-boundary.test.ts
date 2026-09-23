import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Secondary-usage boundaries at the edge and between modules (docs/SECONDARY-USAGE.md): the brand host
 * allowlist, anonymous and cross-origin refusals, the daily tick's recovery pass, and isolation from
 * render billing. The route handlers are exercised with a real database in brand-usage-api.test.ts.
 */
const mocks = vi.hoisted(() => ({ viewer: vi.fn(), sql: vi.fn(), reconcile: vi.fn(), renderPass: vi.fn() }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({ user: null, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: mocks.sql }));
vi.mock('@/lib/renders/runtime', () => ({ runLiveRenderPass: mocks.renderPass, formatPassReport: () => 'ok' }));
vi.mock('@/lib/identity/portrait-runtime', () => ({ portraitDeps: async () => null }));
vi.mock('@/lib/brands/usage/payment', async (original) => ({ ...(await original<object>()), reconcileBrandUsagePayments: mocks.reconcile }));
vi.mock('next/server', async (original) => ({ ...(await original<object>()), after: () => undefined }));
import { middleware } from '@/middleware';
import { POST as usage, GET as usageStatus } from '@/app/api/brand-workspace/usage/route';
import { POST as workspace } from '@/app/api/brand-workspace/route';
import { GET as tick } from '@/app/api/renders/tick/route';

const req = (host: string, path: string, method = 'GET', origin?: string) => new NextRequest(`https://${host}${path}`, { method, headers: { host, ...(origin ? { origin } : {}) } });
const post = (path: string, origin: string, body: unknown = { operation: 'order.create', input: {} }) => new NextRequest(`https://brand.twings.app${path}`, {
  method: 'POST', headers: { host: 'brand.twings.app', origin, 'sec-fetch-site': origin === 'https://brand.twings.app' ? 'same-origin' : 'cross-site', 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('brand usage edge boundary', () => {
  it('the brand host lets only same-origin usage writes through and the pay pages go through sign-in', async () => {
    expect((await middleware(req('brand.twings.app', '/api/brand-workspace/usage', 'POST', 'https://brand.twings.app'))).headers.get('x-middleware-next')).toBe('1');
    expect((await middleware(req('brand.twings.app', '/api/brand-workspace/usage', 'POST', 'https://evil.test'))).status).toBe(404);
    expect((await middleware(req('brand.twings.app', '/api/brand-workspace/usage', 'DELETE', 'https://brand.twings.app'))).status).toBe(404);
    expect((await middleware(req('brand.twings.app', '/api/brand-workspace/usage/anything', 'POST', 'https://brand.twings.app'))).status).toBe(404);
    expect((await middleware(req('brands.twings.app', '/api/brand-workspace/usage', 'POST', 'https://brands.twings.app'))).status).toBe(404);
    for (const path of ['/brand/projects/p/usage/c/pay', '/brand/usage/return'])
      expect(new URL((await middleware(req('brand.twings.app', path))).headers.get('location')!).pathname).toBe('/auth/choose');
  });
  it('refuses anonymous and cross-origin requests before reading anything', async () => {
    mocks.viewer.mockResolvedValue({ userId: null, isAdmin: false });
    expect((await usage(post('/api/brand-workspace/usage', 'https://brand.twings.app'))).status).toBe(401);
    expect((await usageStatus(new NextRequest('https://brand.twings.app/api/brand-workspace/usage?orderId=x', { headers: { host: 'brand.twings.app' } }))).status).toBe(401);
    expect((await workspace(post('/api/brand-workspace', 'https://brand.twings.app', { operation: 'usage.accept', input: {} }))).status).toBe(401);
    mocks.viewer.mockResolvedValue({ userId: 'a0000000-0000-4000-8000-000000000001', isAdmin: false });
    expect((await usage(post('/api/brand-workspace/usage', 'https://evil.test'))).status).toBe(403);
    expect((await workspace(post('/api/brand-workspace', 'https://evil.test', { operation: 'usage.inquire', input: {} }))).status).toBe(403);
    expect(mocks.sql).not.toHaveBeenCalled();
  });
  it('the existing daily tick also runs the usage payment recovery pass', async () => {
    vi.stubEnv('CRON_SECRET', '');
    mocks.sql.mockResolvedValue({ query: vi.fn() });
    mocks.renderPass.mockResolvedValue({ errors: [] });
    mocks.reconcile.mockResolvedValue({ checked: 3 });
    const r = await tick(new Request('https://twings.app/api/renders/tick'));
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect((await r.json()).brandUsage).toEqual({ checked: 3 });
    vi.unstubAllEnvs();
  });
  it('usage code never touches render billing, the render queue or the public render flag', () => {
    const root = join(process.cwd(), 'lib/brands/usage');
    const files = [...readdirSync(root).map((f) => join(root, f)), join(process.cwd(), 'app/api/brand-workspace/usage/route.ts')];
    for (const file of files) {
      // Code only: comments may name what the module deliberately does not do.
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
      expect(source, file).not.toMatch(/billing_payments|RENDER_PIPELINE_PUBLIC|createRenderJob|@\/lib\/renders|toss-service/);
    }
  });
});
