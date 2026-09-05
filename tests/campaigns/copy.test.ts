import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { payoutHeadline, payoutSentence } from '@/lib/campaigns/copy';
import { PayoutRuleSchema } from '@/lib/campaigns/schemas';
import { campaignLabels } from '@/components/campaigns/labels';

/** The one sentence a creator quotes back — the same words on the detail, their page and the admin. */
describe('the payout sentence', () => {
  const ko = campaignLabels(getDictionary('ko')).payout;
  const en = campaignLabels(getDictionary('en')).payout;

  it('spells a flat fee with its hold', () => {
    const rule = PayoutRuleSchema.parse({ model: 'flat', flatCents: 30_000 });
    expect(payoutSentence(rule, 'ko', ko)).toBe('고정 30,000원 · 검수 후 7일 뒤 지급');
    expect(payoutSentence(rule, 'en', en)).toBe('Flat ₩30,000 · paid 7 days after review');
    expect(payoutHeadline(rule, 'ko', ko)).toBe('30,000원');
  });

  it('spells a hybrid rule with its cap, and a view-based rule with its floor', () => {
    const hybrid = PayoutRuleSchema.parse({ model: 'hybrid', flatCents: 20_000, perThousandViewsCents: 300, maxCents: 80_000 });
    expect(payoutSentence(hybrid, 'ko', ko)).toBe('기본 20,000원 + 1,000회당 300원 · 최대 80,000원 · 검수 후 7일 뒤 지급');
    const perView = PayoutRuleSchema.parse({ model: 'per_view', perThousandViewsCents: 500, minCents: 10_000, holdDays: 0 });
    expect(payoutSentence(perView, 'en', en)).toBe('₩500 per 1,000 views · at least ₩10,000 · paid right after review');
    expect(payoutHeadline(perView, 'ko', ko)).toBe('1,000회당 500원');
  });
});
