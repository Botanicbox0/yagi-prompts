import { describe, expect, it } from 'vitest';
import { quoteSubscriptionVideo, subscriptionEconomics, templateSubscriptionQuote } from '@/lib/twings/subscription-plan';
import { getCreatorPlanVersion } from '@/lib/twings/subscription-versions';

describe('19,000 won creator subscription design', () => {
  it('keeps a revenue margin of 8–10% after VAT and direct costs at full use', () => {
    const legacyId = 'creator-2026-10-07-v1';
    const economics = subscriptionEconomics({ planVersionId: legacyId });
    expect(getCreatorPlanVersion(legacyId)?.priceKrw).toBe(19000);
    expect(getCreatorPlanVersion(legacyId)?.monthlyCredits).toBe(400);
    expect(economics.generationBudgetKrw).toBeCloseTo(14236.992, 3);
    expect(economics.marginRate).toBeGreaterThanOrEqual(0.08);
    expect(economics.marginRate).toBeLessThanOrEqual(0.10);
    expect(economics.marginRate).toBeCloseTo(0.081558, 5);
    // The fee is a provisional contract assumption, not a confirmed Toss rate.
    expect(subscriptionEconomics({ planVersionId: legacyId, pgFeeRate: 0.04 }).marginRate).toBeLessThan(0.08);
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
