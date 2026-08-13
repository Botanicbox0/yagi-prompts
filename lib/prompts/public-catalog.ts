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
export const getPromptCatalog = unstable_cache(
  readPromptCatalog,
  ['prompt-catalog', 'v1', resolveRuntimeMode()],
  {
    tags: [PROMPTS_TAG],
    revalidate: CATALOG_TTL_SECONDS,
  },
);
