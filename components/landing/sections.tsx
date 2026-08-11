import { Reveal, ScrubY } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { Marquee } from '@/components/ui/marquee';
import { HeroMedia } from './hero-media';
import { ReelPoster } from './reel-poster';
import { PlaybookCard, type CardLabels } from './playbook-card';
import { PlanCards } from '@/components/pricing/plan-cards';
import { HERO_REEL } from '@/lib/content/slots';
import { formatCount, interpolate } from '@/lib/i18n/format';
import type { CatalogCard, CatalogTotals } from '@/lib/content/catalog';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';

/**
 * The landing's server-rendered sections, in the §3.1 order.
 *
 * Every section carries `data-section` + `data-theme`: that pair is what the nav's and the ad
 * rail's probe-line observers read (§4), and it is what paints the §5.1 black↔white rhythm.
 * The inversions here are: hero dark → premise light → marquee dark → how-it-reads light →
 * [circle wipe] → featured dark → pricing light → FAQ dark → footer dark.
 */

function signInHref(locale: Locale): string {
  return `/auth/signin?next=%2Flibrary&locale=${locale}`;
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function Hero({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <section data-section data-theme="dark" className="section overflow-hidden">
      {/* §4: `svh` hero on the small tier so mobile browser chrome cannot clip the CTA. */}
      <div className="mx-auto flex min-h-svh max-w-shell flex-col justify-between px-gutter pt-30 pb-14 lg:min-h-0 lg:pt-36 lg:pb-24">
        <div>
          <p className="text-accent font-label text-eyebrow uppercase">{dict.hero.eyebrow}</p>
          <Reveal
            immediate
            delay={0.05}
            as="h1"
            lines={[dict.hero.line1, dict.hero.line2, dict.hero.line3]}
            className="mt-7 font-display text-display uppercase"
          />
        </div>

        <div className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-end lg:gap-14">
          <div>
            <p className="max-w-detail text-body opacity-70">{dict.hero.lede}</p>
            <div className="mt-9 flex flex-wrap items-center gap-x-8 gap-y-4">
              <a
                href={signInHref(locale)}
                className="inline-block border border-current px-6 py-3 font-label text-label uppercase"
              >
                <TextSwap>{dict.auth.startWithGoogle} →</TextSwap>
              </a>
              <a
                href={`/${locale}/pricing`}
                className="text-accent inline-block font-label text-label uppercase"
              >
                <TextSwap>{dict.hero.secondaryCta} →</TextSwap>
              </a>
            </div>
          </div>

          <HeroMedia
            reel={HERO_REEL}
            label={dict.hero.reelLabel}
            poster={
              <ReelPoster
                kicker={dict.hero.reelKicker}
                caption={dict.hero.reelCaption}
                words={[
                  dict.howItReads.stepsTitle,
                  dict.howItReads.blocksTitle,
                  dict.howItReads.unlockTitle,
                ]}
              />
            }
          />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Premise
// ---------------------------------------------------------------------------

export function Premise({ dict, totals }: { dict: Dictionary; totals: CatalogTotals }) {
  const stats: Array<{ value: string; label: string }> = [
    { value: String(totals.playbooks), label: dict.premise.statPlaybooksLabel },
    { value: String(totals.prompts), label: dict.premise.statPromptsLabel },
    { value: String(totals.steps), label: dict.premise.statStepsLabel },
    { value: dict.premise.statUpdatedValue, label: dict.premise.statUpdatedLabel },
  ];

  return (
    <section data-section data-theme="light" className="section">
      <div className="band py-24 lg:py-32">
        <p className="text-accent font-label text-eyebrow uppercase">{dict.premise.eyebrow}</p>

        <ScrubY className="mt-8">
          <Reveal
            as="h2"
            lines={[dict.premise.line1, dict.premise.line2, dict.premise.line3]}
            className="font-display text-title font-black uppercase"
          />
        </ScrubY>

        <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:gap-14">
          <p className="text-body opacity-70">{dict.premise.body1}</p>
          <p className="text-body">{dict.premise.body2}</p>
        </div>

        <dl className="mt-16 grid grid-cols-2 gap-px border border-hairline bg-hairline lg:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-surface px-5 py-7">
              <dt className="font-label text-eyebrow uppercase opacity-60">{stat.label}</dt>
              <dd className="mt-3 font-display text-[clamp(2.25rem,4vw,3.25rem)] leading-none font-black">
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Marquee strip (§5.3-5) — the seam between "what we claim" and "how it reads"
// ---------------------------------------------------------------------------

export function MarqueeStrip({ dict, items }: { dict: Dictionary; items: string[] }) {
  return (
    <section data-section data-theme="dark" className="section border-y border-hairline">
      <Marquee items={items} label={dict.marquee.label} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Featured
// ---------------------------------------------------------------------------

export function Featured({
  locale,
  dict,
  cards,
}: {
  locale: Locale;
  dict: Dictionary;
  cards: CatalogCard[];
}) {
  const labels: CardLabels = {
    steps: dict.featured.stepsLabel,
    proBlocks: dict.featured.proBlocksLabel,
    open: dict.featured.open,
    showcase: dict.featured.showcaseLabel,
    loginWall: dict.featured.loginWallLabel,
  };

  const categoryLabel = (key: string) =>
    (dict.category as Record<string, string>)[key] ?? key;
  const difficultyLabel = (key: string) =>
    (dict.difficulty as Record<string, string>)[key] ?? key;

  return (
    <section data-section data-theme="dark" className="section">
      <div className="band py-24 lg:py-32">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4">
          <p className="text-accent font-label text-eyebrow uppercase">{dict.featured.eyebrow}</p>
          <span className="border border-hairline px-3 py-1 font-label text-eyebrow uppercase">
            {dict.featured.badge}
          </span>
        </div>

        <ScrubY className="mt-8">
          <Reveal
            as="h2"
            lines={[dict.featured.line1, dict.featured.line2]}
            className="font-display text-title font-black uppercase"
          />
        </ScrubY>

        <p className="mt-8 max-w-detail text-body opacity-70">{dict.featured.lede}</p>

        {cards.length === 0 ? (
          <div className="mt-14 border border-hairline p-10">
            <p className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[0.95] font-black uppercase">
              {dict.featured.emptyTitle}
            </p>
            <p className="mt-5 max-w-detail text-body opacity-70">{dict.featured.emptyBody}</p>
            <a
              href={signInHref(locale)}
              className="text-accent mt-8 inline-block font-label text-label uppercase"
            >
              <TextSwap>{dict.auth.startWithGoogle} →</TextSwap>
            </a>
          </div>
        ) : (
          <ul className="mt-14 grid gap-6 sm:grid-cols-2">
            {cards.map((card, index) => (
              <li key={card.slug}>
                <PlaybookCard
                  card={card}
                  index={index + 1}
                  locale={locale}
                  categoryLabel={categoryLabel(card.category)}
                  difficultyLabel={difficultyLabel(card.difficulty)}
                  labels={labels}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing summary
// ---------------------------------------------------------------------------

export function planFeatures(dict: Dictionary): { free: string[]; pro: string[] } {
  return {
    free: [dict.pricing.featureStructure, dict.pricing.featureAssets, dict.pricing.featureBilingual],
    pro: [
      dict.pricing.featurePrompts,
      dict.pricing.featureParams,
      dict.pricing.featureCopy,
      dict.pricing.featureWorkflow,
      dict.pricing.featureNotifications,
    ],
  };
}

export function planCopy(dict: Dictionary) {
  return {
    free: dict.plan.free,
    pro: dict.plan.pro,
    freePrice: dict.pricing.freePrice,
    proPrice: dict.pricing.proPrice,
    perMonth: dict.pricing.perMonth,
    freeTagline: dict.pricing.freeTagline,
    proTagline: dict.pricing.proTagline,
    cancelNote: dict.pricing.cancelNote,
    startWithGoogle: dict.auth.startWithGoogle,
  };
}

/** §3.1 "N prompts across M playbooks", computed from the cached catalog projection. */
export function countsLine(dict: Dictionary, locale: Locale, totals: CatalogTotals): string {
  if (totals.playbooks === 0) return dict.pricing.countsEmpty;
  return interpolate(dict.pricing.countsLine, {
    prompts: formatCount(totals.prompts, locale),
    playbooks: formatCount(totals.playbooks, locale),
  });
}

export function PricingSummary({
  locale,
  dict,
  totals,
}: {
  locale: Locale;
  dict: Dictionary;
  totals: CatalogTotals;
}) {
  const features = planFeatures(dict);

  return (
    <section data-section data-theme="light" className="section">
      <div className="band py-24 lg:py-32">
        <p className="text-accent font-label text-eyebrow uppercase">{dict.pricing.eyebrow}</p>

        <ScrubY className="mt-8">
          <Reveal
            as="h2"
            lines={[dict.pricing.line1, dict.pricing.line2]}
            className="font-display text-title font-black uppercase"
          />
        </ScrubY>

        <p className="mt-8 max-w-detail text-body opacity-70">{dict.pricing.lede}</p>
        <p className="mt-3 font-mono text-code opacity-60">{countsLine(dict, locale, totals)}</p>

        <div className="mt-12">
          <PlanCards
            locale={locale}
            copy={planCopy(dict)}
            freeFeatures={features.free}
            proFeatures={features.pro}
          />
        </div>

        <a
          href={`/${locale}/pricing`}
          className="text-accent mt-10 inline-block font-label text-label uppercase"
        >
          <TextSwap>{dict.pricing.compare} →</TextSwap>
        </a>
      </div>
    </section>
  );
}
