import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import { castShelfSize, type CastSection, type CastShelf } from '@/lib/prompts/catalog';
import { TEMPLATE_MEDIA, USE_CASES, type TemplateMedium } from '@/lib/prompts/schemas';
import { castHref } from '@/lib/prompts/links';
import { PromptRail } from '@/components/prompts/rails';
import { pillClassName } from '@/components/prompts/pill';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';

/**
 * docs/CAST-CATEGORIES.md §5 — one cast's templates (반려동물과 함께 · 둘이서), split by what they
 * produce into two labelled rails, 영상 then 이미지. Three placements, one component:
 *
 *   · `home`    — a section under the home gallery: up to `HOME_CAST_CARDS` per medium and a "모두 보기"
 *                 link to the cast page;
 *   · `listing` — under the `/video` or `/image` grid: that medium's rail only, and the same link;
 *   · `page`    — the cast page itself (`/{locale}/pet`, `/{locale}/couple`): every card, both rails,
 *                 a pill row that jumps between them when both exist.
 *
 * A medium with no published template draws no rail, and a cast with none draws NOTHING — no empty
 * shelf in production. Couples never reach here while their flag is off: the catalogue already
 * dropped them (lib/prompts/catalog.ts), so their shelf is empty.
 */
export const HOME_CAST_CARDS = 4;

export function CastShelfSection({
  locale,
  dict,
  cast,
  shelf,
  mode,
  medium,
}: {
  locale: Locale;
  dict: Dictionary;
  cast: CastSection;
  shelf: CastShelf;
  mode: 'home' | 'listing' | 'page';
  /** `listing` only: the tab's medium. */
  medium?: TemplateMedium;
}) {
  const copy = dict.cast[cast];
  const media = TEMPLATE_MEDIA.filter((value) => shelf[value].length > 0 && (mode !== 'listing' || value === medium));
  if (media.length === 0 || castShelfSize(shelf) === 0) return null;
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const href = castHref(locale, cast);
  const Heading = mode === 'page' ? 'h1' : 'h2';
  const railId = (value: TemplateMedium) => `cast-${cast}-${value}`;

  return (
    <section
      data-cast-section={cast}
      data-cast-mode={mode}
      aria-labelledby={`cast-${cast}-title`}
      className={mode === 'page' ? '' : 'mt-14 border-t border-hairline pt-8 lg:mt-20'}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="max-w-xl">
          <Heading id={`cast-${cast}-title`} className={mode === 'page' ? 'audience-title' : 'audience-heading'}>
            {copy.title}
          </Heading>
          <p className="mt-3 text-sm leading-relaxed text-black/65">{copy.lede}</p>
        </div>
        {mode !== 'page' && (
          <a href={href} data-cast-see-all={cast} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">
            {copy.seeAll} ↗
          </a>
        )}
      </div>

      {/* Both media on the page: one pill row that says what is below and jumps there (the medium tabs' look). */}
      {mode === 'page' && media.length > 1 && (
        <nav aria-label={dict.cast.railsLabel} data-cast-jump className="mt-5 flex gap-2">
          {media.map((value) => (
            <a key={value} href={`#${railId(value)}`} data-cast-jump-to={value} className={pillClassName(false)}>
              {dict.cast[value]} <span className="ml-1 tabular-nums opacity-55">{shelf[value].length}</span>
            </a>
          ))}
        </nav>
      )}

      {media.map((value) => {
        const cards = mode === 'home' ? shelf[value].slice(0, HOME_CAST_CARDS) : shelf[value];
        return (
          <div key={value} id={railId(value)} data-cast-rail={`${cast}-${value}`} className="mt-8 scroll-mt-24 first-of-type:mt-6">
            {/* The split is the first thing read: a plain label over each rail, its count beside it. */}
            <h3 className="flex items-baseline gap-2 text-sm font-semibold text-black/85">
              {dict.cast[value]}
              <span className="text-xs font-normal tabular-nums text-black/50">{shelf[value].length}</span>
            </h3>
            <PromptRail
              id={railId(value)}
              heading={`${copy.title} · ${dict.cast[value]}`}
              lede={copy.lede}
              cards={cards}
              locale={locale}
              labels={labels}
              useCaseLabels={useCaseLabels}
              emptyLabel={copy.lede}
              filteredEmptyLabel={dict.prompts.filterEmpty}
              hideHeading
              topClassName="mt-3"
            />
          </div>
        );
      })}
    </section>
  );
}
