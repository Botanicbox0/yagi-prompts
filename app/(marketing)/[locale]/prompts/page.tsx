import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import { USE_CASES } from '@/lib/prompts/schemas';
import { UPGRADE_PATH, signInHref } from '@/lib/billing/links';
import { promptsGalleryMetadata } from '@/lib/seo/prompt-metadata';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import { Reveal } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptRail } from '@/components/prompts/rails';
import { UseCaseFilter } from '@/components/prompts/filter-chips';
import { SubmitStrip } from '@/components/prompts/detail';
import { promptLabels, presentUseCases, useCaseLabel } from '@/components/prompts/labels';

/**
 * `/[locale]/prompts` — PLAN §13.2, the v1.5 gallery.
 *
 * Cache mode is the load-bearing decision: **static + tag `prompts` + a 1h TTL floor**, exactly
 * like the landing. That is only possible because the card projection carries zero gated bytes
 * (`lib/prompts/catalog.ts` never reads `prompt_text` at all), so one cached HTML document is
 * correct for an anonymous visitor, a free reader and a Pro subscriber alike. The per-viewer
 * decisions that remain — can this person copy this text — happen at `/api/prompts/copy/[id]`.
 *
 * Consequences, deliberately accepted:
 *   · no `searchParams` anywhere (it would opt the page out of static rendering), so the use-case
 *     filter is client-side over the DOM — the brief's own fallback;
 *   · no session read anywhere in this tree, which `tests/routes/cache-contract.test.ts` enforces.
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
  return promptsGalleryMetadata({
    locale,
    // Bare in the tab (the layout template appends the brand); named in the OG card, which is read
    // where the site is not.
    title: dict.meta.promptsTitle,
    ogTitle: `${dict.meta.promptsTitle} — ${dict.meta.siteName}`,
    description: dict.meta.promptsDescription,
  });
}

export default async function PromptsGalleryPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const catalog = await getPromptCatalog();

  const labels = promptLabels(dict);
  const ads = adLabels(dict);
  const useCaseLabels = Object.fromEntries(
    USE_CASES.map((value) => [value, useCaseLabel(dict, value)]),
  );
  const filterOptions = presentUseCases(catalog.totals.useCases).map(
    (value) => [value, useCaseLabels[value]!] as [string, string],
  );

  // Static strings: the gallery cannot know the viewer, so the copy button's refusal branches are
  // pre-addressed and the SERVER decides which one the reader actually lands on (§13.3-5).
  const signin = signInHref(`/${locale}/prompts`, locale);
  const upgrade = `${UPGRADE_PATH}?locale=${locale}`;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/prompts" initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section">
        <div id="prompts-rail-anchor" className="relative">
          {/* §3.6 — the rail runs the length of the gallery at ≥1440. */}
          <AdRail anchorId="prompts-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
            <p className="text-accent font-label text-eyebrow uppercase">{dict.prompts.eyebrow}</p>

            <Reveal
              immediate
              delay={0.05}
              as="h1"
              lines={[dict.prompts.line1, dict.prompts.line2]}
              className="mt-6 font-display text-title font-black uppercase"
            />

            {/* §13 SEO: the positioning claim is the page's first sentence, in both locales. */}
            <p className="mt-8 max-w-detail text-body opacity-70">{dict.prompts.intro}</p>

            <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
              <a
                href={PROMPT_SUBMIT_PATH}
                className="text-accent inline-block border border-current px-5 py-2.5 font-label text-label uppercase"
              >
                <TextSwap>{dict.prompts.submitCta} →</TextSwap>
              </a>
            </div>

            <div className="mt-10 border-t border-hairline pt-6">
              <UseCaseFilter
                options={filterOptions}
                labels={{ heading: dict.prompts.filterHeading, all: dict.prompts.filterAll }}
              />
            </div>

            <PromptRail
              id="yagi"
              heading={dict.prompts.railYagi}
              lede={dict.prompts.railYagiLede}
              cards={catalog.yagi}
              locale={locale}
              labels={labels}
              useCaseLabels={useCaseLabels}
              emptyLabel={dict.prompts.emptyYagi}
              filteredEmptyLabel={dict.prompts.filterEmpty}
              signinHref={signin}
              upgradeHref={upgrade}
            />

            <PromptRail
              id="community"
              heading={dict.prompts.railCommunity}
              lede={dict.prompts.railCommunityLede}
              cards={catalog.community}
              locale={locale}
              labels={labels}
              useCaseLabels={useCaseLabels}
              emptyLabel={dict.prompts.emptyCommunity}
              filteredEmptyLabel={dict.prompts.filterEmpty}
              signinHref={signin}
              upgradeHref={upgrade}
            />

            <SubmitStrip
              title={dict.prompts.submitStripTitle}
              body={dict.prompts.submitStripBody}
              cta={dict.prompts.submitCta}
            />

            {/* §3.6 — below the rail tier this is the page's single ad slot. */}
            <div className="mt-16 rail:hidden">
              <AdBanner labels={ads} />
            </div>
          </div>
        </div>
      </main>

      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
