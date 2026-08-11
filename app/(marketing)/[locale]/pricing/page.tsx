import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleToggle } from '@/components/locale-toggle';

/** Pricing — M0 skeleton. Free vs Pro table + catalog counts land in M1. Static, like landing. */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  return {
    title: dict.nav.pricing,
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: { en: '/en/pricing', ko: '/ko/pricing', 'x-default': '/en/pricing' },
    },
  };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);

  return (
    <main className="min-h-screen bg-white px-gutter py-24 text-black">
      <div className="mb-10 flex items-center justify-between">
        <p className="font-label text-eyebrow uppercase text-blue">{dict.nav.pricing}</p>
        <LocaleToggle current={locale} rest="/pricing" />
      </div>
      <h1 className="font-display text-title uppercase">
        {dict.plan.free} / {dict.plan.pro}
      </h1>
      <p className="mt-6 max-w-detail text-body">{dict.plan.upgrade}</p>
    </main>
  );
}
