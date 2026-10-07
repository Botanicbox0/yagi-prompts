import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
import BrandsPage from '@/app/(marketing)/[locale]/brands/page';

describe('the brand page shows the service before asking visitors to enquire', () => {
  it('renders the visual format and use-case explorers with crawlable copy', async () => {
    const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale: 'ko' }) }));
    expect(html).toContain('data-brand-format-explorer');
    expect(html.match(/data-format-select=/g)).toHaveLength(3);
    expect(html).toContain('data-brand-use-case-explorer');
    expect(html.match(/data-use-case-select=/g)).toHaveLength(5);
    expect(html.match(/data-use-case-panel=/g)).toHaveLength(5);
    expect(html).not.toContain('브리프');
    expect(html).not.toContain('brand-lime');
    expect(html).toContain('성공 사례 보기');
    expect(html).toContain('data-brand-inquiry-dialog');
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
