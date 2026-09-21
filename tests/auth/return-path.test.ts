import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signInWithOAuth: vi.fn(),
}));
vi.mock('@/lib/supabase/auth-client', () => ({
  getSessionUser: auth.getSessionUser,
  createAuthServerClient: async () => ({ auth }),
}));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));

import { GET as signIn } from '@/app/auth/signin/route';
import { GET as callback } from '@/app/auth/callback/route';

describe('OAuth return paths remain on the request origin', () => {
  it('detects the brand sign-in language before choosing a provider, while a URL choice wins', async () => {
    auth.getSessionUser.mockResolvedValue(null);
    for (const [country, query, expected] of [['KR', '', 'ko'], ['US', '', 'en'], ['KR', '&locale=en', 'en']]) {
      const response = await signIn(new NextRequest(`https://brand.twings.app/auth/signin?next=%2Fbrand${query}`, {
        headers: { 'x-vercel-ip-country': country!, 'accept-language': 'en' },
      }));
      const location = new URL(response.headers.get('location')!);
      expect(location.pathname).toBe('/auth/choose');
      expect(location.searchParams.get('locale')).toBe(expected);
      expect(location.searchParams.get('next')).toBe('/brand');
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getSessionUser.mockResolvedValue({ id: 'user' });
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
    vi.stubEnv('VERCEL_URL', 'yagi-prompts-example.vercel.app');
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const next of ['/\\evil.example/path', '/\t/evil.example/path', '//evil.example/path', 'https://evil.example/path']) {
    it(`rejects the already-signed-in redirect ${JSON.stringify(next)}`, async () => {
      const url = new URL('https://twings.app/auth/signin');
      url.searchParams.set('next', next);
      const response = await signIn(new NextRequest(url));
      expect(new URL(response.headers.get('location')!).origin).toBe(url.origin);
      expect(new URL(response.headers.get('location')!).pathname).toBe('/en/video');
    });
    it(`rejects the callback redirect ${JSON.stringify(next)}`, async () => {
      const url = new URL('https://twings.app/auth/callback?code=test-code');
      url.searchParams.set('next', next);
      const response = await callback(new NextRequest(url));
      expect(new URL(response.headers.get('location')!).origin).toBe(url.origin);
      expect(new URL(response.headers.get('location')!).pathname).toBe('/library');
    });
  }

  it('preserves local return path query and fragment on preview and local origins', async () => {
    for (const origin of ['https://yagi-prompts-example.vercel.app', 'http://localhost:3000']) {
      const url = new URL('/auth/signin', origin);
      url.searchParams.set('next', '/account?tab=notifications#settings');
      const response = await signIn(new NextRequest(url));
      expect(response.headers.get('location')).toBe(origin + '/account?tab=notifications#settings');
    }
  });

  it('keeps admin authentication returns in the admin path after URL normalization', async () => {
    for (const next of ['/ko/video', '/administrator', '/admin/../../ko', '/admin/%2e%2e/%2e%2e/ko', '/%5cevil.example', '/%2fevil.example']) {
      const url = new URL('https://admin.twings.app/auth/signin'); url.searchParams.set('next', next);
      const response = await signIn(new NextRequest(url));
      expect(response.headers.get('location')).toBe('https://admin.twings.app/admin');
    }
  });

  it('builds the PKCE callback on the validated admin request origin', async () => {
    auth.getSessionUser.mockResolvedValue(null);
    auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://provider.example/oauth' }, error: null });
    await signIn(new NextRequest('http://localhost:3001/auth/signin?provider=kakao&next=/admin/prompts', { headers: { host: 'admin.twings.app' } }));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'kakao', options: { redirectTo: 'http://admin.twings.app/auth/callback?next=%2Fadmin%2Fprompts&locale=en' } });
  });

  it('keeps brand PKCE, failures and post-login returns on the canonical brand surface', async () => {
    const signedIn = await signIn(new NextRequest('https://brand.twings.app/auth/signin?provider=kakao&next=/admin'));
    expect(signedIn.headers.get('location')).toBe('https://brand.twings.app/brand');
    auth.getSessionUser.mockResolvedValue(null);
    auth.signInWithOAuth.mockResolvedValue({data:{url:'https://provider.example/oauth'},error:null});
    await signIn(new NextRequest('https://brand.twings.app/auth/signin?provider=kakao&next=/brand/projects/example&locale=ko'));
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({provider:'kakao',options:{redirectTo:'https://brand.twings.app/auth/callback?next=%2Fbrand%2Fprojects%2Fexample&locale=ko'}});
    const failure = await callback(new NextRequest('https://brand.twings.app/auth/callback?next=/admin'));
    const target = new URL(failure.headers.get('location')!);
    expect(target.origin).toBe('https://brand.twings.app'); expect(target.pathname).toBe('/auth/choose');
    expect(target.searchParams.get('next')).toBe('/brand');
  });

  it('returns missing-code and OAuth failures to the same admin chooser', async () => {
    const missingCode = await callback(new NextRequest('https://admin.twings.app/auth/callback?next=/admin/prompts'));
    const location = new URL(missingCode.headers.get('location')!);
    expect(location.origin).toBe('https://admin.twings.app');
    expect(location.pathname).toBe('/auth/choose');
    expect(location.searchParams.get('next')).toBe('/admin/prompts');
    expect(location.searchParams.get('error')).toBe('oauth');
    auth.getSessionUser.mockResolvedValue(null);
    auth.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: {} });
    const failed = await signIn(new NextRequest('https://admin.twings.app/auth/signin?provider=kakao'));
    expect(new URL(failed.headers.get('location')!).pathname).toBe('/auth/choose');
  });
});
