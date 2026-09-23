import { Reveal, ScrubY } from '@/components/motion/reveal';
import { TextSwap } from '@/components/ui/text-swap';
import { Marquee } from '@/components/ui/marquee';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import type { PromptCard, PromptTotals } from '@/lib/prompts/catalog';
import { templatesHref } from '@/lib/prompts/links';
import { USE_CASES } from '@/lib/prompts/schemas';
import { signInHref } from '@/lib/billing/links';
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
  return signInHref(templatesHref(locale, 'video'), locale);
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

/**
 * Founder pass (2026-08-13): the landing is gallery-first — the reference form puts real cards
 * one scroll below the headline. The hero therefore lost its media panel and its viewport-height
 * ambition: it is a compact type band on a LIGHT surface, and the primary CTA is an anchor to the
 * gallery that starts immediately under it.
 *
 * Design review F3: below lg it sheds the lede and the submit link too — on a 375×667 WebView
 * the full band pushed the first poster under the fold, and a gallery-first landing whose first
 * screen shows zero cards is not gallery-first. The two reappear in `HeroLede`, after the first
 * rail. Same type, same copy; only where they live changes.
 */
/**
 * `showImage` — the second door exists only once there is an image template behind it (founder,
 * 2026-09-11): a hero button that lands on "preparing" is a dead end dressed as a choice.
 */
export function Hero({ locale, dict, showImage = false }: { locale: Locale; dict: Dictionary; showImage?: boolean }) {
  return (
    <section data-section data-theme="light" className="section overflow-hidden">
      <div className="mx-auto max-w-shell px-gutter pt-24 pb-8 lg:pt-36 lg:pb-20">
        <p className="text-accent font-label text-eyebrow uppercase">{dict.hero.eyebrow}</p>
        <Reveal
          immediate
          delay={0.05}
          as="h1"
          lines={[dict.hero.line1, dict.hero.line2, dict.hero.line3]}
          className="mt-7 font-display text-display uppercase"
        />

        <div className="mt-8 flex flex-wrap items-end justify-between gap-x-14 gap-y-6 lg:mt-10">
          <p className="hidden max-w-detail text-body opacity-70 lg:block">{dict.hero.lede}</p>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            {/*
             * The one filled button on the site (2026-08-16). Every other CTA here is an outline,
             * so weight alone says which door is the product: photo in, film out. The catalogue
             * link keeps its outline and stays beside it as the evidence you can read first.
             */}
            <a
              href={templatesHref(locale, 'video')}
              data-hero-video
              className="inline-block bg-accent px-6 py-3 font-label text-label text-white uppercase"
            >
              <TextSwap>{dict.templates.ctaVideo} →</TextSwap>
            </a>
            {showImage && (
              <a
                href={templatesHref(locale, 'image')}
                data-hero-image
                className="inline-block border border-current px-6 py-3 font-label text-label uppercase"
              >
                <TextSwap>{dict.templates.ctaImage} →</TextSwap>
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * F3's other half: the hero copy that left the small-screen first viewport, re-homed after the
 * first rail. `lg:hidden` mirrors the hero's `hidden lg:*` exactly — every reader meets the lede
 * and the submit link once, no width meets them twice.
 */
export function HeroLede({ dict }: { dict: Dictionary }) {
  return (
    <div data-hero-lede className="mt-12 border-t border-hairline pt-6 lg:hidden">
      <p className="max-w-detail text-body opacity-70">{dict.hero.lede}</p>
    </div>
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
  // The landing is STATIC, so the copy button's refusal branches are pre-addressed exactly as
  // they are on the gallery; the server decides which one a given reader actually lands on.
  // §15: the 403 branch is per-card — each card's own page carries the cookie funnel.
  const signin = signInHref(templatesHref(locale, 'video'), locale);

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
              href={templatesHref(locale, 'video')}
              className="text-accent mt-8 inline-block font-label text-label uppercase"
            >
              <TextSwap>{dict.templates.ctaVideo} →</TextSwap>
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
                  />
                </li>
              ))}
            </ul>
            <a
              href={templatesHref(locale, 'video')}
              className="text-accent mt-12 inline-block font-label text-label uppercase"
            >
              <TextSwap>{dict.templates.allVideo} →</TextSwap>
            </a>
          </>
        )}
      </div>
    </section>
  );
}
