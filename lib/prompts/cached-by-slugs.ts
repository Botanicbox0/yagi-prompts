import 'server-only';
import { unstable_cache } from 'next/cache';
import { CATALOG_TTL_SECONDS, PROMPTS_TAG } from '@/lib/cache';
import { publicMediaCacheKey } from '@/lib/content/asset-url';
import { getSqlRunner } from '@/lib/db/connect';
import { readPublicProjection } from '@/lib/db/read-policy';
import { coupleTemplatesOpen, petTemplatesOpen, templateLookOpen } from '@/lib/flags';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { loadPromptCardsBySlugs, type PromptCard } from './catalog';

const cachedBySlugs = unstable_cache(
  async (sortedKey: string): Promise<PromptCard[]> => {
    const slugs = sortedKey ? sortedKey.split(',').filter(Boolean) : [];
    if (slugs.length === 0) return [];
    return readPublicProjection(await getSqlRunner(), [], (sql) =>
      loadPromptCardsBySlugs(sql, slugs, {
        coupleOpen: coupleTemplatesOpen(),
        petOpen: petTemplatesOpen(),
      }),
    );
  },
  [
    'prompt-cards-by-slugs-v1',
    resolveRuntimeMode(),
    publicMediaCacheKey(),
    coupleTemplatesOpen() ? 'couple-on' : 'couple-off',
    petTemplatesOpen() ? 'pet-on' : 'pet-off',
    templateLookOpen() ? 'look-on' : 'look-off',
  ],
  { tags: [PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

export async function cachedPromptCardsBySlugs(slugs: readonly string[]): Promise<PromptCard[]> {
  const unique = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))].sort();
  if (unique.length === 0) return [];
  return cachedBySlugs(unique.join(','));
}
