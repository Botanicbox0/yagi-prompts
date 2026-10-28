import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { loadPublicRecipe, recipeOutline, type RecipeOutline } from './public';

/**
 * The template page is static (tag `prompts`, 1h TTL); its recipe OUTLINE is cached with it, so a
 * studio publish that refreshes the page refreshes this too. Only the outline is ever returned —
 * and so only the outline is ever stored: the prompts, notes and file addresses stay behind
 * `/api/recipes/{id}`, which needs a signed-in member (docs/PLATFORM-2.0.md §20.3). The outline
 * carries no localized text, so one entry serves both languages.
 */
const cached = unstable_cache(
  async (templateId: string): Promise<RecipeOutline | null> => {
    const sql = await getSqlRunner();
    const full = sql ? await loadPublicRecipe(sql, templateId, { selfie: '', reference: '', step: '' }) : null;
    return full ? recipeOutline(full) : null;
  },
  ['recipe-outline-v1', resolveRuntimeMode()],
  { tags: ['prompts'], revalidate: 3600 },
);

export async function cachedRecipeOutline(templateId: string): Promise<RecipeOutline | null> {
  try {
    return await cached(templateId);
  } catch {
    // No cache outside a Next request, or a read that failed: show nothing rather than guess.
    return null;
  }
}
