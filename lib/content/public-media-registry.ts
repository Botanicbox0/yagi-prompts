import type { SqlRunner } from '@/lib/db/sql-runner';
import { publicMediaR2Config } from '@/lib/runtime-mode';
import { readVerifiedPublicMediaKeys } from '@/lib/storage/public-media-ledger';
import { PUBLIC_MEDIA_KEYS } from './public-media-keys';

/**
 * docs/BRAND-MOAT-AND-STORAGE.md — which `public-content` keys may be served from the media host right
 * now: the list in code, plus the keys the app has copied and verified since (`public_media_copies`).
 *
 * `publicContentUrl` is synchronous and runs mid-render, so it reads the last answer held here. A stale
 * answer is safe because a key it does not know yet goes to Supabase, where the original stays. That is
 * why only keys in the code list may lose their originals, never keys found only in the table. The
 * database is never asked during `next build`, and not at all until the R2 keys exist: a statement
 * error costs a pooled connection, which is what failed builds ran out of (`lib/db/connect-shared.ts`).
 *
 * On `globalThis` for the same reason as `lib/db/connect.ts`: every route must share one answer.
 */
const REFRESH_MS = 60_000;

interface Registry {
  keys: ReadonlySet<string>;
  loadedAt: number;
}

const shared = globalThis as { __twingsPublicMedia?: Registry };
const registry = (): Registry => (shared.__twingsPublicMedia ??= { keys: PUBLIC_MEDIA_KEYS, loadedAt: 0 });

function enabled(): boolean {
  return process.env.NEXT_PHASE !== 'phase-production-build' && publicMediaR2Config() !== null;
}

/**
 * Await this where the answer is about to be stored or sent. `force` is for filling a cached document,
 * which outlives this process by up to an hour, so it must not be built from a minute-old answer.
 */
export async function refreshPublicMediaKeys(sql: SqlRunner | null, options: { force?: boolean } = {}): Promise<void> {
  if (sql === null || !enabled()) return;
  const state = registry();
  if (!options.force && Date.now() - state.loadedAt < REFRESH_MS) return;
  state.loadedAt = Date.now();
  try {
    state.keys = new Set([...PUBLIC_MEDIA_KEYS, ...(await readVerifiedPublicMediaKeys(sql))]);
  } catch {
    console.warn('[public-media] could not read the verified keys, keeping the last answer');
  }
}

/** The answer for a synchronous caller. When it is old, the next caller gets a newer one. */
export function copiedPublicMediaKeys(): ReadonlySet<string> {
  const state = registry();
  if (enabled() && Date.now() - state.loadedAt >= REFRESH_MS) {
    state.loadedAt = Date.now();
    void import('@/lib/db/connect')
      .then(({ getSqlRunner }) => getSqlRunner())
      .then((sql) => refreshPublicMediaKeys(sql, { force: true }))
      .catch(() => undefined);
  }
  return state.keys;
}

/** Test seam. */
export function resetPublicMediaKeys(): void {
  delete shared.__twingsPublicMedia;
}
