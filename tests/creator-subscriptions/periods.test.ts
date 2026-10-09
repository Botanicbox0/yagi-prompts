import { describe, expect, it } from 'vitest';
import { billingBoundary, SUBSCRIPTION_PLANS } from '@/lib/creator-subscriptions/plans';

describe('immutable subscription billing terms', () => {
  it('keeps approved prices and allowances independent of cost quote changes', () => {
    expect(SUBSCRIPTION_PLANS.creator).toMatchObject({ amountKrw: 24900, monthlyUnits: 604 });
    expect(SUBSCRIPTION_PLANS.premium).toMatchObject({ amountKrw: 49000, monthlyUnits: 1200 });
  });
  it('clamps February while preserving the original January 31 anchor in Korea', () => {
    const anchor = new Date('2028-01-31T00:30:00+09:00');
    expect(billingBoundary(anchor, 1).toISOString()).toBe('2028-02-28T15:30:00.000Z');
    expect(billingBoundary(anchor, 2).toISOString()).toBe('2028-03-30T15:30:00.000Z');
  });
});
