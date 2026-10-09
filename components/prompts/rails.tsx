import type { PromptCard } from '@/lib/prompts/catalog';
import { PromptCardView } from './prompt-card';
import { RevealGrid } from '@/components/motion/reveal-grid';
import type { PromptLabels } from './labels';

/**
 * Fixed-ratio cards share grid rows. A wrapped title grows its row rather than shifting all
 * subsequent cards in one column, and visual order stays the same as catalog and keyboard order.
 */
export function PromptRail({
  id,
  heading,
  lede,
  cards,
  locale,
  labels,
  useCaseLabels,
  emptyLabel,
  filteredEmptyLabel,
  now,
  topClassName = 'mt-16 first:mt-0 lg:mt-24',
  hideHeading = false,
}: {
  id: string;
  heading: string;
  lede: string;
  cards: PromptCard[];
  locale: string;
  labels: PromptLabels;
  useCaseLabels: Record<string, string>;
  emptyLabel: string;
  filteredEmptyLabel: string;
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
}) {
  return (
    <section data-rail={id} className={topClassName}>
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
        <>
          <RevealGrid className={`${hideHeading ? '' : 'mt-8 '}grid gap-6 sm:grid-cols-2 lg:grid-cols-3`}>
            {cards.map((card) => (
              <li
                key={card.slug}
                data-prompt-item
                data-use-case={card.useCase.join(' ')}
                className="min-w-0"
              >
                <PromptCardView
                  card={card}
                  locale={locale}
                  labels={labels}
                  useCaseLabels={useCaseLabels}
                  {...(now === undefined ? {} : { now })}
                />
              </li>
            ))}
          </RevealGrid>
          {/* Shown by the client filter when it empties this rail; hidden in the static HTML. */}
          <p data-rail-filtered-empty hidden className="mt-2 font-mono text-code opacity-60">
            {filteredEmptyLabel}
          </p>
        </>
      )}
    </section>
  );
}
