import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Localized } from '@/lib/content/schemas';
import { publicContentUrl } from '@/lib/content/asset-url';
import { shapeContestMedia, type ContestMediaOptions, type ShapedContestMedia } from './media';
import { countApprovedEntries, loadPublishedContests, type ContestRow } from './repo';
import { comparePhaseOrder, contestPhase, type ContestPhase } from './phase';

/**
 * PLAN §14.2 — the public listing projection.
 *
 * This is `lib/prompts/catalog.ts` for contests and it owns the same one rule: the projection is
 * built by NAMING every field, so there is no spread, no `...row`, and nothing downstream to strip.
 *
 * The rule that is NEW here, and the one that mattered most to get right: **no entry ever enters
 * this projection.** A contest card says how many approved films are in and whether winners have
 * been named — two integers. Not a title, not a handle, not an SNS link. The listing is `[static +
 * tag 'contests']`, so anything on it is served byte-identically to every reader and sits in a CDN;
 * an entrant's SNS handle is a real identity, and the place it is published is the DETAIL page,
 * once, after a human approved it. `tests/contests/catalog.test.ts` pins the exact key set.
 *
 * The second deliberate absence is the PHASE. Phase is a function of the clock, and this projection
 * is cached for up to an hour (§3.1's TTL floor) — baking "open" into cached data would make the
 * cache the thing that decides whether a contest is running. So the cards carry DATES, and
 * `splitByPhase()` is called at render time with a real `now`, which means each ISR regeneration
 * picks up the correct phase.
 */

export interface ContestCard {
  id: string;
  slug: string;
  title: Localized;
  summary: Localized;
  /** §14.2 — "prize set in display type" on the detail; the card carries it as the hook. */
  prize: Localized;
  brandName: string;
  brandUrl: string | null;
  poster: ShapedContestMedia | null;
  startsAt: string | null;
  deadlineAt: string | null;
  publishedAt: string | null;
  /** Approved entries only. A count, never a row. */
  entryCount: number;
  /** 1–3 when placements exist; drives the "winners announced" marker on a closed card. */
  winnerCount: number;
}

export interface ContestTotals {
  published: number;
  open: number;
  upcoming: number;
  closed: number;
  entries: number;
}

export interface ContestCatalog {
  contests: ContestCard[];
  totals: Omit<ContestTotals, 'open' | 'upcoming' | 'closed'>;
}

export const EMPTY_CONTEST_CATALOG: ContestCatalog = {
  contests: [],
  totals: { published: 0, entries: 0 },
};

export interface ContestCatalogOptions extends ContestMediaOptions {}

/** One row → one card. The ONLY place a `ContestCard` is constructed. */
export function toContestCard(
  row: ContestRow,
  counts: { approved: number; winners: number } = { approved: 0, winners: 0 },
  options: ContestCatalogOptions = {},
): ContestCard {
  const { poster } = shapeContestMedia(row.id, row.media, {
    publicUrl: options.publicUrl ?? publicContentUrl,
    ...(options.mediaUrl ? { mediaUrl: options.mediaUrl } : {}),
  });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    prize: row.prize,
    brandName: row.brandName,
    brandUrl: row.brandUrl,
    poster,
    startsAt: row.startsAt,
    deadlineAt: row.deadlineAt,
    publishedAt: row.publishedAt,
    entryCount: counts.approved,
    winnerCount: counts.winners,
  };
}

export async function loadContestCatalog(
  sql: SqlRunner,
  options: ContestCatalogOptions = {},
): Promise<ContestCatalog> {
  const rows = await loadPublishedContests(sql);
  const counts = await countApprovedEntries(sql);
  const contests = rows.map((row) => toContestCard(row, counts.get(row.id), options));

  return {
    contests,
    totals: {
      published: contests.length,
      entries: contests.reduce((sum, card) => sum + card.entryCount, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// phase split — called at RENDER time, never at cache time
// ---------------------------------------------------------------------------

export interface PhasedContests {
  open: ContestCard[];
  upcoming: ContestCard[];
  closed: ContestCard[];
  totals: ContestTotals;
}

/**
 * §14.2 — "open first, then upcoming, then closed", each rail in its own meaningful order
 * (`comparePhaseOrder`). One pass, so a card can only ever land in one rail.
 */
export function splitByPhase(catalog: ContestCatalog, now: Date | number): PhasedContests {
  const buckets: Record<ContestPhase, ContestCard[]> = { open: [], upcoming: [], closed: [] };
  for (const card of catalog.contests) {
    buckets[contestPhase(card, now)].push(card);
  }
  for (const phase of ['open', 'upcoming', 'closed'] as const) {
    buckets[phase].sort((a, b) => comparePhaseOrder(phase, a, b));
  }
  return {
    ...buckets,
    totals: {
      published: catalog.totals.published,
      entries: catalog.totals.entries,
      open: buckets.open.length,
      upcoming: buckets.upcoming.length,
      closed: buckets.closed.length,
    },
  };
}
