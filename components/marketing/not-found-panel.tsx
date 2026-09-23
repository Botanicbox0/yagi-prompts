import type { Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { templatesHref } from '@/lib/prompts/links';
import { campaignsHref } from '@/lib/campaigns/links';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * One locale's 404 sentence and its two doors. The marketing 404 renders it once per locale (it
 * cannot know the reader's language); the session-gated `(app)` 404 knows it and renders one.
 */
export function NotFoundPanel({ locale }: { locale: Locale }) {
  const copy = getDictionary(locale);
  return (
    <section lang={locale} data-not-found={locale}>
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
}
