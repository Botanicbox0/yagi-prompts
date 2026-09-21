import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { renderToStaticMarkup } from 'react-dom/server';
const context = vi.hoisted(() => ({ headers: new Headers(), cookie: '' }));
vi.mock('next/headers', () => ({ headers: async () => context.headers, cookies: async () => ({ get: () => context.cookie ? { value: context.cookie } : undefined }) }));
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: async (_r: NextRequest, headers: Headers) => ({ user: null, response: NextResponse.next({ request: { headers } }) }),
  withCookies: (response: NextResponse) => response,
}));
vi.mock('@/lib/auth/dev-identity', () => ({ devIdentityUserId: () => null }));
import { middleware } from '@/middleware';
import { LOCALE_COOKIE, LOCALE_HEADER } from '@/lib/i18n/config';
import { getRequestLocale } from '@/lib/i18n/server';
import ChooseProviderPage from '@/app/(app)/auth/choose/page';

const request = (path: string, signals: Record<string, string> = {}, host = 'brand.twings.app') =>
  new NextRequest(`https://${host}${path}`, { headers: { host, ...signals } });
describe('brand first-visit locale', () => {
  beforeEach(() => { context.headers = new Headers(); context.cookie = ''; });
  it.each([['KR', 'en', 'ko'], ['US', 'ko', 'en'], ['JP', 'ko', 'en'], ['', 'ko-KR', 'ko'], ['XX', 'ko', 'ko']])('country %s with browser %s selects %s', async (country, browser, expected) => {
    const response = await middleware(request('/brand', { 'x-vercel-ip-country': country!, 'accept-language': browser! }));
    const target = new URL(response.headers.get('location')!);
    expect(target.searchParams.get('locale')).toBe(expected);
    expect(target.searchParams.get('next')).toBe('/brand');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('honors saved choice before geography and leaves consumer routing unchanged', async () => {
    const saved = await middleware(request('/brand', { cookie: `${LOCALE_COOKIE}=en`, 'x-vercel-ip-country': 'KR' }));
    expect(new URL(saved.headers.get('location')!).searchParams.get('locale')).toBe('en');
    const consumer = await middleware(request('/', { 'x-vercel-ip-country': 'KR', 'accept-language': 'en' }, 'twings.app'));
    expect(new URL(consumer.headers.get('location')!).pathname).toBe('/en');
  });
  it('uses region on a direct chooser visit and honors an explicit locale over an old cookie', async () => {
    const auto = await middleware(request('/auth/choose?next=%2Fbrand', { 'x-vercel-ip-country': 'KR', 'accept-language': 'en' }));
    expect(auto.headers.get(`x-middleware-request-${LOCALE_HEADER}`)).toBe('ko');
    const manual = await middleware(request('/auth/choose?next=%2Fbrand&locale=en', { cookie: `${LOCALE_COOKIE}=ko`, 'x-vercel-ip-country': 'KR' }));
    expect(manual.headers.get(`x-middleware-request-${LOCALE_HEADER}`)).toBe('en');
    expect(manual.cookies.get(LOCALE_COOKIE)?.value).toBe('en');
    context.headers.set(LOCALE_HEADER, 'en'); context.cookie = 'ko';
    expect(await getRequestLocale()).toBe('en');
  });
  it('renders the detected language and carries it through provider links; explicit links stay explicit', async () => {
    context.headers.set(LOCALE_HEADER, 'ko');
    const html = renderToStaticMarkup(await ChooseProviderPage({ searchParams: Promise.resolve({ next: '/brand' }) }));
    expect(html).toContain('로그인 또는 회원가입');
    expect(html).toContain('next=%2Fbrand&amp;locale=ko');
    expect(html).toContain('data-auth-language');
    const english = renderToStaticMarkup(await ChooseProviderPage({ searchParams: Promise.resolve({ next: '/brand', locale: 'en' }) }));
    expect(english).not.toContain('로그인 또는 회원가입');
  });
});
