import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
import BrandsPage from '@/app/(marketing)/[locale]/brands/page';

describe('the brand page shows the service before asking visitors to enquire', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`keeps ${locale} case visitors on real posts instead of a Morphic workflow`, async () => {
      const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale }) }));
      expect(html).not.toMatch(/href="https:\/\/morphic\.com\//);
      expect(html).not.toContain('make-90s-street-style-interview-video');
      expect(html).toContain('href="https://www.instagram.com/p/DcXjygPg8fE/"');
      for (const code of ['DdqhUUvRUik', 'DdqirU_yjr-', 'Dd1CiCDSlix', 'Dd0VQJaz8h-']) {
        expect(html).toContain(`href="https://www.instagram.com/p/${code}/"`);
      }
      expect(html.match(/data-case-post="/g)).toHaveLength(4);
      expect(html.match(/data-post-market="KR"/g)).toHaveLength(2);
      expect(html.match(/data-post-market="JP"/g)).toHaveLength(2);
      // Internal workspace details are evidence sources, never visitor destinations.
      expect(html).not.toMatch(/href="https:\/\/brand\.twings\.app\/brand\/projects\//);
    });
  }

  it('shows the finished work and publishing offer without hiding services behind five tabs', async () => {
    const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale: 'ko' }) }));
    expect(html).toContain('data-brand-format-explorer');
    expect(html.match(/data-format-select=/g)).toHaveLength(3);
    expect(html).toContain('data-brand-service-examples');
    expect(html.match(/data-service-example=/g)).toHaveLength(3);
    expect(html).not.toContain('data-use-case-select');
    expect(html).toContain('크리에이터의 얼굴로');
    expect(html).toContain('AI로 만드는');
    expect(html).toContain('브랜드 광고 영상');
    expect(html).not.toContain('브랜드는 방향을 정하고');
    expect(html).not.toContain('문의 제출만으로 주문');
    expect(html).not.toContain('승인할 콘텐츠와 리포트');
    expect(html).toContain('/ko/brands/stories/morphic');
    expect(html).not.toContain('브리프');
    expect(html).not.toContain('brand-lime');
    expect(html).toContain('성공 사례 보기');
    expect(html).toContain('data-brand-inquiry-dialog');
    expect(html).toContain('data-brand-markets');
    expect(html).toContain('한국과 일본');
    expect(html).toContain('동시에');
    expect(html).toContain('크리에이터 풀');
    // The page uses Lenis; its wheel handler must not swallow scrolling inside the short modal.
    expect(html).toMatch(/<dialog[^>]*data-brand-inquiry-dialog[^>]*data-lenis-prevent/);
    expect(html).toContain('name="contactRole"');
    expect(html).toContain('data-production-films');
    expect(html).toContain('https://pitch.com/v/yagi-production-wokrs-vsrgfd');
    expect(html).toContain('https://pitch.com/v/yagi-workshop_introduction-vbujun');
    expect(html).toContain('data-brand-formula');
    expect(html).toContain('data-brand-scale-pillars');
    expect(html).toContain('data-production-collabs');
    expect(html).toContain('data-company-deck');
    expect(html).toContain('포맷');
    expect(html).toContain('게시');
    expect(html).toContain('결과');
  });

  it('keeps videos cheap and controllable before interaction', async () => {
    const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale: 'en' }) }));
    expect(html.match(/preload="none"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain('playsInline=""');
    expect(html).toContain('poster="/reel/brands/city-fashion.jpg"');
    expect(html).toContain('data-video-control');
    expect(html).toContain('https://pitch.com/v/yagi-workshop-introduction-en-higgsfield-kb35ht');
  });
});
