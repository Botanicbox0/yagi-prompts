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

  // 2026-10-29 founder reviews: one promise, a hero film instead of stills, three doors, both proofs, no red.
  it('leads with the hero film and three doors, then proves the asset studio and the creator campaign', async () => {
    const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale: 'ko' }) }));
    const order = ['data-studio-hero', 'data-studio-contrast', 'data-studio-assets', 'data-campaign-scale', 'data-production-service', 'data-brands'];
    for (const marker of order) expect(html).toContain(marker);
    for (let i = 1; i < order.length; i++) expect(html.indexOf(order[i - 1]!)).toBeLessThan(html.indexOf(order[i]!));
    // Hero: one film (per locale) of one product becoming shots, an ad and creator versions; no still bento.
    expect(html).toContain('data-hero-film');
    expect(html).toContain('src="/reel/landing/hero-ko.mp4"');
    expect(html).toContain('poster="/reel/landing/hero-ko.jpg"');
    for (const gone of ['data-hero-lock', 'data-hero-output', 'data-hero-grid']) expect(html).not.toContain(gone);
    // Three doors, each to a section that exists on the page.
    expect(html.match(/data-hero-door=/g)).toHaveLength(3);
    for (const id of ['assets', 'campaign', 'production']) {
      expect(html).toContain(`data-hero-door="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    // Why not generic AI: three real same-product pairs, no competitor named.
    expect(html.match(/data-contrast-pair=/g)).toHaveLength(3);
    expect(html).toContain('data-brand-markets');
    expect(html.match(/data-contrast-pillar=/g)).toHaveLength(3);
    expect(html).toContain('절대 규칙');
    // Asset studio: one brand kit; the eight products, scenes, try-on and clips are tabs, all in the initial HTML.
    expect(html).toContain('data-brand-kit');
    expect(html.match(/data-range-product=/g)).toHaveLength(8);
    expect(html.match(/data-asset-scene=/g)).toHaveLength(8);
    expect(html.match(/data-asset-clip=/g)).toHaveLength(5);
    // Each ad sits right after the product shot it shows: the heart perfume, then the lip gloss.
    expect(html.match(/data-asset-ad-still=/g)).toHaveLength(2);
    for (const [still, clip] of [['highteen-product', 'highteen'], ['beauty-ad-product', 'ad']]) {
      expect(html.indexOf(`src="/reel/landing/${still}.webp"`)).toBeGreaterThan(-1);
      expect(html.indexOf(`src="/reel/landing/${still}.webp"`)).toBeLessThan(html.indexOf(`data-asset-clip="${clip}"`));
    }
    expect(html.indexOf('data-asset-clip="highteen"')).toBeLessThan(html.indexOf('data-asset-clip="ad"'));
    expect(html).toContain('같은 향수로 만든 20초 광고');
    expect(html.match(/data-asset-panel=/g)).toHaveLength(4);
    expect(html.match(/hidden="" data-asset-panel=/g)).toHaveLength(3);
    expect(html.indexOf('data-asset-panel="0"')).toBeLessThan(html.indexOf('data-range-product='));
    // Creator campaign: the mosaic, the likeness and data promises, then the Morphic case.
    expect(html.match(/data-feed-post=/g)).toHaveLength(4);
    expect(html).toContain('data-brand-scale-pillars');
    expect(html).toContain('AI 학습에 쓰지 않습니다');
    expect(html).toContain('계정마다 독립된 공간에 암호화해 보관합니다');
    expect(html.indexOf('data-campaign-scale')).toBeLessThan(html.indexOf('id="morphic-case"'));
    expect(html).toContain('/ko/brands/stories/morphic');
    expect(html).toContain('광고 한 편으로');
    // Production stays a quiet third offer, with its decks and collaborators.
    expect(html).toContain('data-production-films');
    expect(html).toContain('data-production-collabs');
    expect(html).toContain('data-company-deck');
    expect(html).toContain('https://pitch.com/v/yagi-production-wokrs-vsrgfd');
    expect(html).toContain('https://pitch.com/v/yagi-workshop_introduction-vbujun');
    // The enquiry form keeps its fields and its Lenis escape.
    expect(html).toMatch(/<dialog[^>]*data-brand-inquiry-dialog[^>]*data-lenis-prevent/);
    expect(html).toContain('name="contactRole"');
    // Retired: the bottle orbit, the 41-frame mood wall, the five-tab service sprawl, YAGI red.
    for (const gone of ['data-studio-orbit', 'data-mood-tile', 'data-format-select', 'data-service-example', 'data-hero-cinema-grid']) expect(html).not.toContain(gone);
    expect(html).not.toMatch(/ED1E1E|237,\s*30,\s*30/i);
    expect(html).not.toContain('빠르게 회신드립니다.</p></div><div');
  });

  it('keeps videos cheap and controllable before interaction', async () => {
    const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale: 'en' }) }));
    expect(html.match(/preload="none"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(html).toContain('playsInline=""');
    expect(html).toContain('poster="/reel/landing/beauty-ad.jpg"');
    expect(html).toContain('poster="/reel/landing/hero-en.jpg"');
    expect(html).toContain('data-video-control');
    // The landing's own loops start only when on screen (LoopVideo), never from the markup.
    expect(html).not.toMatch(/<video[^>]*data-loop-video[^>]*autoPlay|<video[^>]*autoPlay[^>]*data-loop-video/);
  });

  for (const locale of ['ko', 'en'] as const) {
    it(`is honest in ${locale} about what is live, beta and early access`, async () => {
      const html = renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale }) }));
      const ko = locale === 'ko';
      expect(html).toContain(ko ? 'TWINGS 브랜드 스튜디오' : 'TWINGS brand studio');
      expect(html).toContain('data-campaign-hero');
      expect(html).toContain('data-campaign-proof');
      expect(html.match(/data-early-access="early"/g)).toHaveLength(1);
      expect(html.match(/data-early-access="beta"/g)).toHaveLength(1);
      expect(html.match(/data-early-access="live"/g)).toHaveLength(1);
      expect(html).toContain(ko ? '예시 화면' : 'Example screen');
      // Every picture of a person is labelled: the film's model, the try-on model, the creator examples.
      expect(html).toContain(ko ? '모델은 가상 인물입니다' : 'The model is a virtual person');
      expect(html).toContain(ko ? '가상 인물 예시' : 'Virtual person example');
      // Try-on (beta): both modes ship in the HTML.
      expect(html.match(/data-vto-panel=/g)).toHaveLength(2);
      expect(html).toMatch(/hidden="" data-vto-panel="free"/);
      // Only approved figures, pinned to the named case.
      expect(html).toContain(ko ? '200만' : '2M+');
      // The example library is a client campaign: its brand name and packaging never appear.
      expect(html).not.toMatch(/L['’]?H\.?A\.?S/i);
      // No competitor names, no credit or price promises before the founder sets them (§20.7).
      expect(html).not.toMatch(/Dropbox|Midjourney|Runway|Figma|Photoshop|Playbook|Typeface|Higgsfield|Nano Banana|Seedream/);
      expect(html).not.toMatch(/credits?\b|크레딧/i);
    });
  }
});
