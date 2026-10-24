import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { templatesListingMetadata } from '@/lib/seo/template-metadata';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { TemplatesListing } from '@/components/templates/listing';
import { FaqSection } from '@/lib/seo/faq-section';
import { FirstRunSheet } from '@/components/onboarding/first-run-sheet';

/**
 * `/[locale]/video` — the VIDEO tab (docs/TEMPLATES-IA.md §2). Static + tag `prompts` + the 1h TTL
 * floor, like the landing: the card projection carries no gated bytes, so one cached document is
 * right for everyone. No `searchParams`, no session read anywhere in this tree.
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
    medium: 'video',
    title: dict.meta.videoTitle,
    ogTitle: `${dict.meta.videoTitle} — ${dict.meta.siteName}`,
    description: dict.meta.videoDescription,
    siteName: dict.meta.siteName,
  });
}

export default async function VideoTemplatesPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const catalog = await getPromptCatalog();

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/video" initialTheme="light" />
      <main id="main" data-templates="video" data-section data-theme="light" className="section">
        <TemplatesListing locale={locale} dict={dict} medium="video" cards={catalog.video} />
      </main>
      <FaqSection dict={dict} locale={locale} placement="template" path={`/${locale}/video`} />
      <MarketingFooter locale={locale} dict={dict} />
      {/* docs/PLATFORM-2.0.md §3.2-1 — once, for a new account; the server markup is empty. */}
      <FirstRunSheet copy={dict.firstRun} locale={locale} />
    </>
  );
}
