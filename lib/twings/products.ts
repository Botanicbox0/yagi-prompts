import type { PromptCard } from '@/lib/prompts/catalog';

/**
 * TWINGS — what a visitor actually buys (founder direction, 2026-08-16; re-homed 2026-09-05).
 *
 * The product is "a photo you hand over and a finished film you get back", so a TEMPLATE is the
 * unit: one price, one finished example, one medium. Until docs/TEMPLATES-IA.md the two styles and
 * their prices were a hardcoded list here; they now live on the row (`prompt_items.price_cents`,
 * `runtime_seconds`, migration 0015) so the founder adds a sellable template in the admin editor
 * rather than in a deploy. This module keeps the things that are not data: how a price is printed,
 * in which currency, and which cards are for sale at all.
 *
 * Two currencies, one rule (founder, 2026-09-07: "한국어로 제작할때 비용이 달러로 표시되면 안될 것
 * 같아"): a Korean page shows a FIXED won price, never a converted dollar. The won price lives on
 * the row too (`price_krw`, migration 0018) so the founder sets it like the USD one; a row without
 * one falls back to the x,900 suggestion below, which is also what the migration backfilled.
 *
 * And WHERE a price shows (same day: "가격은 자세히 보기를 눌러야만"): on the template page and in
 * the pricing table — never on a card. The card sells the result; the page names the price.
 */

export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** The fixed rate the x,900 suggestion uses. A suggestion, not a quote — the row's own won price wins. */
export const KRW_PER_USD = 1400;

/** $4 → 5,900원, $7 → 9,900원, $2 → 2,900원: up to the next thousand, minus a hundred; never below 900. */
export function suggestedKrw(cents: number): number {
  if (cents <= 0) return 0;
  const krw = (cents * KRW_PER_USD) / 100;
  return Math.max(900, Math.ceil(krw / 1000) * 1000 - 100);
}

export function formatKrw(krw: number): string {
  return `${new Intl.NumberFormat('ko-KR').format(krw)}원`;
}

type Priced = Pick<PromptCard, 'priceCents' | 'priceKrw'>;

/** The won price a Korean reader sees: the row's own, else the suggestion from the dollar price. */
export function krwPrice(card: Priced): number {
  return card.priceKrw > 0 ? card.priceKrw : suggestedKrw(card.priceCents);
}

/** The price in the reader's currency: won on a Korean page, dollars everywhere else. */
export function formatTemplatePrice(card: Priced, locale: string): string {
  return locale === 'ko' ? formatKrw(krwPrice(card)) : formatPrice(card.priceCents);
}

/** A card that can be bought — priced above zero. `price_cents = 0` is "not for sale yet". */
export function isForSale(card: Pick<PromptCard, 'priceCents'>): boolean {
  return card.priceCents > 0;
}

/** The price range across everything for sale, printed in the reader's currency, for the pricing page's one sentence. */
export function priceRangeFor(cards: readonly Priced[], locale: string): { min: string; max: string } | null {
  const sale = cards.filter(isForSale);
  if (sale.length === 0) return null;
  if (locale === 'ko') {
    const won = sale.map(krwPrice);
    return { min: formatKrw(Math.min(...won)), max: formatKrw(Math.max(...won)) };
  }
  const cents = sale.map((card) => card.priceCents);
  return { min: formatPrice(Math.min(...cents)), max: formatPrice(Math.max(...cents)) };
}
