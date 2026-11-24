import { badgeFor } from '@/lib/content/badges';
import type { PromptCard } from './catalog';
import type { TemplateCast, TemplateMedium } from './schemas';
import { USE_CASES } from './use-cases';

/**
 * What a buyer can sort the template lists by (founder, 2026-11-24, said for the second time).
 *
 * The video list used the image side's genre chips (시네마틱 · 단편 · 뮤직비디오 …). They told a
 * buyer nothing: nineteen of twenty-four published videos were "cinematic". A video is chosen by facts
 * about the film you get, so the video list groups by those — its length band, whether it is new, and
 * (docs/PERSONAL-STUDIO.md §3.4.9, S2) whether the template keeps the buyer's own hair and makeup or
 * styles them. "A speaking scene" joins once templates declare it. The image list keeps its use-case
 * chips exactly as before.
 *
 * Pure: the server derives the offered options from the cards (`listFacets`), the rail writes each
 * card's facets onto its `<li>` (`cardFacets`), and the client filter reads them back
 * (`facetsFromDataset`) and decides visibility (`matchesFilter`). No zod, no database — this module
 * ships to the browser.
 *
 * Length is `runtime_seconds`, the length the template sells and renders. A row without it (NULL)
 * has no band: the card stays in the list under "all" and is never shown under a length chip, rather
 * than being guessed into one. The render worker's last-resort default for such a row is not a
 * length the product states anywhere (card, template page, credits all treat NULL as unknown).
 */

export const LENGTH_BANDS = ['short', 'mid', 'long'] as const;
export type LengthBand = (typeof LENGTH_BANDS)[number];

/** Upper bounds in seconds: short ≤ 10, mid 11–15, long ≥ 16. */
const SHORT_MAX_SECONDS = 10;
const MID_MAX_SECONDS = 15;

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — the `style` group, for video cards that declare their styling (`card.styling`):
 * `mine` = the hair and makeup the template names are all taken from the photo; `styled` = the template styles (or
 * locks) the hair or the makeup. A card that declares nothing about either matches neither and is shown under "all"
 * only, like a card without a length.
 */
export const STYLE_OPTIONS = ['mine', 'styled'] as const;
export type StyleFacet = (typeof STYLE_OPTIONS)[number];

/** The groups, in the order the row draws them. */
export const FACET_GROUPS = ['new', 'length', 'style', 'useCase'] as const;
export type FacetGroup = (typeof FACET_GROUPS)[number];

/** The one option of the `new` group — also its URL value (`?new=1`). */
export const NEW_OPTION = '1';

/** One choice per group; an absent group is "all". Values are the URL values. */
export type FilterState = Partial<Record<FacetGroup, string>>;

export interface CardFacets {
  new: boolean;
  length: LengthBand | null;
  style: StyleFacet | null;
  useCase: string[];
  cast: TemplateCast;
}

export interface ListFacet {
  group: FacetGroup;
  /** Only options at least one card has, in display order. */
  options: Array<{ value: string; count: number }>;
}

export function lengthBand(seconds: number | null | undefined): LengthBand | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds <= SHORT_MAX_SECONDS) return 'short';
  if (seconds <= MID_MAX_SECONDS) return 'mid';
  return 'long';
}

function isLengthBand(value: unknown): value is LengthBand {
  return typeof value === 'string' && (LENGTH_BANDS as readonly string[]).includes(value);
}

function isStyleFacet(value: unknown): value is StyleFacet {
  return typeof value === 'string' && (STYLE_OPTIONS as readonly string[]).includes(value);
}

type FacetCard = Pick<PromptCard, 'medium' | 'runtimeSeconds' | 'publishedAt' | 'useCase'> & Partial<Pick<PromptCard, 'cast' | 'locks' | 'styling'>>;

const LOOK_PARTS: readonly string[] = ['hair', 'makeup'];

