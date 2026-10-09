import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { faqItems } from '@/lib/faq/catalog';
import { subscriptionFaqItems } from '@/lib/faq/subscription';
import { faqStructuredData } from '@/lib/seo/structured-data';
import { PREPARING_SUBSCRIPTION_AVAILABILITY } from '@/lib/creator-subscriptions/availability';

describe('subscription public answers', () => {
  it('uses the same real availability in visible answers and JSON-LD, including Creator-only opening', () => {
    for (const locale of ['ko', 'en'] as const) {
      const dict = getDictionary(locale); const original = faqItems(dict);
      expect(subscriptionFaqItems(original, dict.faq, PREPARING_SUBSCRIPTION_AVAILABILITY)).toEqual(original);
      for (const premium of ['preparing', 'open'] as const) {
        const availability = { ...PREPARING_SUBSCRIPTION_AVAILABILITY, status: 'open' as const, plans: { creator: { status: 'open' as const }, premium: { status: premium } }, editing: premium };
        const copy = premium === 'open' ? dict.faq.subscriptionOpen : dict.faq.subscriptionCreatorOpen;
        const current = subscriptionFaqItems(original, dict.faq, availability);
        expect(current.find(item => item.id === 'pricing')?.a).toBe(copy.a2);
        const structured = faqStructuredData('https://twings.app', `/${locale}/faq`, locale, current);
        expect(structured.mainEntity).toEqual(current.map(item => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })));
        expect(current.find(item => item.id === 'ai-campaign-safety')).toEqual(original.find(item => item.id === 'ai-campaign-safety'));
      }
    }
  });
});
