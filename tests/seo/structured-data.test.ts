import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { FAQ_CATALOG, FAQ_CATEGORIES, faqItems } from '@/lib/faq/catalog';
import type { PromptCard } from '@/lib/prompts/catalog';
import { campaignServiceStructuredData, faqStructuredData, siteStructuredData, templateStructuredData } from '@/lib/seo/structured-data';
import { serializeJsonLd } from '@/lib/seo/json-ld';

const origin = 'https://twings.example';
const card: PromptCard = {
  id: 'template', slug: 'portrait', source: 'yagi', title: 'Portrait', titleKo: '인물 영상',
  authorHandle: null, models: [], modelLabels: [], useCase: [], medium: 'video',
  priceCents: 400, priceKrw: 5900, price1080Cents: 0, price1080Krw: 0, runtimeSeconds: 15, engine: null, aspectDefault: null,
  poster: { source: 'public', src: '/poster.jpg', mime: 'image/jpeg' },
  video: { source: 'public', src: '/example.mp4', mime: 'video/mp4', duration_s: 8.5 },
  lock: null, featured: false, publishedAt: '2026-09-01T09:00:00+09:00',
};
const template = (overrides: Partial<PromptCard> = {}, publicSalesEnabled = false, locale: 'ko' | 'en' = 'ko') => templateStructuredData({
  origin, locale, card: { ...card, ...overrides }, description: 'The visible description.', publicSalesEnabled,
});
const graph = (value: ReturnType<typeof template>) => (value?.['@graph'] ?? []) as Record<string, unknown>[];

describe('public structured data', () => {
  it('links the real operator and bilingual website without inventing social identities', () => {
    const data = siteStructuredData(origin)['@graph'] as Record<string, unknown>[];
    expect(data.map((item) => item['@type'])).toEqual(['Organization', 'WebSite']);
    expect(data[0]).toMatchObject({ legalName: '야기워크숍 주식회사', url: `${origin}/`, logo: `${origin}/brand/twings-mark-black.png` });
    expect(data[0]).not.toHaveProperty('sameAs');
    expect(data[1]).toMatchObject({ publisher: { '@id': `${origin}/#organization` }, inLanguage: ['ko', 'en'] });
  });

  it('publishes only real video fields and uses clip duration rather than purchased output duration', () => {
    expect(graph(template())[0]).toMatchObject({ '@type': 'VideoObject', name: '인물 영상', duration: 'PT8.5S', uploadDate: '2026-09-01T00:00:00.000Z', thumbnailUrl: [`${origin}/poster.jpg`], contentUrl: `${origin}/example.mp4` });
    expect(graph(template({ video: { ...card.video!, duration_s: undefined } }))[0]).not.toHaveProperty('duration');
  });

  it.each([
    { video: null }, { poster: null }, { publishedAt: null }, { publishedAt: 'invalid' },
    { medium: 'image' as const }, { video: { ...card.video!, src: 'javascript:alert(1)' } },
    { video: { ...card.video!, source: 'route' as const, src: '/api/prompts/media/example%3Avideo' } },
    { poster: { ...card.poster!, src: 'https://user:password@cdn.example/file.jpg' } },
  ])('omits incomplete or unsafe video metadata: %j', (overrides) => {
    expect(graph(template(overrides))).toEqual([]);
  });

  it('publishes no purchase offer while generation is closed', () => {
    expect(graph(template()).some((item) => item['@type'] === 'Product')).toBe(false);
  });

  it('publishes a stored KRW one-time offer only for an actually purchasable Korean template', () => {
    const product = graph(template({}, true)).find((item) => item['@type'] === 'Product');
    expect(product).toMatchObject({ name: '인물 영상', offers: { '@type': 'Offer', price: 5900, priceCurrency: 'KRW', url: `${origin}/ko/t/portrait` } });
    for (const input of [{ priceCents: 0 }, { priceKrw: 0 }, { priceKrw: -1 }, { priceKrw: Number.NaN }]) {
      expect(graph(template(input, true)).some((item) => item['@type'] === 'Product')).toBe(false);
    }
    // No converted fallback or hidden KRW offer beneath a visible USD price.
    expect(graph(template({}, true, 'en')).some((item) => item['@type'] === 'Product')).toBe(false);
  });

  it('describes campaign service without an Event, creator fee, rating or invented reach', () => {
    const data = campaignServiceStructuredData({ origin, path: '/ko/campaigns/example', locale: 'ko', name: 'Visible campaign', description: 'Visible brief', serviceType: 'Brand campaigns', offer: true });
    expect(data).toMatchObject({ '@type': 'Service', offers: { '@type': 'Offer', offeredBy: { '@id': `${origin}/#organization` } } });
    expect(JSON.stringify(data)).not.toMatch(/Event|price|rating|payout|viewCount/);
    expect(campaignServiceStructuredData({ origin, path: '/en/campaigns', locale: 'en', name: 'Campaigns', description: 'Brief', serviceType: 'Campaigns' })).not.toHaveProperty('offers');
  });

  it('escapes script breakouts without changing the parsed content', () => {
    const data = { text: '</script><script>alert("x")</script>&\u2028\u2029' };
    const text = serializeJsonLd(data);
    expect(text).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(text)).toEqual(data);
  });
});

describe('single FAQ catalog', () => {
  it('states the closed public generation status in the visible and structured answers', () => {
    const dict = getDictionary('ko');
    const closed = faqItems(dict, 'template', false);
    expect(closed.find(item => item.id === 'browsing')?.a).toContain(dict.seo.generationClosed);
    expect(closed.find(item => item.id === 'pricing')?.a).toContain(dict.seo.generationClosed);
    expect(faqItems(dict, 'template', true).find(item => item.id === 'browsing')?.a).not.toContain(dict.seo.generationClosed);
  });
  it('has unique identities, all required categories, and matching localized content', () => {
    expect(new Set(FAQ_CATALOG.map((item) => item.id)).size).toBe(FAQ_CATALOG.length);
    expect(new Set(FAQ_CATALOG.map((item) => item.category))).toEqual(new Set(FAQ_CATEGORIES));
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale);
      const all = faqItems(dict);
      expect(all).toHaveLength(8);
      expect(new Set(all.map((item) => item.q.trim().toLowerCase())).size).toBe(all.length);
      for (const item of all) {
        expect(item.q.trim().length).toBeGreaterThan(0);
        expect(item.a.trim().length).toBeGreaterThan(0);
      }
      for (const placement of ['landing', 'template', 'campaign'] as const) {
        const visible = faqItems(dict, placement);
        const data = faqStructuredData(origin, `/${locale}/faq`, locale, visible);
        expect(data.mainEntity).toEqual(visible.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })));
        for (const item of visible) expect(all).toContainEqual(item);
      }
    }
  });

  it('does not publish private routes or planned subscription prices in LLM reading aids', () => {
    for (const path of ['public/llms.txt', 'public/llms-full.txt']) {
      const content = readFileSync(path, 'utf8');
      expect(content).toContain('https://twings.app/en/faq');
      expect(content).toContain('https://twings.app/ko/faq');
      expect(content).not.toMatch(/https:\/\/[^\s]*(?:\/admin|\/account|\/api|\/billing|\/renders)|19,000|39,000|TOSS_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
    }
  });
});
