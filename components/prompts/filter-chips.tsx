'use client';

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { filterHref, readFilterState, type OfferedFilters } from '@/lib/navigation/public-state';
import { cardVisible, facetsFromDataset, hiddenByLook, matchesFilter, type FacetGroup, type FilterState, type ViewerLook } from '@/lib/prompts/facets';
import { FEW_TEMPLATES_THRESHOLD } from '@/lib/template-look/look';
import { useViewerLook } from '@/components/template-look/use-viewer-look';
import { pillClassName } from './pill';

/**
 * PLAN §13.2 — the list filter, done WITHOUT taking the page dynamic.
 *
 * The lists are `[static + revalidateTag('prompts')]`, and reading `searchParams` in a Next 15 page
 * opts it straight out of static rendering — so a server-rendered filter would trade the cache
 * contract for a query string. The filter runs client-side over cards that are ALREADY in the
 * document.
 *
 * 2026-11-24: one filter, driven by facets (lib/prompts/facets.ts). The video list offers NEW and
 * length, the image list its use cases. Every card's `<li>` carries `data-length`, `data-new` and
 * `data-use-case`; the filter is `element.hidden = !match` over the catalogue's OWN rail — never the
 * cast shelves drawn under it on the same page. Nothing is re-fetched or re-rendered, URL state is
 * restored after hydration, and with JavaScript off the chips are hidden and every card stays.
 */

export interface FilterFacetView {
  group: FacetGroup;
  /** The group's accessible name; also the menu pill's label when the group is folded. */
  label: string;
  options: Array<{ value: string; label: string }>;
}

/** TASTE: no chip piles. Past this many chips in the row ("all" included), a group folds into one menu pill. */
export const FILTER_ROW_MAX_CHIPS = 6;

/** Which groups fold: the one with the most options first, until the row fits. */
export function collapsedGroups(facets: readonly FilterFacetView[], max = FILTER_ROW_MAX_CHIPS): Set<FacetGroup> {
  const folded = new Set<FacetGroup>();
  let chips = 1 + facets.reduce((sum, facet) => sum + facet.options.length, 0);
  while (chips > max) {
    const next = facets
      .filter((facet) => !folded.has(facet.group) && facet.options.length > 1)
      .reduce<FilterFacetView | null>((widest, facet) => (widest && widest.options.length > facet.options.length ? widest : facet), null);
    if (!next) break;
    folded.add(next.group);
    chips -= next.options.length - 1;
  }
  return folded;
}

interface FilterItem {
  dataset: Partial<Record<string, string | undefined>>;
  hidden: boolean;
}

export interface FilterRail {
  querySelectorAll(selector: string): ArrayLike<FilterItem> & Iterable<FilterItem>;
  querySelector(selector: string): { hidden: boolean } | null;
}

/** What one pass over a rail found (docs/PERSONAL-STUDIO.md §3.4.10 adds the style counts). */
export interface RailVisibility {
  /** Cards on screen. */
  visible: number;
  /** Cards the chips allow but the viewer's style hides ("다른 스타일도 보기" would bring them back). */
  lookHidden: number;
  /** Cards the viewer's style allows, whatever the chips say (the "few so far" line counts these). */
  lookShown: number;
}

/**
 * THE one pass that sets `hidden` on a rail's cards: `cardVisible` (lib/prompts/facets.ts) decides from the card's
 * facets, the chips and the viewer's style together, so nothing else fights over the attribute. The rail's own "nothing
 * here" line shows when the rail is empty, and its "다른 스타일도 보기" button (drawn only with the switch on) when the
 * style alone emptied it.
 */
