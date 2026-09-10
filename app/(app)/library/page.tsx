import { getSqlRunner } from '@/lib/db/connect';
import {
  EMPTY_LIBRARY,
  isFiltered,
  loadLibrary,
  parseLibraryQuery,
  type LibraryData,
} from '@/lib/content/library';
import { getLocaleFromHeaders } from '@/lib/i18n/server';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { formatCount, interpolate } from '@/lib/i18n/format';
import { LocaleToggle } from '@/components/locale-toggle';
import { TwingsWordmark } from '@/components/brand/twings-wordmark';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import { adLabels, siteLinks } from '@/components/marketing/chrome';
import { FilterBar } from '@/components/library/filter-bar';
import { LibraryEmpty, LibraryGrid, type GridLabels } from '@/components/library/grid';

/**
 * `/library` — PLAN §3.2, behind the middleware session gate (§3.7).
 *
 * Dynamic and `no-store` by contract (§3.4): the grid is read per request from the AUTHENTICATED
 * catalog projection (`lib/content/library.ts`), never from the cached public one, so a playbook
 * published a second ago is here and nothing viewer-shaped can land in a shared cache.
 *
 * Filters, search and the empty states are all server-rendered from the query string — the URL is
 * the entire state of this page.
 */
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const [locale, params] = await Promise.all([getLocaleFromHeaders(), searchParams]);
  const dict = getDictionary(locale);
  const query = parseLibraryQuery(params);

  const sql = await getSqlRunner();
  const data: LibraryData = sql
    ? await loadLibrary(sql, query)
    : { ...EMPTY_LIBRARY, query };

  const categoryLabel = (key: string) => (dict.category as Record<string, string>)[key] ?? key;
  const difficultyLabel = (key: string) => (dict.difficulty as Record<string, string>)[key] ?? key;

  const gridLabels: GridLabels = {
    steps: dict.library.steps,
    proBlocks: dict.library.proBlocks,
    open: dict.library.open,
    showcase: dict.featured.showcaseLabel,
    loginWall: dict.featured.loginWallLabel,
    badgeNew: dict.badge.new,
    badgeUpdated: dict.badge.updated,
    emptyTitle: dict.library.emptyTitle,
    emptyBody: dict.library.emptyBody,
    catalogEmptyTitle: dict.library.catalogEmptyTitle,
    catalogEmptyBody: dict.library.catalogEmptyBody,
    clear: dict.library.clear,
  };

  const ads = adLabels(dict, locale);
  const filtered = isFiltered(query);

  return (
    <div data-section data-theme="light" className="section min-h-screen">
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-shell items-center justify-between px-gutter py-5">
          <a href={`/${locale}`} className="flex items-center gap-2.5">
            <TwingsWordmark className="h-[18px] w-auto" />
          </a>
          <div className="flex items-center gap-6">
            {siteLinks(locale, dict).map((link, index) => (
              <a
                key={link.href}
                href={link.href}
                className={[index === 0 ? '' : 'hidden sm:inline', 'font-label text-eyebrow uppercase'].join(' ')}
              >
                {link.label}
              </a>
            ))}
            <LocaleToggle current={locale} rest="/library" prefixed={false} />
          </div>
        </div>
      </header>

      <main id="main" className="py-16 lg:py-20">
        <div id="library-rail-anchor" className="relative">
          <AdRail anchorId="library-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <div className="band">
            <p className="text-accent font-label text-eyebrow uppercase">{dict.library.eyebrow}</p>
            <h1 className="mt-6 font-display text-title font-black uppercase">
              {dict.library.title}
            </h1>
            <p className="mt-6 max-w-detail text-body opacity-70">{dict.library.lede}</p>

            <div className="mt-12">
              <FilterBar
                query={query}
                facets={data.facets}
                filtered={filtered}
                labels={{
                  search: dict.library.search,
                  searchPlaceholder: dict.library.searchPlaceholder,
                  category: dict.library.filterCategory,
                  difficulty: dict.library.filterDifficulty,
                  tag: dict.library.filterTag,
                  all: dict.library.filterAll,
                  apply: dict.library.apply,
                  clear: dict.library.clear,
                  sortNewest: dict.library.sortNewest,
                  categoryLabel,
                  difficultyLabel,
                }}
              />
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 font-mono text-code opacity-60">
              <span>
                {interpolate(dict.library.resultCount, {
                  shown: formatCount(data.visible.length, locale),
                  total: formatCount(data.all.length, locale),
                })}
              </span>
              <span>{dict.library.sortNewest}</span>
            </div>

            <div className="mt-10">
              {data.visible.length === 0 ? (
                <LibraryEmpty filtered={filtered} labels={gridLabels} />
              ) : (
                <LibraryGrid
                  cards={data.visible}
                  locale={locale}
                  labels={gridLabels}
                  categoryLabel={categoryLabel}
                  difficultyLabel={difficultyLabel}
                />
              )}
            </div>

            {/* §3.6: one ad per viewport — the banner is hidden at the rail tier by its own CSS. */}
            <div className="mt-16">
              <AdBanner labels={ads} />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
