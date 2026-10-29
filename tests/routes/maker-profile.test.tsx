import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PromptCard, PublicMaker } from '@/lib/prompts/catalog';
import { en } from '@/messages/en';

/**
 * docs/PLATFORM-2.0.md §7.5 — `/{locale}/makers/{handle}`. A page exists only for a maker in the
 * catalogue's public list (they opted in, 0060); anything else is a real 404, and a page that does
 * exist is indexable, with canonical + hreflang.
 */

const state = vi.hoisted(() => ({ makers: [] as PublicMaker[], video: [] as PromptCard[] }));
vi.mock('server-only', () => ({}));
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
  state.makers = [{ handle: 'jun_01', bio: 'AI 영상 템플릿을 만듭니다.', templateCount: 1, latestPublishedAt: '2026-10-20T00:00:00.000Z' }];
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
    state.makers = [{ handle: 'jun_01', bio: null, templateCount: 1, latestPublishedAt: null }];
    expect(await outcome('nobody_here')).toBe('404');
    expect(await outcome('..%2Fadmin')).toBe('404');
    expect(await outcome('a')).toBe('404');
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

  it('speaks English on /en with the English bio, and names itself the recipe page while a recipe is open', async () => {
    state.makers = [{ handle: 'jun_01', bio: 'AI 영상 템플릿을 만듭니다.', bioEn: 'I make AI video templates.', templateCount: 1, openRecipeCount: 1, latestPublishedAt: null }];
    state.video = [card('maker-golden-hour', { recipeOpen: true })];
    const html = renderToStaticMarkup(await MakerPage(params('jun_01', 'en')));
    expect(html).toContain('I make AI video templates.');
    expect(html).not.toContain('AI 영상 템플릿을 만듭니다.');
    expect(html).toContain('data-maker-recipe-hub');
    expect(html).toContain('data-card-recipe');
    expect((await generateMetadata(params('jun_01', 'en'))).description).toBe('I make AI video templates.');
    // The Korean page keeps the bio the maker wrote first.
    expect(renderToStaticMarkup(await MakerPage(params('jun_01', 'ko')))).toContain('AI 영상 템플릿을 만듭니다.');
    // No open recipe, no recipe claim.
    state.makers = [{ ...state.makers[0]!, openRecipeCount: 0 }];
    expect(await outcome('jun_01')).not.toContain('data-maker-recipe-hub');
  });
});
