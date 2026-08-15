import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRobots, buildSitemap } from '@/lib/seo/sitemap';
import {
  promptMetadata,
  promptsGalleryMetadata,
  unresolvedPromptMetadata,
} from '@/lib/seo/prompt-metadata';
import { loadPromptCatalog, type PromptCard } from '@/lib/prompts/catalog';
import { HIDDEN_PROMPT_SLUGS } from '../../scripts/prompt-fixtures';
import { promptHarness, type PromptHarness } from '../helpers/prompts';

/**
 * PLAN §13.2 — "published prompt details join the sitemap with locale alternates; gallery indexed;
 * submit/admin noindex."
 *
 * The property worth testing is a disclosure one, and it is the OPPOSITE of the playbook rule:
 * there is no showcase filter for prompts, because a Pro-gated prompt page is still fully public
 * (poster, clip, title, credit, model — only the text is gated). What DOES filter is the projection
 * itself: only `published` rows are in it, so pending and rejected slugs cannot reach a crawler.
 */

const ORIGIN = 'https://playbook.example';

describe('prompt sitemap inclusion (§13.2)', () => {
  let harness: PromptHarness;
  let prompts: PromptCard[];
  let urls: string[];

  beforeAll(async () => {
    harness = await promptHarness();
    const catalog = await loadPromptCatalog(harness.sql, { publicUrl: () => null });
    prompts = [...catalog.yagi, ...catalog.community];
    urls = buildSitemap({ origin: ORIGIN, cards: [], prompts }).map((entry) => entry.url);
  });
  afterAll(async () => harness.close());

  it('lists the gallery itself in both locales', () => {
    expect(urls).toContain(`${ORIGIN}/en/prompts`);
    expect(urls).toContain(`${ORIGIN}/ko/prompts`);
  });

  it('lists every published prompt, both rails, in both locales', () => {
    for (const slug of ['neon-alley-dolly', 'static-portrait-window-light', 'skate-park-golden-hour']) {
      expect(urls, slug).toContain(`${ORIGIN}/en/prompts/${slug}`);
      expect(urls, slug).toContain(`${ORIGIN}/ko/prompts/${slug}`);
    }
    expect(prompts).toHaveLength(11);
  });

  /** A gated prompt is still an indexable page — the gate is on the text, not on the page. */
  it('lists Pro-gated prompts exactly like open ones', () => {
    const gated = prompts.find((card) => card.lock !== null)!;
    expect(urls).toContain(`${ORIGIN}/en/prompts/${gated.slug}`);
  });

  it('never lists a pending or rejected submission', () => {
    for (const slug of HIDDEN_PROMPT_SLUGS) {
      expect(urls.some((url) => url.includes(slug)), slug).toBe(false);
    }
  });

  it('never lists the submission form or any app surface', () => {
    for (const path of ['/prompts/submit', '/admin', '/account', '/api']) {
      expect(urls.some((url) => url.includes(path)), path).toBe(false);
    }
  });

  it('carries reciprocal alternates on every prompt entry', () => {
    const entries = buildSitemap({ origin: ORIGIN, cards: [], prompts });
    for (const entry of entries.filter((e) => e.url.includes('/prompts/'))) {
      const languages = entry.alternates?.languages as Record<string, string>;
      expect(languages.en).toBeDefined();
      expect(languages.ko).toBeDefined();
      expect(languages['x-default']).toBe(languages.en);
      expect([languages.en, languages.ko]).toContain(entry.url);
    }
  });

  it('dates each prompt from its own publication', () => {
    const entries = buildSitemap({ origin: ORIGIN, cards: [], prompts });
    const entry = entries.find((e) => e.url.endsWith('/en/prompts/neon-alley-dolly'))!;
    const card = prompts.find((c) => c.slug === 'neon-alley-dolly')!;
    expect(new Date(entry.lastModified as Date).toISOString()).toBe(card.publishedAt);
  });

  it('disallows the submission form in robots without touching the gallery', () => {
    const rule = Array.isArray(buildRobots(ORIGIN).rules)
      ? (buildRobots(ORIGIN).rules as Array<{ disallow?: string[] }>)[0]!
      : (buildRobots(ORIGIN).rules as { disallow?: string[] });
    expect(rule.disallow).toContain('/prompts/submit');
    expect(rule.disallow).not.toContain('/prompts');
  });
});

