import type { Metadata } from 'next';
import { SubscriptionFaq } from '@/components/twings/subscription-faq';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { FAQ_CATEGORIES, faqItems } from '@/lib/faq/catalog';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { cachedSubscriptionAvailability } from '@/lib/creator-subscriptions/cached-availability';
import { localeAlternates } from '@/lib/seo/playbook-metadata';
import { siteOgImage } from '@/lib/seo/og';
import { siteUrl } from '@/lib/seo/site-url';

export const revalidate = 3600;
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return {
    title: dict.faq.title,
    description: dict.seo.faqDescription,
    alternates: { canonical: `/${locale}/faq`, languages: localeAlternates('/faq') },
    openGraph: {
      type: 'website', title: dict.faq.title, description: dict.seo.faqDescription,
      url: `/${locale}/faq`, locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      siteName: dict.meta.siteName, images: [siteOgImage(locale)],
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function FaqPage({ params }: Props) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const items = faqItems(dict);
  const availability = await cachedSubscriptionAvailability();
  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/faq" initialTheme="light" />
      <main id="main" data-faq-catalog="all" data-section data-theme="light" className="section">
        <header className="band pt-28 lg:pt-36">
          <p className="text-accent font-label text-eyebrow uppercase">{dict.faq.eyebrow}</p>
          <h1 className="mt-6 font-display text-title font-black">{dict.faq.title}</h1>
          <p className="mt-8 max-w-detail text-body opacity-70">{dict.seo.faqDescription}</p>
          <p data-service-definition className="mt-6 max-w-detail text-body opacity-70">{dict.seo.definition}</p>
          <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-3" aria-label={dict.faq.title}>
            {FAQ_CATEGORIES.map((category) => <a key={category} className="underline underline-offset-4" href={`#${category}`}>{dict.seo.faqCategories[category]}</a>)}
          </nav>
        </header>
        <SubscriptionFaq items={items} copy={{ subscriptionOpen: dict.faq.subscriptionOpen, subscriptionCreatorOpen: dict.faq.subscriptionCreatorOpen, subscriptionPaused: dict.faq.subscriptionPaused }} initialAvailability={availability} origin={siteUrl()} path={`/${locale}/faq`} locale={locale} eyebrow={dict.faq.eyebrow} title={dict.faq.title} categories={FAQ_CATEGORIES.map(id => ({ id, title: dict.seo.faqCategories[id] }))} />
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
