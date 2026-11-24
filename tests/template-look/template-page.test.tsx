import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { postTemplateLook } from '@/components/template-look/look-island';
import { effectiveLook, lookSnapshot, resetLookStore } from '@/lib/template-look/store';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — a template page reached directly (a shared link, a search) is always viewable.
 * With the switch on, a template written for one style shows one quiet fact ("여성 스타일" / "남성 스타일"); the line
 * about a mismatch with the viewer's choice is client-only (empty in the cached HTML) and never blocks the button.
 */

const state = vi.hoisted(() => ({ look: false }));
const film = vi.hoisted(() => ({
  id: 'look-film', slug: 'sample-look-female', title: 'Runway walk (sample)', titleKo: '런웨이 워크 (예시)', medium: 'video',
  engine: 'seedance-2.5', runtimeSeconds: 11, aspectDefault: '9:16', priceCents: 400, priceKrw: 4900, price1080Cents: 0, price1080Krw: 0,
  source: 'yagi', origin: 'studio', authorHandle: null, makerProfile: false, recipeOpen: false, models: [], modelLabels: [], useCase: [],
  poster: null, video: null, lock: null, featured: false, publishedAt: null, look: 'female',
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/flags', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/flags')>()), templateLookOpen: () => state.look }));
vi.mock('@/lib/creator-subscriptions/cached-availability', () => ({
  cachedSubscriptionAvailability: async () => ({ status: 'preparing', version: 'verified', plans: { creator: { status: 'preparing' }, premium: { status: 'preparing' } }, editing: 'preparing', premiumEditRequestsPerPeriod: null }),
}));
vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [film], image: [], makers: [] }) }));
vi.mock('@/lib/campaigns/public-catalog', () => ({ getCampaignCatalog: async () => ({ campaigns: [] }) }));
vi.mock('@/lib/recipes/cached-public', () => ({ cachedPublicRecipe: async () => null }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/prompts/detail-media', () => ({ PromptDetailMedia: () => null }));
vi.mock('@/components/prompts/poster', () => ({ TypographicPoster: () => null, posterRatio: () => '9 / 16' }));
vi.mock('@/lib/db/connect', () => ({ getSqlRunner: async () => null }));

import TemplatePage from '@/app/(marketing)/[locale]/t/[slug]/page';

const page = async (locale: 'ko' | 'en') => renderToStaticMarkup(await TemplatePage({ params: Promise.resolve({ locale, slug: film.slug }) }));
const facts = (html: string) => html.slice(html.indexOf('data-template-facts'), html.indexOf('</dl>', html.indexOf('data-template-facts')));

afterEach(() => {
  state.look = false;
  resetLookStore();
});

describe('the template page and the template style', () => {
  it('switch off: no style fact, no style words anywhere', async () => {
    const html = await page('ko');
    expect(facts(html)).not.toContain('여성 스타일');
    expect(html).not.toContain('data-look');
  });

  it('switch on: one quiet fact for a one-style template, in both languages', async () => {
    state.look = true;
    const ko = await page('ko');
    expect(facts(ko)).toContain('<dt class="sr-only">스타일</dt><dd class="inline font-medium text-black/80">여성 스타일</dd>');
    const en = await page('en');
    expect(facts(en)).toContain('Women&#x27;s styles');
    // Never a gender word; never in the structured data.
    expect(ko).not.toMatch(/성별/);
    const jsonLd = ko.slice(ko.indexOf('application/ld+json'), ko.indexOf('</script>', ko.indexOf('application/ld+json')));
    expect(jsonLd).not.toMatch(/여성 스타일|Women's|"look"/);
  });

  it('switch on: the mismatch line is not in the cached HTML, and the make button is untouched', async () => {
    state.look = true;
    const html = await page('ko');
    expect(html).not.toContain('data-look-mismatch');
    expect(html).toContain('data-make-cta');
  });
});

describe('storing the choice from the browser', () => {
  it('records the choice for every island when the route stored it', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, look: 'male' }), { status: 200 }));
    expect(await postTemplateLook('male', fetchImpl as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/account/template-look');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"look":"male"}');
    expect(effectiveLook(lookSnapshot())).toBe('male');
  });

  it('changes nothing when the route refused or the network failed', async () => {
    expect(await postTemplateLook('female', (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch)).toBe(false);
    expect(await postTemplateLook('female', (async () => { throw new Error('offline'); }) as unknown as typeof fetch)).toBe(false);
    expect(effectiveLook(lookSnapshot())).toBeNull();
  });
});
