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
import { makerHref, makerShortPath, makerWorkSrc } from '@/lib/makers/links';
import { cachedPublicWorks } from '@/lib/makers/cached-public';
import { countryName } from '@/lib/makers/fields';
import { makerMetadata, unresolvedTemplateMetadata } from '@/lib/seo/template-metadata';
import { JsonLd } from '@/lib/seo/json-ld';
import { siteUrl } from '@/lib/seo/site-url';
import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';
import { PromptRail } from '@/components/prompts/rails';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { CreativeAvatar, CreativeLinks, placeOf } from '@/components/makers/identity';
import { RevealEmail, ShareProfile } from '@/components/makers/islands';
import { WorksGallery } from '@/components/makers/works-gallery';

/**
 * `/[locale]/makers/[handle]` — an AI creative's public page (docs/PLATFORM-2.0.md §7.5·§20).
 * `twings.app/@handle` lands here in the reader's language (middleware).
 *
 * It exists only for a creative who turned their profile on (0060); everyone else, and every handle
 * that never existed, is a real 404. Static + tag `prompts` + the 1h TTL floor like the template
 * page: it reads the same cached catalogue, so a studio change moves the card credit, the template
 * page and this page together. What it shows is what the creative chose to show — name, headline,
 * place, links, tools, an email behind a button, their works and their published templates — and
 * nothing else about the account.
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
  const name = found.maker.displayName;
  return makerMetadata({
    handle,
    locale,
    title: name ? `${name} (@${handle}) · ${dict.makers.eyebrow}` : interpolate(dict.makers.metaTitle, values),
    description: found.maker.headline ?? found.maker.bio ?? interpolate(dict.makers.metaDescription, values),
    siteName: dict.meta.siteName,
    poster: found.maker.avatar ?? found.cards.find((card) => card.poster)?.poster?.src ?? null,
  });
}

/** schema.org ProfilePage → Person: what search and answer engines read about a creative (AGENTS.md §7). */
function profileStructuredData(origin: string, locale: Locale, maker: PublicMaker, role: string): Record<string, unknown> {
  const url = `${origin}${makerHref(locale, maker.handle)}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    mainEntity: {
      '@type': 'Person',
      name: maker.displayName ?? `@${maker.handle}`,
      alternateName: `@${maker.handle}`,
      identifier: maker.handle,
      jobTitle: maker.headline ?? role,
      ...(maker.bio ? { description: maker.bio } : {}),
      ...(maker.avatar ? { image: `${origin}${maker.avatar}` } : {}),
      ...(maker.country ? { homeLocation: { '@type': 'Place', name: [maker.city, countryName(maker.country, locale)].filter(Boolean).join(', '), address: { '@type': 'PostalAddress', addressCountry: maker.country, ...(maker.city ? { addressLocality: maker.city } : {}) } } } : {}),
      ...(maker.links.length ? { sameAs: maker.links.map((link) => link.url) } : {}),
      ...(maker.tools.length ? { knowsAbout: maker.tools } : {}),
      url,
    },
  };
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
  const works = await cachedPublicWorks(maker.handle);
  const place = placeOf(maker.country, maker.city, locale);
  const origin = siteUrl();
  const shortUrl = `${origin}${makerShortPath(maker.handle)}`;
  const name = maker.displayName ?? `@${maker.handle}`;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/makers/${handle}`} initialTheme="light" />
      <JsonLd id="creative-structured-data" data={profileStructuredData(origin, locale, maker, t.jsonLdRole)} />
      <main id="main" data-maker-profile={handle} data-section data-theme="light" className="section">
        <div className="band pt-24 pb-20 lg:pt-28">
          {/* Identity: who, where, with what — the first screen a brand or a fan reads. */}
          <header data-creative-hero className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <p className="text-accent font-label text-eyebrow uppercase">{t.eyebrow}</p>
              <div className="mt-6 flex items-center gap-5 sm:gap-7">
                {/* The wrappers carry the breakpoint: the avatar's own `inline-flex` would beat a `hidden` on it. */}
                <span className="hidden shrink-0 sm:block"><CreativeAvatar handle={maker.handle} name={maker.displayName} src={maker.avatar} size={112} eager /></span>
                <span className="block shrink-0 sm:hidden"><CreativeAvatar handle={maker.handle} name={maker.displayName} src={maker.avatar} size={76} eager /></span>
                <div className="min-w-0">
                  <h1 className="font-display text-[clamp(2.2rem,6vw,4.75rem)] leading-[0.92] font-black tracking-tight break-words">{name}</h1>
                  {maker.displayName && <p className="mt-2 font-mono text-sm text-black/60 break-all">@{maker.handle}</p>}
                </div>
              </div>
              {maker.headline && <p data-creative-headline className="mt-7 max-w-2xl text-[clamp(1.15rem,2.2vw,1.5rem)] leading-snug font-medium text-black/85">{maker.headline}</p>}
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-black/65">
                {place && <span data-creative-place>{interpolate(t.basedIn, { place })}</span>}
                {maker.openToBrands && (
                  <span data-creative-open className="inline-flex items-center gap-2 rounded-full bg-black/[0.05] px-3 py-1 text-black/80">
                    <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />{t.openToBrands}
                  </span>
                )}
                <span data-maker-count>{interpolate(t.templateCount, { count: String(maker.templateCount) })} · {dict.templates.verified}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
              {maker.publicEmail && <RevealEmail reversed={[...maker.publicEmail].reverse().join('')} labels={{ show: t.showEmail, copy: t.copyEmail, copied: t.copied }} />}
              <ShareProfile url={shortUrl} title={name} labels={{ share: t.share, shared: t.shared }} />
            </div>
          </header>

          {(maker.bio || maker.tools.length > 0 || maker.links.length > 0) && (
            <section data-creative-about aria-label={t.aboutHeading} className="mt-12 grid gap-8 border-t border-hairline pt-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              {maker.bio
                ? <p data-maker-bio className="max-w-2xl text-base leading-relaxed whitespace-pre-line break-words text-black/75">{maker.bio}</p>
                : <span />}
              <div className="space-y-6">
                {maker.tools.length > 0 && (
                  <div>
                    <p className="font-label text-eyebrow text-black/50 uppercase">{t.toolsHeading}</p>
                    <ul data-creative-tools className="mt-3 flex flex-wrap gap-1.5">
                      {maker.tools.map((tool) => <li key={tool} className="rounded-md border border-hairline px-2.5 py-1 font-mono text-xs text-black/75">{tool}</li>)}
                    </ul>
                  </div>
                )}
                {maker.links.length > 0 && (
                  <div>
                    <p className="font-label text-eyebrow text-black/50 uppercase">{t.linksHeading}</p>
                    <CreativeLinks links={maker.links} className="mt-3" />
                  </div>
                )}
              </div>
            </section>
          )}

          {works.length > 0 && (
            <section data-creative-works-section className="mt-14">
              <div className="mb-6 flex items-baseline justify-between gap-4">
                <h2 className="font-display text-[clamp(1.4rem,2.6vw,2rem)] leading-[0.95] font-black uppercase">{t.worksHeading}</h2>
                <span className="font-mono text-xs text-black/50">{works.length}</span>
              </div>
              <WorksGallery
                works={works.map((work) => ({ id: work.id, kind: work.kind, src: makerWorkSrc(work.id, work.mime), width: work.width, height: work.height, title: work.title, caption: work.caption, linkUrl: work.linkUrl }))}
                labels={{ viewOriginal: t.viewOriginal, close: t.close, previous: t.previous, next: t.next, workLabel: t.workLabel }}
              />
            </section>
          )}

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
