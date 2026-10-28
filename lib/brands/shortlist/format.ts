import type { ShortlistMetrics } from './schema';

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
