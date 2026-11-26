import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { loadPublicRecipe, type PublicRecipe, type PublicRecipeLabels } from './public';

/**
 * The template page is static (tag `prompts`, 1h TTL); its "만드는 법" projection is cached with it, so
 * a studio publish that refreshes the page refreshes this too. Keyed by locale (the labels differ).
 * The page renders only `recipeTeaser` of it; the rest goes to members through /api/renders/access.
 */
const cached = unstable_cache(
  async (templateId: string, selfie: string, reference: string, step: string, pet: string, partner: string): Promise<PublicRecipe | null> => {
    const sql = await getSqlRunner();
    return sql ? loadPublicRecipe(sql, templateId, { selfie, reference, step, pet, partner }) : null;
  },
  // v3 (2026-10-30): a step prompt may run to 8,000 characters; v2 entries made under the 4,000 cap
  // hold `null` for a longer recipe and would outlive the deploy that raised it.
  // v4 (2026-10-30, #111): the projection carries the creative's notes (intro, step tips, outro) and each
  // file's number and download address — a v3 entry has none of them.
  // v5 (2026-11-11, docs/CAST-CATEGORIES.md): the pet and partner photos have their own labels.
  // v6 (2026-11-25, docs/CREATOR-PLATFORM.md): shown prompts go without their `Template styling:` / `Template locks:`
  // blocks; a v5 entry still carries them.
  // v7 (2026-11-25): a Seedance 2.5 step may run to 15,000 characters (lib/engines/prompt-limits.ts); a v6 entry
  // holds `null` for such a recipe, like v2 did for 8,000.
  // v8 (2026-11-25): optional clip-by-clip production guide cards on public studio recipes.
  // v9 (2026-11-26): logged-out clip outline and full-width clip section on template pages.
  ['public-recipe-v9', resolveRuntimeMode()],
  { tags: ['prompts'], revalidate: 3600 },
);

export async function cachedPublicRecipe(templateId: string, labels: PublicRecipeLabels): Promise<PublicRecipe | null> {
  try {
    return await cached(templateId, labels.selfie, labels.reference, labels.step, labels.pet ?? labels.selfie, labels.partner ?? labels.selfie);
  } catch {
    // No cache outside a Next request, or a read that failed: show nothing rather than guess.
    return null;
  }
}
