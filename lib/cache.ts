import { revalidatePath, revalidateTag } from 'next/cache';

/**
 * Tag AND path, together (2026-08-14, found with the first real content). Locally `next start`
 * honours tag→route invalidation, so the sweeps were green — but on Vercel the first real publish
 * sat invisible behind the prerendered landing until the 1h TTL: `revalidateTag` emptied the DATA
 * cache while the FULL-ROUTE cache of the static pages kept serving the old HTML. The fix is to
 * name the routes too. The list is the §4 route table's static public surfaces, spelled per
 * locale because `revalidatePath` takes concrete paths, not patterns.
 */
function revalidateStaticSurfaces(rests: readonly string[]): void {
  for (const locale of ['en', 'ko']) {
    for (const rest of rests) revalidatePath(`/${locale}${rest}`);
  }
}

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
  revalidateStaticSurfaces(['', '/pricing']);
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
  // The landing carries the rails and the pricing page carries the counts (§13.2/§15.3).
  revalidateStaticSurfaces(['', '/prompts', '/pricing']);
}

/**
 * PLAN §14.2 — the contests listing is `[static + tag 'contests']`.
 *
 * A third tag on the same reasoning as the second: publishing a contest, approving an entry and
 * naming a winner all move the listing and nothing else, while a playbook publish or a prompt
 * approval must not. The moderation queue is the busiest write path here, and it would be the
 * strangest thing on the site if approving one film re-rendered the whole marketing tree.
 */
export const CONTESTS_TAG = 'contests';

export function revalidateContests(): void {
  revalidateTag(CONTESTS_TAG);
  revalidateStaticSurfaces(['/contests']);
}
