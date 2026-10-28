import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CASE_STUDIES } from '@/lib/campaigns/case-studies';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/campaigns/brand-experience', () => ({
  BrandFormatExplorer: () => <div data-brand-format-explorer />,
  BrandCraftShowcase: () => <div data-production-craft-strip />,
  HeroCinemaGrid: () => <div data-hero-cinema-grid />,
  MorphicFilmPair: () => <div data-morphic-film-pair />,
}));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
vi.mock('@/lib/content/landing-media-server', () => ({ getLandingMedia: async () => ({}) }));
import BrandsPage, { generateMetadata } from '@/app/(marketing)/[locale]/brands/page';

describe('the approved Morphic evidence actually rendered to visitors', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`keeps ${locale} figures tied only to the 90s interview case`, async () => {
      const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale }) }));
      const launch = html.match(/<article[^>]*data-case-study="morphic-90s-interview"[\s\S]*?<\/article>/)?.[0];
      const followUp = html.match(/<article[^>]*data-case-study="morphic-september-kr-jp"[\s\S]*?<\/article>/)?.[0];
      expect(launch).toBeDefined();
      expect(followUp).toBeDefined();
      expect(launch).toContain('Morphic');
      expect(launch).toContain(locale === 'ko' ? '90년대' : '1990s');
      expect(launch).toContain(locale === 'ko' ? '9편' : '>9<');
      expect(launch).toContain(locale === 'ko' ? '200만+' : '2M+');
      expect(launch).toContain(locale === 'ko' ? '300건+' : '300+');
      expect(followUp).toContain('Morphic');
      expect(followUp).toContain(locale === 'ko' ? '한국과 일본' : 'Korea and Japan');
      expect(followUp).not.toContain(locale === 'ko' ? '200만+' : '2M+');
      expect(html).not.toMatch(/\/reel\/brands\/[^"'\s>]*@/i);
      expect(html).not.toContain('href="https://morphic.com/');
      expect(followUp).toContain('href="https://www.instagram.com/p/DdqhUUvRUik/"');
      expect(followUp).toContain('href="https://www.instagram.com/p/Dd1CiCDSlix/"');
      expect(CASE_STUDIES).toHaveLength(2);
    });
  }

  it('wires the public cases into page metadata and structured data without duplicating the site name', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'ko' }) });
    const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale: 'ko' }) }));
    // PLATFORM-2.0 §20 (2026-10-28): the brand side is the marketing asset studio.
    expect(metadata.title).toBe('올인원 마케팅 에셋 스튜디오');
    expect(metadata.openGraph).toMatchObject({ siteName: 'TWINGS', title: '올인원 마케팅 에셋 스튜디오' });
    expect(html).toContain('id="brand-case-studies-structured-data"');
    expect(html).not.toContain('morphic.com/resources/how-to/make-90s-street-style-interview-video');
    expect(html).toContain('href="https://www.instagram.com/p/Dd0VQJaz8h-/"');
    expect(html).toContain('2026년 8월');
    expect(html).toContain('2026년 9월');
  });
});
