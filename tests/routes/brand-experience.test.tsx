import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prompts/public-catalog', () => ({ getPromptCatalog: async () => ({ video: [] }) }));
vi.mock('@/components/marketing/chrome', () => ({ MarketingNav: () => null, MarketingFooter: () => null }));
vi.mock('@/lib/seo/faq-section', () => ({ FaqSection: () => null }));
vi.mock('@/lib/content/landing-media-server', () => ({ getLandingMedia: async () => ({}) }));
import BrandsPage from '@/app/(marketing)/[locale]/brands/page';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

const render = async (locale: 'ko' | 'en') => renderToStaticMarkup(await BrandsPage({ params: Promise.resolve({ locale }) }));

describe('the brand page shows the service before asking visitors to enquire', () => {
  for (const locale of ['ko', 'en'] as const) {
    it(`shows the ${locale} Morphic case as one compact card that opens the story page`, async () => {
      const html = await render(locale);
      // The identity wrapper sits around the whole page, nav and footer included.
      expect(html.indexOf('<div data-brand-accent')).toBeGreaterThan(-1);
      expect(html.indexOf('<div data-brand-accent')).toBeLessThan(html.indexOf('id="main"'));
      // 2026-10-30 founder: the Morphic example no longer needs to be large on the landing.
      expect(html).toContain('data-morphic-card');
      expect(html).toContain(`href="/${locale}/brands/stories/morphic"`);
      for (const figure of locale === 'ko' ? ['9편', '200만+', '300건+'] : ['2M+', '300+']) expect(html).toContain(figure);
      expect(html).not.toContain('data-customer-story');
      expect(html).not.toContain('data-case-post=');
      expect(html).not.toMatch(/href="https:\/\/morphic\.com\//);
      expect(html).not.toMatch(/href="https:\/\/brand\.twings\.app\/brand\/projects\//);
    });
  }

  // 2026-10-30 founder feedback: every screen must say what the software gives a brand. The problem screen and
  // the six-step workflow rail are gone; remix and local fixes are in.
  it('runs hero → learns your brand → remix → work → local fixes → campaign → production → closing', async () => {
    const html = await render('ko');
    const order = ['data-v7-hero=', 'data-v7-first=', 'data-v7-remix=', 'data-v7-work=', 'data-v7-finish=', 'data-v7-campaign=', 'data-v7-production=', 'data-v7-closing='];
    for (const marker of order) expect(html).toContain(marker);
    for (let i = 1; i < order.length; i++) expect(html.indexOf(order[i - 1]!)).toBeLessThan(html.indexOf(order[i]!));
    for (const gone of ['data-v7-problem', 'data-v7-engine', 'data-v7-workflow', 'data-workflow-step', '서로 닮아 갑니다', '실제 캠페인의 작업 순서', '브랜드를 위한 TWINGS', '모델 고르기']) expect(html).not.toContain(gone);
    expect(html).toContain('브랜드만의');
    expect(html).toContain('AI 미디어 엔진');
    expect(html).toContain('브랜드를 이해한 상태에서 시작합니다');
    // Hero: one inset film (a smaller file on phones), a quiet spec line, three doors to sections that exist.
    expect(html).toContain('data-hero-film');
    expect(html).toContain('src="/reel/landing/v7/hero.mp4"');
    expect(html).toContain('src="/reel/landing/v7/hero-720.mp4"');
    expect(html).toContain('src="/reel/landing/v7/hero-2160.mp4"');
    expect(html).toContain('poster="/reel/landing/v7/hero.jpg"');
    expect(html).toContain('data-hero-spec');
    expect(html.match(/data-hero-door=/g)).toHaveLength(3);
    for (const id of ['work', 'campaign', 'production']) {
      expect(html).toContain(`data-hero-door="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    // It learns the brand: rules, memory, one line of direction.
    expect(html.match(/data-chapter="/g)).toHaveLength(3);
    expect(html).toContain('data-hard-rules');
    for (const stage of ['kit', 'memory', 'direction']) expect(html).toContain(`data-stage="${stage}"`);
    // Remix: two formats, the runway's three real edits on show first, each with its own film.
    expect(html).toContain('data-remix');
    expect(html.match(/data-remix-format=/g)).toHaveLength(2);
    expect(html.match(/data-remix-edit=/g)).toHaveLength(4);
    for (const picture of ['look', 'model']) expect(html).toContain(`/reel/landing/v7/rx-attach-${picture}.webp`);
    for (const film of ['orig', 'outfit', 'model', 'set', 'duo']) expect(html).toContain(`src="/reel/landing/v7/rx-runway-${film}.mp4"`);
    // The work: fashion looks, beauty shots, try-on, then the two ads beside what they feature.
    expect(html.match(/data-asset-look=/g)).toHaveLength(9);
    expect(html.match(/data-asset-cut=/g)).toHaveLength(6);
    expect(html.match(/data-asset-panel=/g)).toHaveLength(4);
    expect(html.match(/hidden="" data-asset-panel=/g)).toHaveLength(3);
    // Try-on: the lookbook is one garment, shot three ways; the founder's picks stay in the looks and free mode.
    for (const cut of ['vto-garment', 'vto-set-front', 'vto-set-upper', 'vto-set-side', 'vto-free-amber', 'vto-look-upper']) expect(html).toContain(`/reel/studio/${cut}.webp`);
    expect(html.match(/data-asset-ad-still=/g)).toHaveLength(2);
    for (const [still, clip] of [['ad-denim', 'fashion'], ['highteen-product', 'perfume']]) {
      expect(html.indexOf(`src="/reel/landing/${still}.webp"`)).toBeGreaterThan(-1);
      expect(html.indexOf(`src="/reel/landing/${still}.webp"`)).toBeLessThan(html.indexOf(`data-asset-clip="${clip}"`));
    }
    expect(html.match(/data-asset-clip=/g)).toHaveLength(2);
    expect(html).toContain('같은 향수로 만든 20초 광고');
    // 2026-10-30 founder: the pink-makeup lead does not fit the blue world; none of her footage or stills stay.
    for (const gone of ['film-beauty', 'film-runway-blue', 'cut-face', 'cut-recline']) expect(html).not.toContain(gone);
    // Local fixes: three real before/after pairs in a wipe compare.
    expect(html.match(/data-contrast-pair=/g)).toHaveLength(3);
    expect(html.match(/data-contrast-source=/g)).toHaveLength(3);
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
    expect(html).toContain('poster="/reel/campaigns/highteen.jpg"');
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
      expect(html).toContain(ko ? '지금은 YAGI 스튜디오가 이 과정을 직접 운영합니다' : 'Today the YAGI studio runs this for you');
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

  // The FAQ is rendered on this page and on /faq; it was mocked out above, so its text is checked at the source.
  it('keeps the unapproved headcount out of the FAQ answers', () => {
    expect(Object.values(ko.faq).join(' ')).not.toContain('수십 명');
    expect(Object.values(en.faq).join(' ')).not.toMatch(/dozens of/i);
  });
});
