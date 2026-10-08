import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { brandStory } from '@/lib/campaigns/brand-stories';

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/components/campaigns/brand-experience', () => ({ MorphicFilmPair: () => <div data-films /> }));
import StoryPage, { generateMetadata } from '@/app/(marketing)/[locale]/brands/stories/[slug]/page';
import StoriesPage from '@/app/(marketing)/[locale]/brands/stories/page';

describe('public customer stories', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`links ${locale} customer stories to permanent detail URLs`, async () => {
      const html = renderToStaticMarkup(await StoriesPage({ params: Promise.resolve({ locale }) }));
      expect(html).toContain(`href="/${locale}/brands/stories/morphic"`);
      const detail = renderToStaticMarkup(await StoryPage({ params: Promise.resolve({ locale, slug: 'morphic' }) }));
      expect(detail.match(/data-case-study=/g)).toHaveLength(2);
      expect(detail).toContain(locale === 'ko' ? '200만+' : '2M+');
      const followUp = detail.match(/<article[^>]*data-case-study="morphic-september-kr-jp"[\s\S]*?<\/article>/)?.[0];
      expect(followUp).not.toContain('data-case-metric');
      const metadata = await generateMetadata({ params: Promise.resolve({ locale, slug: 'morphic' }) });
      expect(metadata.alternates?.canonical).toBe(`/${locale}/brands/stories/morphic`);
      expect(metadata.alternates?.languages).toMatchObject({ ko: '/ko/brands/stories/morphic', en: '/en/brands/stories/morphic' });
    });
  }
  it('rejects unpublished story identifiers instead of displaying the first customer', async () => {
    expect(brandStory('unapproved')).toBeNull();
    await expect(StoryPage({ params: Promise.resolve({ locale: 'ko', slug: 'unapproved' }) })).rejects.toThrow('NOT_FOUND');
    await expect(generateMetadata({ params: Promise.resolve({ locale: 'ko', slug: 'unapproved' }) })).rejects.toThrow('NOT_FOUND');
  });
});