export function applyRailVisibility(scope: FilterRail, filter: FilterState, viewer?: ViewerLook | null, itemSelector = '[data-prompt-item]'): RailVisibility {
  let visible = 0;
  let lookHidden = 0;
  let lookShown = 0;
  for (const item of Array.from(scope.querySelectorAll(itemSelector))) {
    const facets = facetsFromDataset(item.dataset);
    item.hidden = !cardVisible(facets, filter, viewer);
    if (!item.hidden) visible += 1;
    const styleHides = hiddenByLook(facets, viewer);
    if (!styleHides) lookShown += 1;
    else if (matchesFilter(facets, filter)) lookHidden += 1;
  }
  const empty = scope.querySelector('[data-rail-filtered-empty]');
  if (empty) empty.hidden = visible > 0;
  const reveal = scope.querySelector('[data-look-reveal]');
  if (reveal) reveal.hidden = !(visible === 0 && lookHidden > 0);
  return { visible, lookHidden, lookShown };
}

/**
 * Shows the matching cards of ONE rail (`[data-rail="<rail>"]`) and returns how many are visible.
 * The rail's own "nothing here" line says so when the filter empties it.
 */
export function applyListFilter(root: { querySelector(selector: string): FilterRail | null }, rail: string, filter: FilterState, viewer?: ViewerLook | null): number {
  const scope = root.querySelector(`[data-rail="${rail}"]`);
  if (!scope) return 0;
  return applyRailVisibility(scope, filter, viewer).visible;
}

/** docs/PERSONAL-STUDIO.md §3.4.10 — the list's style words, handed in only with the switch on. */
export interface ListFilterLook {
  /** "There are only a few men's-style templates so far…", shown under the count only then. */
  few: string;
}

