import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PromptCard, PublicMaker } from '@/lib/prompts/catalog';
import { en } from '@/messages/en';

/**
 * docs/PLATFORM-2.0.md §7.5 — `/{locale}/makers/{handle}`. A page exists only for a maker in the
 * catalogue's public list (they opted in, 0060); anything else is a real 404, and a page that does
 * exist is indexable, with canonical + hreflang.
 */

const state = vi.hoisted(() => ({ makers: [] as PublicMaker[], video: [] as PromptCard[], works: [] as unknown[] }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/makers/cached-public', () => ({ cachedPublicWorks: async () => state.works }));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: state.video, image: [], makers: state.makers }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw Object.assign(new Error('NEXT_NOT_FOUND'), { notFound: true }); },
  permanentRedirect: (to: string) => { throw Object.assign(new Error('NEXT_REDIRECT'), { to }); },
}));

import MakerPage, { generateMetadata, revalidate } from '@/app/(marketing)/[locale]/makers/[handle]/page';

const base = {
  id: 'x', title: 'Golden hour', titleKo: '골든 아워', source: 'yagi', models: [], modelLabels: [], useCase: [], medium: 'video',
  priceCents: 0, priceKrw: 0, price1080Cents: 0, price1080Krw: 0, runtimeSeconds: 15, engine: null, aspectDefault: '9:16',
  poster: null, video: null, lock: null, featured: false, publishedAt: '2026-10-20T00:00:00.000Z',
} as const;
const card = (slug: string, overrides: Partial<PromptCard> = {}): PromptCard => ({ ...base, slug, authorHandle: 'jun_01', origin: 'maker', makerProfile: true, ...overrides } as PromptCard);

/** A public creative with only what 0060 knew; tests add the 0065 fields they need. */
const maker = (overrides: Partial<PublicMaker> = {}): PublicMaker => ({
  handle: 'jun_01', bio: null, displayName: null, headline: null, country: null, city: null, links: [], publicEmail: null, tools: [],
  openToBrands: false, avatar: null, templateCount: 1, latestPublishedAt: null, ...overrides,
});

const params = (handle: string, locale = 'ko') => ({ params: Promise.resolve({ locale, handle }) });
async function outcome(handle: string): Promise<string> {
  try {
    return renderToStaticMarkup(await MakerPage(params(handle)));
  } catch (error) {
    const e = error as { notFound?: boolean; to?: string };
    if (e.notFound) return '404';
    if (e.to) return `redirect ${e.to}`;
    throw error;
  }
}

beforeEach(() => {
  state.makers = [maker({ bio: 'AI 영상 템플릿을 만듭니다.', latestPublishedAt: '2026-10-20T00:00:00.000Z' })];
  state.works = [];
  state.video = [card('maker-golden-hour'), card('someone-else', { authorHandle: 'other' }), card('studio-one', { origin: 'studio', authorHandle: null, makerProfile: false })];
});

describe('maker profile route', () => {
  it('is static with the catalogue TTL', () => {
    expect(revalidate).toBe(3600);
  });

  it("renders a public maker's handle, bio, count and only their templates in the 2-column grid", async () => {
    const html = await outcome('jun_01');
    expect(html).toContain('data-maker-profile="jun_01"');
    expect(html).toContain('@jun_01');
    expect(html).toContain('AI 영상 템플릿을 만듭니다.');
    expect(html).toContain('템플릿 1편');
    expect(html).toContain('data-prompt-card="maker-golden-hour"');
    expect(html).not.toContain('data-prompt-card="someone-else"');
    expect(html).not.toContain('data-prompt-card="studio-one"');
    expect(html).toContain('grid-cols-2');
    expect(html).toContain('data-frame="portrait"');
  });

  it('is a 404 for a maker who is not public, a handle that never existed, and a malformed one', async () => {
    state.makers = [];
    expect(await outcome('jun_01')).toBe('404');
    state.makers = [maker()];
    expect(await outcome('nobody_here')).toBe('404');
    expect(await outcome('..%2Fadmin')).toBe('404');
    expect(await outcome('a')).toBe('404');
  });

  it('shows who the creative is: name, headline, place, tools, links, works — and the email only behind a button', async () => {
    state.makers = [maker({
      displayName: 'Jun Park', headline: 'AI director making fashion films', country: 'KR', city: 'Seoul', tools: ['Seedance 2.5', 'Midjourney'],
      links: [{ kind: 'instagram', url: 'https://www.instagram.com/jun.films/' }, { kind: 'website', url: 'https://jun.studio/' }],
      publicEmail: 'hello@jun.studio', openToBrands: true, avatar: '/api/makers/media/avatar-jun_01?v=abcdef0123456789',
    })];
    state.works = [{ id: `wrk_${'a'.repeat(32)}`, kind: 'image', mime: 'image/jpeg', width: 1200, height: 1500, title: 'Neon diner', caption: null, linkUrl: null, position: 0 }];
    const html = await outcome('jun_01');
    expect(html).toContain('Jun Park');
    expect(html).toContain('@jun_01');
    expect(html).toContain('data-creative-headline');
    expect(html).toContain('Seoul, 대한민국');
    expect(html).toContain('data-creative-open');
    expect(html).toContain('data-creative-link="instagram"');
    expect(html).toContain('@jun.films');
    expect(html).toContain('Seedance 2.5');
    expect(html).toContain(`data-creative-work="wrk_${'a'.repeat(32)}"`);
    expect(html).toContain(`/creative-media/wrk_${'a'.repeat(32)}.jpg`);
    expect(html).toContain('avatar-jun_01?v=abcdef0123456789');
    // The address is in the page only reversed, for the button to assemble — never as text or a mailto.
    expect(html).not.toContain('hello@jun.studio');
    expect(html).toContain('data-creative-email="hidden"');
    // ProfilePage → Person, with the links as sameAs.
    const ld = JSON.parse(/<script id="creative-structured-data" type="application\/ld\+json">(.*?)<\/script>/.exec(html)![1]!);
    expect(ld).toMatchObject({ '@type': 'ProfilePage', mainEntity: { '@type': 'Person', name: 'Jun Park', alternateName: '@jun_01', sameAs: ['https://www.instagram.com/jun.films/', 'https://jun.studio/'] } });
    expect(JSON.stringify(ld)).not.toContain('hello@jun.studio');
  });

  it('sends "@handle" and capitals to the one canonical address', async () => {
    expect(await outcome('%40jun_01')).toBe('redirect /ko/makers/jun_01');
    expect(await outcome('JUN_01')).toBe('redirect /ko/makers/jun_01');
  });

  it('is indexable, with canonical, hreflang and profile OG metadata', async () => {
    const meta = await generateMetadata(params('jun_01', 'en'));
    expect(meta.robots).toBeUndefined();
    expect(meta.alternates?.canonical).toBe('/en/makers/jun_01');
    expect(meta.alternates?.languages).toEqual({ en: '/en/makers/jun_01', ko: '/ko/makers/jun_01', 'x-default': '/en/makers/jun_01' });
    expect(meta.title).toBe(en.makers.metaTitle.replace('{handle}', 'jun_01'));
    expect(meta.description).toBe('AI 영상 템플릿을 만듭니다.');
    expect(meta.openGraph).toMatchObject({ type: 'profile', url: '/en/makers/jun_01' });
    state.makers = [];
    expect((await generateMetadata(params('jun_01'))).robots).toEqual({ index: false, follow: false });
  });
});
