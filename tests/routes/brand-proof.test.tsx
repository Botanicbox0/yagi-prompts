import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CASE_STUDIES } from '@/lib/campaigns/case-studies';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/campaigns/brand-experience', () => ({
  BrandFormatExplorer: () => <div data-brand-format-explorer />,
  MorphicFilmPair: () => <div data-morphic-film-pair />,
}));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
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
    expect(metadata.title).toBe('브랜드 크리에이터 캠페인');
    expect(metadata.openGraph).toMatchObject({ siteName: 'TWINGS', title: '브랜드 크리에이터 캠페인' });
    expect(html).toContain('id="brand-case-studies-structured-data"');
    expect(html).not.toContain('morphic.com/resources/how-to/make-90s-street-style-interview-video');
    expect(html).toContain('href="https://www.instagram.com/p/Dd0VQJaz8h-/"');
    expect(html).toContain('2026년 8월');
    expect(html).toContain('2026년 9월');
  });
});