export function ListFilter({
  rail,
  facets,
  labels,
  total,
  look,
}: {
  /** The `data-rail` id of the grid this filter owns. */
  rail: string;
  /** Already localised and already restricted to what the list offers (`listFacets`). */
  facets: FilterFacetView[];
  labels: { heading: string; all: string; count: string; reset: string };
  /** The unfiltered card count, so the count line is in the static HTML before hydration. */
  total: number;
  /** docs/PERSONAL-STUDIO.md §3.4.10 — present only with `TWINGS_TEMPLATE_LOOK=on`; absent, the filter is as before. */
  look?: ListFilterLook;
}) {
  const navigation = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<FilterState>({});
  const [count, setCount] = useState<number>(total);
  const [lookShown, setLookShown] = useState<number>(total);
  const lookOn = Boolean(look);
  const viewer = useViewerLook(lookOn);
  const viewerStyle = viewer?.look ?? null;
  const viewerShowAll = viewer?.showAll ?? false;
  const choosable = facets.length > 0;
  const offered: OfferedFilters = Object.fromEntries(facets.map((facet) => [facet.group, facet.options.map((option) => option.value)]));
  const offeredKey = JSON.stringify(offered);
  const folded = collapsedGroups(facets);
  const active = Object.keys(filter).length > 0;

  useEffect(() => {
    const allowed = JSON.parse(offeredKey) as OfferedFilters;
    const restore = () => setFilter(readFilterState(window.location.search, allowed));
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [offeredKey]);

  const commit = (next: FilterState) => {
    setFilter(next);
    window.history.replaceState(window.history.state, '', filterHref(window.location.href, next, JSON.parse(offeredKey) as OfferedFilters));
  };
  /** Set one group's choice (null clears it); the other groups keep theirs. */
  const choose = (group: FacetGroup, value: string | null) => {
    const next = { ...filter };
    if (value === null) delete next[group];
    else next[group] = value;
    commit(next);
  };

  // A layout effect: with a style chosen, the other style's cards go before the browser paints the hydrated list.
  useLayoutEffect(() => {
    const root = document as unknown as Parameters<typeof applyListFilter>[0];
    const scope = root.querySelector(`[data-rail="${rail}"]`);
    const result = scope ? applyRailVisibility(scope, filter, lookOn ? { look: viewerStyle, showAll: viewerShowAll } : null) : { visible: 0, lookHidden: 0, lookShown: 0 };
    setCount(result.visible);
    setLookShown(result.lookShown);
    return () => { applyListFilter(root, rail, {}); };
  }, [filter, rail, lookOn, viewerStyle, viewerShowAll]);

  useEffect(() => {
    const group = navigation.current;
    if (!group) return;
    const reveal = () => {
      const selected = group.querySelector<HTMLElement>('[aria-pressed="true"], [data-filter-menu][data-active="true"]');
      if (!selected || group.scrollWidth <= group.clientWidth) return;
      const bounds = group.getBoundingClientRect(), item = selected.getBoundingClientRect();
      // Only the chip row moves; restoring a saved filter must not move the page vertically.
      if (item.left < bounds.left + 4) group.scrollLeft += item.left - bounds.left - 4;
      else if (item.right > bounds.right - 4) group.scrollLeft += item.right - bounds.right + 4;
    };
    reveal();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    observer?.observe(group);
    return () => observer?.disconnect();
  }, [filter, offeredKey]);

  const chip = (key: string, label: string, on: boolean, onClick: () => void, option?: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={on}
      data-active={on ? 'true' : 'false'}
      {...(option ? { 'data-filter-option': option } : {})}
      onClick={onClick}
      className={pillClassName(on)}
    >
      {label}
    </button>
  );

  const menu = (facet: FilterFacetView) => {
    const on = filter[facet.group] !== undefined;
    return (
      <span key={facet.group} data-filter-facet={facet.group} data-filter-menu data-active={on ? 'true' : 'false'} className="relative inline-flex shrink-0">
        <select
          aria-label={facet.label}
          value={filter[facet.group] ?? ''}
          onChange={(event) => choose(facet.group, event.target.value || null)}
          className={`${pillClassName(on)} cursor-pointer appearance-none pr-9`}
        >
          <option value="">{facet.label}</option>
          {facet.options.map((option) => (
            <option key={option.value} value={option.value} data-filter-option={`${facet.group}:${option.value}`}>{option.label}</option>
          ))}
        </select>
        <svg aria-hidden="true" viewBox="0 0 12 12" className={`pointer-events-none absolute top-1/2 right-3.5 size-3 -translate-y-1/2 ${on ? 'text-white' : 'text-black/60'}`}>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  };

  // F3: below lg the chips are ONE horizontally-scrollable row — wrapped rows of chips pushed the
  // first card under a 375×667 fold. ≥lg wraps as before.
  return <>
    {/* Without JS every card stays visible, so the server-rendered count is still true; only the
        chips, which could not filter anything, are hidden. */}
    <noscript><style>{'[data-list-filter] [data-filter-row]{display:none}'}</style></noscript>
    <div data-list-filter={choosable ? '' : 'count-only'} className="min-w-0 space-y-3">
      {choosable && (
        <div ref={navigation} role="group" aria-label={labels.heading} data-filter-row className="flex items-center gap-2 overflow-x-auto lg:flex-wrap lg:overflow-x-visible">
          {chip('__all', labels.all, !active, () => commit({}))}
          {facets.map((facet, index) => (
            <Fragment key={facet.group}>
              {index > 0 && <span aria-hidden="true" data-filter-divider className="mx-1 h-5 w-px shrink-0 bg-hairline" />}
              {folded.has(facet.group) ? menu(facet) : (
                // A one-option group (NEW) is its own label; naming the group again would be read twice.
                <div {...(facet.options.length > 1 ? { role: 'group', 'aria-label': facet.label } : {})} data-filter-facet={facet.group} className="flex shrink-0 items-center gap-2">
                  {facet.options.map((option) => {
                    const on = filter[facet.group] === option.value;
                    return chip(option.value, option.label, on, () => choose(facet.group, on ? null : option.value), `${facet.group}:${option.value}`);
                  })}
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
      <div className="flex min-h-6 items-center gap-4 text-xs text-black/55">
        <span data-filter-count role="status" aria-live="polite">{labels.count.replace('{count}', String(count))}</span>
        {active && <button type="button" onClick={() => commit({})} className="min-h-8 text-black underline underline-offset-4">{labels.reset}</button>}
      </div>
      {/* §3.4.10 (women-first): only for the men's style, and only while it shows fewer than three — never a size claim. */}
      {look && viewerStyle === 'male' && !viewerShowAll && lookShown < FEW_TEMPLATES_THRESHOLD && (
        <p data-look-few className="text-xs leading-relaxed text-black/55">{look.few}</p>
      )}
    </div>
  </>;
}
