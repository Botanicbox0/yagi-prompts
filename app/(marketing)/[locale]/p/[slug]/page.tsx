import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getShapedPlaybook, type ShapedPlaybookResult } from '@/lib/content/facade';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { getDictionary } from '@/lib/i18n/dictionaries';
import {
  playbookMetadata,
  unresolvedPlaybookMetadata,
} from '@/lib/seo/playbook-metadata';
import { MarketingFooter, MarketingNav, adLabels } from '@/components/marketing/chrome';
import { AdRail, DETAIL_RAIL_LEFT } from '@/components/ad/ad-rail';
import { AdBanner, AdCard } from '@/components/ad/ad-card';
import {
  DetailHeader,
  NeighbourNav,
  ProCta,
  StepTimeline,
} from '@/components/playbook/detail';
import { StepChips, StepIndex } from '@/components/playbook/step-index';
import { playbookLabels } from '@/components/playbook/labels';
import { LockBeacon } from '@/components/analytics/beacon';
import { upgradeIntent } from '@/lib/billing/links';
import { isBillingConfigured } from '@/lib/billing/stripe-gateway';
import { trackAsync } from '@/lib/events/server';

/**
 * `/[locale]/p/[slug]` — the playbook detail page (PLAN §3.3, laid out per §4).
 *
 * Cache mode is a security property, not a preference (§3.4): this page is shaped per viewer, so it
 * is `force-dynamic` and middleware stamps `private, no-store` on it. It is the ONE locale-prefixed
 * public route that reads the session — which is exactly why landing and pricing keep their own
 * static tree and their own nav (see tests/routes/cache-contract.test.ts).
 *
 * Three outcomes, from the one gate:
 *   ok              → render, shaped to the viewer's tier
 *   requires_signin → anon on a published NON-showcase playbook. The card that linked here is
 *                     public metadata (§3.1), so a 404 would be a lie; this starts Journey A.
 *   not_found       → draft, archived, unknown, or a preview attempt by a non-admin.
 */
export const dynamic = 'force-dynamic';

/** One resolution per request, shared by `generateMetadata` and the render. */
const resolve = cache(
  (slug: string): Promise<ShapedPlaybookResult> => getShapedPlaybook(slug),
);

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

  // The page decides WHEN; `lib/seo/playbook-metadata.ts` decides WHAT — and is unit-tested there
  // (M5), which is the only way the canonical/hreflang/og:image rules get asserted at all.
  if (result.status !== 'ok') return unresolvedPlaybookMetadata(dict.meta.siteName);

  const { playbook } = result;
  return playbookMetadata({
    slug: playbook.slug,
    locale,
    title: playbook.title,
    summary: playbook.summary,
    is_showcase: playbook.is_showcase,
    hero: playbook.hero,
    siteName: dict.meta.siteName,
  });
}

export default async function PlaybookDetailPage({ params }: RouteParams) {
  const { locale: raw, slug } = await params;
  const locale = localeOf(raw);
  const dict = getDictionary(locale);
  const result = await resolve(slug);

  if (result.status === 'requires_signin') {
    const next = encodeURIComponent(`/${locale}/p/${slug}`);
    redirect(`/auth/signin?next=${next}&locale=${locale}`);
  }
  if (result.status !== 'ok') notFound();

  const { playbook, neighbours, preview } = result;
  const labels = playbookLabels(dict);
  const ads = adLabels(dict, locale);

  // §3.4 funnel. Fire-and-forget: an analytics insert may never sit on this page's critical path,
  // and may never be able to fail it (lib/events/server.ts swallows everything).
  trackAsync({
    type: 'view_playbook',
    userId: result.viewer.userId,
    playbookId: playbook.playbook_id,
    meta: { slug: playbook.slug, locale, surface: 'detail' },
  });

  // Where "unlock" goes, decided once, from the tier the gate already resolved (§3.4):
  //   anon → sign in and come back here · signed-in free → straight to Stripe · unconfigured → pricing.
  const upgrade = upgradeIntent({
    tier: playbook.tier,
    slug: playbook.slug,
    locale,
    billingConfigured: isBillingConfigured(),
  });
  const categoryLabel = (dict.category as Record<string, string>)[playbook.category] ?? playbook.category;
  const difficultyLabel =
    (dict.difficulty as Record<string, string>)[playbook.difficulty] ?? playbook.difficulty;

  return (
    <>
      <MarketingNav locale={locale} dict={dict} rest={`/p/${slug}`} initialTheme="light" />

      <main id="main" data-section data-theme="light" className="section pb-24">
        <div id="detail-rail-anchor" className="detail relative pt-20 lg:pt-24">
          <div className="detail__index">
            <div className="hidden lg:block lg:pt-32">
              <StepIndex steps={playbook.steps} locale={locale} labels={labels} />
            </div>
          </div>

          <div className="detail__body">
            {preview && (
              <p className="text-accent mb-6 border border-accent px-3 py-1.5 font-label text-eyebrow uppercase inline-block">
                {labels.previewBadge}
              </p>
            )}

            <DetailHeader
              playbook={playbook}
              locale={locale}
              labels={labels}
              categoryLabel={categoryLabel}
              difficultyLabel={difficultyLabel}
            />

            <div className="mt-10">
              <StepChips steps={playbook.steps} locale={locale} labels={labels} />
            </div>

            <StepTimeline
              steps={playbook.steps}
              locale={locale}
              labels={labels}
              tier={playbook.tier}
              upgrade={upgrade}
            />

            {/* §3.6: below the rail tier this is the page's single ad slot ("after step 2" is the
                plan's landing wording; on detail the honest place is after the reading, not inside
                a step, so it sits with the conversion strip). */}
            <div className="mt-16">
              <AdBanner labels={ads} />
            </div>

            <ProCta
              lockedCount={playbook.lockedCount}
              locale={locale}
              labels={labels}
              upgrade={upgrade}
            />

            {/* §3.4 `hit_lock` — once per page, and only when the server really rendered a lock. */}
            {playbook.lockedCount > 0 && <LockBeacon slug={playbook.slug} />}

            <NeighbourNav neighbours={neighbours} locale={locale} labels={labels} />

            <p className="mt-10">
              <a href="/library" className="text-accent font-label text-eyebrow uppercase">
                ← {labels.allPlaybooks}
              </a>
            </p>
          </div>

          {/* §3.6 ad rail: ≥1440 only, and on the DETAIL band math (§4). */}
          <div className="detail__rail hidden rail:block">
            <AdRail anchorId="detail-rail-anchor" left={DETAIL_RAIL_LEFT}>
              <AdCard labels={ads} />
            </AdRail>
          </div>
        </div>
      </main>

      {/* §3.3 "the same strip appears at the bottom of playbook detail pages". */}
      <MarketingFooter locale={locale} dict={dict} />
    </>
  );
}
