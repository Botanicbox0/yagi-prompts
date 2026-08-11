import type { SqlRunner } from '@/lib/db/sql-runner';
import { loadCatalogRows, type CatalogRow } from './catalog';

/**
 * PLAN §3.2 / §7 — catalog projection #2: the **authenticated** library grid.
 *
 * Deliberately NOT `getPublicCatalog()`: that one is cached under tag `catalog` with a 1h TTL floor
 * and shaped for anonymous marketing surfaces. This one is read per request on a `no-store` route
 * (§3.4) so a freshly published playbook is in the library the moment it lands, and so the row ids
 * the gateway needs never enter a cached artefact.
 *
 * Everything below the loader is pure: filtering, search and facets are functions of (rows, query),
 * which is what makes "server-rendered via query params" testable without a browser.
 * §3.2: sort is **newest only in v1** — there is no sort parameter, by design.
 */

export type LibraryCard = CatalogRow;

export interface LibraryQuery {
  /** Free text over title + summary, BOTH locales (§3.9: the catalog is bilingual, readers aren't). */
  q: string;
  category: string | null;
  difficulty: string | null;
  /** One value matched against tools ∪ models — §3.2 calls it "tool/model tag". */
  tag: string | null;
}

export const EMPTY_QUERY: LibraryQuery = { q: '', category: null, difficulty: null, tag: null };

export interface LibraryFacets {
  categories: string[];
  difficulties: string[];
  tags: string[];
}

type ParamValue = string | string[] | undefined;

function firstValue(value: ParamValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function clean(value: ParamValue, allowed?: readonly string[]): string | null {
  const raw = firstValue(value)?.trim();
  if (!raw) return null;
  if (allowed && !allowed.includes(raw)) return null;
  return raw;
}

export const CATEGORIES = ['image', 'video', 'character', 'voice', 'music', 'pipeline'] as const;
export const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;

/**
 * Query params → a validated query. Unknown categories/difficulties are dropped rather than
 * returning an empty grid: a hand-edited URL should degrade to "no filter", not to "no results".
 */
export function parseLibraryQuery(
  params: Record<string, ParamValue> | undefined,
): LibraryQuery {
  if (!params) return EMPTY_QUERY;
  return {
    q: (firstValue(params.q) ?? '').trim().slice(0, 120),
    category: clean(params.category, CATEGORIES),
    difficulty: clean(params.difficulty, DIFFICULTIES),
    tag: clean(params.tag),
  };
}

export function isFiltered(query: LibraryQuery): boolean {
  return query.q !== '' || query.category !== null || query.difficulty !== null || query.tag !== null;
}

/** Serialise back to a query string, dropping empties — the filter links round-trip through this. */
export function libraryHref(query: Partial<LibraryQuery>, base = '/library'): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.difficulty) params.set('difficulty', query.difficulty);
  if (query.tag) params.set('tag', query.tag);
  const search = params.toString();
  return search.length > 0 ? `${base}?${search}` : base;
}

function haystack(card: LibraryCard): string {
  return [
    card.title.en,
    card.title.ko,
    card.summary.en,
    card.summary.ko,
    card.slug,
    ...card.tools,
    ...card.models,
  ]
    .join(' ')
    .toLowerCase();
}

export function filterLibraryCards(cards: LibraryCard[], query: LibraryQuery): LibraryCard[] {
  const needle = query.q.toLowerCase();
  return cards.filter((card) => {
    if (query.category && card.category !== query.category) return false;
    if (query.difficulty && card.difficulty !== query.difficulty) return false;
    if (query.tag && ![...card.tools, ...card.models].includes(query.tag)) return false;
    if (needle && !haystack(card).includes(needle)) return false;
    return true;
  });
}

/** Facets come from the DATA, not from a hard-coded list: an unused category is not a filter. */
export function libraryFacets(cards: LibraryCard[]): LibraryFacets {
  const categories = new Set<string>();
  const difficulties = new Set<string>();
  const tags = new Set<string>();
  for (const card of cards) {
    categories.add(card.category);
    difficulties.add(card.difficulty);
    for (const tag of card.tools) tags.add(tag);
    for (const tag of card.models) tags.add(tag);
  }
  return {
    // Stable, meaningful order: the domain's own order, not alphabetical.
    categories: CATEGORIES.filter((c) => categories.has(c)),
    difficulties: DIFFICULTIES.filter((d) => difficulties.has(d)),
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
  };
}

export interface LibraryData {
  all: LibraryCard[];
  visible: LibraryCard[];
  facets: LibraryFacets;
  query: LibraryQuery;
}

export async function loadLibrary(sql: SqlRunner, query: LibraryQuery): Promise<LibraryData> {
  const all = await loadCatalogRows(sql);
  return { all, visible: filterLibraryCards(all, query), facets: libraryFacets(all), query };
}

export const EMPTY_LIBRARY: LibraryData = {
  all: [],
  visible: [],
  facets: { categories: [], difficulties: [], tags: [] },
  query: EMPTY_QUERY,
};
