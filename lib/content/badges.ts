/**
 * PLAN §3.5 — "In-app: NEW/UPDATED badges for everyone (badges are marketing for the toggle)."
 *
 * Pure date logic over two facts the catalog projection already knows:
 *
 *   `firstPublishedAt` — the playbook's DEBUT: the oldest `published_at` across its revisions.
 *                        Not the current revision's, which moves on every rewrite and would make
 *                        a two-year-old playbook read as NEW the day it was corrected.
 *   `updatedAt`        — when the CURRENT revision was published, but only when that revision
 *                        carries a change note. A change note is exactly what a republication is
 *                        required to have (§6 publish gate), so it is the honest marker of "this
 *                        was rewritten" rather than "this row was touched".
 *
 * The two windows overlap on purpose, and NEW wins: a playbook that debuted and was corrected in
 * the same fortnight is still, to a reader, new. §3.5 v1 has **no per-user read state** — these are
 * facts about the catalog, identical for everyone, which is why they can live on a cached
 * projection at all.
 */

export const BADGE_WINDOW_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlaybookBadge = 'new' | 'updated';

export interface BadgeInput {
  firstPublishedAt: string | null;
  updatedAt: string | null;
  /** Injectable clock — the truth table is tested against fixed instants, never against `Date.now`. */
  now?: Date | number;
  windowDays?: number;
}

function withinWindow(iso: string | null, now: number, windowMs: number): boolean {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  // A future timestamp (clock skew between the app and the database) counts as recent rather than
  // as absent — the alternative is a freshly published playbook silently losing its badge.
  return now - at < windowMs;
}

export function badgeFor(input: BadgeInput): PlaybookBadge | null {
  const now = typeof input.now === 'number' ? input.now : (input.now ?? new Date()).getTime();
  const windowMs = (input.windowDays ?? BADGE_WINDOW_DAYS) * DAY_MS;

  if (withinWindow(input.firstPublishedAt, now, windowMs)) return 'new';
  if (withinWindow(input.updatedAt, now, windowMs)) return 'updated';
  return null;
}
