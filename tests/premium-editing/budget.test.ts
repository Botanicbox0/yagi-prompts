import { describe, expect, it } from 'vitest';
import { configuredPremiumEditLimit } from '@/lib/premium-editing/budget';

describe('explicit Premium edit request budget', () => {
  it('has no implicit allowance and accepts only bounded operator-approved integer limits', () => {
    for (const value of [undefined, '', '0', '-1', '1.5', '1001', 'Infinity', '30x']) {
      expect(configuredPremiumEditLimit({ PREMIUM_EDIT_REQUESTS_PER_PERIOD: value })).toBeNull();
    }
    expect(configuredPremiumEditLimit({ PREMIUM_EDIT_REQUESTS_PER_PERIOD: '30' })).toBe(30);
    expect(configuredPremiumEditLimit({ PREMIUM_EDIT_REQUESTS_PER_PERIOD: '1000' })).toBe(1000);
  });
});
