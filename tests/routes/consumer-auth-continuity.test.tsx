import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/** Audit P2-12 and P3: the sign-in chooser and the selfie page keep the reader's way back. */
const viewer = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-twings-surface': 'consumer', 'x-playbook-locale': 'ko' }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/auth/viewer', () => ({ getViewer: async () => ({ userId: viewer.userId, email: null, isAdmin: false, tier: 'free', locale: 'ko' }) }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));
// The selfie page carries the app header, whose locale toggle is a server action module.
vi.mock('@/app/actions/locale', () => ({ setLocaleAction: async () => undefined }));

import ChooseProviderPage from '@/app/(app)/auth/choose/page';
import SelfiePage from '@/app/(app)/identity/selfie/page';

const chooser = async (params: Record<string, string>) =>
  renderToStaticMarkup(await ChooseProviderPage({ searchParams: Promise.resolve({ locale: 'ko', ...params }) }));
const back = (html: string) => /<a href="([^"]*)" data-auth-back/.exec(html)?.[1] ?? null;

describe('consumer chooser back link', () => {
  it('never points at a gated page that would bounce straight back here', async () => {
    for (const next of ['/renders/abc', '/account', '/campaigns/x/apply', '/identity/verify?next=%2Fko']) {
      expect(back(await chooser({ next })), next).toBe('/ko');
    }
  });

  it('still returns to a public page', async () => {
    expect(back(await chooser({ next: '/ko/t/tpl' }))).toBe('/ko/t/tpl');
  });

  it('the consent line is no longer faded to 50%', async () => {
    const consent = /data-auth-legal="[^"]*" class="([^"]*)"/.exec(await chooser({ next: '/ko/video' }))?.[1] ?? '';
    expect(consent).toContain('legal');
    expect(consent).not.toContain('opacity');
  });
});

describe('selfie page sign-in redirect', () => {
  beforeEach(() => {
    viewer.userId = null;
  });

  async function target(query: { next?: string }): Promise<string> {
    try {
      await SelfiePage({ searchParams: Promise.resolve(query) });
    } catch (error) {
      return String((error as { digest?: string }).digest ?? '').split(';')[2] ?? '';
    }
    throw new Error('expected a redirect');
  }

  it('keeps next through the chooser', async () => {
    expect(await target({ next: '/ko/t/tpl#make' })).toBe(`/auth/choose?next=${encodeURIComponent('/identity/selfie?next=%2Fko%2Ft%2Ftpl%23make')}`);
  });

  it('drops an unsafe next and keeps the plain return', async () => {
    for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example']) {
      expect(await target({ next })).toBe('/auth/choose?next=%2Fidentity%2Fselfie');
    }
    expect(await target({})).toBe('/auth/choose?next=%2Fidentity%2Fselfie');
  });
});
