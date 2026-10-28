import type { PromptCard, PromptOrigin } from '@/lib/prompts/catalog';
import { PromptCardView } from './prompt-card';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { railOrder } from './card-frame';
import type { PromptLabels } from './labels';

/**
 * Fixed-ratio cards share grid rows. A wrapped title grows its row rather than shifting all
 * subsequent cards in one column, and visual order stays the same as catalog and keyboard order.
 *
 * docs/PLATFORM-2.0.md §15.6 (founder 2026-10-28): every card is the same 4:5 frame, two columns
 * on a phone and four from a tablet up — no three-column step, so a rail that fills a desktop row
 * also fills phone rows. NEW cards lead the rail; the rest keep the catalog's featured → newest
 * order. The use-case and origin chips that filtered this grid are gone (§15.6), so every card is
 * always in the HTML and always visible.
 */
export function PromptRail({
  id,
  heading,
  lede,
  cards,
  locale,
  labels,
  emptyLabel,
  now,
  topClassName = 'mt-16 first:mt-0 lg:mt-24',
  hideHeading = false,
  origin,
}: {
  id: string;
  heading: string;
  lede: string;
  cards: PromptCard[];
  locale: string;
  labels: PromptLabels;
  /** Kept for callers that still pass it; no card prints use cases and nothing filters by them. */
  useCaseLabels?: Record<string, string>;
  emptyLabel: string;
  /** Kept for callers that still pass it; with no filter, a rail never empties on screen. */
  filteredEmptyLabel?: string;
  now?: Date | number;
  /**
   * The rail's OWN top rhythm, owned by the page (F3): the landing tightens its first rail on
   * mobile so a card makes the 375×667 first viewport, the gallery keeps the default. A single
   * replaceable string rather than an appended class — two competing `mt-*` utilities would
   * resolve by stylesheet order, not by intent.
   */
  topClassName?: string;
  /** The catalog already has a visible page title and introduction. Keep its rail label accessible. */
  hideHeading?: boolean;
  /** docs/PLATFORM-2.0.md §7.5 — which origin this rail holds (a marker; nothing hides rails any more). */
  origin?: PromptOrigin;
}) {
  return (
    <section data-rail={id} data-rail-origin={origin} className={topClassName}>
      <div className={hideHeading ? 'sr-only' : 'flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-hairline pb-4'}>
        {/* §5.2: rail headers are DISPLAY type, and the KO variant is a different string rather
            than the same one at a smaller size (globals.css does the 0.85× on top). */}
        <h2
          id={`rail-${id}`}
          className="font-display text-[clamp(1.6rem,3.4vw,2.75rem)] leading-[0.92] font-black tracking-tight uppercase"
        >
          {heading}
        </h2>
        <p className="font-mono text-[0.75rem] opacity-55">{lede}</p>
      </div>

      {cards.length === 0 ? (
        <p className="mt-8 font-mono text-code opacity-60">{emptyLabel}</p>
      ) : (
        <RevealGrid className={`${hideHeading ? '' : 'mt-8 '}grid grid-cols-2 items-start gap-x-3 gap-y-6 sm:gap-x-4 md:grid-cols-4 md:gap-y-8`}>
          {railOrder(cards, now).map((card) => (
            <li key={card.slug} data-prompt-item className="min-w-0">
              <PromptCardView card={card} locale={locale} labels={labels} {...(now === undefined ? {} : { now })} />
            </li>
          ))}
        </RevealGrid>
      )}
    </section>
  );
}
