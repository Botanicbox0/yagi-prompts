import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { loadPublicRecipe, type PublicRecipe, type PublicRecipeLabels } from './public';

/**
 * The template page is static (tag `prompts`, 1h TTL); its "만드는 법" projection is cached with it, so
 * a studio publish that refreshes the page refreshes this too. Keyed by locale (the labels differ).
 */
const cached = unstable_cache(
  async (templateId: string, selfie: string, reference: string, step: string): Promise<PublicRecipe | null> => {
    const sql = await getSqlRunner();
    return sql ? loadPublicRecipe(sql, templateId, { selfie, reference, step }) : null;
  },
  ['public-recipe-v1', resolveRuntimeMode()],
  { tags: ['prompts'], revalidate: 3600 },
);

export async function cachedPublicRecipe(templateId: string, labels: PublicRecipeLabels): Promise<PublicRecipe | null> {
  try {
    return await cached(templateId, labels.selfie, labels.reference, labels.step);
  } catch {
    // No cache outside a Next request, or a read that failed: show nothing rather than guess.
    return null;
  }
}
