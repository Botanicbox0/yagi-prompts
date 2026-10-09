import { Faq } from '@/components/landing/faq';
import { faqItems, type FaqPlacement } from '@/lib/faq/catalog';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { JsonLd } from './json-ld';
import { faqStructuredData } from './structured-data';
import { siteUrl } from './site-url';
import { SubscriptionFaq } from '@/components/twings/subscription-faq';
import type { PublicSubscriptionAvailability } from '@/lib/creator-subscriptions/availability';

export function FaqSection({ dict, locale, placement, path, theme = 'light', availability }: {
  dict: Dictionary;
  locale: Locale;
  placement: FaqPlacement;
  path: string;
  theme?: 'light' | 'dark';
  availability?: PublicSubscriptionAvailability;
}) {
  const items = faqItems(dict, placement);
  return (
    <section data-section data-theme={theme} data-faq-catalog={placement} className="section">
      {['pricing', 'landing', 'template'].includes(placement) ? <SubscriptionFaq items={items} copy={{ subscriptionOpen: dict.faq.subscriptionOpen, subscriptionCreatorOpen: dict.faq.subscriptionCreatorOpen, subscriptionPaused: dict.faq.subscriptionPaused }} initialAvailability={availability} eyebrow={dict.faq.eyebrow} title={dict.faq.title} origin={siteUrl()} path={path} locale={locale} /> : <>
        <JsonLd id="faq-structured-data" data={faqStructuredData(siteUrl(), path, locale, items)} />
        <Faq eyebrow={dict.faq.eyebrow} title={dict.faq.title} items={items} />
      </>}
      <div className="band pb-16">
        <a className="text-accent font-label text-label underline underline-offset-4" href={`/${locale}/faq`}>{dict.seo.allFaq} →</a>
      </div>
    </section>
  );
}
