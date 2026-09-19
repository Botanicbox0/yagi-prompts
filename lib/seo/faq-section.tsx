import { Faq } from '@/components/landing/faq';
import { faqItems, type FaqPlacement } from '@/lib/faq/catalog';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { JsonLd } from './json-ld';
import { faqStructuredData } from './structured-data';
import { siteUrl } from './site-url';

export function FaqSection({ dict, locale, placement, path, theme = 'light' }: {
  dict: Dictionary;
  locale: Locale;
  placement: FaqPlacement;
  path: string;
  theme?: 'light' | 'dark';
}) {
  const items = faqItems(dict, placement);
  return (
    <section data-section data-theme={theme} data-faq-catalog={placement} className="section">
      <JsonLd id="faq-structured-data" data={faqStructuredData(siteUrl(), path, locale, items)} />
      <Faq eyebrow={dict.faq.eyebrow} title={dict.faq.title} items={items} />
      <div className="band pb-16">
        <a className="text-accent font-label text-label underline underline-offset-4" href={`/${locale}/faq`}>{dict.seo.allFaq} →</a>
      </div>
    </section>
  );
}
