import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { templatesListingMetadata } from '@/lib/seo/template-metadata';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import { TemplatesListing } from '@/components/templates/listing';

/**
 * `/[locale]/image` — the IMAGE tab (docs/TEMPLATES-IA.md §2). Same page as `/video` with the
 * other medium; its designed empty state is the honest one until image templates are published.
 */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

interface RouteParams {
  params: Promise<{ locale: string }>;
}

function localeOf(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  return templatesListingMetadata({
    locale,
    medium: 'image',
    title: dict.meta.imageTitle,
    ogTitle: `${dict.meta.imageTitle} — ${dict.meta.siteName}`,
    description: dict.meta.imageDescription,
    siteName: dict.meta.siteName,
  });
}

export default async function ImageTemplatesPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const catalog = await getPromptCatalog();
  const ads = adLabels(dict);

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/image" initialTheme="light" />
      <main id="main" data-templates="image" data-section data-theme="light" className="section">
        <div id="templates-rail-anchor" className="relative">
          <AdRail anchorId="templates-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>
          <TemplatesListing locale={locale} dict={dict} medium="image" cards={catalog.image} />
          <div className="band pb-24 rail:hidden">
            <AdBanner labels={ads} />
          </div>
        </div>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
