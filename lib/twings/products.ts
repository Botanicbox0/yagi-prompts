import type { PromptCard } from '@/lib/prompts/catalog';

/**
 * TWINGS §1 — what a visitor actually buys (founder direction, 2026-08-16).
 *
 * The product stopped being "a prompt you copy" and became "a photo you hand over and a finished
 * film you get back". A STYLE is therefore the unit: one price, one finished example, one sentence
 * about what it turns you into.
 *
 * The example film is not a separate asset — it is the published prompt's own result clip, looked
 * up by slug. One video, one poster, one place they are maintained; the studio page and the prompt
 * page can never show different work for the same style.
 *
 * Prices are the founder's (2026-08-16): the 90s interview at $4, the prom queen at $7. They live
 * here as integers of USD cents so nothing downstream has to parse a string to add them up.
 */
export interface TwingsStyle {
  id: string;
  /** The published prompt whose result clip demonstrates this style. */
  slug: string;
  priceCents: number;
  runtimeSeconds: number;
}

export const TWINGS_STYLES: readonly TwingsStyle[] = [
  { id: 'seoul-90s', slug: '90s-seoul-interview', priceCents: 400, runtimeSeconds: 15 },
  { id: 'prom-queen', slug: 'you-are-a-prom-queen', priceCents: 700, runtimeSeconds: 30 },
];

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** A style joined to the card that carries its film. Styles with no published film are dropped. */
export interface TwingsStyleView extends TwingsStyle {
  card: PromptCard;
}

export function joinStyles(cards: readonly PromptCard[]): TwingsStyleView[] {
  return TWINGS_STYLES.flatMap((style) => {
    const card = cards.find((item) => item.slug === style.slug);
    return card ? [{ ...style, card }] : [];
  });
}
