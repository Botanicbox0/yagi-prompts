/**
 * Founder 2026-11-02: the catalog opens with the best-looking templates ("추천순"). This hand-kept
 * order stands in until likes or a recommender can rank them (docs/PLATFORM-2.0.md §7.5); that system
 * replaces `recommendedRank` and nothing else has to change.
 *
 * Judged by eye on each template's poster and film: does it read as a real photograph, is it art
 * directed, does it hold up small on a card. A slug that is not listed simply has no rank.
 */
export const RECOMMENDED_VIDEO_ORDER = [
  'aquarium-goldfish',
  'city-fashion-montage',
  'fashion-show-arrival',
  'chinese-wuxia-heroine',
  'lens-portal-tutu',
  'my-tiffany-s-moment',
  'memory-film',
  'alice-in-wonderland',
  'dollhouse-fashion-salon',
  'giant-daydream',
  'summer-peach-photoshoot',
  'star-in-a-virtual-beauty-ad',
  '80s-roller-disco',
  'japanese-teen-star-in-the-1980s',
  'the-signature-piece',
  'aquarium-goldfish-daydream',
  '90s-seoul-interview',
  'the-three-princes',
  'tokyo-s-new-teen-star-86',
  'gothic-doll-claw-machine',
  'pink-signal-flip-phone',
  'you-are-a-prom-queen',
  'dobby-is-free',
] as const;

export const RECOMMENDED_IMAGE_ORDER = ['bridal-editorial-5-shots', 'dark-halloween-image-set-5-images'] as const;

/** The places no new template pushes down: two rows on a four-column desktop. */
export const RECOMMENDED_LEAD = 8;

const RANKS: ReadonlyMap<string, number> = new Map(
  [RECOMMENDED_VIDEO_ORDER, RECOMMENDED_IMAGE_ORDER].flatMap((order) => order.map((slug, rank) => [slug, rank] as const)),
);

/** Lower is better, counted inside the template's own medium. `null` means not ranked yet. */
export function recommendedRank(slug: string): number | null {
  return RANKS.get(slug) ?? null;
}
