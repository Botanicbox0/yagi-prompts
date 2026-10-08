import { describe, expect, it } from 'vitest';
import { CREATOR_PLAN_VERSIONS, CURRENT_CREATOR_PLANS, getCreatorPlanVersion } from '@/lib/twings/subscription-versions';
import { quoteSubscriptionVideo, subscriptionEconomics } from '@/lib/twings/subscription-plan';

describe('immutable creator price versions', () => {
  it('archives the unsold 19,000 won design and proposes two VAT-inclusive plans', () => {
    expect(getCreatorPlanVersion('creator-2026-10-07-v1')).toMatchObject({ priceKrw: 19000, monthlyCredits: 400 });
    expect(CURRENT_CREATOR_PLANS.map(p => [p.priceKrw, p.monthlyCredits])).toEqual([[29000, 620], [49000, 1060]]);
    expect(getCreatorPlanVersion('not-a-version')).toBeNull();
    expect(Object.isFrozen(CREATOR_PLAN_VERSIONS)).toBe(true);
    for (const plan of CURRENT_CREATOR_PLANS) {
      expect(Object.isFrozen(plan)).toBe(true);
      expect(plan.currency).toBe('KRW');
      expect(plan.interval).toBe('month');
    }
  });

  it.each([0.033, 0.0363, 0.04])('targets 8–10%% full-use margin at fee %s', pgFeeRate => {
    for (const plan of CURRENT_CREATOR_PLANS) {
      const e = subscriptionEconomics({ planVersionId: plan.id, pgFeeRate });
      expect(e.marginRate).toBeGreaterThanOrEqual(.08);
      expect(e.marginRate).toBeLessThanOrEqual(.10);
    }
  });

  it('pins consumption to the requested historical version, not the current price', () => {
    const input = { seconds: 10, resolution: '720p' as const, aspect: '9:16' };
    expect(quoteSubscriptionVideo(input, 'creator-2026-10-07-v1')?.maxPerMonth).toBe(4);
    expect(quoteSubscriptionVideo(input, CURRENT_CREATOR_PLANS[0].id)?.maxPerMonth).toBe(6);
    expect(quoteSubscriptionVideo(input, CURRENT_CREATOR_PLANS[1].id)?.maxPerMonth).toBe(10);
    expect(quoteSubscriptionVideo(input, 'missing')).toBeNull();
    expect(() => subscriptionEconomics({ planVersionId: 'missing' })).toThrow();
  });
});
