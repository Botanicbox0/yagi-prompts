import type { ContestCard } from '@/lib/contests/catalog';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { TextSwap } from '@/components/ui/text-swap';
import { ContestCardView } from './contest-card';
import type { ContestLabels } from './labels';

/**
 * PLAN §14.2 — the three phase rails, and the empty state that has to look like a decision.
 *
 * A three-column grid rather than the prompts wall's CSS columns: a contest card carries a title, a
 * summary and a prize line under its poster, so the cards are close to the same height already and
 * a column-major masonry would only scramble the reading order of a list whose ORDER is the point
 * (soonest deadline first). §5.3-6's hover is identical either way — it lives on `.card`.
 */
export function ContestRail({
  id,
  heading,
  lede,
  cards,
  locale,
  labels,
  now,
}: {
  id: string;
  heading: string;
  lede: string;
  cards: ContestCard[];
  locale: string;
  labels: ContestLabels;
  now: Date | number;
}) {
  if (cards.length === 0) return null;

  return (
    <section data-contest-rail={id} className="mt-16 first:mt-0 lg:mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-hairline pb-4">
        {/* §5.2: rail headers are DISPLAY type; globals.css does the KO 0.85× on top. */}
        <h2
          id={`contest-rail-${id}`}
          className="font-display text-[clamp(1.6rem,3.4vw,2.75rem)] leading-[0.92] font-black tracking-tight uppercase"
        >
          {heading}
        </h2>
        <p className="font-mono text-[0.75rem] opacity-55">{lede}</p>
      </div>

      <RevealGrid
        itemSelector="[data-contest-item]"
        className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
      >
        {cards.map((card) => (
          <li key={card.slug} data-contest-item className="flex">
            <ContestCardView card={card} locale={locale} labels={labels} now={now} />
          </li>
        ))}
      </RevealGrid>
    </section>
  );
}

/**
 * §14.2 — "a designed empty state (site is live — empty must look intentional)".
 *
 * The site launched before its first contest existed, so this is the state a real visitor meets
 * today: it has to read as a statement about how contests start here, not as a missing row. It is
 * therefore built like a section and not like a notice — display type, a hairline, a real sentence,
 * and the one CTA that turns an empty page into a lead (the same `hire_click` mailto the footer
 * carries, §3.1).
 */
export function ContestsEmptyState({
  title,
  body,
  cta,
  mailto,
}: {
  title: string;
  body: string;
  cta: string;
  mailto: string;
}) {
  return (
    /**
     * The spacing and the CTA are both from the M9 design review (finding 9): 128px of combined
     * margin+padding above the one statement on an otherwise empty page read as a rendering
     * failure rather than as a decision, and a 14px CTA under 56px display type read as a
     * footnote. 80px of air (64 on a phone), and a CTA with a real touch target under it.
     */
    <section data-contests-empty className="mt-8 border-t border-hairline pt-8 lg:mt-10 lg:pt-10">
      <div className="max-w-detail">
        {/* §5.2 "display lines manually broken" — the KO copy carries its own breaks. */}
        <p className="font-display text-[clamp(2rem,5vw,3.5rem)] leading-[0.92] font-black whitespace-pre-line uppercase">
          {title}
        </p>
        <p className="mt-6 text-body opacity-70">{body}</p>
        <a
          href={mailto}
          className="text-accent mt-9 inline-flex min-h-12 items-center border border-current px-6 py-3.5 font-label text-[1rem] tracking-[0.1em] uppercase"
        >
          <TextSwap>{cta} →</TextSwap>
        </a>
      </div>
    </section>
  );
}

/**
 * §14.2 — the B2B strip. Same shape as the prompts `SubmitStrip`, aimed at the other side of the
 * marketplace: prompts ask a creator for work, contests ask a brand for a brief.
 */
export function ContestHireStrip({
  title,
  body,
  cta,
  mailto,
}: {
  title: string;
  body: string;
  cta: string;
  mailto: string;
}) {
  return (
    <aside data-contest-hire className="mt-16 border border-hairline p-8 sm:p-10">
      <p className="font-display text-[clamp(1.5rem,3vw,2.25rem)] leading-[0.95] font-black uppercase">
        {title}
      </p>
      <p className="mt-4 max-w-detail text-body opacity-70">{body}</p>
      <a
        href={mailto}
        className="text-accent mt-7 inline-block border border-current px-4 py-2 font-label text-eyebrow uppercase"
      >
        <TextSwap>{cta} →</TextSwap>
      </a>
    </aside>
  );
}

/**
 * The one mailto both strips use.
 *
 * Built here rather than in the dictionary so the subject line carries the contest context and the
 * address stays a single literal — the footer's studio enquiry and this one land in the same inbox
 * and must not drift apart.
 */
export const CONTEST_MAILTO =
  'mailto:hello@yagiworkshop.xyz?subject=YAGI%20PROMPTS%20%E2%80%94%20run%20a%20contest%20with%20the%20studio';
