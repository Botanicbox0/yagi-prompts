import type { PromptCard } from '@/lib/prompts/catalog';

export type EditorialMoodId =
  | 'all'
  | 'runway-editorial'
  | 'retro-youth'
  | 'dream-fantasy'
  | 'celeb-spotlight'
  | 'photo-series';

export type ViewerPlanTier = 'standard' | 'image_only' | 'creator' | 'premium';
export type GalleryMediumTab = 'all' | 'video' | 'image';

/**
 * Determines which medium tab opens first based on the user's subscription plan tier.
 * For the lowest-tier `image_only` plan, Image Templates (`'image'`) are prioritized and
 * surfaced first so users never have to scroll past video-only templates.
 */
export function resolveDefaultMediumForPlan(planTier: ViewerPlanTier = 'standard'): GalleryMediumTab {
  if (planTier === 'image_only') return 'image';
  return 'all';
}

/**
 * The one chip row above the home gallery (founder review 2026-11-10: one row, plain words, no
 * numbers). Medium chips and the four mood chips share one selection; labels live in the
 * dictionaries under `creatorJourney.filter*`.
 */
export type HomeFilterId =
  | 'all'
  | 'video'
  | 'image'
  | 'runway-editorial'
  | 'retro-youth'
  | 'dream-fantasy'
  | 'celeb-spotlight';

export const HOME_FILTER_IDS: readonly HomeFilterId[] = [
  'all',
  'video',
  'image',
  'runway-editorial',
  'retro-youth',
  'dream-fantasy',
  'celeb-spotlight'
];

export function resolveDefaultFilterForPlan(planTier: ViewerPlanTier = 'standard'): HomeFilterId {
  return resolveDefaultMediumForPlan(planTier);
}

/** Whether a card with these traits stays visible under the selected chip. */
export function matchesHomeFilter(
  filter: HomeFilterId,
  slug: string,
  medium: 'video' | 'image'
): boolean {
  if (filter === 'all') return true;
  if (filter === 'video' || filter === 'image') return medium === filter;
  return resolveTemplateMoods(slug, medium).includes(filter);
}

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
