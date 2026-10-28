import type { Locale } from '@/lib/i18n/config';
import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { PromptCard } from '@/lib/prompts/catalog';
import { TEMPLATE_MEDIA, type TemplateMedium } from '@/lib/prompts/schemas';
import { templatesHref } from '@/lib/prompts/links';
import { TextSwap } from '@/components/ui/text-swap';
import { PromptRail } from '@/components/prompts/rails';
import { promptLabels } from '@/components/prompts/labels';

/**
 * docs/TEMPLATES-IA.md §2 — one listing, two tabs. `/video` and `/image` render this with their
 * medium; the tabs are plain links so the pages stay static and the URL says which tab is open.
 *
 * Nothing on this surface varies by viewer (no gated text anywhere any more), so the whole thing is
 * cached HTML shared by everyone — the same cache posture the prompts gallery had, for a simpler
 * reason.
 *
 * First screen (docs/PLATFORM-2.0.md §15.6, founder 2026-10-28): title → the medium tabs → the
 * cards. The use-case chips and the "전체 · 오리지널 · 메이커" chips are gone: the founder judged that
 * they added nothing, and the rails already say where a template comes from. The service
 * definition follows the grid.
 *
 * §7.5·§14.1: the cards split by origin — "TWINGS 오리지널" first, then the maker collection. With
 * no maker template neither the second rail nor the rail headings appear.
 */
export function MediumTabs({ locale, dict, active }: { locale: Locale; dict: Dictionary; active: TemplateMedium }) {
  // Text tabs on a hairline, like the site nav's current-page underline — not a pair of buttons.
  // The active tab's 2px rule sits on the hairline (`-mb-px`); the other reads at 4.5:1 or better.
  return (
    <nav aria-label={dict.templates.tabsLabel} data-medium-tabs className="flex gap-7 border-b border-hairline">
      {TEMPLATE_MEDIA.map((medium) => {
        const on = medium === active;
        return (
          <a
            key={medium}
            href={templatesHref(locale, medium)}
            data-medium-tab={medium}
            aria-current={on ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 text-[0.95rem] font-semibold transition-colors duration-200 ${on ? 'border-black text-black' : 'border-transparent text-black/55 hover:text-black'}`}
          >
            {dict.nav[medium]}
          </a>
        );
      })}
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
  const other: TemplateMedium = medium === 'video' ? 'image' : 'video';
  const studio = cards.filter((card) => card.origin !== 'maker');
  const makers = cards.filter((card) => card.origin === 'maker');
  const split = makers.length > 0;
  const tt = dict.templates;
  const railProps = { locale, labels, emptyLabel: t.emptyTitle };

  return (
    <div data-template-catalog={medium} className="band pt-24 pb-20 lg:pt-28">
      <h1 className="font-display text-[clamp(2.25rem,5vw,4rem)] leading-tight font-black tracking-tight">{t.rail}</h1>

      <div className="mt-6">
        <MediumTabs locale={locale} dict={dict} active={medium} />
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
        <>
          {studio.length > 0 && (
            <PromptRail
              id={medium}
              origin="studio"
              heading={split ? tt.studioRail : t.rail}
              lede={split ? tt.studioRailLede : t.railLede}
              cards={studio}
              {...railProps}
              hideHeading={!split}
              topClassName={split ? 'mt-10' : 'mt-8'}
            />
          )}
          {split && (
            <PromptRail
              id={`${medium}-makers`}
              origin="maker"
              heading={tt.makerRail}
              lede={tt.makerRailLede}
              cards={makers}
              {...railProps}
              topClassName={studio.length > 0 ? 'mt-16 lg:mt-20' : 'mt-10'}
            />
          )}
        </>
      )}

      {/* §15.3-5: the GEO definition ("TWINGS는 …") stays in the HTML for search and llms.txt
          readers, but under the grid — the first screen is the formats themselves. */}
      <p data-service-definition className="mt-16 max-w-2xl border-t border-hairline pt-6 text-sm leading-relaxed text-black/60">{dict.seo.definition}</p>
    </div>
  );
}
