import { originPath, sanitizeSlug } from '@/lib/billing/links';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { TextSwap } from '@/components/ui/text-swap';

/**
 * `/billing/cancelled` — §3.4: "returns the visitor unchanged".
 *
 * Unchanged is the whole content of this page. Nothing is reconciled (there is nothing to
 * reconcile), nothing is tracked (abandoning checkout is not one of the five funnel events, §6),
 * and the only thing offered is the way back to where they were — carried through the cancel URL's
 * own `slug`/`locale`, the same pair the success URL carries.
 */
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function BillingCancelledPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const rawLocale = first(params.locale);
  const locale: Locale = isLocale(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const dict = getDictionary(locale);
  const slug = sanitizeSlug(first(params.slug));
  const returnTo = originPath({ slug, locale });

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <main id="main" className="band py-24 lg:py-32">
        <h1 className="max-w-detail font-display text-title font-black uppercase">
          {dict.billing.cancelledTitle}
        </h1>
        <p className="mt-6 max-w-detail text-body opacity-70">{dict.billing.cancelledBody}</p>
        <p className="mt-10">
          <a href={returnTo} className="text-accent font-label text-label uppercase">
            <TextSwap>
              {slug === null ? dict.billing.backToLibrary : dict.billing.backToPlaybook} →
            </TextSwap>
          </a>
        </p>
      </main>
    </div>
  );
}
