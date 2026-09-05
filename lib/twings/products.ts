import type { PromptCard } from '@/lib/prompts/catalog';

/**
 * TWINGS — what a visitor actually buys (founder direction, 2026-08-16; re-homed 2026-09-05).
 *
 * The product is "a photo you hand over and a finished film you get back", so a TEMPLATE is the
 * unit: one price, one finished example, one medium. Until docs/TEMPLATES-IA.md the two styles and
 * their prices were a hardcoded list here; they now live on the row (`prompt_items.price_cents`,
 * `runtime_seconds`, migration 0015) so the founder adds a sellable template in the admin editor
 * rather than in a deploy. This module keeps the two things that are not data: how a price is
 * printed, and which cards are for sale at all.
 */

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** A card that can be bought — priced above zero. `price_cents = 0` is "not for sale yet". */
export function isForSale(card: Pick<PromptCard, 'priceCents'>): boolean {
  return card.priceCents > 0;
}

/** A template joined to the numbers the studio needs. Cards not for sale are dropped. */
export interface TwingsStyleView {
  id: string;
  slug: string;
  priceCents: number;
  runtimeSeconds: number;
  card: PromptCard;
}

export function joinStyles(cards: readonly PromptCard[]): TwingsStyleView[] {
  return cards.filter(isForSale).map((card) => ({
    id: card.slug,
    slug: card.slug,
    priceCents: card.priceCents,
    runtimeSeconds: card.runtimeSeconds ?? 0,
    card,
  }));
}

/** The price range across everything for sale, for the pricing page's one sentence. */
export function priceRange(cards: readonly PromptCard[]): { minCents: number; maxCents: number } | null {
  const cents = cards.filter(isForSale).map((card) => card.priceCents);
  if (cents.length === 0) return null;
  return { minCents: Math.min(...cents), maxCents: Math.max(...cents) };
}
