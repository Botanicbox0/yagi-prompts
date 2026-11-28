import type { CSSProperties } from 'react';
import type { PromptCard } from '@/lib/prompts/catalog';
import { PromptCardView } from './prompt-card';
import { RevealGrid } from '@/components/motion/reveal-grid';
import { cardRatio, railOrder } from './card-frame';
import { cardFacets, lookAttribute } from '@/lib/prompts/facets';
import { templateLookOpen } from '@/lib/flags';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { DEFAULT_LOCALE, isLocale } from '@/lib/i18n/config';
import type { PromptLabels } from './labels';

/**
 * Founder 2026-10-31: justified rows (`.film-rows`). Each card keeps its film's own ratio, every
 * card in a row is one height, and visual order stays the same as catalog and keyboard order.
 *
 * The order is `railOrder`: recommended first, unranked NEW templates after the lead, originals and
 * AI creatives mixed (§7.5).
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
  linkAuthor,
  anchorOffset = false,
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
  /** Passed to PromptCardView when a surface should suppress author links (e.g., own profile). */
  linkAuthor?: boolean;
  /** The heading is an in-page anchor target under the fixed header (the profile tabs). Off = the markup every other page has always had. */
  anchorOffset?: boolean;
}) {
  // docs/PERSONAL-STUDIO.md §3.4.10 — with the switch on, every card says who it is written for (`data-look`) and the
  // rail carries the "다른 스타일도 보기" button the style island shows when the viewer's style alone empties it. With
  // the switch off neither exists, so the markup is exactly as before.
  const look = templateLookOpen() ? { reveal: getDictionary(isLocale(locale) ? locale : DEFAULT_LOCALE).templateLook.reveal } : null;
  return (
    <section data-rail={id} className={topClassName}>
      <div className={hideHeading ? 'sr-only' : 'flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-hairline pb-4'}>
        {/* §5.2: rail headers are DISPLAY type, and the KO variant is a different string rather
            than the same one at a smaller size (globals.css does the 0.85× on top). */}
        <h2
          id={`rail-${id}`}
          className={`${anchorOffset ? 'scroll-mt-24 ' : ''}font-display text-[clamp(1.6rem,3.4vw,2.75rem)] leading-[0.92] font-black tracking-tight uppercase`}
        >
          {heading}
        </h2>
        {/* Sentences are set in the body face; mono is for spec labels only (docs/design/IDENTITY.md §3). */}
        <p className="text-sm text-muted">{lede}</p>
      </div>

      {cards.length === 0 ? (
        <p className="mt-8 text-sm text-muted">{emptyLabel}</p>
      ) : (
        <>
          <RevealGrid className={`${hideHeading ? '' : 'mt-8 '}film-rows`}>
            {railOrder(cards, now).map((card) => {
              // The buyer facts the list filter reads back (lib/prompts/facets.ts); an unknown
              // length is an empty band, shown under "all" only.
              const facets = cardFacets(card, now);
              return (
                <li
                  key={card.slug}
                  data-prompt-item
                  data-use-case={facets.useCase.join(' ')}
                  data-length={facets.length ?? ''}
                  data-new={facets.new ? 'true' : 'false'}
                  data-cast={facets.cast}
                  // docs/PERSONAL-STUDIO.md §3.4.9 (S2): only a card that declares its styling carries it.
                  {...(facets.style ? { 'data-style': facets.style } : {})}
                  {...(look ? { 'data-look': lookAttribute(facets) } : {})}
                  style={{ '--r': cardRatio(card) } as CSSProperties}
                >
                  <PromptCardView
                    card={card}
                    locale={locale}
                    labels={labels}
                    useCaseLabels={useCaseLabels}
                    {...(now === undefined ? {} : { now })}
                    {...(linkAuthor === undefined ? {} : { linkAuthor })}
                  />
                </li>
              );
            })}
          </RevealGrid>
          {/* Shown by the client filter when it empties this rail; hidden in the static HTML. */}
          <p data-rail-filtered-empty hidden className="mt-2 text-sm text-muted">
            {filteredEmptyLabel}
          </p>
          {look && (
            <button type="button" data-look-reveal hidden className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-[#CC1573] underline underline-offset-4">
              {look.reveal}
            </button>
          )}
        </>
      )}
    </section>
  );
}
