import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { Locale } from '@/lib/i18n/config';
import type { PromptCard, PromptCatalog } from '@/lib/prompts/catalog';
import type { TemplateMedium } from '@/lib/prompts/schemas';
import { templatesHref } from '@/lib/prompts/links';
import { PromptCardView } from '@/components/prompts/prompt-card';
import { promptLabels } from '@/components/prompts/labels';

/**
 * docs/PLATFORM-2.0.md §3.2-4 — "기다리는 동안 다른 포맷 보기". A few minutes is long enough to
 * choose the next one; the same 4:5 cards as the catalog, so a clip plays here too.
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
      <ul className="mt-5 grid grid-cols-2 items-start gap-x-3 gap-y-6 sm:gap-x-4 lg:grid-cols-4">
        {cards.map((card) => (
          <li key={card.slug} className="min-w-0">
            <PromptCardView card={card} locale={locale} labels={labels} />
          </li>
        ))}
      </ul>
    </section>
  );
}
