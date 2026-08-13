import { Reveal, ScrubY } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { Marquee } from '@/components/ui/marquee';
import { HeroMedia } from './hero-media';
import { ReelPoster } from './reel-poster';
import { PlanCards } from '@/components/pricing/plan-cards';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { HERO_REEL } from '@/lib/content/slots';
import { formatCount, interpolate } from '@/lib/i18n/format';
import type { PromptCard, PromptTotals } from '@/lib/prompts/catalog';
import { promptsHref, PROMPT_SUBMIT_PATH } from '@/lib/prompts/links';
import { USE_CASES } from '@/lib/prompts/schemas';
import { UPGRADE_PATH, signInHref } from '@/lib/billing/links';
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

/** §13.2 — the nav pivot moved the default destination from the library to the gallery. */
function startHref(locale: Locale): string {
  return signInHref(promptsHref(locale), locale);
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
              {/* §13 pivots the primary CTA: the gallery IS the product now, and it is public —
                  asking for a login before showing the work would be the old funnel, backwards. */}
              <a
                href={promptsHref(locale)}
                className="inline-block border border-current px-6 py-3 font-label text-label uppercase"
              >
                <TextSwap>{dict.nav.prompts} →</TextSwap>
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

/** §13.2 — the premise section is now the 100% original manifesto, and the two rails explained. */
export function Premise({ dict, totals }: { dict: Dictionary; totals: PromptTotals }) {
  const stats: Array<{ value: string; label: string }> = [
    { value: String(totals.yagi), label: dict.premise.statYagiLabel },
    { value: String(totals.community), label: dict.premise.statCommunityLabel },
    { value: totals.modelLabel, label: dict.premise.statModelLabel },
    { value: dict.premise.statTestedValue, label: dict.premise.statTestedLabel },
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
              <dd className="text-stat mt-3 font-display font-black">
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

/** §13.2 — "featured strip = YAGI prompt cards (from the prompts catalog)". */
export function Featured({
  locale,
  dict,
  cards,
}: {
  locale: Locale;
  dict: Dictionary;
  cards: PromptCard[];
}) {
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(
    USE_CASES.map((value) => [value, useCaseLabel(dict, value)]),
  );
  // The landing is STATIC, so the copy button's refusal branches are pre-addressed exactly as they
  // are on the gallery; the server decides which one a given reader actually lands on.
  const signin = signInHref(promptsHref(locale), locale);
  const upgrade = `${UPGRADE_PATH}?locale=${locale}`;

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
              href={PROMPT_SUBMIT_PATH}
              className="text-accent mt-8 inline-block font-label text-label uppercase"
            >
              <TextSwap>{dict.prompts.submitCta} →</TextSwap>
            </a>
          </div>
        ) : (
          <>
            <ul className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((card) => (
                <li key={card.slug}>
                  <PromptCardView
                    card={card}
                    locale={locale}
                    labels={labels}
                    useCaseLabels={useCaseLabels}
                    signinHref={signin}
                    upgradeHref={upgrade}
                  />
                </li>
              ))}
            </ul>
            <a
              href={promptsHref(locale)}
              className="text-accent mt-12 inline-block font-label text-label uppercase"
            >
              <TextSwap>{dict.prompts.backToGallery} →</TextSwap>
            </a>
          </>
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

/**
 * §13.2 — the counts line, now over the two rails.
 *
 * M1 counted "N prompts across M playbooks" from the playbook catalog; the pivot makes the two
 * rails the honest headline number, and it comes from the SAME cached projection the gallery reads
 * so the two can never disagree.
 */
export function countsLine(dict: Dictionary, locale: Locale, totals: PromptTotals): string {
  if (totals.published === 0) return dict.pricing.countsEmpty;
  return interpolate(dict.pricing.countsLine, {
    yagi: formatCount(totals.yagi, locale),
    community: formatCount(totals.community, locale),
  });
}

export function PricingSummary({
  locale,
  dict,
  totals,
}: {
  locale: Locale;
  dict: Dictionary;
  totals: PromptTotals;
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