/**
 * A video card's style facet (see `STYLE_OPTIONS`); null for an image, a card without a styling declaration, or one
 * that names neither the hair nor the makeup. A locked hair or makeup is the template's too (the lock wins).
 */
export function styleFacet(card: FacetCard): StyleFacet | null {
  if (card.medium !== 'video' || !card.styling) return null;
  const locked = card.locks ? (card.locks.all ? LOOK_PARTS : card.locks.slots.filter((slot) => LOOK_PARTS.includes(slot))) : [];
  if (locked.length > 0 || card.styling.styled.some((part) => LOOK_PARTS.includes(part))) return 'styled';
  return card.styling.photo.some((part) => LOOK_PARTS.includes(part)) ? 'mine' : null;
}

export function cardFacets(card: FacetCard, now?: Date | number): CardFacets {
  return {
    // The same rule and window as the card's NEW badge and the rail's NEW-first order.
    new: badgeFor({ firstPublishedAt: card.publishedAt, updatedAt: null, ...(now === undefined ? {} : { now }) }) === 'new',
    length: card.medium === 'video' ? lengthBand(card.runtimeSeconds) : null,
    style: styleFacet(card),
    useCase: [...card.useCase],
    cast: card.cast ?? 'solo',
  };
}

/** The attributes `PromptRail` writes on each `<li>`, read back by the client filter. */
export function facetsFromDataset(dataset: Partial<Record<string, string | undefined>>): CardFacets {
  const cast = dataset.cast;
  return {
    new: dataset.new === 'true',
    length: isLengthBand(dataset.length) ? dataset.length : null,
    style: isStyleFacet(dataset.style) ? dataset.style : null,
    useCase: (dataset.useCase ?? '').split(/\s+/).filter(Boolean),
    cast: cast === 'pet' || cast === 'couple' ? cast : 'solo',
  };
}

/**
 * The groups a list offers. A group with fewer than two populated options is not a choice and is
 * dropped; `new` (one option) is offered only when some, but not all, cards are new, and `style` only
 * when it splits the list (two populated options, or one that some but not all cards have).
 */
export function listFacets(cards: readonly FacetCard[], medium: TemplateMedium, now?: Date | number): ListFacet[] {
  if (cards.length === 0) return [];
  const facets = cards.map((card) => cardFacets(card, now));
  const out: ListFacet[] = [];

  if (medium === 'image') {
    const useCase = USE_CASES
      .map((value) => ({ value: value as string, count: facets.filter((facet) => facet.useCase.includes(value)).length }))
      .filter((option) => option.count > 0);
    if (useCase.length >= 2) out.push({ group: 'useCase', options: useCase });
    return out;
  }

  const fresh = facets.filter((facet) => facet.new).length;
  if (fresh > 0 && fresh < facets.length) out.push({ group: 'new', options: [{ value: NEW_OPTION, count: fresh }] });

  const length = LENGTH_BANDS
    .map((value) => ({ value: value as string, count: facets.filter((facet) => facet.length === value).length }))
    .filter((option) => option.count > 0);
  if (length.length >= 2) out.push({ group: 'length', options: length });

  const style = STYLE_OPTIONS
    .map((value) => ({ value: value as string, count: facets.filter((facet) => facet.style === value).length }))
    .filter((option) => option.count > 0);
  if (style.length >= 2 || (style.length === 1 && style[0]!.count < facets.length)) out.push({ group: 'style', options: style });

  return out;
}

/** One choice per group, groups ANDed. A card with no length never matches a length choice. */
export function matchesFilter(facets: CardFacets, filter: FilterState): boolean {
  if (filter.new !== undefined && !(filter.new === NEW_OPTION && facets.new)) return false;
  if (filter.length !== undefined && facets.length !== filter.length) return false;
  if (filter.style !== undefined && facets.style !== filter.style) return false;
  if (filter.useCase !== undefined && !facets.useCase.includes(filter.useCase)) return false;
  return true;
}
