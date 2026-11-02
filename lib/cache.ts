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
 * docs/PLATFORM-2.0.md §7.5 — a maker turned their profile on or off, or changed handle. The credit
 * on every card and template page moves with tag `prompts`; the maker's own page (old and new
 * address) is named too so a turned-off profile stops answering at once.
 */
export function revalidateMakerProfile(handles: readonly string[]): void {
  revalidatePrompts();
  revalidateStaticSurfaces(['/video', '/image', ...handles.map((handle) => `/makers/${handle}`)]);
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

/**
 * docs/CAMPAIGNS.md — the campaigns listing is `[static + tag 'campaigns']`, on the same reasoning
 * as contests: selecting a creator or verifying a post moves the listing's counters and nothing
 * else on the marketing tree.
 */
export const CAMPAIGNS_TAG = 'campaigns';

export function revalidateCampaigns(): void {
  revalidateTag(CAMPAIGNS_TAG);
  revalidateStaticSurfaces(['/campaigns']);
}

/**
 * Landing media slots (lib/content/landing-media.ts, `/admin/landing-media`): a replaced or reset
 * image refreshes the two landings that render slots, on the same tag-and-path terms as the others.
 */
export const LANDING_MEDIA_TAG = 'landing-media';

export function revalidateLandingMedia(): void {
  revalidateTag(LANDING_MEDIA_TAG);
  revalidateStaticSurfaces(['', '/brands']);
}

/**
 * docs/BRAND-MOAT-AND-STORAGE.md — a public file was verified on the media host. The documents and pages
 * that hold its address move to the new one now, not at the TTL, because a new template gets its first
 * visitors right after it is published.
 */
export function revalidatePublicMedia(): void {
  revalidateCatalog();
  revalidatePrompts();
  revalidateContests();
  revalidateLandingMedia();
  revalidateStaticSurfaces(['/video', '/image']);
  revalidatePath('/[locale]/t/[slug]', 'page');
}

export function revalidateSubscriptions(): void {
  revalidateTag('creator-subscription-status');
  revalidateStaticSurfaces(['', '/pricing', '/faq', '/legal/terms', '/legal/refund', '/legal/privacy']);
  revalidatePath('/[locale]/t/[slug]', 'page');
  revalidatePath('/llms.txt');
  revalidatePath('/llms-full.txt');
}
