import { describe, expect, it, vi } from 'vitest';
import { readPublicProjection } from '@/lib/db/read-policy';
import { EMPTY_PROMPT_CATALOG } from '@/lib/prompts/catalog';
import { EMPTY_CONTEST_CATALOG } from '@/lib/contests/catalog';
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * Design review F4 — the public catalogs' outage policy.
 *
 * The old behaviour swallowed EVERY read failure into the designed empty catalog, and ISR then
 * cached that for an hour as if it were intentional: a database outage rendered — and kept
 * serving — a hollow site. The policy this pins is the split that matters:
 *
 *   · `sql === null`  the runtime DELIBERATELY has no database (§11 placeholder env; CI's bare
 *                     `next build`) — the designed empty state is the truthful render;
 *   · a CONFIGURED database that fails  ⇒ the read THROWS, so a background ISR revalidation
 *     keeps serving the last good page (Next discards a revalidation whose render throws) and a
 *     cold build fails loudly instead of shipping a hollow site.
 */

const runner: SqlRunner = {
  query: () => Promise.resolve({ rows: [] }),
  transaction: () => Promise.reject(new Error('unused')),
};

describe('readPublicProjection (F4)', () => {
  it('yields the designed empty catalog when the runtime has no database at all', async () => {
    const load = vi.fn();
    await expect(readPublicProjection(null, EMPTY_PROMPT_CATALOG, load)).resolves.toBe(
      EMPTY_PROMPT_CATALOG,
    );
    // No runner, no read: the empty state is a decision, not a swallowed failure.
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects when a configured database fails to read — never the empty catalog', async () => {
    const outage = new Error('connection refused');
    await expect(
      readPublicProjection(runner, EMPTY_PROMPT_CATALOG, () => Promise.reject(outage)),
    ).rejects.toBe(outage);
  });

  it('passes a successful read through untouched', async () => {
    const catalog = { ...EMPTY_PROMPT_CATALOG, totals: { ...EMPTY_PROMPT_CATALOG.totals } };
    await expect(
      readPublicProjection(runner, EMPTY_PROMPT_CATALOG, () => Promise.resolve(catalog)),
    ).resolves.toBe(catalog);
  });

  it('holds for the contests catalog under the same policy', async () => {
    await expect(
      readPublicProjection(null, EMPTY_CONTEST_CATALOG, () => Promise.reject(new Error('x'))),
    ).resolves.toBe(EMPTY_CONTEST_CATALOG);
    await expect(
      readPublicProjection(runner, EMPTY_CONTEST_CATALOG, () => Promise.reject(new Error('down'))),
    ).rejects.toThrow('down');
  });
});
