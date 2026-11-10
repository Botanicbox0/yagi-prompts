import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { templatesListingMetadata } from '@/lib/seo/template-metadata';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PersonalIdentity } from '@/components/audience/personal-identity';
import { TemplatesListing } from '@/components/templates/listing';
import { CastShelfSection } from '@/components/templates/cast-shelf';
import { CAST_SECTIONS, castShelf, soloCatalog } from '@/lib/prompts/catalog';
import { FaqSection } from '@/lib/seo/faq-section';

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

  return (
    <PersonalIdentity>
      <MarketingNav locale={locale} dict={dict} rest="/image" initialTheme="light" />
      <main id="main" data-templates="image" data-section data-theme="light" className="section">
        <TemplatesListing
          locale={locale}
          dict={dict}
          medium="image"
          cards={soloCatalog(catalog).image}
          after={CAST_SECTIONS.map((cast) => <CastShelfSection key={cast} locale={locale} dict={dict} cast={cast} shelf={castShelf(catalog, cast)} mode="listing" medium="image" />)}
        />
      </main>
      <FaqSection dict={dict} locale={locale} placement="template" path={`/${locale}/image`} />
      <MarketingFooter locale={locale} dict={dict} />
    </PersonalIdentity>
  );
}
