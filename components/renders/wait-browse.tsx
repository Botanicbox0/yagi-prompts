import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { PromptCard, PromptCatalog } from '@/lib/prompts/catalog';
import type { TemplateMedium } from '@/lib/prompts/schemas';
import { templatesHref } from '@/lib/prompts/links';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { CARD_GRID_GAP, cardFrame, pairCards } from '@/components/prompts/card-frame';
import { promptLabels } from '@/components/prompts/labels';

/**
 * docs/PLATFORM-2.0.md §3.2-4 — "기다리는 동안 다른 포맷 보기". A few minutes is long enough to
 * choose the next one; the same cards and grid as the catalog (4:5, wide templates as a two-column
 * tile), so a clip plays here too.
 */
export const WAIT_BROWSE_LIMIT = 4;

/** Same medium first (catalog order), topped up from the other; never the template being made. */
export function pickWaitCards(
  catalog: Pick<PromptCatalog, 'video' | 'image'>,
  { medium, exclude, limit = WAIT_BROWSE_LIMIT }: { medium: TemplateMedium; exclude: string; limit?: number },
): PromptCard[] {
  const same = (medium === 'video' ? catalog.video : catalog.image) ?? [];
  const other = (medium === 'video' ? catalog.image : catalog.video) ?? [];
  return [...same, ...other].filter((card) => card.slug !== exclude).slice(0, limit);
}

export function WaitBrowse({ cards, locale, dict }: { cards: PromptCard[]; locale: Locale; dict: Dictionary }) {
  if (cards.length === 0) return null;
  const w = dict.renders.wait;
  const labels = promptLabels(dict);
  return (
    <section data-render-browse className="mt-14 border-t border-hairline pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="text-lg font-semibold">{w.browseTitle}</h2>
        <a href={templatesHref(locale, 'video')} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">
          {w.browseAll} ↗
        </a>
      </div>
      <ul className={`mt-5 grid grid-cols-2 items-start gap-y-6 ${CARD_GRID_GAP} lg:grid-cols-4`}>
        {pairCards(cards).map((card) => {
          const frame = cardFrame(card);
          return (
            <li key={card.slug} className={frame === 'wide' ? 'col-span-2 min-w-0' : 'min-w-0'}>
              <PromptCardView card={card} locale={locale} labels={labels} frame={frame} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
