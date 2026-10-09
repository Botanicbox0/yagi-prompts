'use client';
import { Faq } from '@/components/landing/faq';
import { useSubscriptionAvailability } from './subscription-availability';
import { subscriptionFaqItems, type SubscriptionFaqCopy } from '@/lib/faq/subscription';
import type { FaqItem, FaqCategory } from '@/lib/faq/catalog';
import type { PublicSubscriptionAvailability } from '@/lib/creator-subscriptions/availability';
import { JsonLd } from '@/lib/seo/json-ld';
import { faqStructuredData } from '@/lib/seo/structured-data';
import type { Locale } from '@/lib/i18n/config';

/** Visible answers and JSON-LD always change together, including a paused or Creator-only launch. */
export function SubscriptionFaq({ items, copy, initialAvailability, eyebrow, title, origin, path, locale, categories }: {
  items: FaqItem[]; copy: SubscriptionFaqCopy; initialAvailability?: PublicSubscriptionAvailability;
  eyebrow: string; title: string; origin: string; path: string; locale: Locale;
  categories?: { id: FaqCategory; title: string }[];
}) {
  const availability = useSubscriptionAvailability(initialAvailability);
  const current = subscriptionFaqItems(items, copy, availability);
  return <>
    <JsonLd id="faq-structured-data" data={faqStructuredData(origin, path, locale, current)} />
    {categories ? categories.map(category => <section key={category.id} id={category.id} className="scroll-mt-20" data-faq-category={category.id}><Faq eyebrow={eyebrow} title={category.title} items={current.filter(item => item.category === category.id)} /></section>) : <Faq eyebrow={eyebrow} title={title} items={current} />}
  </>;
}
