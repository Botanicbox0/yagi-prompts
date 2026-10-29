import 'server-only';
import { unstable_cache } from 'next/cache';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { CATALOG_TTL_SECONDS, PROMPTS_TAG } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { readPublicProjection } from '@/lib/db/read-policy';
import { EMPTY_PROMPT_CATALOG, loadPromptCatalog, type PromptCatalog } from './catalog';

/**
 * PLAN §13.2 — the cached prompt catalog.
 *
 * Exactly the posture `lib/content/public-catalog.ts` established for playbooks, and for exactly
 * the same reason: this is the ONE read the static surfaces make, so tag `prompts` + a 1h TTL floor
 * is what lets `/[locale]/prompts` and the landing stay static and still be correct within the hour
 * if an invalidation is ever lost.
 *
 * No database configured ⇒ the empty catalog, never a throw: `npm run build` must survive a machine
 * with no database at all (CI does exactly that). A CONFIGURED database that fails to read throws
 * instead — the F4 policy (`lib/db/read-policy.ts`): stale-good beats cached-empty.
 */

async function readPromptCatalog(): Promise<PromptCatalog> {
  return readPublicProjection(await getSqlRunner(), EMPTY_PROMPT_CATALOG, loadPromptCatalog);
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
/**
 * The VERSION moves with the projection's SHAPE, not just with the data source (2026-08-15).
 *
 * `modelLabel: string` became `modelLabels: string[]` and the build crashed on
 * `undefined.join(...)` — a v1 entry rendered by v2 code. The identical trap caught the contests
 * catalog the same morning, which is the whole argument for writing it on both: a cache that
 * outlives a deploy also outlives a type. **Bump this string in the same commit as any change to
 * `PromptCard`.**
 */
/**
 * 2026-10-21 (`v4-price-5pct`): prices changed in the database, not in `PromptCard`'s shape, and the
 * Vercel data cache carried the old catalog straight into the next deployment — the template pages
 * kept showing 8,900원 while checkout charged the new server price, the one mismatch a PG review
 * rejects outright ("상품 금액과 결제 금액이 상이"). The edge-cache purge API is not available on
 * this plan, and the admin "Refresh caches" button revalidates `catalog`, not `prompts`. A bulk
 * price change made outside the admin form needs this bump too.
 */
/** 2026-10-26 (`v8-prom-queen-hero-restored`): `you-are-a-prom-queen` 16:9 featured hero & `city-fashion-montage` 4:3 dimensions. */
/** 2026-10-29 (`v10-fashion-show-arrival`): `@yunseolfromseoul` maker profile & `fashion-show-arrival` template. */
export const getPromptCatalog = unstable_cache(
  readPromptCatalog,
  ['prompt-catalog', 'v10-fashion-show-arrival', resolveRuntimeMode()],
  {
    tags: [PROMPTS_TAG],
    revalidate: CATALOG_TTL_SECONDS,
  },
);
