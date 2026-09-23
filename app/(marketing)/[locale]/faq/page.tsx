import type { Metadata } from 'next';
import { Faq } from '@/components/landing/faq';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { FAQ_CATEGORIES, faqItems } from '@/lib/faq/catalog';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { JsonLd } from '@/lib/seo/json-ld';
import { localeAlternates } from '@/lib/seo/playbook-metadata';
import { siteOgImage } from '@/lib/seo/og';
import { siteUrl } from '@/lib/seo/site-url';
import { faqStructuredData } from '@/lib/seo/structured-data';

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
  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/faq" initialTheme="light" />
      <main id="main" data-faq-catalog="all" data-section data-theme="light" className="section">
        <JsonLd id="faq-structured-data" data={faqStructuredData(siteUrl(), `/${locale}/faq`, locale, items)} />
        <header className="band pt-28 lg:pt-36">
          <p className="text-accent font-label text-eyebrow uppercase">{dict.faq.eyebrow}</p>
          <h1 className="mt-6 font-display text-title font-black">{dict.faq.title}</h1>
          <p className="mt-8 max-w-detail text-body opacity-70">{dict.seo.faqDescription}</p>
          <p data-service-definition className="mt-6 max-w-detail text-body opacity-70">{dict.seo.definition}</p>
          <nav className="mt-8 flex flex-wrap gap-x-6 gap-y-3" aria-label={dict.faq.title}>
            {FAQ_CATEGORIES.map((category) => <a key={category} className="underline underline-offset-4" href={`#${category}`}>{dict.seo.faqCategories[category]}</a>)}
          </nav>
        </header>
        {FAQ_CATEGORIES.map((category) => (
          <section key={category} id={category} className="scroll-mt-20" data-faq-category={category}>
            <Faq eyebrow={dict.faq.eyebrow} title={dict.seo.faqCategories[category]} items={items.filter((item) => item.category === category)} />
          </section>
        ))}
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
