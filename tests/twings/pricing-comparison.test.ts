import { describe, expect, it } from 'vitest';
import { SINGLE_VIDEO_PRICE_V1, singleVideoPrice720, comparePurchaseOptions } from '@/lib/twings/pricing-comparison';
import { CURRENT_CREATOR_PLANS } from '@/lib/twings/subscription-versions';
import { quoteSubscriptionVideo } from '@/lib/twings/subscription-plan';

describe('coherent single and monthly pricing', () => {
  it('makes either subscription cheaper at its complete-film capacity across all 720p formats', () => {
    for (let seconds = 4; seconds <= 30; seconds++) {
      for (const aspect of ['9:16', '16:9', '4:3', '3:4', '1:1', '21:9']) {
        const units = quoteSubscriptionVideo({ seconds, resolution: '720p', aspect })!.units;
        for (const plan of CURRENT_CREATOR_PLANS) {
          const singles = Math.floor(plan.monthlyCredits / units) * singleVideoPrice720(seconds)!;
          expect(plan.priceKrw).toBeLessThan(singles);
        }
      }
    }
    expect(CURRENT_CREATOR_PLANS[1].priceKrw / CURRENT_CREATOR_PLANS[1].monthlyCredits)
      .toBeLessThan(CURRENT_CREATOR_PLANS[0].priceKrw / CURRENT_CREATOR_PLANS[0].monthlyCredits);
    expect(Object.isFrozen(SINGLE_VIDEO_PRICE_V1)).toBe(true);
    expect(singleVideoPrice720(31)).toBeNull();
  });
  it.each([[1, 'single', 8900], [3, 'single', 26700], [4, CURRENT_CREATOR_PLANS[0].id, 29000],
    [5, CURRENT_CREATOR_PLANS[0].id, 37900], [6, CURRENT_CREATOR_PLANS[0].id, 46800],
    [7, CURRENT_CREATOR_PLANS[1].id, 49000]])('recommends the cheapest complete choice for %s 15-second films', (count, id, totalKrw) => {
    expect(comparePurchaseOptions([{ count, credits: 150, priceKrw: 8900 }])?.best).toMatchObject({ id, totalKrw });
  });
  it('allocates indivisible mixed films by money saved, not a greedy credit ratio', () => {
    const result = comparePurchaseOptions([{ count: 2, credits: 300, priceKrw: 18900 }, { count: 1, credits: 150, priceKrw: 8900 }])!;
    expect(result.best).toMatchObject({ id: CURRENT_CREATOR_PLANS[0].id, totalKrw: 37900, extraFilms: 1 });
    expect(result.singleKrw).toBe(46700);
  });
  it('does not invent prices for unpriced or unsupported comparisons', () => {
    expect(comparePurchaseOptions([{ count: 1, credits: 247, priceKrw: null }])).toBeNull();
    expect(comparePurchaseOptions([{ count: 0, credits: 247, priceKrw: null }])?.best.totalKrw).toBe(0);
    expect(() => comparePurchaseOptions([{ count: 1.5, credits: 100, priceKrw: 5900 }])).toThrow();
  });
});
