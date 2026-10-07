import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CASE_STUDIES } from '@/lib/campaigns/case-studies';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/campaigns/showreel', () => ({ CampaignShowreel: () => null }));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
import BrandsPage from '@/app/(marketing)/[locale]/brands/page';

describe('the approved case evidence actually rendered to visitors', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`keeps ${locale} rendered figures tied to the approved manifest`, async () => {
      const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale }) }));
      for (const study of CASE_STUDIES) {
        const article = html.match(new RegExp(`<article[^>]*data-case-study="${study.id}"[\\s\\S]*?</article>`))?.[0];
        expect(article).toBeDefined();
        const values = [...article!.matchAll(/<dd[^>]*>([^<]*)<\/dd>/g)].map(match => match[1]);
        expect(values).toEqual([
          `${study.films}${locale === 'ko' ? '편' : ''}`,
          `${new Intl.NumberFormat(locale, { notation: 'compact' }).format(study.viewsAtLeast)}+`,
          `${study.organicAtLeast}${locale === 'ko' ? '건' : ''}+`,
        ]);
      }
    });
  }
});
