import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import type { PromptCard, PublicMaker } from '@/lib/prompts/catalog';
import { USE_CASES } from '@/lib/prompts/schemas';
import { templatesHref } from '@/lib/prompts/links';
import { makerHandleOf } from '@/lib/makers/profile';
import { makerHref } from '@/lib/makers/links';
import { makerMetadata, unresolvedTemplateMetadata } from '@/lib/seo/template-metadata';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PromptRail } from '@/components/prompts/rails';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';

/**
 * `/[locale]/makers/[handle]` — a template maker's public page (docs/PLATFORM-2.0.md §7.5).
 *
 * It exists only for a maker who turned their profile on (0060); everyone else, and every handle
 * that never existed, is a real 404. Static + tag `prompts` + the 1h TTL floor like the template
 * page: it reads the same cached catalogue, so turning a profile on or off moves the card credit,
 * the template page and this page together. What it shows is the handle, the bio and the published
 * templates — nothing else about the person.
 */
/** Must stay equal to CATALOG_TTL_SECONDS — Next requires a literal here (tests pin the pair). */
export const revalidate = 3600;

interface RouteParams {
  params: Promise<{ locale: string; handle: string }>;
}

function localeOf(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

const resolve = cache(async (handle: string): Promise<{ maker: PublicMaker; cards: PromptCard[] } | null> => {
  const catalog = await getPromptCatalog();
  const maker = (catalog.makers ?? []).find((item) => item.handle === handle);
  if (!maker) return null;
  const cards = [...catalog.video, ...catalog.image].filter((card) => card.makerProfile && card.authorHandle === handle);
  return { maker, cards };
});

/** `@Jun_01` → `jun_01`; the URL segment arrives percent-encoded. */
function handleFrom(raw: string): string | null {
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  return makerHandleOf(decoded);
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw, handle: rawHandle } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const handle = handleFrom(rawHandle);
  const found = handle ? await resolve(handle) : null;
  if (!handle || !found) return unresolvedTemplateMetadata(dict.meta.siteName);
  const values = { handle, count: String(found.maker.templateCount) };
  return makerMetadata({
    handle,
    locale,
    title: interpolate(dict.makers.metaTitle, values),
    description: found.maker.bio ?? interpolate(dict.makers.metaDescription, values),
    siteName: dict.meta.siteName,
    poster: found.cards.find((card) => card.poster)?.poster?.src ?? null,
  });
}

export default async function MakerPage({ params }: RouteParams) {
  const { locale: raw, handle: rawHandle } = await params;
  const locale = localeOf(raw);
  const handle = handleFrom(rawHandle);
  const found = handle ? await resolve(handle) : null;
  if (!handle || !found) notFound();
  // One address per maker: `/makers/@Jun_01` and `/makers/JUN_01` land on `/makers/jun_01`.
  if (rawHandle !== handle) permanentRedirect(makerHref(locale, handle));

  const dict = getDictionary(locale);
  const t = dict.makers;
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const { maker, cards } = found;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/makers/${handle}`} initialTheme="light" />
      <main id="main" data-maker-profile={handle} data-section data-theme="light" className="section">
        <div className="band pt-24 pb-20 lg:pt-28">
          <p className="text-accent font-label text-eyebrow uppercase">{t.eyebrow}</p>
          <h1 className="mt-4 font-display text-[clamp(2.25rem,5vw,4rem)] leading-tight font-black tracking-tight break-all">@{maker.handle}</h1>
          {maker.bio && <p data-maker-bio className="mt-5 max-w-2xl text-base leading-relaxed whitespace-pre-line break-words text-black/75">{maker.bio}</p>}
          <p data-maker-count className="mt-5 text-sm text-black/60">
            {interpolate(t.templateCount, { count: String(maker.templateCount) })} · {dict.templates.verified}
          </p>

          {cards.length === 0 ? (
            <p data-maker-empty className="mt-14 border-t border-hairline pt-8 text-sm text-black/60">{t.empty}</p>
          ) : (
            <PromptRail
              id="maker"
              origin="maker"
              heading={t.templatesHeading}
              lede=""
              cards={cards}
              locale={locale}
              labels={labels}
              useCaseLabels={useCaseLabels}
              emptyLabel={t.empty}
              filteredEmptyLabel={dict.prompts.filterEmpty}
              topClassName="mt-14"
            />
          )}

          <a href={templatesHref(locale, 'video')} className="mt-12 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{t.browse} →</a>
        </div>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
