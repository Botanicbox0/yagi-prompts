import { FACET_GROUPS, type FacetGroup, type FilterState } from '@/lib/prompts/facets';

/** URL state stays in the client so the public catalog can keep its shared static HTML. */

/** The query parameter each filter group owns (`?new=1&length=short&style=mine`, the image list's `?useCase=`). */
const FILTER_PARAMS: Record<FacetGroup, string> = { new: 'new', length: 'length', style: 'style', useCase: 'useCase' };

/** What a list offers right now, per group — anything else in a URL is ignored. */
export type OfferedFilters = Partial<Record<FacetGroup, readonly string[]>>;

export function readFilterState(search: string, offered: OfferedFilters): FilterState {
  const params = new URLSearchParams(search);
  const state: FilterState = {};
  for (const group of FACET_GROUPS) {
    const value = params.get(FILTER_PARAMS[group]);
    if (value && offered[group]?.includes(value)) state[group] = value;
  }
  return state;
}

/**
 * Rewrites only the filter params: every group's param is cleared, then the offered choices are set
 * in group order. Other params and the fragment stay; a param this list does not offer (a legacy
 * `?useCase=` on the video list) goes on the first interaction.
 */
export function filterHref(href: string, state: FilterState, offered: OfferedFilters): string {
  const url = new URL(href);
  for (const group of FACET_GROUPS) url.searchParams.delete(FILTER_PARAMS[group]);
  for (const group of FACET_GROUPS) {
    const value = state[group];
    if (value && offered[group]?.includes(value)) url.searchParams.set(FILTER_PARAMS[group], value);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readUseCase(search: string, options: readonly string[]): string | null {
  const value = new URLSearchParams(search).get('useCase');
  return value && options.includes(value) ? value : null;
}

export function useCaseHref(href: string, value: string | null, options: readonly string[]): string {
  const url = new URL(href);
  if (value && options.includes(value)) url.searchParams.set('useCase', value);
  else url.searchParams.delete('useCase');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Section links match their fragment; page links also match genuine descendant routes. */
export function isPublicNavCurrent(href: string, pathname: string | null, hash: string): boolean {
  if (!pathname || !href.startsWith('/') || href.startsWith('//')) return false;
  const destination = new URL(href, 'https://twings.app');
  const clean = (path: string) => path.replace(/\/+$/, '') || '/';
  const target = clean(destination.pathname);
  const current = clean(pathname);
  if (destination.hash) return target === current && destination.hash === hash;
  return target === current || (target !== '/' && current.startsWith(`${target}/`));
}
