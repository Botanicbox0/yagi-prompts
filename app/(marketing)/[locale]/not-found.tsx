import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { templatesHref } from '@/lib/prompts/links';
import { campaignsHref } from '@/lib/campaigns/links';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * The branded 404 (UX audit, 2026-09-03). `notFound()` fires for an archived prompt, an
 * unpublished contest and a mistyped legal path, and every one of them rendered Next's unstyled
 * English default with no nav — a dead end on a site whose whole point is the next door.
 *
 * Bilingual and STATIC on purpose. A `not-found.tsx` receives no params, and the marketing tree
 * may not read request headers or cookies (the cache contract in tests/routes pins that), so it cannot
 * know the reader's locale. It says the sentence in both and links each to its own studio; the
 * chrome takes the default locale.
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
            {LOCALES.map((locale) => {
              const copy = getDictionary(locale);
              return (
                <section key={locale} lang={locale} data-not-found={locale}>
                  <h1 className="font-display text-[clamp(2rem,4.5vw,3.5rem)] leading-[0.92] font-black whitespace-pre-line uppercase">
                    {copy.notFound.title}
                  </h1>
                  <p className="mt-6 max-w-detail text-body opacity-70">{copy.notFound.body}</p>
                  <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3">
                    <a
                      href={templatesHref(locale, 'video')}
                      className="inline-block bg-accent px-5 py-3 font-label text-label text-white uppercase"
                    >
                      <TextSwap>{copy.templates.ctaVideo} →</TextSwap>
                    </a>
                    <a
                      href={campaignsHref(locale)}
                      className="inline-block border border-current px-5 py-3 font-label text-label uppercase"
                    >
                      <TextSwap>{copy.nav.campaigns} →</TextSwap>
                    </a>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </main>

      <MarketingFooter locale={DEFAULT_LOCALE} dict={dict} />
    </>
  );
}
