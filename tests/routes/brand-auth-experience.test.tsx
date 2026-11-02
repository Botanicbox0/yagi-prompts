import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const context = vi.hoisted(() => ({ surface: 'consumer' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-twings-surface': context.surface, 'x-twings-locale': 'ko' }),
  cookies: async () => ({ get: () => undefined }),
}));
import ChooseProviderPage from '@/app/(app)/auth/choose/page';
import OpenInBrowserPage from '@/app/(app)/auth/open-in-browser/page';
const page = async (params: Record<string, string> = {}) => renderToStaticMarkup(await ChooseProviderPage({ searchParams: Promise.resolve({ locale: 'ko', ...params }) }));

describe('brand login experience', () => {
  beforeEach(() => { context.surface = 'consumer'; });
  it('explains the brand workflow on the brand host even without a next parameter', async () => {
    context.surface = 'brand';
    const html = await page();
    expect(html).toContain('data-brand-auth');
    expect(html).toContain('data-brand-auth-stage');
    expect(html).toContain('AI 미디어 엔진');
    expect(html).toContain('next=%2Fbrand');
    expect(html).toContain('https://twings.app/ko/legal/terms');
    // Public media of the landing's demo brand, from the host that serves it; playback starts in the island.
    expect(html).toContain('https://twings.app/reel/landing/cut-beads.webp');
    expect(html).toContain('https://twings.app/reel/landing/v7/feed-blue.mp4');
    expect(html).not.toContain('autoPlay=');
    // Clearly a demo brand, not a client: the kit carries the example label.
    expect(html).toContain('data-brand-auth-kit');
    expect(html).toContain('YAGI 데모 브랜드');
    expect(html).not.toContain('가상 브랜드');
    // A login stays calm: not the landing's fast-cut dark hero again.
    expect(html).not.toContain('v7/hero');
    // The act is the page's heading; the category line beside it is not.
    expect(html.match(/<h1[^>]*>[^<]*/)?.[0]).toContain('로그인 또는 회원가입');
    // One message: the old agency pitch and its pink carousel stay gone.
    expect(html).not.toContain('목표와 예산');
    expect(html).not.toContain('public-content/');
    expect(html).not.toContain('helvetica-neue');
  });
  it('keeps invitation return paths, OAuth errors, legal consent and both providers in server HTML', async () => {
    const html = await page({ next: '/brand/invite?token=example', error: 'oauth' });
    expect(html).toContain('data-brand-auth');
    expect(html).toContain('next=%2Fbrand%2Finvite%3Ftoken%3Dexample');
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-auth-provider="google"');
    expect(html).toContain('data-auth-provider="kakao"');
    expect(html).toContain('data-auth-legal');
    expect(html).toContain('data-auth-language');
  });
  it('does not present the brand experience to consumer, admin or invalid return paths', async () => {
    for (const next of ['/ko/video', '/admin', 'https://evil.invalid/brand', '/brand/twings.svg']) {
      expect(await page({ next })).not.toContain('data-brand-auth');
    }
    context.surface = 'admin';
    expect(await page({ next: '/brand' })).not.toContain('data-brand-auth');
  });
  it('offers no "back" link that would only redirect to this same sign-in page', async () => {
    context.surface = 'brand';
    for (const next of ['/brand', '/brand/projects/example', '/brand/members']) {
      expect(await page({ next })).not.toContain('data-auth-back');
    }
    // The invitation landing is readable signed out, so going back there is real.
    expect(await page({ next: '/brand/invite?token=example' })).toContain('data-auth-back');
    context.surface = 'admin';
    expect(await page({ next: '/admin' })).not.toContain('data-auth-back');
    context.surface = 'consumer';
    expect(await page({ next: '/ko/video' })).toContain('data-auth-back');
  });
  it('renders English copy and usable non-JavaScript login links with a static initial showcase', async () => {
    const html = await page({ next: '/brand', locale: 'en' });
    expect(html).toContain('Your brand');
    expect(html).toContain('data-brand-auth-stage');
    expect(html).toContain('data-brand-auth-pause');
    expect(html).toContain('href="/auth/signin?provider=google');
    expect(html).not.toContain('목표와 예산');
  });
  it('tells invited readers which account to use', async () => {
    const invited = await page({ next: '/brand/invite' });
    expect(invited).toContain('초대받은 이메일 계정으로 로그인해 주세요');
    expect(invited.match(/<h1[^>]*>[^<]*/)?.[0]).toContain('초대를 수락하려면');
    expect(await page({ next: '/brand' })).not.toContain('초대받은 이메일 계정으로');
  });
  it('keeps the consumer and admin doors as they were', async () => {
    for (const surface of ['consumer', 'admin']) {
      context.surface = surface;
      const html = await page({ next: surface === 'admin' ? '/admin' : '/ko/video' });
      expect(html).not.toContain('data-brand-auth');
      expect(html).toContain('rounded-[4px]');
      expect(html).toContain('data-auth-provider="kakao"');
    }
  });
  it('gives only brand readers the brand open-in-browser card, with the same copy and address', async () => {
    const webview = async (next: string) => renderToStaticMarkup(await OpenInBrowserPage({ searchParams: Promise.resolve({ locale: 'ko', next }) }));
    const brand = await webview('/brand');
    expect(brand).toContain('data-webview-interstitial');
    expect(brand).toContain('data-brand-auth');
    expect(brand).toContain('기본 브라우저에서 열어 주세요.');
    expect(brand).toContain('data-webview-next');
    const consumer = await webview('/ko/video');
    expect(consumer).toContain('data-webview-interstitial');
    expect(consumer).not.toContain('data-brand-auth');
    context.surface = 'admin';
    expect(await webview('/brand')).not.toContain('data-brand-auth');
  });
});