describe('prompt metadata (§13.2 SEO)', () => {
  const poster = { source: 'public' as const, src: 'https://cdn.test/abc.png', mime: 'image/png' };
  const video = { source: 'public' as const, src: 'https://cdn.test/abc.mp4', mime: 'video/mp4' };

  const meta = (overrides = {}) =>
    promptMetadata({
      slug: 'neon-alley-dolly',
      locale: 'en',
      title: 'Neon alley dolly',
      titleKo: '네온 골목 달리',
      description: 'Original prompts.',
      poster,
      video,
      siteName: 'YAGI PROMPTS',
      ...overrides,
    });

  it('self-canonicals and emits reciprocal alternates', () => {
    const m = meta();
    expect(m.alternates?.canonical).toBe('/en/prompts/neon-alley-dolly');
    expect(m.alternates?.languages).toEqual({
      en: '/en/prompts/neon-alley-dolly',
      ko: '/ko/prompts/neon-alley-dolly',
      'x-default': '/en/prompts/neon-alley-dolly',
    });
  });

  it('titles the ko page in Korean when there is a Korean title', () => {
    expect(meta({ locale: 'ko' }).title).toBe('네온 골목 달리');
    expect(meta({ locale: 'ko', titleKo: null }).title).toBe('Neon alley dolly');
  });

  it('never deindexes a published prompt, gated or not', () => {
    expect(meta().robots).toBeUndefined();
  });

  it('uses the poster as og:image and the clip as og:video', () => {
    const og = meta().openGraph as { images?: Array<{ url: string }>; videos?: Array<{ url: string }> };
    expect(og.images?.[0]?.url).toBe('https://cdn.test/abc.png');
    expect(og.videos?.[0]?.url).toBe('https://cdn.test/abc.mp4');
  });

  /** F6 — og:site_name: the card is read where the site is not, so the card names the site. */
  it('names the site on the OG object', () => {
    expect((meta().openGraph as { siteName?: string }).siteName).toBe('YAGI PROMPTS');
  });

  /**
   * Founder share-link pass (2026-08-13): the policy INVERTED. A posterless prompt used to omit
   * og:image; now nothing shareable is ever imageless — the brand card (`/og/card.png`, §5
   * language) is the fallback, because a bare text row in a KakaoTalk/Notion preview is the worst
   * rendering the link can have. A real poster still wins when one exists (test above).
   */
  it('falls back to the brand card rather than shipping an imageless share', () => {
    const og = meta({ poster: null, video: null }).openGraph as {
      images?: Array<{ url: string; width?: number; height?: number }>;
    };
    expect(og.images?.[0]?.url).toBe('/og/card.png');
    expect(og.images?.[0]?.width).toBe(1200);
    expect(og.images?.[0]?.height).toBe(630);
    const twitter = meta({ poster: null, video: null }).twitter as { card?: string };
    expect(twitter.card).toBe('summary_large_image');
  });

  it('deindexes anything that did not resolve', () => {
    expect(unresolvedPromptMetadata('YAGI PROMPTS').robots).toEqual({ index: false, follow: false });
  });

  it('makes the gallery indexable and self-canonical', () => {
    const m = promptsGalleryMetadata({
      locale: 'ko',
      title: 'Prompts',
      description: 'D',
      siteName: 'YAGI PROMPTS',
    });
    expect(m.alternates?.canonical).toBe('/ko/prompts');
    expect(m.robots).toBeUndefined();
    expect((m.openGraph as { locale?: string }).locale).toBe('ko_KR');
    expect((m.openGraph as { siteName?: string }).siteName).toBe('YAGI PROMPTS');
  });

  /**
   * M7 regression. The `<title>` and the OG title are NOT the same string: the locale layout
   * appends `· {siteName}` to every child title, so a gallery title that also spelled the brand
   * rendered "Prompts — YAGI PROMPTS · YAGI PROMPTS" in the tab. The OG card still needs the name,
   * because it is read where the site is not.
   */
  it('names the site in the OG title and not in the tab title', () => {
    const m = promptsGalleryMetadata({
      locale: 'en',
      title: 'Prompts',
      ogTitle: 'Prompts — YAGI PROMPTS',
      description: 'D',
      siteName: 'YAGI PROMPTS',
    });
    expect(m.title).toBe('Prompts');
    expect((m.openGraph as { title?: string }).title).toBe('Prompts — YAGI PROMPTS');
  });
});
