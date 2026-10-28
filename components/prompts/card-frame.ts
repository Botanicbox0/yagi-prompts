import type { PromptCard } from '@/lib/prompts/catalog';
import { badgeFor } from '@/lib/content/badges';
import { DEFAULT_IMAGE_ASPECT, DEFAULT_VIDEO_ASPECT } from '@/lib/images/engines';
import { makerRest } from '@/lib/makers/links';

/**
 * docs/PLATFORM-2.0.md §15.6 (founder feedback 2026-10-28, two rounds). A portrait or square
 * template sits in a 4:5 card. A template wider than it is tall (16:9, 4:3, 3:2 …) is a **wide
 * tile** across two grid columns, as tall as the 4:5 card beside it. A 16:9 card the shape of its
 * output was a short strip next to a 9:16 one; a 16:9 clip cropped into 4:5 lost about 55% of its
 * width and turned a wide shot into a face crop. The tile keeps the row: a four-column row holds
 * four cards, two tiles, or one tile and two cards, every title on one line.
 */
export const CARD_RATIO = '4 / 5';

export type CardFrame = 'portrait' | 'wide';

/**
 * The wide tile's media height, equal to a 4:5 card's at any width. The tile is two columns and
 * one gap wide (100cqi of its media box), so a column is (100cqi − gap) / 2 and 4:5 makes the
 * height 1.25 of that. `--card-gap` is the grid's own column gap, from CARD_GRID_GAP.
 */
export const WIDE_HEIGHT = 'calc((100cqi - var(--card-gap, 1rem)) * 0.625)';

/**
 * The column gap of every grid that places wide tiles, as a variable so WIDE_HEIGHT subtracts the
 * gap the grid really has: 0.75rem on a phone, 1rem from `sm` up.
 */
export const CARD_GRID_GAP = 'gap-x-(--card-gap) [--card-gap:0.75rem] sm:[--card-gap:1rem]';

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

/** Wider than tall → the two-column tile; portrait and square → the 4:5 card. */
export function cardFrame(card: Pick<PromptCard, 'aspectDefault' | 'medium'>): CardFrame {
  return (parseAspect(cardAspect(card)) ?? 0) > 1 ? 'wide' : 'portrait';
}

type Framed = Pick<PromptCard, 'aspectDefault' | 'medium'>;
const isWide = (card: Framed) => cardFrame(card) === 'wide';

/**
 * Grid order for wide tiles, without `grid-auto-flow: dense` (that would break keyboard order =
 * visual order). The grid fills in two-cell units: one wide tile, or two single cards side by
 * side. A single with no partner pulls the next single forward to sit beside it, so every unit
 * starts on an even cell and a two- or four-column grid never leaves a hole mid-rail. A single
 * with no single after it goes to the very end — the only place a half row may sit.
 */
export function pairCards<T extends Framed>(cards: readonly T[]): T[] {
  const queue = [...cards];
  const out: T[] = [];
  let lone: T | undefined;
  for (let card = queue.shift(); card !== undefined; card = queue.shift()) {
    if (isWide(card)) {
      out.push(card);
      continue;
    }
    const partner = queue.findIndex((next) => !isWide(next));
    if (partner === -1) lone = card;
    else out.push(card, ...queue.splice(partner, 1));
  }
  return lone === undefined ? out : [...out, lone];
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
 * NEW first, then the catalog's own order (featured → newest, `lib/prompts/repo.ts`), each group
 * paired into two-cell units (`pairCards`). Every NEW card still comes before every older one: an
 * odd single left over in the NEW group waits at its end for the first older single.
 */
export function railOrder<T extends Pick<PromptCard, 'publishedAt'> & Framed>(cards: readonly T[], now?: Date | number): T[] {
  const isNew = (card: T) => badgeFor({ firstPublishedAt: card.publishedAt, updatedAt: null, ...(now === undefined ? {} : { now }) }) === 'new';
  const fresh = pairCards(cards.filter(isNew));
  const older = cards.filter((card) => !isNew(card));
  if (fresh.filter((card) => !isWide(card)).length % 2 === 0) return [...fresh, ...pairCards(older)];
  const lone = fresh.pop()!; // pairCards leaves the odd single last
  const partner = older.findIndex((card) => !isWide(card));
  if (partner === -1) return [...fresh, ...older, lone];
  const mate = older.splice(partner, 1);
  return [...fresh, lone, ...mate, ...pairCards(older)];
}
