import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL } from '@/lib/prompts/schemas';
import {
  EDITORIAL_MOOD_OPTIONS,
  HERO_EDITORIAL_PRIORITY,
  SequenceDispatchSection,
  pickHeroFeaturedTemplate,
  resolveDefaultMediumForPlan,
  resolveTemplateMoods
} from '@/components/audience/sequence-dispatch';

function makeCard(overrides: Partial<PromptCard> = {}): PromptCard {
  return {
    id: '9a000000-0000-4000-8000-000000000001',
    slug: 'city-fashion-montage',
    title: 'City Fashion Montage',
    titleKo: '도심 패션 몽타주',
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
    runtimeSeconds: 12,
    engine: null,
    aspectDefault: '4:3',
    poster: { source: 'route', src: '/api/prompts/media/city%3Aposter', mime: 'image/png', w: 1664, h: 1248 },
    video: { source: 'route', src: '/api/prompts/media/city%3Avideo', mime: 'video/mp4' },
    lock: null,
    featured: true,
    publishedAt: '2026-10-25T00:00:00.000Z',
    ...overrides
  };
}

describe('SequenceDispatchSection & personal home editorial curation (2026-11-04)', () => {
  it('prioritizes top-ranked aesthetic editorial films over legacy you-are-a-prom-queen for the hero showcase', () => {
    const promQueen = makeCard({ slug: 'you-are-a-prom-queen', title: 'You Are a Prom Queen' });
    const cityFashion = makeCard({ slug: 'city-fashion-montage', title: 'City Fashion Montage' });
    const goldfish = makeCard({ slug: 'aquarium-goldfish', title: 'Aquarium Goldfish' });

    const chosen = pickHeroFeaturedTemplate([promQueen, goldfish, cityFashion]);
    expect(chosen?.slug).toBe('city-fashion-montage');
    expect(HERO_EDITORIAL_PRIORITY[0]).toBe('city-fashion-montage');
    expect(HERO_EDITORIAL_PRIORITY).not.toContain('you-are-a-prom-queen');
  });

  it('classifies templates into meaningful protagonist worlds instead of generic cinematic tags', () => {
    expect(resolveTemplateMoods('city-fashion-montage', 'video')).toContain('runway-editorial');
    expect(resolveTemplateMoods('90s-seoul-interview', 'video')).toContain('retro-youth');
    expect(resolveTemplateMoods('aquarium-goldfish', 'video')).toContain('dream-fantasy');
    expect(resolveTemplateMoods('star-in-a-virtual-beauty-ad', 'video')).toContain('celeb-spotlight');
    expect(resolveTemplateMoods('bridal-editorial-5-shots', 'image')).toContain('photo-series');
    expect(resolveTemplateMoods('bridal-editorial-5-shots', 'image')).toContain('runway-editorial');
  });

  it('renders THIS WEEK IN TWINGS dispatch with top hot videos and elevated 5-shot photo series spotlight', () => {
    const hotVideos = [
      makeCard({ slug: 'aquarium-goldfish', title: 'Aquarium Goldfish', titleKo: '어항 속 금붕어 백일몽', runtimeSeconds: 10 }),
      makeCard({ slug: 'city-fashion-montage', title: 'City Fashion Montage', titleKo: '도심 패션 몽타주', runtimeSeconds: 12 }),
      makeCard({ slug: 'fashion-show-arrival', title: 'Fashion Show Arrival', titleKo: '패션쇼 프레스 도착', runtimeSeconds: 15, authorHandle: 'yunseolfromseoul', origin: 'maker' })
    ];
    const imageSeries = [
      makeCard({
        slug: 'bridal-editorial-5-shots',
        title: 'Bridal Editorial (5 Shots)',
        titleKo: '브라이덜 에디토리얼 5컷 화보',
        medium: 'image',
        runtimeSeconds: null,
        aspectDefault: '4:5',
        gallery: [
          { source: 'route', src: '/img/1.jpg', mime: 'image/jpeg', w: 1080, h: 1350 },
          { source: 'route', src: '/img/2.jpg', mime: 'image/jpeg', w: 1080, h: 1350 },
          { source: 'route', src: '/img/3.jpg', mime: 'image/jpeg', w: 1080, h: 1350 }
        ]
      }),
      makeCard({
        slug: 'dark-halloween-image-set-5-images',
        title: 'Dark Halloween (5 Shots)',
        titleKo: '다크 할로윈 5컷 화보',
        medium: 'image',
        runtimeSeconds: null,
        aspectDefault: '4:5'
      })
    ];

    const htmlKo = renderToStaticMarkup(
      <SequenceDispatchSection
        locale="ko"
        hotVideos={hotVideos}
        imageSeries={imageSeries}
        cardSecondsPattern="{seconds}초"
        cardAuthorPattern="by @{handle}"
        cardAuthorAnonymous="메이커 제작"
      />
    );

    expect(htmlKo).toContain('data-sequence-editorial');
    expect(htmlKo).toContain('data-weekly-dispatch');
    expect(htmlKo).toContain('THIS WEEK IN TWINGS');
    expect(htmlKo).toContain('data-dispatch-card="aquarium-goldfish"');
    expect(htmlKo).toContain('data-dispatch-card="city-fashion-montage"');
    expect(htmlKo).toContain('data-dispatch-card="fashion-show-arrival"');

    // No redundant "01 · HOT FILM" label above cards, and videos render as playing <video> elements
    expect(htmlKo).not.toContain('HOT FILM');
    expect(htmlKo).toContain('data-dispatch-video="aquarium-goldfish"');
    expect(htmlKo).toContain('data-dispatch-video="city-fashion-montage"');
    expect(htmlKo).toContain('data-dispatch-video="fashion-show-arrival"');

    // Instant medium switcher (Video ⇄ 5-Shot Photo Series) + Image-Only plan priority toggle
    expect(htmlKo).toContain('data-gallery-medium-switcher');
    expect(htmlKo).toContain('data-medium-tab="video"');
    expect(htmlKo).toContain('data-medium-tab="image"');
    expect(htmlKo).toContain('data-plan-tier-toggle="image_only"');

    expect(htmlKo).toContain('data-dispatch-image-spotlight');
    expect(htmlKo).toContain('data-dispatch-image-featured="bridal-editorial-5-shots"');
    expect(htmlKo).toContain('5장 에디토리얼 화보 세트');
    expect(htmlKo).toContain('FRAMES 01–05');

    // Meaningful mood curator pills
    expect(htmlKo).toContain('data-editorial-mood-curator');
    for (const option of EDITORIAL_MOOD_OPTIONS) {
      expect(htmlKo).toContain(`data-mood-pill="${option.id}"`);
      expect(htmlKo).toContain(option.labelKo.replaceAll('&', '&amp;'));
    }

    // TWINGS Identity compliance: no YAGI red (#ED1E1E), no internal engine names
    expect(htmlKo).not.toContain('#ED1E1E');
    expect(htmlKo).not.toContain(PROMPT_MODEL_LABEL);
  });

  it('prioritizes 5-shot photo series first when initialPlanTier is image_only (lowest subscription tier)', () => {
    expect(resolveDefaultMediumForPlan('standard')).toBe('all');
    expect(resolveDefaultMediumForPlan('image_only')).toBe('image');

    const htmlImageOnly = renderToStaticMarkup(
      <SequenceDispatchSection
        locale="ko"
        hotVideos={[makeCard({ slug: 'aquarium-goldfish' })]}
        imageSeries={[makeCard({ slug: 'bridal-editorial-5-shots', medium: 'image' })]}
        cardSecondsPattern="{seconds}초"
        cardAuthorPattern="by @{handle}"
        cardAuthorAnonymous="메이커 제작"
        initialPlanTier="image_only"
      />
    );

    expect(htmlImageOnly).toContain('data-plan-tier="image_only"');
    expect(htmlImageOnly).toContain('data-image-priority="first"');
    expect(htmlImageOnly).toContain('data-medium-tab="image" aria-selected="true"');
  });
});
