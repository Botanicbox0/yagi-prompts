import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getShapedContest, type ContestDetailResult } from '@/lib/contests/facade';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { contestMetadata, unresolvedContestMetadata } from '@/lib/seo/contest-metadata';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import {
  ContestBackLink,
  ContestBody,
  ContestHeader,
  ContestMeta,
  ContestPrize,
} from '@/components/contests/detail';
import { contestLabels } from '@/components/contests/labels';

/**
 * `/[locale]/contests/[slug]` — PLAN §14.2.
 *
 * `force-dynamic` + `private, no-store` (middleware), and the reason differs from the other two
 * routes that carry those headers. This page's HTML does not vary by READER — there is no tier gate
 * anywhere on the contests surface — it varies by CLOCK. Phase, D-day and the CTA all move on their
 * own, and a shared cache holding "D-3" would tell someone they had three days left on the morning
 * after the deadline closed.
 *
 * Published only, for everyone including admins: §14.1 makes publishing the founder's deliberate
 * act, so a draft that anyone holding the URL could read would defeat the point. Drafts render at
 * `/admin/contests/[slug]/preview`, behind `requireAdmin()`. The gate lives in
 * `lib/contests/access.ts` — nothing here decides anything.
 */
export const dynamic = 'force-dynamic';

/** One resolution per request, shared by `generateMetadata` and the render. */
const resolve = cache((slug: string): Promise<ContestDetailResult> => getShapedContest(slug));

interface RouteParams {
  params: Promise<{ locale: string; slug: string }>;
}

function localeOf(raw: string): Locale {
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function generateMetadata({ params }: RouteParams): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const result = await resolve(slug);
  if (result.status !== 'ok') return unresolvedContestMetadata(dict.meta.siteName);
  return contestMetadata({ contest: result.contest, locale, siteName: dict.meta.siteName });
}

export default async function ContestDetailPage({ params }: RouteParams) {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const result = await resolve(slug);
  if (result.status !== 'ok') notFound();

  const { contest } = result;
  const labels = contestLabels(dict);
  const ads = adLabels(dict);

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/contests/${slug}`} initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section pb-24">
        {/* The hero is full-bleed, so it sits OUTSIDE the band and the rail anchor starts below it
            (§4's band rule keeps text-critical content out of the right 340px at ≥1440). */}
        <ContestHeader contest={contest} locale={locale} labels={labels} />

        <div className="band">
          <ContestMeta contest={contest} locale={locale} labels={labels} />
        </div>

        {/* §14.2's "money shot", as a full-width inversion — so it is also outside the rail anchor
            (M9 design review, finding 3). A band that stopped 340px short of the right edge would be
            a panel, and §5.1 makes the black↔white inversion the identity. */}
        <ContestPrize contest={contest} locale={locale} labels={labels} />

        <div id="contest-rail-anchor" className="relative">
          <AdRail anchorId="contest-rail-anchor">
            <AdCard labels={ads} />
          </AdRail>

          <div className="band">
            <ContestBody contest={contest} locale={locale} labels={labels} />
            <ContestBackLink locale={locale} labels={labels} />

            {/* §3.3/§14.2 — the B2B pitch belongs to the LISTING, which is where a brand who does
                not yet have a contest is standing. Repeating it under every detail page, eight
                lines above the footer that carries it a third time, was the same sentence three
                times (M9 design review, finding 10). */}
            <div className="mt-16 rail:hidden">
              <AdBanner labels={ads} />
            </div>
          </div>
        </div>
      </main>

      {/* §3.3 — the hire strip is the same one every content page ends on. */}
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
