import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { LocaleToggle } from '@/components/locale-toggle';

/**
 * Landing — M0 skeleton only. The §5 scroll story (hero, pinned panels, circle wipe, marquee,
 * featured cards, FAQ) lands in M1.
 *
 * Cache mode per §3.1/§4: STATIC + tag `catalog` + a 1h TTL floor. No `headers()`, no `cookies()`,
 * no dynamic APIs may appear on this page or the mode silently degrades to dynamic.
 */
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
    title: dict.meta.siteName,
    description: dict.meta.tagline,
    alternates: { canonical: `/${locale}`, languages: { en: '/en', ko: '/ko', 'x-default': '/en' } },
  };
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const dict = getDictionary(locale);

  return (
    <main className="min-h-screen bg-white text-black">
      <header className="flex h-16 items-center justify-between border-b border-line-light px-gutter">
        <span className="font-display text-label font-black uppercase">{dict.meta.siteName}</span>
        <div className="flex items-center gap-6 font-label text-eyebrow uppercase">
          <a href="/library">{dict.nav.library}</a>
          <a href={`/${locale}/pricing`}>{dict.nav.pricing}</a>
          <LocaleToggle current={locale} rest="/" />
        </div>
      </header>

      <section className="px-gutter py-24">
        <p className="font-label text-eyebrow uppercase text-blue">M0 · foundation</p>
        <h1 className="font-display text-display uppercase">{dict.meta.siteName}</h1>
        <p className="mt-6 max-w-detail text-body">{dict.meta.tagline}</p>
        <p className="mt-10">
          <a className="font-label text-label uppercase text-blue" href="/library">
            {dict.auth.startWithGoogle} →
          </a>
        </p>
      </section>

      <footer className="border-t border-line-light px-gutter py-12 text-body">
        <a className="text-blue" href="mailto:hello@yagiworkshop.xyz">
          {dict.footer.hireCta} →
        </a>
      </footer>
    </main>
  );
}
