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
    expect(html).toContain('data-hero-cinema-grid');
    expect(html).toContain('data-production-craft-strip');
    expect(html.match(/data-craft-pillar=/g)).toHaveLength(3);
    expect(html).toContain('data-craft-stage="01"');
    expect(html.match(/data-contact-thumb=/g)).toHaveLength(3);
    expect(html).toContain('크리에이터로');
    expect(html).toContain('무한 확장되는');
    expect(html).toContain('브랜드 광고가 수십 개의 인플루언서 채널로 빠르게 확장됩니다.');
    expect(html).toContain('data-brand-scale-pillars');
    expect(html).toContain('data-production-collabs');
    expect(html).toContain('data-company-deck');
    expect(html).not.toContain('5,000+');
    expect(html).not.toContain('파트너십');
    expect(html).not.toContain('AES-256');
    expect(html).not.toContain('TLS 1.2');
    expect(html).toContain('AI 학습에 절대 쓰지 않습니다');
    expect(html).toContain('계정마다 독립된 공간에 암호화 보관');
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

  // PLATFORM-2.0 §20: the asset studio leads, the live campaign service follows as "spread".
  for (const locale of ['ko', 'en'] as const) {
    it(`opens ${locale} on the asset studio and is honest about what is early access`, async () => {
      const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale }) }));
      const ko = locale === 'ko';
      expect(html).toContain(ko ? '브랜드를 위한 올인원 마케팅 에셋 스튜디오' : 'Your all-in-one marketing asset studio');
      for (const marker of ['data-studio-hero', 'data-studio-stage', 'data-studio-split', 'data-studio-flow', 'data-studio-pipeline', 'data-brand-memory', 'data-studio-spread', 'data-studio-contrast']) {
        expect(html).toContain(marker);
      }
      // The hero leads; the campaign service (cases, approved figures) is still on the page below it.
      expect(html.indexOf('data-studio-hero')).toBeLessThan(html.indexOf('data-campaign-proof'));
      expect(html.indexOf('data-studio-spread')).toBeLessThan(html.indexOf('id="morphic-case"'));
      // Not built yet → labelled. The live step is the campaign service.
      expect(html.match(/data-early-access=/g)?.length).toBeGreaterThanOrEqual(3);
      expect(html.match(/data-flow-step="early"/g)).toHaveLength(3);
      expect(html.match(/data-flow-step="live"/g)).toHaveLength(1);
      expect(html).toContain(ko ? '예시 화면' : 'Example screen');
      // Every demo panel ships in the initial HTML; only one is visible at a time.
      expect(html.match(/data-studio-panel=/g)).toHaveLength(3);
      expect(html.match(/hidden="" data-studio-panel=/g)).toHaveLength(2);
      expect(html.match(/data-memory-layer=/g)).toHaveLength(3);
      // The smoke search only marks frames that show smoke.
      expect(html.match(/data-search-hit="true"/g)).toHaveLength(3);
      // Mood clusters: "all" plus eight moods, every library frame in the initial HTML.
      expect(html).toContain('data-mood-clusters');
      expect(html.match(/data-mood-chip=/g)).toHaveLength(9);
      expect(html.match(/data-mood-tile=/g)).toHaveLength(36);
      // The example library is a client campaign: its brand name and packaging never appear.
      expect(html).not.toMatch(/L['’]?H\.?A\.?S/i);
      // No competitor names, no credit or price promises before the founder sets them (§20.7).
      expect(html).not.toMatch(/Dropbox|Midjourney|Runway|Figma|Photoshop|Playbook/);
      expect(html).not.toMatch(/credits?\b|크레딧/i);
    });
  }
});
