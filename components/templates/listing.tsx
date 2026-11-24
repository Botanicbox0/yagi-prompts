import type { ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { PromptCard } from '@/lib/prompts/catalog';
import { TEMPLATE_MEDIA, USE_CASES, type TemplateMedium } from '@/lib/prompts/schemas';
import { templatesHref } from '@/lib/prompts/links';
import { listFacets, type FacetGroup } from '@/lib/prompts/facets';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptRail } from '@/components/prompts/rails';
import { ListFilter, type FilterFacetView } from '@/components/prompts/filter-chips';
import { promptLabels, useCaseLabel } from '@/components/prompts/labels';
import { pillClassName } from '@/components/prompts/pill';
import { templateLookOpen } from '@/lib/flags';
import { TemplateLookIsland } from '@/components/template-look/look-island';

/**
 * docs/TEMPLATES-IA.md §2 — one listing, two tabs. `/video` and `/image` render this with their
 * medium; the tabs are plain links so the pages stay static and the URL says which tab is open.
 *
 * Nothing on this surface varies by viewer (no gated text anywhere any more), so the whole thing is
 * cached HTML shared by everyone — the same cache posture the prompts gallery had, for a simpler
 * reason. The filter is client-side over the DOM.
 *
 * First screen (docs/PLATFORM-2.0.md §15.3-5): title → medium pills → filter pills (only when
 * there is a choice) and the count → the cards. The service definition follows the grid.
 *
 * 2026-11-24 (founder, second time): the video list filters by what a buyer knows about the film —
 * NEW and its length — never by the image side's genre chips. The image list keeps its use cases
 * (lib/prompts/facets.ts).
 *
 * §7.5 (founder 2026-10-30): ONE grid. TWINGS originals and AI creatives' templates are ranked
 * together and mixed by `railOrder`; a creative's card says `by @handle` and nothing else marks
 * the difference. No origin rails, no origin chips — a reader picks a format, not who made it.
 */
export function MediumTabs({ locale, dict, active }: { locale: Locale; dict: Dictionary; active: TemplateMedium }) {
  return (
    <nav aria-label={dict.templates.tabsLabel} data-medium-tabs className="flex gap-2">
      {TEMPLATE_MEDIA.map((medium) => (
        <a
          key={medium}
          href={templatesHref(locale, medium)}
          data-medium-tab={medium}
          aria-current={medium === active ? 'page' : undefined}
          className={pillClassName(medium === active)}
        >
          {dict.nav[medium]}
        </a>
      ))}
    </nav>
  );
}

export function TemplatesListing({
  locale,
  dict,
  medium,
  cards,
  after,
  now,
}: {
  locale: Locale;
  dict: Dictionary;
  medium: TemplateMedium;
  cards: PromptCard[];
  /** docs/CAST-CATEGORIES.md §5 — the pet and couple shelves for this medium, between the grid and the definition. */
  after?: ReactNode;
  /** Injectable clock for NEW (the badge, the order and the filter read the same one). */
  now?: Date | number;
}) {
  const t = dict.templates[medium];
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const other: TemplateMedium = medium === 'video' ? 'image' : 'video';
  const p = dict.prompts;
  const groupLabel: Record<FacetGroup, string> = { new: p.filterNew, length: p.filterLength, style: p.filterStyle, useCase: p.filterHeading };
  const optionLabel = (group: FacetGroup, value: string): string => {
    if (group === 'new') return p.filterNew;
    if (group === 'length') return value === 'short' ? p.filterLengthShort : value === 'mid' ? p.filterLengthMid : p.filterLengthLong;
    if (group === 'style') return value === 'mine' ? p.filterStyleMine : p.filterStyleStyled;
    return useCaseLabels[value] ?? value;
  };
  const facets: FilterFacetView[] = listFacets(cards, medium, now).map((facet) => ({
    group: facet.group,
    label: groupLabel[facet.group],
    options: facet.options.map((option) => ({ value: option.value, label: optionLabel(facet.group, option.value) })),
  }));
  // docs/PERSONAL-STUDIO.md §3.4.10 — the template style, only with the switch on: the chip filter folds it into its own
  // pass for the grid, the style island takes the cast shelves under it. Off, neither prop nor island exists.
  const look = templateLookOpen();

  return (
    <div data-template-catalog={medium} className="audience-shell pt-24 pb-20 lg:pt-28">
      <h1 className="audience-title">{t.rail}</h1>

      <div className="mt-5 space-y-4">
        <MediumTabs locale={locale} dict={dict} active={medium} />
        {cards.length > 0 && (
          <ListFilter rail={medium} facets={facets} total={cards.length} labels={{ heading: p.filterRowLabel, all: p.filterAll, count: p.filterCount, reset: p.filterReset }} {...(look ? { look: { few: dict.templateLook.few } } : {})} />
        )}
      </div>

      {cards.length === 0 ? (
        <div data-templates-empty={medium} className="mt-14 border border-hairline p-10">
          <p className="font-display text-[clamp(1.75rem,3vw,2.5rem)] leading-[0.95] font-black uppercase">{t.emptyTitle}</p>
          <p className="mt-5 max-w-detail text-body opacity-70">{t.emptyBody}</p>
          <a href={templatesHref(locale, other)} className="text-accent mt-8 inline-block font-label text-label uppercase">
            <TextSwap>{dict.templates[other].seeCta} →</TextSwap>
          </a>
        </div>
      ) : (
        <PromptRail
          id={medium}
          heading={t.rail}
          lede={t.railLede}
          cards={cards}
          locale={locale}
          labels={labels}
          useCaseLabels={useCaseLabels}
          emptyLabel={t.emptyTitle}
          filteredEmptyLabel={p.filterNone}
          hideHeading
          topClassName="mt-4"
          {...(now === undefined ? {} : { now })}
        />
      )}

      {after}

      {/* §15.3-5: the GEO definition ("TWINGS는 …") stays in the HTML for search and llms.txt
          readers, but under the grid — the first screen is the formats themselves. */}
      <p data-service-definition className="mt-16 max-w-2xl border-t border-hairline pt-6 text-sm leading-relaxed text-black/60">{dict.seo.definition}</p>
      {look && <TemplateLookIsland copy={dict.templateLook} scope={{ exclude: cards.length > 0 ? [medium] : [] }} />}
    </div>
  );
}
