import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PROMPT_MODEL_LABEL } from '@/lib/prompts/schemas';
import {
  HERO_EDITORIAL_PRIORITY,
  HOME_FILTER_IDS,
  matchesHomeFilter,
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

const FILTER_LABELS = {
  label: '템플릿 필터',
  all: '전체',
  video: '영상',
  image: '화보',
  runway: '패션',
  retro: '레트로',
  fantasy: '판타지',
  celeb: '셀럽'
};

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
        filterLabels={FILTER_LABELS}
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

    expect(htmlKo).toContain('data-dispatch-image-spotlight');
    expect(htmlKo).toContain('data-dispatch-image-featured="bridal-editorial-5-shots"');
    expect(htmlKo).toContain('5장 에디토리얼 화보 세트');

    // Founder review 2026-11-10: one row of plain chips, no numbering, no plan pill, no frame tag
    expect(htmlKo).toContain('data-home-filter');
    for (const id of HOME_FILTER_IDS) {
      expect(htmlKo).toContain(`data-home-filter-chip="${id}"`);
    }
    for (const label of ['전체', '영상', '화보', '패션', '레트로', '판타지', '셀럽']) {
      expect(htmlKo).toContain(`>${label}</button>`);
    }
    for (const gone of ['FRAMES 01', 'Image-Only', 'data-plan-tier-toggle', '분위기와 세계관', '전체 에디션', '순수익', 'data-mood-pill', 'data-direct-scene-door']) {
      expect(htmlKo).not.toContain(gone);
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
        filterLabels={FILTER_LABELS}
        initialPlanTier="image_only"
      />
    );

    expect(htmlImageOnly).toContain('data-plan-tier="image_only"');
    expect(htmlImageOnly).toContain('data-image-priority="first"');
    expect(htmlImageOnly).toContain('data-home-filter-chip="image" aria-pressed="true"');
  });

  it('filters by medium and by mood with one selection', () => {
    expect(matchesHomeFilter('all', 'aquarium-goldfish', 'video')).toBe(true);
    expect(matchesHomeFilter('video', 'bridal-editorial-5-shots', 'image')).toBe(false);
    expect(matchesHomeFilter('image', 'bridal-editorial-5-shots', 'image')).toBe(true);
    expect(matchesHomeFilter('dream-fantasy', 'aquarium-goldfish', 'video')).toBe(true);
    expect(matchesHomeFilter('retro-youth', 'aquarium-goldfish', 'video')).toBe(false);
    expect(matchesHomeFilter('runway-editorial', 'bridal-editorial-5-shots', 'image')).toBe(true);
  });
});
