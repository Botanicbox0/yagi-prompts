import 'server-only';
import { unstable_cache } from 'next/cache';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { CATALOG_TTL_SECONDS, CONTESTS_TAG } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { EMPTY_CONTEST_CATALOG, loadContestCatalog, type ContestCatalog } from './catalog';

/**
 * PLAN §14.2 — the cached contest catalog.
 *
 * Exactly the posture `lib/prompts/public-catalog.ts` established, tag `contests` instead of
 * `prompts`, and for exactly the same reason: this is the ONE read the static listing makes, so a
 * tag plus a 1h TTL floor is what lets `/[locale]/contests` stay static and still be correct within
 * the hour if an invalidation is ever lost.
 *
 * The cached VALUE is time-independent by construction (`lib/contests/catalog.ts` stores dates, not
 * phases), so a regeneration re-derives the phase from a fresh clock rather than replaying an old
 * one. That is what makes an hourly TTL an acceptable resolution for a countdown measured in days.
 *
 * No database configured ⇒ the empty catalog, never a throw: `npm run build` must survive a machine
 * with no database at all (CI does exactly that).
 */

async function readContestCatalog(): Promise<ContestCatalog> {
  const sql = await getSqlRunner();
  if (!sql) return EMPTY_CONTEST_CATALOG;
  try {
    return await loadContestCatalog(sql);
  } catch (err) {
    console.warn(`[contests] read failed, falling back to the empty catalog: ${String(err)}`);
    return EMPTY_CONTEST_CATALOG;
  }
}

/** Keyed by runtime mode for the M7 reason: `.next/cache` outlives a data-source switch. */
export const getContestCatalog = unstable_cache(
  readContestCatalog,
  ['contest-catalog', 'v1', resolveRuntimeMode()],
  {
    tags: [CONTESTS_TAG],
    revalidate: CATALOG_TTL_SECONDS,
  },
);
