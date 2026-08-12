import 'server-only';
import { unstable_cache } from 'next/cache';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { CATALOG_TAG, CATALOG_TTL_SECONDS } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { EMPTY_CATALOG, loadPublicCatalog, type PublicCatalog } from './catalog';

/**
 * PLAN §3.1 / §7 — the cached public catalog.
 *
 * This is the ONE place the static marketing surfaces read data, and the reason they can stay
 * static: `unstable_cache` attaches tag `catalog` + a 1h TTL floor to the read, so
 * `revalidateCatalog()` (publish flow, admin refresh button) invalidates `/[locale]` and
 * `/[locale]/pricing` through it, and a lost invalidation self-heals within the hour.
 *
 * No database configured ⇒ `EMPTY_CATALOG`, never a throw: a marketing page that fails to build
 * is worse than one with no featured cards, and CI builds with no database at all.
 */

async function readCatalog(): Promise<PublicCatalog> {
  const sql = await getSqlRunner();
  if (!sql) return EMPTY_CATALOG;
  try {
    return await loadPublicCatalog(sql);
  } catch (err) {
    console.warn(`[catalog] read failed, falling back to the empty catalog: ${String(err)}`);
    return EMPTY_CATALOG;
  }
}

/**
 * M7 — the runtime mode is part of the cache KEY, not just of the read.
 *
 * `unstable_cache` results persist in `.next/cache` ACROSS BUILDS, so without this a build that
 * switched data sources would serve the previous source's catalog: locally, a cloud build reusing
 * the local fixtures (or the reverse, which breaks the anon sweep); on Vercel, the first deploy
 * after repointing `DATABASE_URL`. Keying by mode makes the two caches disjoint — cheaper, and far
 * less surprising, than remembering to purge.
 */
export const getPublicCatalog = unstable_cache(
  readCatalog,
  ['public-catalog', 'v1', resolveRuntimeMode()],
  {
    tags: [CATALOG_TAG],
    revalidate: CATALOG_TTL_SECONDS,
  },
);
