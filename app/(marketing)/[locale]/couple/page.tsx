import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { castListingMetadata, unresolvedTemplateMetadata } from '@/lib/seo/template-metadata';
import { CastPage } from '@/components/templates/cast-page';
import { coupleTemplatesOpen } from '@/lib/flags';

/**
 * `/[locale]/couple` — docs/CAST-CATEGORIES.md §5. Off (404, unindexed) unless TWINGS_COUPLE_TEMPLATES=on (§4).
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
  if (!coupleTemplatesOpen()) return unresolvedTemplateMetadata(dict.meta.siteName);
  return castListingMetadata({
    locale,
    cast: 'couple',
    title: dict.cast.couple.metaTitle,
    ogTitle: `${dict.cast.couple.metaTitle} — ${dict.meta.siteName}`,
    description: dict.cast.couple.metaDescription,
    siteName: dict.meta.siteName,
  });
}

export default async function CoupleTemplatesPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  return <CastPage locale={localeOf(raw)} cast="couple" />;
}
