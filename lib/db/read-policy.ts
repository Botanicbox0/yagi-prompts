import type { SqlRunner } from './sql-runner';

/**
 * Design review F4 — the outage policy shared by every cached public projection.
 *
 * Extracted from the prompts/contests `public-catalog.ts` readers (which are `server-only` +
 * `next/cache` and therefore unimportable in vitest) so the policy itself is testable:
 *
 *   · `sql === null`  the runtime DELIBERATELY has no database (§11 placeholder env, CI's bare
 *     `next build`) — the designed empty catalog is the truthful render, and the build must
 *     survive it;
 *   · a CONFIGURED database that fails must THROW. `unstable_cache` never stores a rejected
 *     read, a background ISR revalidation whose render throws keeps the last good page on the
 *     air, and a cold build fails loudly — the alternative was an hour of "designed empty"
 *     cached over a live catalog, which is an outage dressed as a decision.
 */
export async function readPublicProjection<T>(
  sql: SqlRunner | null,
  empty: T,
  load: (sql: SqlRunner) => Promise<T>,
): Promise<T> {
  if (sql === null) return empty;
  return load(sql);
}
