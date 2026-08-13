import type { PromptCard } from '@/lib/prompts/catalog';
import { PromptCardView } from './prompt-card';
import { RevealGrid } from '@/components/motion/reveal-grid';
import type { PromptLabels } from './labels';

/**
 * PLAN §13.2 — the two rails, and the masonry wall each of them holds.
 *
 * **Masonry with CSS columns, not a row-span grid.** The choice is about the hover state: a
 * row-span grid needs every card to declare a row count, which means quantising heights, which
 * means either cropping posters or leaving gaps — and `scale(1.03)` inside a grid item that has
 * been given an explicit row span clips against its own track. Columns let each card keep its
 * media's intrinsic ratio, so the zoom happens inside a box that already fits it, at 375, 768,
 * 1024 and 1440 alike. `break-inside: avoid` is what makes a card indivisible.
 *
 * The trade — column-major reading order — is the right one here: this is a gallery to browse, not
 * a sequence to read, and every card is an independent link with its own accessible name.
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
  signinHref,
  upgradeHref,
  now,
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
  signinHref: string;
  upgradeHref: string;
  now?: Date | number;
}) {
  return (
    <section data-rail={id} className="mt-16 first:mt-0 lg:mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-hairline pb-4">
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
          <RevealGrid className="mt-8 gap-6 [column-fill:balance] sm:columns-2 lg:columns-3">
            {cards.map((card) => (
              <li
                key={card.slug}
                data-prompt-item
                data-use-case={card.useCase.join(' ')}
                className="mb-6 break-inside-avoid"
              >
                <PromptCardView
                  card={card}
                  locale={locale}
                  labels={labels}
                  useCaseLabels={useCaseLabels}
                  signinHref={signinHref}
                  upgradeHref={upgradeHref}
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
