import type { Metadata } from 'next';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { getContestCatalog } from '@/lib/contests/public-catalog';
import { splitByPhase } from '@/lib/contests/catalog';
import { contestsListingMetadata } from '@/lib/seo/contest-metadata';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import { Reveal } from '@/components/motion/reveal';
import {
  CONTEST_MAILTO,
  ContestFeature,
  ContestHireStrip,
  ContestHostKinds,
  ContestRail,
  ContestsEmptyState,
} from '@/components/contests/rails';
import { contestLabels, hostKindLabel } from '@/components/contests/labels';
import { HOST_KINDS } from '@/lib/contests/schemas';

/**
 * `/[locale]/contests` — PLAN §14.2, the contests listing.
 *
 * Cache mode is the load-bearing decision, and it is the same one the prompts gallery made:
 * **static + tag `contests` + a 1h TTL floor**. Nothing on this page varies by reader — a contest
 * is marketing, there is no tier gate anywhere on the surface — so one cached document is correct
 * for an anonymous visitor, a free reader and a Pro subscriber alike.
 *
 * What DOES vary is the clock, and it is handled without giving up the cache: the cached projection
 * stores dates rather than phases (`lib/contests/catalog.ts`), the split happens here at render
 * time, and the countdown is whole UTC days — a resolution an hourly TTL can actually keep
 * (`lib/contests/phase.ts` explains the arithmetic). A ticking clock would have forced this page
 * dynamic for a number that changes once a day.
 *
 * Consequences, deliberately accepted and identical to §13.2's: no `searchParams` anywhere, and no
 * session read anywhere in this tree — `tests/routes/cache-contract.test.ts` enforces both.
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
  return contestsListingMetadata({
    locale,
    title: dict.meta.contestsTitle,
    ogTitle: `${dict.meta.contestsTitle} — ${dict.meta.siteName}`,
    description: dict.meta.contestsDescription,
    siteName: dict.meta.siteName,
  });
}

export default async function ContestsListingPage({ params }: RouteParams) {
  const { locale: raw } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const catalog = await getContestCatalog();

  // The one clock read on this page, taken once so all three rails and every D-day chip agree.
  const now = Date.now();
  const phased = splitByPhase(catalog, now);
  const labels = contestLabels(dict);
  const ads = adLabels(dict);
  const empty = phased.totals.published === 0;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest="/contests" initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section">
        <div id="contests-rail-anchor" className="relative">
          {/* §3.6 — the rail runs the length of the listing at ≥1440. */}
          <AdRail anchorId="contests-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <div className="band pt-28 pb-24 lg:pt-36 lg:pb-32">
            <p className="text-accent font-label text-eyebrow uppercase">{dict.contests.eyebrow}</p>

            <Reveal
              immediate
              delay={0.05}
              as="h1"
              lines={[dict.contests.line1, dict.contests.line2]}
              className="mt-6 font-display text-title font-black uppercase"
            />

            <p className="mt-8 max-w-detail text-body opacity-70">{dict.contests.intro}</p>

            {empty ? (
              <ContestsEmptyState
                title={dict.contests.emptyTitle}
                body={dict.contests.emptyBody}
                cta={dict.contests.emptyCta}
                mailto={CONTEST_MAILTO}
              />
            ) : (
              <div className="mt-10 border-t border-hairline pt-6">
                {/* The soonest-closing OPEN contest, given the treatment the fact deserves. The
                    catalog already arrives deadline-first, so `[0]` is that contest. */}
                {phased.open[0] && (
                  <ContestFeature
                    card={phased.open[0]}
                    locale={locale}
                    labels={labels}
                    now={now}
                  />
                )}
                <ContestRail
                  id="open"
                  heading={dict.contests.railOpen}
                  lede={dict.contests.railOpenLede}
                  cards={phased.open}
                  locale={locale}
                  labels={labels}
                  now={now}
                />
                <ContestRail
                  id="upcoming"
                  heading={dict.contests.railUpcoming}
                  lede={dict.contests.railUpcomingLede}
                  cards={phased.upcoming}
                  locale={locale}
                  labels={labels}
                  now={now}
                />
                <ContestRail
                  id="closed"
                  heading={dict.contests.railClosed}
                  lede={dict.contests.railClosedLede}
                  cards={phased.closed}
                  locale={locale}
                  labels={labels}
                  now={now}
                />
              </div>
            )}

            {/* Who may open one (2026-08-15). It sits above the enquiry strip because it is the
                answer to the question the strip's CTA provokes. */}
            {!empty && (
              <ContestHostKinds
                title={dict.contests.hostKindsTitle}
                body={dict.contests.hostKindsBody}
                kinds={HOST_KINDS.map((kind) => hostKindLabel(labels, kind))}
              />
            )}

            {/* §14.2's B2B CTA is on this page in both states — but only ONCE.
                When the listing is empty the empty state IS the pitch and already carries the
                mailto, so repeating it in a bordered strip eight lines below would be the same
                sentence twice with a rule between them. When there are contests, the strip is what
                carries it. */}
            {!empty && (
              <ContestHireStrip
                title={dict.contests.hireTitle}
                body={dict.contests.hireBody}
                cta={dict.contests.hireCta}
                mailto={CONTEST_MAILTO}
              />
            )}

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
