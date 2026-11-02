import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { NotFoundPanel } from '@/components/marketing/not-found-panel';

/**
 * The branded 404 (UX audit, 2026-09-03). `notFound()` fires for an archived prompt, an
 * unpublished contest and a mistyped legal path, and every one of them rendered Next's unstyled
 * English default with no nav — a dead end on a site whose whole point is the next door.
 *
 * Bilingual and STATIC on purpose. A `not-found.tsx` receives no params, and the marketing tree
 * may not read request headers or cookies (the cache contract in tests/routes pins that), so it cannot
 * know the reader's locale. It says the sentence in both and links each to its own studio; the
 * chrome takes the default locale. The session-gated `(app)` group has its own single-locale 404
 * built from the same panel.
 */
export default function NotFound() {
  const dict = getDictionary(DEFAULT_LOCALE);

  return (
    <>
      <MarketingNav locale={DEFAULT_LOCALE} dict={dict} rest="/" initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section">
        <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
          <p className="text-accent font-label text-eyebrow uppercase">404</p>
          <div className="mt-8 grid gap-14 lg:grid-cols-2">
            {LOCALES.map((locale) => (
              <NotFoundPanel key={locale} locale={locale} />
            ))}
          </div>
        </div>
      </main>

      <MarketingFooter locale={DEFAULT_LOCALE} dict={dict} />
    </>
  );
}
