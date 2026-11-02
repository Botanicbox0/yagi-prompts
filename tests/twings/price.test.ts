import { describe, expect, it } from 'vitest';
import { formatKrw, formatPrice, formatTemplatePrice, krwPrice, priceRangeFor, suggestedKrw } from '@/lib/twings/products';

const card = (priceCents: number, priceKrw = 0) => ({ priceCents, priceKrw });

/** Founder, 2026-09-07: a Korean page shows a fixed won price, never a converted dollar. */
describe('template prices in two currencies', () => {
  it('suggests an x,900 won price from the dollar price, never below 900', () => {
    expect(suggestedKrw(400)).toBe(5900);
    expect(suggestedKrw(700)).toBe(9900);
    expect(suggestedKrw(200)).toBe(2900);
    expect(suggestedKrw(1000)).toBe(13900);
    expect(suggestedKrw(50)).toBe(900);
    expect(suggestedKrw(0)).toBe(0);
  });

  it('prints won the Korean way and dollars the way they were', () => {
    expect(formatKrw(5900)).toBe('5,900원');
    expect(formatKrw(13900)).toBe('13,900원');
    expect(formatPrice(400)).toBe('$4');
    expect(formatPrice(250)).toBe('$2.50');
  });

  it('lets the row’s own won price win over the suggestion, and leaves the dollar page alone', () => {
    expect(krwPrice(card(400))).toBe(5900);
    expect(krwPrice(card(400, 5000))).toBe(5000);
    expect(formatTemplatePrice(card(400), 'ko')).toBe('5,900원');
    expect(formatTemplatePrice(card(400, 5000), 'ko')).toBe('5,000원');
    expect(formatTemplatePrice(card(400, 5000), 'en')).toBe('$4');
  });

  it('spells the range in the reader’s currency', () => {
    const cards = [card(200, 2500), card(400), card(700), card(0)];
    expect(priceRangeFor(cards, 'ko')).toEqual({ min: '2,500원', max: '9,900원' });
    expect(priceRangeFor(cards, 'en')).toEqual({ min: '$2', max: '$7' });
    expect(priceRangeFor([card(0)], 'ko')).toBeNull();
  });
});
