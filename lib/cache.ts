import { revalidateTag } from 'next/cache';

/**
 * PLAN §3.1 — landing and pricing are static with tag-based revalidation AND a TTL floor:
 * `revalidateTag('catalog')` on publish, plus `revalidate = 3600` on the pages so a lost
 * invalidation self-heals within the hour. An idempotent "Refresh caches" button in /admin (M4)
 * calls the same function.
 */
export const CATALOG_TAG = 'catalog';

/** Static marketing surfaces re-fetch at most hourly even if every invalidation is lost. */
export const CATALOG_TTL_SECONDS = 3600;

export function revalidateCatalog(): void {
  revalidateTag(CATALOG_TAG);
}

/**
 * PLAN §13.2 — the prompts gallery is `[static + revalidateTag('prompts')]`.
 *
 * A second tag rather than a wider `catalog` one: publishing a playbook and approving a community
 * prompt are different events with different frequencies, and a moderation queue that invalidated
 * the whole marketing tree on every approve would make the busiest write path the most expensive.
 * The landing reads BOTH projections, so it carries both tags and either one refreshes it.
 */
export const PROMPTS_TAG = 'prompts';

export function revalidatePrompts(): void {
  revalidateTag(PROMPTS_TAG);
}
