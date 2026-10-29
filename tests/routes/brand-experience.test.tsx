import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
vi.mock('@/lib/content/landing-media-server', () => ({ getLandingMedia: async () => ({}) }));
import BrandsPage from '@/app/(marketing)/[locale]/brands/page';

const render = async (locale: 'ko' | 'en') => renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale }) }));

describe('the brand page shows the service before asking visitors to enquire', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`keeps ${locale} case visitors on real posts instead of a Morphic workflow`, async () => {
      const html = await render(locale);
      // The identity wrapper sits around the whole page, nav and footer included.
      expect(html.indexOf('<div data-brand-accent')).toBeGreaterThan(-1);
      expect(html.indexOf('<div data-brand-accent')).toBeLessThan(html.indexOf('id="main"'));
      expect(html).not.toMatch(/href="https:\/\/morphic\.com\//);
      expect(html).not.toContain('make-90s-street-style-interview-video');
      expect(html).toContain('href="https://www.instagram.com/p/DcXjygPg8fE/"');
      for (const code of ['DdqhUUvRUik', 'DdqirU_yjr-', 'Dd1CiCDSlix', 'Dd0VQJaz8h-']) {
        expect(html).toContain(`href="https://www.instagram.com/p/${code}/"`);
      }
      expect(html.match(/data-case-post="/g)).toHaveLength(4);
      expect(html.match(/data-post-market="KR"/g)).toHaveLength(2);
      expect(html.match(/data-post-market="JP"/g)).toHaveLength(2);
      expect(html).not.toMatch(/href="https:\/\/brand\.twings\.app\/brand\/projects\//);
    });
  }

  // 2026-10-30 founder brief: the brand's own AI media engine. Fixed layer vs what changes, the real workflow,
  // the work, creator scale, production and what comes next, one blue closing.
  it('runs hero → problem → engine → workflow → work → campaign → production → closing', async () => {
    const html = await render('ko');
    const order = ['data-v7-hero=', 'data-v7-problem=', 'data-v7-first=', 'data-v7-workflow=', 'data-v7-work=', 'data-v7-campaign=', 'data-v7-production=', 'data-v7-closing='];
    for (const marker of order) expect(html).toContain(marker);
    for (let i = 1; i < order.length; i++) expect(html.indexOf(order[i - 1]!)).toBeLessThan(html.indexOf(order[i]!));
    expect(html).toContain('브랜드만의');
    expect(html).toContain('AI 미디어 엔진');
    // Hero: one inset film, three doors to sections that exist.
    expect(html).toContain('data-hero-film');
    expect(html).toContain('src="/reel/landing/v7/hero.mp4"');
    expect(html).toContain('poster="/reel/landing/v7/hero.jpg"');
    expect(html.match(/data-hero-door=/g)).toHaveLength(3);
    for (const id of ['work', 'campaign', 'production']) {
      expect(html).toContain(`data-hero-door="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    // Why it all looks the same: three real same-product pairs in a wipe compare.
    expect(html.match(/data-contrast-pair=/g)).toHaveLength(3);
    expect(html.match(/data-contrast-source=/g)).toHaveLength(3);
    // The engine: a fixed layer, three changes, then how the fixed layer is built in three chapters.
    expect(html).toContain('data-v7-engine');
    expect(html.match(/data-engine-change=/g)).toHaveLength(3);
    expect(html.match(/data-chapter="/g)).toHaveLength(3);
    expect(html).toContain('data-hard-rules');
    for (const stage of ['kit', 'memory', 'direction']) expect(html).toContain(`data-stage="${stage}"`);
    // The workflow: six steps on one rail.
    expect(html.match(/data-workflow-step=/g)).toHaveLength(6);
    // The work: eight products, eight scenes, try-on, then 5-second clips and the two ads beside their products.
    expect(html.match(/data-range-product=/g)).toHaveLength(8);
    expect(html.match(/data-asset-scene=/g)).toHaveLength(8);
    expect(html.match(/data-asset-panel=/g)).toHaveLength(4);
    expect(html.match(/hidden="" data-asset-panel=/g)).toHaveLength(3);
    expect(html.match(/data-asset-ad-still=/g)).toHaveLength(2);
    for (const [still, clip] of [['highteen-product', 'highteen'], ['beauty-ad-product', 'ad']]) {
      expect(html.indexOf(`src="/reel/landing/${still}.webp"`)).toBeGreaterThan(-1);
      expect(html.indexOf(`src="/reel/landing/${still}.webp"`)).toBeLessThan(html.indexOf(`data-asset-clip="${clip}"`));
    }
    expect(html.match(/data-asset-clip=/g)).toHaveLength(5);
    expect(html).toContain('같은 향수로 만든 20초 광고');
    // Creator campaign: the feed, the consent line, then the Morphic case.
    expect(html.match(/data-feed-post=/g)).toHaveLength(4);
    expect(html).toContain('본인 얼굴 사용에 동의한 뒤 참여합니다');
    expect(html.indexOf('data-campaign-scale')).toBeLessThan(html.indexOf('id="morphic-case"'));
    expect(html).toContain('/ko/brands/stories/morphic');
    // Production: films, decks, and what comes next, each item labelled.
    expect(html).toContain('data-production-films');
    expect(html).toContain('https://pitch.com/v/yagi-production-wokrs-vsrgfd');
    expect(html).toContain('https://pitch.com/v/yagi-workshop_introduction-vbujun');
    expect(html.match(/data-v7-next[\s\S]*?<\/aside>/)?.[0].match(/data-status="soon"/g)).toHaveLength(5);
    // The closing is the enquiry anchor, and the form keeps its fields and its Lenis escape.
    expect(html).toMatch(/<section id="brands" data-v7-closing="true" data-brands="true"/);
    expect(html).toMatch(/<dialog[^>]*data-brand-inquiry-dialog[^>]*data-lenis-prevent/);
    expect(html).toContain('name="contactRole"');
  });

  it('keeps videos cheap and controllable before interaction', async () => {
    const html = await render('en');
    expect(html.match(/preload="none"/g)?.length).toBeGreaterThanOrEqual(8);
    expect(html).toContain('playsInline=""');
    expect(html).toContain('poster="/reel/landing/beauty-ad.jpg"');
    expect(html).toContain('poster="/reel/landing/v7/hero.jpg"');
    // The landing's own loops start only when on screen (Film), never from the markup.
    expect(html).not.toMatch(/<video[^>]*data-loop-video[^>]*autoPlay|<video[^>]*autoPlay[^>]*data-loop-video/);
  });

  for (const locale of ['ko', 'en'] as const) {
    it(`is honest in ${locale}: labels, approved figures, no promises the policy does not make`, async () => {
      const html = await render(locale);
      const ko = locale === 'ko';
      // Unbuilt platform features carry their labels; the campaign service is live.
      expect(html).toContain(ko ? '얼리 액세스' : 'Early access');
      expect(html).toContain(ko ? '진행 중' : 'Live');
      expect(html).toContain(ko ? '지금은 YAGI 스튜디오가 이 순서로 직접 만듭니다' : 'Today the YAGI studio runs these steps by hand');
      expect(html).toContain(ko ? '예시 화면입니다' : 'Example screens');
      expect(html).toContain(ko ? '가상 인물 예시' : 'Fictional example');
      expect(html).toContain(ko ? '200만' : '2M+');
      // Data-handling promises the privacy policy does not make, and an unapproved headcount (2026-10-30 fact check).
      for (const gone of ['AI 학습에 쓰지 않습니다', '즉시 파기', '암호화해 보관', '수십 명', 'not used for AI training', 'dozens of creators']) expect(html).not.toContain(gone);
      // No pricing, no client names beyond the public Morphic case, no client packaging.
      expect(html).not.toContain('pricing.yagiworkshop.xyz');
      expect(html).not.toMatch(/Lafayette|라파예트|더현대|HYUNDAI/i);
      expect(html).not.toMatch(/L['’]?H\.?A\.?S/i);
      // No competitor or engine names, no credit promises, no YAGI red.
      expect(html).not.toMatch(/Dropbox|Midjourney|Runway|Photoshop|Playbook|Typeface|Higgsfield|Nano Banana|Seedream|Seedance|Kling|GPT Image/);
      expect(html).not.toMatch(/credits?\b|크레딧/i);
      expect(html).not.toMatch(/ED1E1E|237,\s*30,\s*30/i);
    });
  }
});
