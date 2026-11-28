import 'server-only';
import { unstable_cache } from 'next/cache';
import { CATALOG_TTL_SECONDS, PROMPTS_TAG } from '@/lib/cache';
import { publicMediaCacheKey } from '@/lib/content/asset-url';
import { getSqlRunner } from '@/lib/db/connect';
import { readPublicProjection } from '@/lib/db/read-policy';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { PROMPT_CATALOG_CACHE_VERSION } from './cache-version';
import { loadPromptCardsBySlugs, type PromptCard } from './catalog';

export async function cachedPromptCardsBySlugs(slugs: readonly string[]): Promise<PromptCard[]> {
  const unique = [...new Set(slugs.map((s) => s.trim()).filter(Boolean))].sort();
  if (unique.length === 0) return [];
  const coupleOpen = process.env.TWINGS_COUPLE_TEMPLATES === 'on';
  const petOpen = process.env.TWINGS_PET_TEMPLATES === 'on';
  const lookOpen = process.env.TWINGS_TEMPLATE_LOOK === 'on';
  const read = unstable_cache(
    async (sortedKey: string): Promise<PromptCard[]> => {
      const list = sortedKey ? sortedKey.split(',').filter(Boolean) : [];
      if (list.length === 0) return [];
      return readPublicProjection(await getSqlRunner(), [], (sql) =>
        loadPromptCardsBySlugs(sql, list, { coupleOpen, petOpen }),
      );
    },
    [
      'prompt-cards-by-slugs-v1',
      PROMPT_CATALOG_CACHE_VERSION,
      resolveRuntimeMode(),
      publicMediaCacheKey(),
      coupleOpen ? 'couple-on' : 'couple-off',
      petOpen ? 'pet-on' : 'pet-off',
      lookOpen ? 'look-on' : 'look-off',
    ],
    { tags: [PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
  );
  return read(unique.join(','));
}
