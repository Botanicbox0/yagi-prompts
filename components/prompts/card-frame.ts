import type { PromptCard } from '@/lib/prompts/catalog';
import { badgeFor } from '@/lib/content/badges';
import { DEFAULT_IMAGE_ASPECT, DEFAULT_VIDEO_ASPECT } from '@/lib/images/engines';
import { makerRest } from '@/lib/makers/links';

/**
 * Founder decision 2026-10-23 (docs/PLATFORM-2.0.md §15.5-15): a portrait template is a **4:5
 * card in two columns**; the 2026-08-14 "every card 16:9" rule survives for landscape templates
 * only. The 16:9 window letterboxed a 9:16 result into half a screen of black — the card now
 * crops a portrait clip to 4:5 instead, the way every short-form template wall does.
 *
 * The catalog no longer uses these windows (see `cardRatio`); the campaign wizard's format picker does.
 */
export const CARD_RATIOS = { portrait: '4 / 5', landscape: '16 / 9' } as const;
export type CardFrame = keyof typeof CARD_RATIOS;

/** Wider than 6:5 reads as landscape; square and 4:5 sit happily in the portrait frame. */
const LANDSCAPE_FROM = 1.2;

function parseAspect(value: string | null): number | null {
  const match = value ? /^(\d+):(\d+)$/.exec(value) : null;
  if (!match) return null;
  const w = Number(match[1]), h = Number(match[2]);
  return w > 0 && h > 0 ? w / h : null;
}

/** What the studio opens with when the template does not say — the medium's default aspect. */
export function cardAspect(card: Pick<PromptCard, 'aspectDefault' | 'medium'>): string {
  if (card.aspectDefault && parseAspect(card.aspectDefault) !== null) return card.aspectDefault;
  return card.medium === 'image' ? DEFAULT_IMAGE_ASPECT : DEFAULT_VIDEO_ASPECT;
}

/**
 * The frame follows the example that sits in it (a complete measured pair, the same rule the
 * creator hero uses), then the template's opening aspect, then the medium's default.
 */
export function cardFrame(card: Pick<PromptCard, 'poster' | 'video' | 'aspectDefault' | 'medium'>): CardFrame {
  const measured = [card.video, card.poster].find((media) => media?.w && media?.h && media.w > 0 && media.h > 0);
  const ratio = measured ? measured.w! / measured.h! : parseAspect(cardAspect(card));
  return ratio !== null && ratio >= LANDSCAPE_FROM ? 'landscape' : 'portrait';
}

/**
 * Founder 2026-10-31: films come in every shape and none of them should be cut to fit. A catalog
 * card takes the example's own ratio and `.film-rows` (globals.css) lines the cards up in rows of
 * one height that fill the width, so the page stays tidy with no crop and no letterbox.
 * Same evidence order as `cardFrame`: the measured example, then the template's opening aspect.
 */
export function cardRatio(card: Pick<PromptCard, 'poster' | 'video' | 'aspectDefault' | 'medium'>): number {
  const measured = [card.video, card.poster].find((media) => media?.w && media?.h && media.w > 0 && media.h > 0);
  return measured ? measured.w! / measured.h! : parseAspect(cardAspect(card)) ?? 4 / 5;
}

/**
 * docs/PLATFORM-2.0.md §7.5·§14.1 — a studio template carries no byline (every one of them said
 * "YAGI 제작", which is no information) unless an admin typed a handle for it (founder 2026-11-02);
 * a maker's template names its maker, or says "메이커 템플릿" while the maker keeps their profile private.
 */
export function cardAuthor(card: Pick<PromptCard, 'origin' | 'authorHandle'>): { handle: string | null } | null {
  if (card.origin !== 'maker' && !card.authorHandle) return null;
  return { handle: card.authorHandle };
}

/** The maker page a credit links to — only for a maker who opted in. */
export function makerProfileRest(card: Pick<PromptCard, 'origin' | 'authorHandle' | 'makerProfile'>): string | null {
  return card.origin === 'maker' && card.makerProfile && card.authorHandle ? makerRest(card.authorHandle) : null;
}

/**
 * Founder 2026-10-30 (docs/PLATFORM-2.0.md §7.5): originals and AI creatives' templates share one
 * feed. Inside the ranking, one origin never takes more than this many places in a row while the
 * other still has cards — on a four-column desktop every row then holds both, on a phone every two.
 */
export const ORIGIN_RUN_MAX = 3;

/**
 * One ranking for the whole feed: NEW first, then the catalog's own order (featured → newest,
 * `lib/prompts/repo.ts`), then the origin rule above. The merge always takes the better-ranked of
 * the two origins' next cards unless that origin has just had ORIGIN_RUN_MAX places, so each origin
 * keeps its own order and a list from one origin comes out exactly as ranked.
 */
export function railOrder<T extends Pick<PromptCard, 'publishedAt'> & Partial<Pick<PromptCard, 'origin'>>>(cards: readonly T[], now?: Date | number): T[] {
  const isNew = (card: T) => badgeFor({ firstPublishedAt: card.publishedAt, updatedAt: null, ...(now === undefined ? {} : { now }) }) === 'new';
  const ranked = [...cards.filter(isNew), ...cards.filter((card) => !isNew(card))];
  // Ranks ride along so the merge compares places, not dates again.
  const queues: [Array<[T, number]>, Array<[T, number]>] = [[], []];
  ranked.forEach((card, index) => queues[card.origin === 'maker' ? 1 : 0].push([card, index]));
  const heads: [number, number] = [0, 0];
  const out: T[] = [];
  let runSide: 0 | 1 | null = null, run = 0;
  while (out.length < ranked.length) {
    const next = (side: 0 | 1) => queues[side][heads[side]];
    const studio = next(0), maker = next(1);
    let side: 0 | 1 = maker === undefined || (studio !== undefined && studio[1] < maker[1]) ? 0 : 1;
    const other: 0 | 1 = side === 0 ? 1 : 0;
    if (side === runSide && run >= ORIGIN_RUN_MAX && next(other) !== undefined) side = other;
    out.push(next(side)![0]);
    heads[side] += 1;
    run = side === runSide ? run + 1 : 1;
    runSide = side;
  }
  return out;
}
