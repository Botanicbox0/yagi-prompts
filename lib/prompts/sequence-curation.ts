import type { PromptCard } from '@/lib/prompts/catalog';

export type EditorialMoodId =
  | 'all'
  | 'runway-editorial'
  | 'retro-youth'
  | 'dream-fantasy'
  | 'celeb-spotlight'
  | 'photo-series';

export interface EditorialMoodOption {
  id: EditorialMoodId;
  indexLabel: string;
  labelKo: string;
  labelEn: string;
  descKo: string;
  descEn: string;
}

export const EDITORIAL_MOOD_OPTIONS: readonly EditorialMoodOption[] = [
  {
    id: 'all',
    indexLabel: 'ALL',
    labelKo: '전체 에디션',
    labelEn: 'All Editions',
    descKo: '이번 주 추천순 전체 영상 포맷과 5장 화보집을 한눈에 둘러봅니다.',
    descEn: 'Browse all curated video formats and 5-shot editorial photo series.'
  },
  {
    id: 'runway-editorial',
    indexLabel: '01',
    labelKo: '런웨이 & 하이패션',
    labelEn: 'Runway & High Fashion',
    descKo: '패션쇼 프레스 라인, 도심 스트릿 몽타주, 하이주얼리와 웨딩 화보 주인공이 되는 장면',
    descEn: 'Step into front-row runway arrivals, city fashion montages, and couture editorials.'
  },
  {
    id: 'retro-youth',
    indexLabel: '02',
    labelKo: '8090 레트로 & 청춘 기록',
    labelEn: '80s–90s Retro & Youth',
    descKo: '90년대 서울 길거리 인터뷰, 80년대 도쿄 하이틴 스타, 필름 캠코더 감성의 청춘 장면',
    descEn: '1990s Seoul street interviews, 80s teen icons, and analog camcorder nostalgia.'
  },
  {
    id: 'dream-fantasy',
    indexLabel: '03',
    labelKo: '몽환 & 시네마 판타지',
    labelEn: 'Dream & Cinema Fantasy',
    descKo: '어항 속 금붕어 백일몽, 발레리나 렌즈 포털, 동화·무협 세계관의 초현실 시네마',
    descEn: 'Surreal aquarium daydreams, lens portals, fairytales, and cinematic fantasy worlds.'
  },
  {
    id: 'celeb-spotlight',
    indexLabel: '04',
    labelKo: '셀럽 & 뷰티 캠페인',
    labelEn: 'Celeb & Beauty Spotlight',
    descKo: '글로벌 뷰티 광고의 메인 모델이나 매거진 커버 주인공처럼 빛나는 클로즈업',
    descEn: 'Star in luxury beauty commercials, magazine covers, and flash-lit press lines.'
  },
  {
    id: 'photo-series',
    indexLabel: '05',
    labelKo: '5장 화보집 (이미지)',
    labelEn: '5-Shot Photo Series',
    descKo: '셀카 한 장으로 한 번에 5장의 화보 세트를 완성하는 에디토리얼 사진 컬렉션',
    descEn: 'Turn one selfie into a complete 5-frame editorial photography series.'
  }
] as const;

const RUNWAY_SLUGS = new Set([
  'city-fashion-montage',
  'fashion-show-arrival',
  'my-tiffany-s-moment',
  'dollhouse-fashion-salon',
  'the-signature-piece',
  'bridal-editorial-5-shots'
]);

const RETRO_SLUGS = new Set([
  '90s-seoul-interview',
  '80s-roller-disco',
  'japanese-teen-star-in-the-1980s',
  'tokyo-s-new-teen-star-86',
  'memory-film',
  'pink-signal-flip-phone',
  'you-are-a-prom-queen'
]);

const DREAM_SLUGS = new Set([
  'aquarium-goldfish',
  'lens-portal-tutu',
  'alice-in-wonderland',
  'chinese-wuxia-heroine',
  'giant-daydream',
  'gothic-doll-claw-machine',
  'the-three-princes',
  'dobby-is-free',
  'dark-halloween-image-set-5-images'
]);

const CELEB_SLUGS = new Set([
  'star-in-a-virtual-beauty-ad',
  'summer-peach-photoshoot',
  'fashion-show-arrival',
  'my-tiffany-s-moment',
  'bridal-editorial-5-shots'
]);

/**
 * Priority order for the personal home hero showcase video.
 * Replaces the legacy rank-#21 `you-are-a-prom-queen` with top-ranked editorial films from
 * `RECOMMENDED_VIDEO_ORDER` (`city-fashion-montage` 4:3 editorial montage, `aquarium-goldfish`,
 * `fashion-show-arrival`, `my-tiffany-s-moment`).
 */
export const HERO_EDITORIAL_PRIORITY = [
  'city-fashion-montage',
  'aquarium-goldfish',
  'fashion-show-arrival',
  'my-tiffany-s-moment',
  'lens-portal-tutu'
] as const;

export function pickHeroFeaturedTemplate(
  cards: readonly PromptCard[]
): PromptCard | undefined {
  const studioVideo = cards.filter((card) => card.origin !== 'maker');
  for (const slug of HERO_EDITORIAL_PRIORITY) {
    const match = studioVideo.find((card) => card.slug === slug && card.video && card.poster);
    if (match) return match;
  }
  for (const slug of HERO_EDITORIAL_PRIORITY) {
    const match = studioVideo.find((card) => card.slug === slug) ?? cards.find((card) => card.slug === slug);
    if (match) return match;
  }
  return (
    studioVideo.find((card) => card.video && card.poster) ??
    studioVideo[0] ??
    cards[0]
  );
}

/**
 * Classifies any template into meaningful, user-centric editorial moods instead of generic
 * production tags like "cinematic".
 */
export function resolveTemplateMoods(
  slug: string,
  medium: 'video' | 'image' = 'video'
): EditorialMoodId[] {
  const moods: EditorialMoodId[] = ['all'];
  if (medium === 'image' || slug.includes('image') || slug.includes('shots')) {
    moods.push('photo-series');
  }
  if (RUNWAY_SLUGS.has(slug) || /fashion|runway|tiffany|bridal|dress|suit/i.test(slug)) {
    moods.push('runway-editorial');
  }
  if (RETRO_SLUGS.has(slug) || /80s|90s|retro|interview|teen|memory|flip-phone|prom/i.test(slug)) {
    moods.push('retro-youth');
  }
  if (
    DREAM_SLUGS.has(slug) ||
    /aquarium|goldfish|dream|alice|wuxia|portal|tutu|doll|halloween|prince/i.test(slug)
  ) {
    moods.push('dream-fantasy');
  }
  if (CELEB_SLUGS.has(slug) || /beauty|star|peach|photoshoot|celeb/i.test(slug)) {
    moods.push('celeb-spotlight');
  }
  // Ensure every video template belongs to at least one curated theme beyond 'all'
  if (moods.length === 1) {
    moods.push('runway-editorial');
  }
  return moods;
}
