import type { Dictionary } from '@/lib/i18n/dictionaries';
import type { ShortlistCandidate } from './service';
import type { ShortlistChoice, ShortlistMetricKey } from './schema';

type Copy = Dictionary['brandWorkspace']['shortlist'];
type Cell = { value: string | number; type?: typeof String | typeof Number; fontWeight?: 'bold' } | null;

export const SHORTLIST_EXPORT_FILE = 'twings-creator-shortlist.xlsx';

export function shortlistStatus(c: ShortlistCandidate, choice: ShortlistChoice, copy: Copy): string {
  if (c.confirmed) return copy.tabs.confirmed;
  return choice === 'picked' ? copy.tabs.picked : choice === 'passed' ? copy.tabs.passed : copy.tabs.open;
}

/** Every figure the card shows, under the words the card uses. Rates are percentages, as on screen. */
function metricColumns(copy: Copy): ReadonlyArray<readonly [ShortlistMetricKey, string]> {
  const { perMonth, engagement, rate } = copy.columns;
  const { likes, comments } = copy.exportColumns;
  const kind = (prefix: 'feed' | 'ad' | 'reels', label: string) => [
    [`${prefix}Posts30d`, `${label} ${perMonth}`],
    [`${prefix}Engagement`, `${label} ${engagement}`],
    [`${prefix}EngagementRate`, `${label} ${rate} (%)`],
    [`${prefix}Likes`, `${label} ${likes}`],
    [`${prefix}Comments`, `${label} ${comments}`],
  ] as const;
  return [
    ['followers', copy.followers], ['following', copy.following], ['posts', copy.posts],
    ['viewsMedian90d', copy.viewsMedian], ['viewsMax90d', copy.viewsMax], ['adShare', `${copy.adShare} (%)`],
    ...kind('feed', copy.rows.feed), ...kind('reels', copy.rows.reels), ...kind('ad', copy.rows.ads),
  ];
}

const text = (value: string | null): Cell => (value ? { value, type: String } : null);

/**
 * One sheet of every candidate the brand can see, with the mark as it stands on screen. Built only from
 * what the page already received: no picture, no internal id, no fee or recruiting detail. Unknown is an
 * empty cell, never 0. Names are written as text cells, so a handle cannot become a formula.
 */
export function shortlistSheet(candidates: readonly ShortlistCandidate[], choices: ReadonlyMap<string, ShortlistChoice>, copy: Copy): Cell[][] {
  const metrics = metricColumns(copy);
  const { name, handle, profile, category, status, measuredOn } = copy.exportColumns;
  const header = [name, handle, profile, category, status, ...metrics.map(([, label]) => label), measuredOn];
  return [
    header.map((value): Cell => ({ value, type: String, fontWeight: 'bold' })),
    ...candidates.map((c): Cell[] => [
      text(c.displayName),
      text(`@${c.handle}`),
      text(`https://www.instagram.com/${c.handle}/`),
      text(c.category),
      text(shortlistStatus(c, choices.get(c.id) ?? 'none', copy)),
      ...metrics.map(([key]): Cell => {
        const value = c.metrics[key];
        return value == null ? null : { value, type: Number };
      }),
      text(c.measuredOn),
    ]),
  ];
}
