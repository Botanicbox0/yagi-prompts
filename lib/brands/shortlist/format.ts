import type { ShortlistCriteria, ShortlistCriteriaKey, ShortlistMetrics } from './schema';

/**
 * How the shortlist reads its figures (docs/BRAND-SHORTLIST.md). Browser-safe: no server imports.
 * Unknown is always "—", never 0.
 */
export const SHORTLIST_UNKNOWN = '—';
const tag = (locale: string) => (locale === 'ko' ? 'ko-KR' : 'en-US');

/** Followers and views: exact below ten thousand (`9,042`), compact above (`3.9만`, `39K`). */
export function shortlistCount(value: number | undefined, locale: string): string {
  if (value == null) return SHORTLIST_UNKNOWN;
  if (value < 10_000) return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 0 }).format(value);
  return new Intl.NumberFormat(tag(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
/** Averages keep one decimal where the source had one (`9.3` posts, `4.2` comments). */
export function shortlistAverage(value: number | undefined, locale: string): string {
  if (value == null) return SHORTLIST_UNKNOWN;
  if (value >= 10_000) return shortlistCount(value, locale);
  return new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 1 }).format(value);
}
export function shortlistPercent(value: number | undefined, locale: string): string {
  if (value == null) return SHORTLIST_UNKNOWN;
  return `${new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 2 }).format(value)}%`;
}
/** `2026-10-27` → `10월 27일` / `Oct 27`. */
export function shortlistDay(day: string, locale: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat(tag(locale), { month: locale === 'ko' ? 'long' : 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

/**
 * A comma-separated sheet Excel opens with Korean intact (the byte order mark) and as plain data: text
 * that Excel would read as a formula starts with an apostrophe. Figures stay raw numbers so they sort.
 */
export function shortlistCsv(columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const cell = (value: string | number | null | undefined) => {
    if (value == null) return '';
    if (typeof value === 'number') return String(value);
    const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${[columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

export type ShortlistSort = 'followers' | 'views' | 'engagement';
export const SHORTLIST_SORTS: readonly ShortlistSort[] = ['followers', 'views', 'engagement'];
/** The figure each sort compares; the higher of feed and Reels rates for engagement. */
export function shortlistSortValue(metrics: ShortlistMetrics, sort: ShortlistSort): number | null {
  if (sort === 'followers') return metrics.followers ?? null;
  if (sort === 'views') return metrics.viewsMedian90d ?? null;
  const rates = [metrics.feedEngagementRate, metrics.reelsEngagementRate].filter((n): n is number => n != null);
  return rates.length ? Math.max(...rates) : null;
}
/** Biggest first, unknown last, then by handle so the order never jitters. */
export function sortShortlist<T extends { handle: string; metrics: ShortlistMetrics }>(list: readonly T[], sort: ShortlistSort): T[] {
  return [...list].sort((a, b) => {
    const x = shortlistSortValue(a.metrics, sort), y = shortlistSortValue(b.metrics, sort);
    if (x !== y) {
      if (x == null) return 1;
      if (y == null) return -1;
      return y - x;
    }
    return a.handle.localeCompare(b.handle);
  });
}

/** The triage ranges, in the order the studio's list shows them (the same keys as `SHORTLIST_CRITERIA_KEYS`). */
export const SHORTLIST_DIMENSIONS = ['followers', 'views', 'engagement', 'adShare'] as const satisfies readonly ShortlistCriteriaKey[];
/** Rates are compared in percent; counts on a log scale where a histogram is drawn. */
export const shortlistIsRate = (key: ShortlistCriteriaKey) => key === 'engagement' || key === 'adShare';
/** The figure each triage range reads: followers, median views, the higher engagement rate, sponsored share. */
export function shortlistDimension(metrics: ShortlistMetrics, key: ShortlistCriteriaKey): number | null {
  if (key === 'followers') return metrics.followers ?? null;
  if (key === 'views') return metrics.viewsMedian90d ?? null;
  if (key === 'engagement') return shortlistSortValue(metrics, 'engagement');
  return metrics.adShare ?? null;
}

export type ShortlistFit = 'in' | 'out' | 'unknown';
/**
 * Where a candidate stands against the ranges: outside any one → `out`; inside all → `in`; a range
 * whose figure is missing → `unknown`, which the studio decides by hand. No ranges → null.
 */
export function shortlistFit(metrics: ShortlistMetrics, criteria: ShortlistCriteria | null | undefined): ShortlistFit | null {
  const ranges = Object.entries(criteria ?? {}).filter(([, r]) => r && (r.min != null || r.max != null)) as Array<[ShortlistCriteriaKey, { min?: number | null; max?: number | null }]>;
  if (ranges.length === 0) return null;
  let unknown = false;
  for (const [key, r] of ranges) {
    const value = shortlistDimension(metrics, key);
    if (value == null) { unknown = true; continue; }
    if ((r.min != null && value < r.min) || (r.max != null && value > r.max)) return 'out';
  }
  return unknown ? 'unknown' : 'in';
}

export function shortlistMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export type ShortlistTag = 'views' | 'organic' | 'engagement' | 'steady';
/**
 * Up to three plain labels a brand can check against the figures on the same card: median views at
 * 60 % of followers or more, engagement 1.3 times the shortlist's median or more, sponsored share
 * 15 % or less, 10 or more posts of one kind in 30 days.
 */
export function shortlistTags(metrics: ShortlistMetrics, medianEngagement: number | null): ShortlistTag[] {
  const tags: ShortlistTag[] = [];
  const { followers, viewsMedian90d, adShare, feedPosts30d, reelsPosts30d } = metrics;
  if (followers && viewsMedian90d != null && viewsMedian90d >= followers * 0.6) tags.push('views');
  const engagement = shortlistSortValue(metrics, 'engagement');
  if (engagement != null && medianEngagement && engagement >= medianEngagement * 1.3) tags.push('engagement');
  if (adShare != null && adShare <= 15) tags.push('organic');
  if (Math.max(feedPosts30d ?? 0, reelsPosts30d ?? 0) >= 10) tags.push('steady');
  return tags.slice(0, 3);
}
