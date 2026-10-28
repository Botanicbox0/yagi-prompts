import type { PromptCard } from '@/lib/prompts/catalog';
import { badgeFor } from '@/lib/content/badges';
import { DEFAULT_IMAGE_ASPECT, DEFAULT_VIDEO_ASPECT } from '@/lib/images/engines';
import { makerRest } from '@/lib/makers/links';

/**
 * Founder decision 2026-10-28 (docs/PLATFORM-2.0.md §15.6): **every card is the same 4:5 frame**.
 * The 2026-10-23 split (4:5 for portrait templates, 16:9 for landscape ones) left a 16:9 or 4:3
 * template a short strip next to a tall 9:16 card, and the strip lost. One frame gives every
 * template the same weight; the ratio chip still tells the buyer the output's real shape.
 */
export const CARD_RATIO = '4 / 5';

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
 * docs/PLATFORM-2.0.md §7.5·§14.1 — a studio template carries no byline (every one of them said
 * "YAGI 제작", which is no information); a maker's template names its maker, or says "메이커 템플릿"
 * while the maker keeps their profile private.
 */
export function cardAuthor(card: Pick<PromptCard, 'origin' | 'authorHandle'>): { handle: string | null } | null {
  if (card.origin !== 'maker') return null;
  return { handle: card.authorHandle };
}

/** The maker page a credit links to — only for a maker who opted in. */
export function makerProfileRest(card: Pick<PromptCard, 'origin' | 'authorHandle' | 'makerProfile'>): string | null {
  return card.origin === 'maker' && card.makerProfile && card.authorHandle ? makerRest(card.authorHandle) : null;
}

/**
 * NEW first, then the catalog's own order (featured → newest, `lib/prompts/repo.ts`). A stable
 * partition, so keyboard and visual order stay the catalog's inside each group.
 */
export function railOrder<T extends Pick<PromptCard, 'publishedAt'>>(cards: readonly T[], now?: Date | number): T[] {
  const isNew = (card: T) => badgeFor({ firstPublishedAt: card.publishedAt, updatedAt: null, ...(now === undefined ? {} : { now }) }) === 'new';
  return [...cards.filter(isNew), ...cards.filter((card) => !isNew(card))];
}
