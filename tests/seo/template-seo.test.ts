import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRobots, buildSitemap } from '@/lib/seo/sitemap';
import { templateMetadata, templatesListingMetadata, unresolvedTemplateMetadata } from '@/lib/seo/template-metadata';
import { loadPromptCatalog, type PromptCard } from '@/lib/prompts/catalog';
import { HIDDEN_PROMPT_SLUGS } from '../../scripts/prompt-fixtures';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * docs/TEMPLATES-IA.md — "the two listings and every published template are indexable, with locale
 * alternates; nothing else on the template surface exists to index."
 *
 * The property is still a disclosure one, and simpler than the prompts era's: there is no gated
 * half anywhere any more, so the only filter is the projection — `published` rows only, which is
 * how pending and rejected slugs stay out of a crawler's reach.
 */

const ORIGIN = 'https://playbook.example';

describe('template sitemap inclusion (docs/TEMPLATES-IA.md)', () => {
  let harness: PromptHarness;
  let templates: PromptCard[];
  let urls: string[];

  beforeAll(async () => {
    harness = await promptHarness();
    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
    templates = [...catalog.video, ...catalog.image];
    urls = buildSitemap({ origin: ORIGIN, cards: [], templates }).map((entry) => entry.url);
  });
  afterAll(async () => harness.close());

  it('lists both tabs in both locales', () => {
    for (const rest of ['/video', '/image']) {
      expect(urls).toContain(`${ORIGIN}/en${rest}`);
      expect(urls).toContain(`${ORIGIN}/ko${rest}`);
    }
  });

  it('lists every published template, both media, in both locales', () => {
    for (const slug of ['neon-alley-dolly', 'static-portrait-window-light', 'skate-park-golden-hour']) {
      expect(urls, slug).toContain(`${ORIGIN}/en/t/${slug}`);
      expect(urls, slug).toContain(`${ORIGIN}/ko/t/${slug}`);
    }
    expect(templates).toHaveLength(11);
  });

  it('never lists a pending or rejected submission', () => {
    for (const slug of HIDDEN_PROMPT_SLUGS) {
      expect(urls.some((url) => url.includes(slug)), slug).toBe(false);
    }
  });

  it('never lists the retired prompt paths or any app surface', () => {
    for (const path of ['/prompts', '/contests', '/studio', '/admin', '/account', '/api']) {
      expect(urls.some((url) => url.includes(path)), path).toBe(false);
    }
  });

  it('carries reciprocal alternates on every template entry', () => {
    const entries = buildSitemap({ origin: ORIGIN, cards: [], templates });
    for (const entry of entries.filter((e) => e.url.includes('/t/'))) {
      const languages = entry.alternates?.languages as Record<string, string>;
      expect(languages.en).toBeDefined();
      expect(languages.ko).toBeDefined();
      expect(languages['x-default']).toBe(languages.en);
      expect([languages.en, languages.ko]).toContain(entry.url);
    }
  });

  it('dates each template from its own publication', () => {
    const entries = buildSitemap({ origin: ORIGIN, cards: [], templates });
    const entry = entries.find((e) => e.url.endsWith('/en/t/neon-alley-dolly'))!;
    const card = templates.find((c) => c.slug === 'neon-alley-dolly')!;
    expect(new Date(entry.lastModified as Date).toISOString()).toBe(card.publishedAt);
  });

  it('no longer disallows the retired forms, and never the tabs', () => {
    const rules = buildRobots(ORIGIN).rules;
    const rule = (Array.isArray(rules) ? rules[0]! : rules) as { disallow?: string[] };
    expect(rule.disallow).not.toContain('/prompts/submit');
    expect(rule.disallow).not.toContain('/contests/*/submit');
    expect(rule.disallow).not.toContain('/video');
    expect(rule.disallow).not.toContain('/image');
  });
});

describe('template metadata (docs/TEMPLATES-IA.md SEO)', () => {
  const poster = { source: 'public' as const, src: 'https://cdn.test/abc.png', mime: 'image/png' };
  const video = { source: 'public' as const, src: 'https://cdn.test/abc.mp4', mime: 'video/mp4' };
  const card = (overrides: Partial<PromptCard> = {}): PromptCard => ({
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'neon-alley-dolly',
    title: 'Neon alley dolly',
    titleKo: '네온 골목 달리',
    authorHandle: null,
    origin: 'studio',
    makerProfile: false,
    source: 'yagi',
    models: ['seedance-2.5'],
    modelLabels: ['SEEDANCE 2.5'],
    useCase: ['cinematic'],
    medium: 'video',
    priceCents: 400,
    priceKrw: 0,
    price1080Cents: 0,
    price1080Krw: 0,
    runtimeSeconds: 15,
    engine: null,
    aspectDefault: null,
    poster,
    video,
    lock: null,
    featured: true,
    publishedAt: '2026-08-12T00:00:00.000Z',
    ...overrides,
  });
  const meta = (overrides: Partial<PromptCard> = {}, locale: 'en' | 'ko' = 'en') =>
    templateMetadata({ card: card(overrides), locale, description: 'One photo in.', siteName: 'TWINGS' });

  it('self-canonicals on /t/{slug} and emits reciprocal alternates', () => {
    const m = meta();
    expect(m.alternates?.canonical).toBe('/en/t/neon-alley-dolly');
    expect(m.alternates?.languages).toEqual({
      en: '/en/t/neon-alley-dolly',
      ko: '/ko/t/neon-alley-dolly',
      'x-default': '/en/t/neon-alley-dolly',
    });
  });

  it('titles the ko page in Korean when there is a Korean title', () => {
    expect(meta({}, 'ko').title).toBe('네온 골목 달리');
    expect(meta({ titleKo: null }, 'ko').title).toBe('Neon alley dolly');
  });

  it('never deindexes a published template', () => {
    expect(meta().robots).toBeUndefined();
  });

  it('uses the poster as og:image and the example film as og:video', () => {
    const og = meta().openGraph as { images?: Array<{ url: string }>; videos?: Array<{ url: string }>; siteName?: string };
    expect(og.images?.[0]?.url).toBe('https://cdn.test/abc.png');
    expect(og.videos?.[0]?.url).toBe('https://cdn.test/abc.mp4');
    expect(og.siteName).toBe('TWINGS');
  });

  it('falls back to the brand card rather than shipping an imageless share', () => {
    const og = meta({ poster: null, video: null }).openGraph as { images?: Array<{ url: string; width?: number; height?: number }> };
    expect(og.images?.[0]?.url).toBe('/og/card.png');
    expect(og.images?.[0]?.width).toBe(1200);
    expect(og.images?.[0]?.height).toBe(630);
  });

  it('deindexes anything that did not resolve', () => {
    expect(unresolvedTemplateMetadata('TWINGS').robots).toEqual({ index: false, follow: false });
  });

  it('makes each tab indexable and self-canonical, naming the site only in the OG title', () => {
    const m = templatesListingMetadata({ locale: 'ko', medium: 'image', title: '이미지 템플릿', ogTitle: '이미지 템플릿 — TWINGS', description: 'D', siteName: 'TWINGS' });
    expect(m.alternates?.canonical).toBe('/ko/image');
    expect(m.robots).toBeUndefined();
    expect(m.title).toBe('이미지 템플릿');
    expect((m.openGraph as { title?: string }).title).toBe('이미지 템플릿 — TWINGS');
    expect((m.openGraph as { locale?: string }).locale).toBe('ko_KR');
  });
});
