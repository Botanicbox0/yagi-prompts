import { getRequestLocale } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { NotFoundPanel } from '@/components/marketing/not-found-panel';

/**
 * The `(app)` group's 404 (audit P1-3). `notFound()` fires on an expired or mistyped share link
 * (`/r/…`, the viral entry point), someone else's render, a foreign Toss order and a closed
 * campaign's apply page — all of which used to fall through to Next's unstyled English default.
 *
 * Unlike the marketing 404 this tree is dynamic, so it can know the reader's language:
 * `getRequestLocale` reads the middleware header where middleware ran, and the locale cookie or
 * Accept-Language on `/r/…`, which skips middleware.
 */
export default async function AppNotFound() {
  const locale = await getRequestLocale();
  const dict = getDictionary(locale);

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/" initialTheme="light" />

      <main id="main" data-app-not-found={locale} data-section data-theme="light" className="section">
        <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
          <p className="text-accent font-label text-eyebrow uppercase">404</p>
          <div className="mt-8">
            <NotFoundPanel locale={locale} />
          </div>
        </div>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
