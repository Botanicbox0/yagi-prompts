import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({ user: { id: 'fixture' }, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
import { middleware } from '@/middleware';
import { createNonce, workspaceCsp } from '@/lib/security/workspace-csp';

/**
 * The workspace pages' CSP (lib/security/workspace-csp.ts): a per-request nonce the render can read,
 * the same policy on the response, and nothing changed for the public site.
 */
const req = (host: string, path: string) => new NextRequest(`https://${host}${path}`, { headers: { host } });
const directives = (csp: string) => Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
const NONCE = /'nonce-([A-Za-z0-9+/=]{22,})'/;

describe('workspace CSP', () => {
  it.each([
    ['brand.twings.app', '/brand'],
    ['brand.twings.app', '/brand/projects/new'],
    ['brand.twings.app', '/auth/choose?next=%2Fbrand'],
    ['admin.twings.app', '/admin'],
    ['admin.twings.app', '/admin/brand-workspace'],
    ['localhost', '/brand/projects/new'],
    ['localhost', '/admin/brand-workspace'],
  ])('sends a strict nonce policy on %s%s and hands the same nonce to the render', async (host, path) => {
    const response = await middleware(req(host, path));
    const csp = response.headers.get('content-security-policy') ?? '';
    const d = directives(csp);
    expect(d['script-src']).toContain("'strict-dynamic'");
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    const nonce = csp.match(NONCE)?.[1];
    expect(nonce).toBeTruthy();
    // Next.js reads the nonce from the request's CSP header; the page reads `x-nonce`.
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(csp);
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
  });

  it('uses a fresh nonce for every request', async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 5; i++) nonces.add((await middleware(req('brand.twings.app', '/brand'))).headers.get('content-security-policy')!.match(NONCE)![1]!);
    expect(nonces.size).toBe(5);
  });

  it('ignores a CSP or nonce the browser sent', async () => {
    const forged = new NextRequest('https://brand.twings.app/brand', { headers: { host: 'brand.twings.app', 'content-security-policy': "script-src 'nonce-forged'", 'x-nonce': 'forged' } });
    const response = await middleware(forged);
    expect(response.headers.get('x-middleware-request-x-nonce')).not.toBe('forged');
    expect(response.headers.get('content-security-policy')).not.toContain('forged');
  });

  it('leaves the public site to its own policy', async () => {
    for (const [host, path] of [['twings.app', '/ko'], ['twings.app', '/ko/campaigns']] as const) {
      const response = await middleware(req(host, path));
      expect(response.headers.get('content-security-policy')).toBeNull();
      expect(response.headers.get('x-middleware-request-x-nonce')).toBeNull();
    }
  });

  it('allows eval only outside a production build', () => {
    expect(workspaceCsp('n', true)).not.toContain('unsafe-eval');
    expect(workspaceCsp('n', false)).toContain("'unsafe-eval'");
    expect(createNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
