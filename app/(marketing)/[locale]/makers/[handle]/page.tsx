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
import { makerBioFor, makerHandleOf } from '@/lib/makers/profile';
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
import { MakerRecipeHub } from '@/components/makers/recipe-hub';

/**
 * `/[locale]/makers/[handle]` — an AI creative's public page (docs/PLATFORM-2.0.md §7.5·§20).
 * `twings.app/@handle` lands here in the reader's language (middleware).
 *
 * It exists only for a creative who turned their profile on (0060); everyone else, and every handle
 * that never existed, is a real 404. Static + tag `prompts` + the 1h TTL floor like the template
 * page: it reads the same cached catalogue, so a studio change moves the card credit, the template
 * page and this page together. What it shows is what the creative chose to show — a cover, a photo,
 * name, headline, place, links, tools, an email behind a button, their works and their published
 * templates — and nothing else about the account.
 *
 * It opens like a profile (founder, 2026-10-29: "LinkedIn처럼 프로필 사진이랑 배경 사진"): the cover
 * banner — 2:1 edge to edge on a phone, 3:1 rounded from `sm` — with the photo over its lower edge,
 * then who and where, the links, the bio; then the recipe line, the templates, the works.
 */
/** No cover yet: a quiet wash from the page's own tokens, so the banner keeps its shape (TASTE.md: one blue, no red). */
const COVER_FALLBACK = [
  'radial-gradient(120% 160% at 10% 0%, color-mix(in oklab, var(--accent) 16%, var(--surface)) 0%, transparent 62%)',
  'linear-gradient(135deg, color-mix(in oklab, var(--on-surface) 3%, var(--surface)), color-mix(in oklab, var(--on-surface) 9%, var(--surface)))',
].join(', ');

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
    description: found.maker.headline ?? makerBioFor(found.maker, locale) ?? interpolate(dict.makers.metaDescription, values),
    siteName: dict.meta.siteName,
    // The 2:1 cover is close to a link card's 1.91:1, so it shares best; then the photo, then a template.
    poster: found.maker.cover ?? found.maker.avatar ?? found.cards.find((card) => card.poster)?.poster?.src ?? null,
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
      ...(makerBioFor(maker, locale) ? { description: makerBioFor(maker, locale) } : {}),
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
  const bio = makerBioFor(maker, locale);

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/makers/${handle}`} initialTheme="light" />
      <JsonLd id="creative-structured-data" data={profileStructuredData(origin, locale, maker, t.jsonLdRole)} />
      <main id="main" data-maker-profile={handle} data-section data-theme="light" className="section">
        {/* The page's own centred shell, as on the template page: `.band` keeps a 300px ad rail free at
            1440+, which would push the banner left of the page's centre. */}
        <div data-creative-shell className="mx-auto w-full max-w-[calc(var(--container-audience)+2*var(--spacing-gutter))] px-[var(--spacing-gutter)] pt-20 pb-20 sm:pt-24 lg:pt-28">
          {/* Identity: the cover, the photo, who and where — the first screen a brand or a fan reads. */}
          <header data-creative-hero>
            <div
              data-creative-cover={maker.cover ? 'photo' : 'none'}
              className="relative -mx-[var(--spacing-gutter)] aspect-[2/1] overflow-hidden sm:mx-0 sm:aspect-[3/1] sm:rounded-[1.75rem] sm:ring-1 sm:ring-black/[0.06]"
              style={maker.cover ? undefined : { background: COVER_FALLBACK }}
            >
              {/* Decoration: the name under it is the heading, so the picture carries no text of its own. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- gateway-served, already cropped and sized */}
              {maker.cover && <img src={maker.cover} alt="" width={1800} height={900} fetchPriority="high" decoding="async" className="h-full w-full object-cover" />}
            </div>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-8 lg:px-10">
              <div className="min-w-0">
                {/* The photo sits over the banner's lower edge. The wrappers carry the breakpoint: the
                    avatar's own `inline-flex` would beat a `hidden` on it. */}
                <span className="relative -mt-12 block w-fit rounded-full bg-surface p-1 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)] sm:hidden">
                  <CreativeAvatar handle={maker.handle} name={maker.displayName} src={maker.avatar} size={88} eager />
                </span>
                <span className="relative -mt-[4.6rem] hidden w-fit rounded-full bg-surface p-1.5 shadow-[0_14px_40px_-16px_rgba(0,0,0,0.35)] sm:block">
                  <CreativeAvatar handle={maker.handle} name={maker.displayName} src={maker.avatar} size={136} eager />
                </span>
                <h1 className="mt-4 font-display text-[clamp(1.9rem,4.4vw,3.25rem)] leading-[1.02] font-black tracking-tight break-words">{name}</h1>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-black/60">
                  {maker.displayName && <span className="font-mono break-all">@{maker.handle}</span>}
                  {maker.displayName && <span aria-hidden="true" className="text-black/30">·</span>}
                  <span>{t.eyebrow}</span>
                </p>
                {maker.headline && <p data-creative-headline className="mt-4 max-w-2xl text-[clamp(1.05rem,1.8vw,1.3rem)] leading-snug font-medium text-black/85">{maker.headline}</p>}
                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-black/65">
                  {place && <span data-creative-place>{interpolate(t.basedIn, { place })}</span>}
                  {maker.openToBrands && (
                    <span data-creative-open className="inline-flex items-center gap-2 rounded-full bg-black/[0.05] px-3 py-1 text-black/80">
                      <span aria-hidden="true" className="size-2 rounded-full bg-emerald-500" />{t.openToBrands}
                    </span>
                  )}
                  <span data-maker-count>{interpolate(t.templateCount, { count: String(maker.templateCount) })} · {dict.templates.verified}</span>
                </div>
                {maker.links.length > 0 && <CreativeLinks links={maker.links} className="mt-5" />}
              </div>
              <div className="flex flex-wrap items-center gap-2.5 sm:justify-end sm:self-start sm:pt-5">
                {maker.publicEmail && <RevealEmail reversed={[...maker.publicEmail].reverse().join('')} labels={{ show: t.showEmail, copy: t.copyEmail, copied: t.copied }} />}
                <ShareProfile url={shortUrl} title={name} labels={{ share: t.share, shared: t.shared }} />
              </div>
            </div>
          </header>

          {(bio || maker.tools.length > 0) && (
            <section data-creative-about aria-label={t.aboutHeading} className="mt-10 grid gap-8 border-t border-hairline pt-8 sm:px-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:px-10">
              {bio
                ? <p data-maker-bio className="max-w-2xl text-base leading-relaxed whitespace-pre-line break-words text-black/75">{bio}</p>
                : <span />}
              {maker.tools.length > 0 && (
                <div>
                  <p className="font-label text-eyebrow text-black/50 uppercase">{t.toolsHeading}</p>
                  <ul data-creative-tools className="mt-3 flex flex-wrap gap-1.5">
                    {maker.tools.map((tool) => <li key={tool} className="rounded-md border border-hairline px-2.5 py-1 font-mono text-xs text-black/75">{tool}</li>)}
                  </ul>
                </div>
              )}
            </section>
          )}

          <div className="sm:px-8 lg:px-10">
            <MakerRecipeHub handle={maker.handle} openRecipes={maker.openRecipeCount ?? 0} copy={t} />
          </div>

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

          {works.length > 0 && (
            <section data-creative-works-section className="mt-16">
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

          <a href={templatesHref(locale, 'video')} className="mt-12 inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">{t.browse} →</a>
        </div>
      </main>
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
