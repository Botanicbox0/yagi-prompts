import type { PublicSubscriptionAvailability } from '@/lib/creator-subscriptions/availability';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { FaqItem } from './catalog';

export type SubscriptionFaqCopy = Pick<Dictionary['faq'], 'subscriptionOpen' | 'subscriptionCreatorOpen' | 'subscriptionPaused'>;
const ANSWERS = { browsing: 'a1', pricing: 'a2', 'subscription-availability': 'a17', 'subscription-video-count': 'a18', 'premium-customization': 'a19', 'subscription-rollover': 'a20', 'subscription-extra-video': 'a21' } as const;
export function subscriptionFaqItems(items: FaqItem[], copy: SubscriptionFaqCopy, availability: PublicSubscriptionAvailability): FaqItem[] {
  const changes: Partial<Record<(typeof ANSWERS)[keyof typeof ANSWERS], string>> = availability.status === 'paused' ? copy.subscriptionPaused :
    availability.plans.creator.status === 'open' ? availability.plans.premium.status === 'open' ? copy.subscriptionOpen : copy.subscriptionCreatorOpen : {};
  return items.map(item => {
    const key = ANSWERS[item.id as keyof typeof ANSWERS];
    return key && changes[key] ? { ...item, a: changes[key]! } : item;
  });
}
