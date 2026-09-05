import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { PromptCard } from '@/lib/prompts/catalog';
import { TEMPLATE_MEDIA, USE_CASES, type TemplateMedium } from '@/lib/prompts/schemas';
import { templatesHref } from '@/lib/prompts/links';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptRail } from '@/components/prompts/rails';
import { UseCaseFilter } from '@/components/prompts/filter-chips';
import { promptLabels, presentUseCases, useCaseLabel } from '@/components/prompts/labels';

/**
 * docs/TEMPLATES-IA.md §2 — one listing, two tabs. `/video` and `/image` render this with their
 * medium; the tabs are plain links so the pages stay static and the URL says which tab is open.
 *
 * Nothing on this surface varies by viewer (no gated text anywhere any more), so the whole thing is
 * cached HTML shared by everyone — the same cache posture the prompts gallery had, for a simpler
 * reason. The use-case filter is client-side over the DOM, exactly as before.
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
          className={[
            'inline-block border px-4 py-2 font-label text-label uppercase',
            medium === active ? 'border-accent bg-accent text-white' : 'border-current',
          ].join(' ')}
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
}: {
  locale: Locale;
  dict: Dictionary;
  medium: TemplateMedium;
  cards: PromptCard[];
}) {
  const t = dict.templates[medium];
  const labels = promptLabels(dict);
  const useCaseLabels = Object.fromEntries(USE_CASES.map((value) => [value, useCaseLabel(dict, value)]));
  const present = presentUseCases([...new Set(cards.flatMap((card) => card.useCase))].sort());
  const filterOptions = present.map((value) => [value, useCaseLabels[value]!] as [string, string]);
  const other: TemplateMedium = medium === 'video' ? 'image' : 'video';

  return (
    <div className="band pt-28 pb-24 lg:pt-32">
      <p className="text-accent font-label text-eyebrow uppercase">{dict.templates.eyebrow}</p>
      <h1 className="mt-6 font-display text-title font-black uppercase">
        <span className="block">{t.line1}</span>
        <span className="block">{t.line2}</span>
      </h1>
      <p className="mt-8 max-w-detail text-body opacity-70">{t.intro}</p>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-hairline pt-6">
        <MediumTabs locale={locale} dict={dict} active={medium} />
        {filterOptions.length > 0 && (
          <UseCaseFilter options={filterOptions} labels={{ heading: dict.prompts.filterHeading, all: dict.prompts.filterAll }} />
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
          filteredEmptyLabel={dict.prompts.filterEmpty}
          topClassName="mt-10 lg:mt-14"
        />
      )}
    </div>
  );
}
