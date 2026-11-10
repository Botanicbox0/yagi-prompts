import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { castListingMetadata } from '@/lib/seo/template-metadata';
import { CastPage } from '@/components/templates/cast-page';

/**
 * `/[locale]/pet` — docs/CAST-CATEGORIES.md §5: the pet templates, 영상 and 이미지. 404 while none is
 * published (no empty page in production).
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
  return castListingMetadata({
    locale,
    cast: 'pet',
    title: dict.cast.pet.metaTitle,
    ogTitle: `${dict.cast.pet.metaTitle} — ${dict.meta.siteName}`,
    description: dict.cast.pet.metaDescription,
    siteName: dict.meta.siteName,
  });
}

export default async function PetTemplatesPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  return <CastPage locale={localeOf(raw)} cast="pet" />;
}
