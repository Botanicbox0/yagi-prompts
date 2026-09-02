import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { SITE_OG_IMAGE, SITE_TWITTER_CARD } from '@/lib/seo/og';
import { formatPrice, joinStyles } from '@/lib/twings/products';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { TwingsStudio, type StudioStyle } from '@/components/twings/studio';

/**
 * `/[locale]/studio` — TWINGS' front door (founder direction, 2026-08-16).
 *
 * The catalogue answered "what can be made"; this answers "make mine". It is the page the founder
 * asked to make obvious: one photo in, a finished film out, at a price on the button.
 *
 * Static, like every other marketing surface: the styles come from the tagged prompt catalog, the
 * demo itself is entirely client-side, and nothing here reads a session. When real rendering lands
 * this page keeps its shape and grows a job id.
 */
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
  // Self-canonical, like pricing: without this the layout's `/${locale}` canonical hands the
  // front door to the landing, and a shared link renders as a bare text row (no og:image).
  return {
    title: dict.studio.metaTitle,
    description: dict.studio.metaDescription,
    alternates: {
      canonical: `/${locale}/studio`,
      languages: { en: '/en/studio', ko: '/ko/studio', 'x-default': '/en/studio' },
    },
    openGraph: {
      type: 'website',
      locale: locale === 'ko' ? 'ko_KR' : 'en_US',
      url: `/${locale}/studio`,
      title: `${dict.studio.metaTitle} — ${dict.meta.siteName}`,
      description: dict.studio.metaDescription,
      siteName: dict.meta.siteName,
      images: [SITE_OG_IMAGE],
    },
    twitter: { card: SITE_TWITTER_CARD },
  };
}

export default async function StudioPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const catalog = await getPromptCatalog();
  /** Keyed by style id; each dictionary carries its own locale's line, so no localize() here. */
  const blurbs = dict.studio.blurbs as Record<string, string | undefined>;

  const styles: StudioStyle[] = joinStyles([...catalog.yagi, ...catalog.community]).map((style) => ({
    id: style.id,
    title: locale === 'ko' && style.card.titleKo ? style.card.titleKo : style.card.title,
    price: formatPrice(style.priceCents),
    runtime: String(style.runtimeSeconds),
    blurb: blurbs[style.id] ?? '',
    posterSrc: style.card.poster?.src ?? null,
    videoSrc: style.card.video?.src ?? null,
  }));

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/studio" initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section">
        <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
          <p className="text-accent font-label text-eyebrow uppercase">{dict.studio.eyebrow}</p>
          <h1 className="mt-6 font-display text-title font-black whitespace-pre-line uppercase">
            {dict.studio.headline}
          </h1>
          <p className="mt-8 max-w-detail text-body opacity-70">{dict.studio.intro}</p>

          <TwingsStudio
            styles={styles}
            labels={{
              stepPhoto: dict.studio.stepPhoto,
              stepStyle: dict.studio.stepStyle,
              stepPay: dict.studio.stepPay,
              stepResult: dict.studio.stepResult,
              dropZone: dict.studio.dropZone,
              dropHint: dict.studio.dropHint,
              changePhoto: dict.studio.changePhoto,
              chooseStyle: dict.studio.chooseStyle,
              payCta: dict.studio.payCta,
              payNote: dict.studio.payNote,
              demoBadge: dict.studio.demoBadge,
              rendering: dict.studio.rendering,
              renderingNote: dict.studio.renderingNote,
              resultHeading: dict.studio.resultHeading,
              resultNote: dict.studio.resultNote,
              again: dict.studio.again,
              runtimeLabel: dict.studio.runtimeLabel,
            }}
          />
        </div>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
