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
