/**
 * PLAN §14.1 — "Phase is derived server-side: upcoming (< starts) / open (starts ≤ now < deadline)
 * / closed (≥ deadline)."
 *
 * Pure: no database, no session, no env, no `Date.now()` of its own — `now` is always a parameter,
 * so the boundaries are unit-testable to the millisecond and a render is reproducible.
 *
 * **Why the phase is not stored.** A stored phase needs something to flip it, which means a cron,
 * which means a second source of truth that is wrong between ticks. Deriving it costs two
 * comparisons and is right at every instant.
 *
 * **Why the countdown is calendar days, not hours.** `/[locale]/contests` is `[static + tag
 * 'contests']` with the site-wide 1h TTL floor (§3.1), so anything on that page can lag reality by
 * up to an hour. A live "4h 12m" chip would therefore be a lie for most of its life. A UTC
 * calendar-day D-day is stable across a whole cache window except at one boundary per day, and it
 * is the countdown Korean readers actually expect ("D-7"). The timezone is UTC, stated here and in
 * the admin form, and it matches `formatDate()`'s `timeZone: 'UTC'` so the chip and the printed
 * deadline can never disagree.
 */

export const CONTEST_PHASES = ['upcoming', 'open', 'closed'] as const;
export type ContestPhase = (typeof CONTEST_PHASES)[number];

/** The listing's rail order (§14.2: "open first, then upcoming, then closed"). */
export const PHASE_RAIL_ORDER: readonly ContestPhase[] = ['open', 'upcoming', 'closed'];

export interface ContestDates {
  /** ISO instant, or null on a draft that has not been dated yet. */
  startsAt: string | null;
  deadlineAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function instant(iso: string | null): number | null {
  if (iso === null) return null;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? null : value;
}

function asMillis(now: Date | number): number {
  return typeof now === 'number' ? now : now.getTime();
}

/**
 * The three-way derivation, with the two boundaries decided explicitly:
 *   · `now === startsAt`  ⇒ **open**   (§14.1's `starts ≤ now`)
 *   · `now === deadlineAt` ⇒ **closed** (§14.1's `≥ deadline`)
 *
 * Undated drafts: no `starts_at` means nothing has begun, so `upcoming`; a start with no deadline
 * means nothing ends it, so `open`. A published contest always has both (DB CHECK), so these two
 * branches only ever describe drafts inside the admin preview.
 */
export function contestPhase(dates: ContestDates, now: Date | number): ContestPhase {
  const at = asMillis(now);
  const starts = instant(dates.startsAt);
  const deadline = instant(dates.deadlineAt);

  if (starts === null || at < starts) return 'upcoming';
  if (deadline !== null && at >= deadline) return 'closed';
  return 'open';
}

/** Midnight UTC of the day an instant falls in — the unit the D-day chip counts. */
function utcDay(millis: number): number {
  return Math.floor(millis / DAY_MS);
}

/**
 * Whole UTC calendar days from `now` to `target`. Same day ⇒ 0; yesterday ⇒ -1.
 *
 * Floor-of-epoch-days rather than `Date.UTC(...)` arithmetic: it is one division, it cannot drift
 * on a leap second, and (because both operands are floored first) an entry made at 23:59 and one
 * made at 00:01 the next day never round to the same answer.
 */
export function daysBetweenUtc(target: string | null, now: Date | number): number | null {
  const at = instant(target);
  if (at === null) return null;
  return utcDay(at) - utcDay(asMillis(now));
}

export interface ContestTiming {
  phase: ContestPhase;
  /**
   * Whole UTC days to the instant that matters IN THIS PHASE — the start when upcoming, the
   * deadline when open. `null` when closed (there is nothing left to count to) or undated.
   */
  daysRemaining: number | null;
  /**
   * `D-7` / `D-DAY`, or null. Deliberately NOT localized: "D-7" is the same glyph sequence in both
   * dictionaries and turning it into a translated sentence would make the chip a paragraph.
   */
  dDay: string | null;
}

export function contestTiming(dates: ContestDates, now: Date | number): ContestTiming {
  const phase = contestPhase(dates, now);
  const target = phase === 'upcoming' ? dates.startsAt : phase === 'open' ? dates.deadlineAt : null;
  const daysRemaining = daysBetweenUtc(target, now);

  return {
    phase,
    daysRemaining,
    // A negative count would mean the phase said one thing and the clock another; return null
    // rather than render "D--1".
    dDay:
      daysRemaining === null || daysRemaining < 0
        ? null
        : daysRemaining === 0
          ? 'D-DAY'
          : `D-${daysRemaining}`,
  };
}

/**
 * §14.2 rail ordering, inside each phase:
 *   open      → soonest deadline first (the one you can still miss)
 *   upcoming  → soonest start first    (the one that opens next)
 *   closed    → latest deadline first  (the most recent result)
 *
 * Ties break on slug so a page rendered twice is the same page.
 */
export function comparePhaseOrder<T extends ContestDates & { slug: string }>(
  phase: ContestPhase,
  a: T,
  b: T,
): number {
  const key = phase === 'upcoming' ? 'startsAt' : 'deadlineAt';
  const left = instant(a[key]) ?? Number.POSITIVE_INFINITY;
  const right = instant(b[key]) ?? Number.POSITIVE_INFINITY;
  if (left !== right) return phase === 'closed' ? right - left : left - right;
  return a.slug.localeCompare(b.slug);
}
