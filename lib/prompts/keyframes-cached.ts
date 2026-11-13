import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { loadPromptKeyframesBySlug, type VideoKeyframe } from './keyframes';

const cached = unstable_cache(
  async (slug: string): Promise<VideoKeyframe[] | null> => {
    const sql = await getSqlRunner();
    return sql ? loadPromptKeyframesBySlug(sql, slug) : null;
  },
  ['prompt-keyframes-v1', resolveRuntimeMode()],
  { tags: ['prompts'], revalidate: 3600 },
);

export async function cachedPromptKeyframes(slug: string): Promise<VideoKeyframe[] | null> {
  try {
    return await cached(slug);
  } catch {
    return null;
  }
}
