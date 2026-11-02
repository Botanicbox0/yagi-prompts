import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const context = vi.hoisted(() => ({ refresh: false }));
vi.mock('@supabase/ssr', () => ({ createServerClient: (_url: string, _key: string, options: { cookies: { setAll: (values: Array<{ name: string; value: string }>, headers: Record<string, string>) => void } }) => ({ auth: { getUser: async () => {
  if (context.refresh) options.cookies.setAll([{ name: 'fixture-auth', value: 'refreshed-fixture' }], { 'Cache-Control': 'private, no-store', Pragma: 'no-cache', Expires: '0' });
  return { data: { user: { id: 'fixture-owner' } } };
} } }) }));
import { updateSession, withCookies } from '@/lib/supabase/middleware';

describe('session refresh forwarded into the same server render', () => {
  beforeEach(() => { context.refresh = false; vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-only-key'); });
  afterEach(() => vi.unstubAllEnvs());
  it('forwards refreshed cookies in the cloned request headers and prevents caching them', async () => {
    context.refresh = true;
    const request = new NextRequest('https://twings.app/account', { headers: { cookie: 'fixture-auth=old-fixture' } });
    const headers = new Headers(request.headers); headers.set('x-playbook-locale', 'ko');
    const { response } = await updateSession(request, headers);
    expect(response.headers.get('x-middleware-request-cookie')).toContain('fixture-auth=refreshed-fixture');
    expect(response.headers.get('x-middleware-request-x-playbook-locale')).toBe('ko');
    expect(response.cookies.get('fixture-auth')?.value).toBe('refreshed-fixture');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('pragma')).toBe('no-cache');
    const redirect = withCookies(NextResponse.redirect('https://twings.app/ko'), response);
    expect(redirect.headers.get('cache-control')).toBe('private, no-store');
    expect(redirect.headers.get('pragma')).toBe('no-cache');
    expect(redirect.cookies.get('fixture-auth')?.value).toBe('refreshed-fixture');
  });
  it('does not make anonymous public page HTML private when no token is refreshed', async () => {
    const { response } = await updateSession(new NextRequest('https://twings.app/ko'), new Headers());
    expect(response.headers.get('cache-control')).toBeNull();
  });
});
