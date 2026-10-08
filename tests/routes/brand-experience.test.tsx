import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
import BrandsPage from '@/app/(marketing)/[locale]/brands/page';

describe('the brand page shows the service before asking visitors to enquire', () => {
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
  });
});
