import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIRECT_VIDEO_PROVIDER_USD,
  DirectSceneStudio,
} from '@/components/audience/direct-scene-studio';
import { DEFAULT_DIRECT_ROYALTY_KRW } from '@/components/audience/direct/defaults';
import {
  heroAspectRatio,
  heroVideoMatchesPoster,
  pickDirectPageMedia,
  stepTileMetrics,
} from '@/components/audience/direct/pick-media';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { EMPTY_PROMPT_CATALOG, type PromptCard, type PromptCatalog } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL } from '@/lib/prompts/schemas';
import { simulateMakerTemplateRevenue } from '@/lib/twings/template-price';

function makeCard(overrides: Partial<PromptCard> = {}): PromptCard {
  return {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'giant-daydream',
    title: 'Giant Daydream',
    titleKo: '작은 방의 백일몽',
    authorHandle: null,
    origin: 'studio',
    makerProfile: false,
    source: 'yagi',
    models: ['seedance-2.5'],
    modelLabels: [PROMPT_MODEL_LABEL],
    useCase: ['cinematic'],
    medium: 'video',
    priceCents: 400,
    priceKrw: 4900,
    price1080Cents: 600,
    price1080Krw: 6900,
    runtimeSeconds: 10,
    engine: null,
    aspectDefault: '9:16',
    poster: { source: 'route', src: '/api/prompts/media/giant-daydream%3Aposter', mime: 'image/png', w: 1080, h: 1920 },
    video: { source: 'route', src: '/api/prompts/media/giant-daydream%3Avideo', mime: 'video/mp4', w: 1080, h: 1920 },
    lock: null,
    featured: true,
    publishedAt: '2026-10-25T00:00:00.000Z',
    ...overrides,
  };
}

function catalogFrom(cards: PromptCard[]): PromptCatalog {
  const video = cards.filter((c) => c.medium === 'video');
  const image = cards.filter((c) => c.medium === 'image');
  return {
    yagi: cards.filter((c) => c.origin === 'studio'),
    community: cards.filter((c) => c.origin === 'maker'),
    video,
    image,
    makers: [],
    totals: {
      yagi: cards.filter((c) => c.origin === 'studio').length,
      community: cards.filter((c) => c.origin === 'maker').length,
      published: cards.length,
      useCases: ['cinematic'],
      modelLabel: PROMPT_MODEL_LABEL,
    },
  };
}

function buildFakeCatalog(): PromptCatalog {
  const makerHero = makeCard({
    id: '9b000000-0000-4000-8000-000000000001',
    slug: 'fashion-show-arrival',
    title: 'Fashion Show Arrival',
    titleKo: '패션쇼 프레스 도착',
    authorHandle: 'yunseolfromseoul',
    origin: 'maker',
    makerProfile: true,
    aspectDefault: '9:16',
    poster: { source: 'route', src: '/api/prompts/media/fashion-show-arrival%3Aposter', mime: 'image/png', w: 1080, h: 1920 },
    video: { source: 'route', src: '/api/prompts/media/fashion-show-arrival%3Avideo', mime: 'video/mp4', w: 1080, h: 1920 },
  });
  const makerStep2 = makeCard({
    id: '9b000000-0000-4000-8000-000000000002',
    slug: 'skate-park-golden-hour',
    title: 'Skate park, golden hour',
    titleKo: '스케이트 파크 골든아워',
    authorHandle: 'hana',
    origin: 'maker',
    makerProfile: true,
    aspectDefault: '9:16',
    poster: { source: 'route', src: '/api/prompts/media/skate-park%3Aposter', mime: 'image/png', w: 1080, h: 1920 },
    video: null,
  });
  const studioHeroFallback = makeCard({
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'giant-daydream',
    title: 'Giant Daydream',
    titleKo: '작은 방의 백일몽',
    origin: 'studio',
    aspectDefault: '4:3',
    poster: { source: 'route', src: '/api/prompts/media/giant-daydream%3Aposter', mime: 'image/png', w: 1440, h: 1080 },
    video: { source: 'route', src: '/api/prompts/media/giant-daydream%3Avideo', mime: 'video/mp4', w: 1440, h: 1080 },
  });
  const studioImage = makeCard({
    id: '9a000000-0000-4000-8000-000000000002',
    slug: 'static-portrait-window-light',
    title: 'Static portrait, window light',
    titleKo: '정적 인물, 창문 광',
    medium: 'image',
    runtimeSeconds: null,
    aspectDefault: '4:5',
    poster: { source: 'route', src: '/api/prompts/media/window-light%3Aposter', mime: 'image/png', w: 1080, h: 1350 },
    video: null,
  });

  return catalogFrom([makerHero, makerStep2, studioHeroFallback, studioImage]);
}

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

