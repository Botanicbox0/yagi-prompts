import 'server-only';
import { unstable_cache } from 'next/cache';
import { CATALOG_TTL_SECONDS, PROMPTS_TAG } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
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
 * with no database at all (CI does exactly that).
 */

async function readPromptCatalog(): Promise<PromptCatalog> {
  const sql = await getSqlRunner();
  if (!sql) return EMPTY_PROMPT_CATALOG;
  try {
    return await loadPromptCatalog(sql);
  } catch (err) {
    console.warn(`[prompts] read failed, falling back to the empty catalog: ${String(err)}`);
    return EMPTY_PROMPT_CATALOG;
  }
}

export const getPromptCatalog = unstable_cache(readPromptCatalog, ['prompt-catalog', 'v1'], {
  tags: [PROMPTS_TAG],
  revalidate: CATALOG_TTL_SECONDS,
});
