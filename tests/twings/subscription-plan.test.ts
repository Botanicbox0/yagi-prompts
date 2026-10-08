import { describe, expect, it } from 'vitest';
import { CREATOR_PLANS, quoteSubscriptionVideo, subscriptionEconomics, templateSubscriptionQuote } from '@/lib/twings/subscription-plan';

describe('minimum-cost creator subscription design', () => {
  it('uses the largest creator allowance that keeps a 10% revenue margin, without reserves or overhead', () => {
    const economics = subscriptionEconomics();
    expect(CREATOR_PLANS.creator.priceKrw).toBe(24900);
    expect(CREATOR_PLANS.creator.monthlyUnits).toBe(604);
    expect(economics.generationBudgetKrw).toBeCloseTo(19543.5072, 3);
    expect(economics.marginRate).toBeGreaterThanOrEqual(0.10);
    expect(economics.marginRate).toBeLessThan(0.101);
    const oneMoreUnit = 2.3112 * 1400 / 100;
    expect((economics.marginKrw - oneMoreUnit) / economics.revenueExVatKrw).toBeLessThan(0.10);
    // The fee is a provisional contract assumption, not a confirmed Toss rate.
    expect(subscriptionEconomics({ pgFeeRate: 0.04 }).marginRate).toBeLessThan(0.10);
  });

  it('offers twelve short or four long Premium films at about 10% margin and keeps editing unavailable', () => {
    const economics = subscriptionEconomics({ planId: 'premium' });
    expect(CREATOR_PLANS.premium.priceKrw).toBe(49000);
    expect(CREATOR_PLANS.premium.monthlyUnits).toBe(1200);
    expect(economics.generationBudgetKrw).toBeCloseTo(38828.16, 3);
    expect(economics.marginRate).toBeCloseTo(0.09204743, 6);
    expect(economics.marginRate).toBeGreaterThanOrEqual(0.08);
    expect(CREATOR_PLANS.premium.promptEditing).toBe('planned');
    for (const plan of Object.values(CREATOR_PLANS)) expect(plan.status).toBe('preparing');
    expect(quoteSubscriptionVideo({ seconds: 10, resolution: '720p', aspect: '9:16' }, 'premium')?.maxPerMonth).toBe(12);
    expect(quoteSubscriptionVideo({ seconds: 15, resolution: '720p', aspect: '9:16' }, 'premium')?.maxPerMonth).toBe(8);
    expect(quoteSubscriptionVideo({ seconds: 30, resolution: '720p', aspect: '9:16' }, 'premium')?.maxPerMonth).toBe(4);
  });

  it('fits two 30-second creator films and refuses a third against the same allowance', () => {
    const quote = quoteSubscriptionVideo({ seconds: 30, resolution: '720p', aspect: '9:16' })!;
    expect(quote.maxPerMonth).toBe(2);
    expect(quote.monthlyPercent * 2).toBeLessThanOrEqual(100);
    expect(quote.monthlyPercent * 3).toBeGreaterThan(100);
  });

  it('prices seconds from exact tokens, without per-second rounding or a discount', () => {
    const quote = quoteSubscriptionVideo({ seconds: 10, resolution: '720p', aspect: '16:9' })!;
    expect(quote.providerTokens).toBe(216000);
    expect(quote.providerUsd).toBeCloseTo(2.3112, 6);
    expect(quote.units).toBe(100);
    expect(quote.maxPerMonth).toBe(6);
    expect(quoteSubscriptionVideo({ seconds: 15, resolution: '720p', aspect: '9:16' })?.units).toBe(150);
    expect(quoteSubscriptionVideo({ seconds: 15, resolution: '720p', aspect: '9:16' })?.maxPerMonth).toBe(4);
    expect(quoteSubscriptionVideo({ seconds: 30, resolution: '720p', aspect: '16:9' })?.units).toBe(300);
  });

  it('accounts for the new 25-second 4:3 template and 1080p independently', () => {
    const quote = quoteSubscriptionVideo({ seconds: 25, resolution: '720p', aspect: '4:3' })!;
    expect(quote.providerTokens).toBe(543403.125);
    expect(quote.units).toBe(252); // 1112 × 834, not a guessed 16:9 frame
    expect(quote.maxPerMonth).toBe(2);
    const hd = quoteSubscriptionVideo({ seconds: 10, resolution: '1080p', aspect: '9:16' })!;
    expect(hd.providerUsd).toBeCloseTo(5.6862, 6);
    expect(hd.units).toBe(247);
    expect(hd.maxPerMonth).toBe(2);
  });

  it('refuses unknown dimensions, unknown engines, image costs, and unsupported durations', () => {
    for (const seconds of [NaN, Infinity, 0, 3, 31, 10.5]) {
      expect(quoteSubscriptionVideo({ seconds, resolution: '720p', aspect: '16:9' })).toBeNull();
    }
    for (const aspect of ['adaptive', '__proto__', 'constructor', '4:5']) {
      expect(quoteSubscriptionVideo({ seconds: 10, resolution: '720p', aspect })).toBeNull();
    }
    const template = { medium: 'video' as const, engine: 'seedance-2.5', runtimeSeconds: 15, aspectDefault: '9:16' };
    expect(templateSubscriptionQuote(template)?.maxPerMonth).toBe(4);
    expect(templateSubscriptionQuote({ ...template, medium: 'image' })).toBeNull();
    expect(templateSubscriptionQuote({ ...template, engine: 'unknown' })).toBeNull();
    expect(templateSubscriptionQuote({ ...template, engine: null, runtimeSeconds: 10 })).toBeNull();
    // Existing render routing moves a long Seedance 2.0 template onto 2.5.
    expect(templateSubscriptionQuote({ ...template, engine: 'seedance-2.0', runtimeSeconds: 25 })?.maxPerMonth).toBe(2);
  });
});