function visibleTextLines(html: string): string[] {
  const withoutScripts = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');
  const text = decodeHtml(
    withoutScripts
      .replace(/<\/(p|h[1-6]|li|div|section|header|figcaption|summary|a|button|span)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

describe('/[locale]/direct — simplified real-media page', () => {
  it('prefers hero cards with matching poster/video aspect ratios, falls back to poster-only when ratios differ, and never duplicates step tiles', () => {
    const fakeCatalog = buildFakeCatalog();
    const withMaker = pickDirectPageMedia(fakeCatalog, null);
    expect(withMaker.hero?.slug).toBe('fashion-show-arrival');
    expect(withMaker.step2Card?.slug).toBe('skate-park-golden-hour');
    expect(withMaker.step1Card?.slug).toBe('static-portrait-window-light');
    expect(withMaker.step3Card?.slug).toBe('giant-daydream');
    expect(
      new Set([
        withMaker.hero?.slug,
        withMaker.step1Card?.slug,
        withMaker.step2Card?.slug,
        withMaker.step3Card?.slug,
      ]).size,
    ).toBe(4);

    // 1-template catalogue -> hero gets it, steps get NO duplicate posters (null)
    const oneTemplate = catalogFrom([fakeCatalog.community[0]!]);
    const pick1 = pickDirectPageMedia(oneTemplate, null);
    expect(pick1.hero?.slug).toBe('fashion-show-arrival');
    expect(pick1.step1Card).toBeNull();
    expect(pick1.step2Card).toBeNull();
    expect(pick1.step3Card).toBeNull();

    // 2-template catalogue -> hero + step 2 only, step 1 & step 3 are null (never duplicate)
    const twoTemplates = catalogFrom([fakeCatalog.community[0]!, fakeCatalog.community[1]!]);
    const pick2 = pickDirectPageMedia(twoTemplates, null);
    expect(pick2.hero?.slug).toBe('fashion-show-arrival');
    expect(pick2.step2Card?.slug).toBe('skate-park-golden-hour');
    expect(pick2.step1Card).toBeNull();
    expect(pick2.step3Card).toBeNull();

    // Agreeing card preferred ahead of disagreeing card (e.g. 4:5 poster vs 16:9 video)
    const disagreeMaker = makeCard({
      id: '9b000000-0000-4000-8000-000000000088',
      slug: 'neon-alley-dolly',
      origin: 'maker',
      aspectDefault: '16:9',
      poster: { source: 'route', src: '/p.png', mime: 'image/png', w: 1280, h: 1600 },
      video: { source: 'route', src: '/v.mp4', mime: 'video/mp4', w: 1280, h: 720 },
    });
    const agreeingStudio = fakeCatalog.yagi[0]!; // 1440x1080 poster & 1440x1080 video
    expect(heroVideoMatchesPoster(disagreeMaker)).toBe(false);
    expect(heroVideoMatchesPoster(agreeingStudio)).toBe(true);
    expect(pickDirectPageMedia(catalogFrom([disagreeMaker, agreeingStudio]), null).hero?.slug).toBe(
      agreeingStudio.slug,
    );

    // Disagreeing card only -> poster image only (NO <video> rendered)
    const disagreeOnlyHtml = renderToStaticMarkup(
      <DirectSceneStudio
        locale="ko"
        videoCatalogHref="/ko/video"
        creatorWorkspaceHref="/creators/workspace/formats/new"
        catalog={catalogFrom([disagreeMaker])}
      />,
    );
    expect(disagreeOnlyHtml).toContain('data-direct-hero-media');
    expect(disagreeOnlyHtml).toContain('src="/p.png"');
    expect(disagreeOnlyHtml).not.toContain('<video');

    // Missing video dimensions -> also renders poster image only (no <video>)
    const unknownDimsCard = makeCard({
      id: '9b000000-0000-4000-8000-000000000089',
      slug: 'unknown-video-dims',
      poster: { source: 'route', src: '/p2.png', mime: 'image/png', w: 1080, h: 1350 },
      video: { source: 'route', src: '/v2.mp4', mime: 'video/mp4' },
    });
    expect(heroVideoMatchesPoster(unknownDimsCard)).toBe(false);
    const unknownDimsHtml = renderToStaticMarkup(
      <DirectSceneStudio
        locale="ko"
        videoCatalogHref="/ko/video"
        creatorWorkspaceHref="/creators/workspace/formats/new"
        catalog={catalogFrom([unknownDimsCard])}
      />,
    );
    expect(unknownDimsHtml).toContain('src="/p2.png"');
    expect(unknownDimsHtml).not.toContain('<video');

    // Skips video-without-poster cards when picking hero video, falls back to poster-only when none have both
    const videoNoPoster = makeCard({
      id: '9b000000-0000-4000-8000-000000000099',
      slug: 'video-without-poster',
      origin: 'maker',
      poster: null,
      video: { source: 'route', src: '/api/prompts/media/vnp%3Avideo', mime: 'video/mp4', w: 1080, h: 1920 },
    });
    const studioValid = fakeCatalog.yagi[0]!;
    expect(pickDirectPageMedia(catalogFrom([videoNoPoster, studioValid]), null).hero?.slug).toBe(
      studioValid.slug,
    );

    const posterOnly = fakeCatalog.yagi[1]!;
    const posterOnlyPick = pickDirectPageMedia(catalogFrom([videoNoPoster, posterOnly]), null);
    expect(posterOnlyPick.hero?.slug).toBe(posterOnly.slug);
    const posterOnlyHtml = renderToStaticMarkup(
      <DirectSceneStudio
        locale="ko"
        videoCatalogHref="/ko/video"
        creatorWorkspaceHref="/creators/workspace/formats/new"
        catalog={catalogFrom([videoNoPoster, posterOnly])}
      />,
    );
    expect(posterOnlyHtml).toContain('data-direct-hero-media');
    expect(posterOnlyHtml).not.toContain('<video');

    // Only video-without-poster cards -> no hero media (no empty grey box)
    expect(pickDirectPageMedia(catalogFrom([videoNoPoster]), null).hero).toBeNull();

    // Poster ratio beats mismatched video dimensions & step tiles preserve 9:16 uncropped (fallback 4:5 when unknown)
    const ratio = heroAspectRatio(disagreeMaker);
    expect(ratio.css).toBe('1280 / 1600');
    expect(ratio.portrait).toBe(true);
    expect(stepTileMetrics(fakeCatalog.community[1]!, 300).aspectCss).toBe('1080 / 1920');
    expect(
      stepTileMetrics(makeCard({ poster: { source: 'route', src: '/u.png', mime: 'image/png' } }), 300).aspectCss,
    ).toBe('4 / 5');

    const empty = pickDirectPageMedia(EMPTY_PROMPT_CATALOG, null);
    expect(empty).toEqual({
      hero: null,
      step1Evidence: null,
      step1Card: null,
      step2Card: null,
      step3Card: null,
    });
  });

  for (const locale of ['ko', 'en'] as const) {
    it(`renders real media, dictionary copy, and strict simplification targets (${locale})`, () => {
      const fakeCatalog = buildFakeCatalog();
      const ds = getDictionary(locale).creatorJourney.directScene;
      const html = renderToStaticMarkup(
        <DirectSceneStudio
          locale={locale}
          videoCatalogHref={`/${locale}/video`}
          creatorWorkspaceHref="/creators/workspace/formats/new"
          catalog={fakeCatalog}
        />,
      );

      const sim = simulateMakerTemplateRevenue({
        medium: 'video',
        providerUsd: DEFAULT_DIRECT_VIDEO_PROVIDER_USD,
        royaltyKrw: DEFAULT_DIRECT_ROYALTY_KRW,
      });
      const hundredMakes =
        sim.milestones.find((m) => m.makes === 100)?.creatorTotalKrw ?? sim.perMake.creator * 100;
      const numLocale = locale === 'en' ? 'en-US' : 'ko-KR';
      const step3ExpectedLabel = ds.step3TileLabel.replace(
        '{amount}',
        DEFAULT_DIRECT_ROYALTY_KRW.toLocaleString(numLocale),
      );

      // Required section markers and workspace CTA href
      expect(html).toContain('data-direct-scene-studio');
      expect(html).toContain('data-direct-hero');
      expect(html).toContain('data-direct-hero-media');
      expect(html).toContain('data-direct-workspace-cta');
      expect(html).toContain('href="/creators/workspace/formats/new"');
      expect(html).toContain('data-direct-steps');
      expect(html.match(/data-direct-step="/g)).toHaveLength(3);
      expect(html).toContain('data-maker-revenue-calculator');
      expect(html.match(/data-maker-raise-option="/g)).toHaveLength(5);
      expect(html).toContain('data-maker-earning-per-make');
      expect(html).toContain('data-high-quality-guide');
      expect(html).toContain('data-quality-rule="01"');
      expect(html).toContain('data-quality-rule="02"');
      expect(html).toContain('data-quality-rule="03"');
      expect(html).toContain('data-buyer-preview-card');

      // Mobile hero order: primary CTA precedes hero media in markup so CTA is above the fold on 390x844
      expect(html.indexOf('data-direct-workspace-cta')).toBeLessThan(
        html.indexOf('data-direct-hero-media'),
      );

      // Closed <details> tips by default, valid <summary> without inner <div>
      const detailsTags = html.match(/<details\b[^>]*>/g) ?? [];
      expect(detailsTags).toHaveLength(3);
      for (const tag of detailsTags) {
        expect(tag).not.toMatch(/\bopen(?:=|\s|>)/);
      }
      const summaryMatches = [...html.matchAll(/<summary\b[^>]*>([\s\S]*?)<\/summary>/g)];
      expect(summaryMatches).toHaveLength(3);
      for (const match of summaryMatches) {
        expect(match[1]).not.toMatch(/<div\b/);
      }

      // One primary pink CTA only; closing button uses same primaryCta label
      expect(html.match(/class="audience-button"/g)).toHaveLength(1);
      const closingHtml = html.slice(html.indexOf('data-buyer-preview-card'));
      expect(decodeHtml(closingHtml)).toContain(ds.primaryCta);

      // Step 2 link image has alt="" and non-empty title in link text; ALL other images have non-empty alt
      const step2Start = html.indexOf('data-direct-step="2"');
      const step3Start = html.indexOf('data-direct-step="3"');
      const step2Section = html.slice(step2Start, step3Start);
      expect(step2Section).toContain('alt=""');
      expect(step2Section).toContain(
        locale === 'ko' ? '스케이트 파크 골든아워' : 'Skate park, golden hour',
      );
      const outsideStep2 = html.slice(0, step2Start) + html.slice(step3Start);
      for (const img of outsideStep2.match(/<img\b[^>]*>/g) ?? []) {
        expect(img).toMatch(/\bsrc="[^"]+"/);
        expect(img).toMatch(/\balt="[^"]+"/);
      }

      // Step 3 uses parameterized {amount} label and does NOT repeat the 100-makes figure
      const step3Section = html.slice(step3Start, html.indexOf('data-maker-revenue-calculator'));
      expect(decodeHtml(step3Section)).toContain(step3ExpectedLabel);
      expect(step3Section).not.toContain(hundredMakes.toLocaleString(numLocale));

      // No cropping object-position tricks on step tiles
      const stepsSection = html.slice(html.indexOf('data-direct-steps'), html.indexOf('data-maker-revenue-calculator'));
      expect(stepsSection).not.toContain('object-cover');
      expect(stepsSection).not.toContain('object-[50%_15%]');

      // Real media elements >= 3
      const imgTags = html.match(/<img\b[^>]*>/g) ?? [];
      const videoTags = html.match(/<video\b[^>]*>/g) ?? [];
      for (const video of videoTags) {
        expect(video).toMatch(/\bsrc="[^"]+"/);
        expect(video).toMatch(/\bposter="[^"]+"/);
        expect(video).toMatch(/\baria-label="[^"]+"/);
        expect(video).toMatch(/\bmuted/);
        expect(video).toMatch(/\bloop/);
        expect(video).toMatch(/\bplaysInline/i);
        expect(video).not.toMatch(/\bautoPlay/i);
      }
      expect(imgTags.length + videoTags.length).toBeGreaterThanOrEqual(3);
      expect(videoTags.length).toBeLessThanOrEqual(1);

      // Interactive control & heading targets
      const buttonTags = html.match(/<button\b[^>]*>/g) ?? [];
      expect(buttonTags.length).toBeLessThanOrEqual(7);
      expect(buttonTags).toHaveLength(5);
      expect(html).not.toMatch(/<(input|textarea|select)\b/);

      const headings = html.match(/<h[1-6]\b/g) ?? [];
      expect(headings.length).toBeLessThanOrEqual(6);
      expect(html.match(/<h1\b/g)).toHaveLength(1);

      // Text line target
      const lines = visibleTextLines(html);
      expect(lines.length).toBeLessThanOrEqual(80);

      // Dictionary copy + net-of-costs disclosure + computed 100-makes figure
      const decoded = decodeHtml(html);
      expect(decoded).toContain(ds.heroEyebrow);
      expect(decoded).toContain(ds.primaryCta);
      expect(decoded).toContain(ds.secondaryCta);
      expect(decoded).toContain(ds.step1Title);
      expect(decoded).toContain(ds.step2Title);
      expect(decoded).toContain(ds.step3Title);
      expect(decoded).toContain(ds.simDisclosure);
      expect(decoded).toContain(ds.closingBody);
      expect(decoded).toContain('by @yunseolfromseoul');
      expect(decoded).toContain('by @hana');

      if (locale === 'ko') {
        expect(decoded).toContain('세금·결제수수료·제작원가를 제외한 예상 금액');
        expect(decoded).toContain('0원~3,000원');
        expect(decoded).toContain('예상 수익이 자동으로 쌓입니다');
        expect(decoded).not.toMatch(/완성해요|쌓여요|좋아요|충분해요/);
      } else {
        expect(decoded).not.toMatch(/[가-힣]/);
        expect(decoded).not.toContain('Template Sale Price');
        expect(decoded).not.toContain('Payout Setup Pending');
        expect(decoded).not.toContain('Browse Templates');
      }

      expect(html).toContain(hundredMakes.toLocaleString(numLocale));
      expect(html).toContain(sim.salePriceKrw.toLocaleString(numLocale));
      expect(html).toContain(sim.perMake.creator.toLocaleString(numLocale));

      // No transition: all
      expect(html).not.toContain('transition-all');
      expect(html).not.toContain('transition: all');

      // Removed blocks stay gone
      for (const removed of [
        'data-direct-wording-rationale',
        'data-direct-scene-simulator',
        'data-stage=',
        'data-template-freeze-matrix',
        'data-direct-resolution-tiers',
        'data-direct-no-bgm-rule',
        'data-maker-milestone',
        'data-maker-db-pipeline',
        'data-selfie-suitability-box',
        'data-dual-likeness-preview',
      ]) {
        expect(html, removed).not.toContain(removed);
      }

      // Forbidden jargon, engine names, legacy tokens, and decorative numbering
      for (const forbidden of [
        'RECIPE V2',
        '{{selfie}}',
        'look_ref',
        'scene_ref',
        '5200K',
        '#ED1E1E',
        '#3875C5',
        '#3063A7',
        '80%',
        'platform_creators',
        'platform_formats',
        'platform_settlements',
        PROMPT_MODEL_LABEL,
        'Seedance',
        'Seedream',
        'Nano Banana',
        'Kling',
        'GPT Image',
        'BytePlus',
        '메이커',
        '크레딧',
        '01 ·',
        'Slack',
        '슬랙',
        '웹훅',
      ]) {
        expect(html.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
      }
    });
  }

  it('shows only the finished scene thumbnail on phone for the selfie -> scene pair, and full pair from md up', () => {
    const fakeCatalog = buildFakeCatalog();
    const dict = getDictionary('ko');
    const html = renderToStaticMarkup(
      <DirectSceneStudio
        locale="ko"
        videoCatalogHref="/ko/video"
        creatorWorkspaceHref="/creators/workspace/formats/new"
        catalog={fakeCatalog}
        evidence={{ before: '/before-selfie.jpg', after: '/after-scene.jpg' }}
      />,
    );

    const step1Section = html.slice(
      html.indexOf('data-direct-step="1"'),
      html.indexOf('data-direct-step="2"'),
    );
    expect(step1Section).toContain('src="/before-selfie.jpg"');
    expect(step1Section).toContain('src="/after-scene.jpg"');
    expect(step1Section).toContain(`alt="${dict.creatorJourney.evidenceSelfieAlt}"`);
    expect(step1Section).toContain(`alt="${dict.creatorJourney.evidenceSceneAlt}"`);
    // Before selfie wrapper is hidden below md (`hidden ... md:block`), finished scene stays visible on phone
    expect(step1Section).toMatch(/class="hidden [^"]*md:block"[^>]*><img[^>]*src="\/before-selfie\.jpg"/);
    expect(step1Section).not.toMatch(/class="hidden [^"]*"[^>]*><img[^>]*src="\/after-scene\.jpg"/);
    expect((html.match(/<video\b/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it('still renders cleanly with zero media when the catalogue is empty', () => {
    const html = renderToStaticMarkup(
      <DirectSceneStudio
        locale="ko"
        videoCatalogHref="/ko/video"
        creatorWorkspaceHref="/creators/workspace/formats/new"
        catalog={EMPTY_PROMPT_CATALOG}
        evidence={null}
      />,
    );

    expect(html).toContain('data-direct-hero');
    expect(html).not.toContain('data-direct-hero-media');
    expect(html).toContain('data-direct-steps');
    expect(html).toContain('data-maker-revenue-calculator');
    expect(html).toContain('data-high-quality-guide');
    expect(html).toContain('data-buyer-preview-card');
    expect(html.match(/<(img|video)\b/g)).toBeNull();
  });
});
