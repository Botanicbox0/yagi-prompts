import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const context = vi.hoisted(() => ({ surface: 'consumer' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-twings-surface': context.surface, 'x-twings-locale': 'ko' }),
  cookies: async () => ({ get: () => undefined }),
}));
import ChooseProviderPage from '@/app/(app)/auth/choose/page';
const page = async (params: Record<string, string> = {}) => renderToStaticMarkup(await ChooseProviderPage({ searchParams: Promise.resolve({ locale: 'ko', ...params }) }));

describe('brand login experience', () => {
  beforeEach(() => { context.surface = 'consumer'; });
  it('explains the brand workflow on the brand host even without a next parameter', async () => {
    context.surface = 'brand';
    const html = await page();
    expect(html).toContain('data-brand-auth');
    expect(html).toContain('data-brand-auth-showcase');
    expect(html).toContain('목표와 예산');
    expect(html).toContain('next=%2Fbrand');
    expect(html).toContain('https://twings.app/ko/legal/terms');
    expect(html).toContain('https://twings.app/reel/campaigns/');
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
  it('renders English copy and usable non-JavaScript login links with a static initial showcase', async () => {
    const html = await page({ next: '/brand', locale: 'en' });
    expect(html).toContain('From the first brief');
    expect(html).toContain('data-brand-auth-showcase');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('href="/auth/signin?provider=google');
    expect(html).not.toContain('목표와 예산');
  });
});
