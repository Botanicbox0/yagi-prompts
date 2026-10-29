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
import BrandsPage, { generateMetadata } from '@/app/(marketing)/[locale]/brands/page';
import StoryPage from '@/app/(marketing)/[locale]/brands/stories/[slug]/page';

describe('the approved Morphic evidence actually rendered to visitors', () => {
  for (const locale of ['ko', 'en'] as const) {
    // 2026-10-30: the landing shows one compact card; the cases themselves live on the story page.
    it(`keeps ${locale} figures tied only to the 90s interview case`, async () => {
      const html = renderToStaticMarkup(await StoryPage({ params: Promise.resolve({ locale, slug: 'morphic' }) }));
      const launch = html.match(/<article[^>]*data-case-study="morphic-90s-interview"[\s\S]*?<\/article>/)?.[0];
      const followUp = html.match(/<article[^>]*data-case-study="morphic-september-kr-jp"[\s\S]*?<\/article>/)?.[0];
      expect(launch).toBeDefined();
      expect(followUp).toBeDefined();
      expect(html).toContain('Morphic');
      expect(launch).toContain(locale === 'ko' ? '90년대' : '1990s');
      expect(launch).toContain(locale === 'ko' ? '9편' : '>9<');
      expect(launch).toContain(locale === 'ko' ? '200만+' : '2M+');
      expect(launch).toContain(locale === 'ko' ? '300건+' : '300+');
      expect(html).toContain('Morphic');
      expect(followUp).toContain(locale === 'ko' ? '한국과 일본' : 'Korea and Japan');
      expect(followUp).not.toContain(locale === 'ko' ? '200만+' : '2M+');
      expect(html).not.toMatch(/\/reel\/brands\/[^"'\s>]*@/i);
      // The story page may link the founder's own Morphic format (sweep checks it); the generic guide stays out.
      expect(html).not.toContain('make-90s-street-style-interview-video');
      expect(followUp).toContain('href="https://www.instagram.com/p/DdqhUUvRUik/"');
      expect(followUp).toContain('href="https://www.instagram.com/p/Dd1CiCDSlix/"');
      expect(CASE_STUDIES).toHaveLength(2);
    });
  }

  it('wires the public cases into page metadata and structured data without duplicating the site name', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ locale: 'ko' }) });
    const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale: 'ko' }) }));
    // PLATFORM-2.0 §21 (2026-10-28): the brand side is the marketing asset studio.
    expect(metadata.title).toBe('브랜드만의 AI 미디어 엔진');
    expect(metadata.openGraph).toMatchObject({ siteName: 'TWINGS', title: '브랜드만의 AI 미디어 엔진' });
    expect(html).toContain('id="brand-case-studies-structured-data"');
    expect(html).not.toContain('morphic.com/resources/how-to/make-90s-street-style-interview-video');
    // The landing's card carries the approved totals and says what they count; the story page has the posts.
    expect(html).toContain('2026년 8월 캠페인 누적 공개 집계입니다.');
    expect(html).toContain('href="/ko/brands/stories/morphic"');
  });
});
