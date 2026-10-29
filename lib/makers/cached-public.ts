import 'server-only';
import { unstable_cache } from 'next/cache';
import { CATALOG_TTL_SECONDS, PROMPTS_TAG } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { listPublicWorks, type MakerWork } from './works';

/**
 * A public creative's works for their static page, cached with the catalogue (tag `prompts`, the
 * same 1h floor): every studio change calls `revalidateMakerProfile`, which moves both together.
 * A failed read shows no works rather than an error page — the profile is still the profile.
 */
const cached = unstable_cache(
  async (handle: string): Promise<MakerWork[]> => {
    const sql = await getSqlRunner();
    return sql ? listPublicWorks(sql, handle) : [];
  },
  ['creative-works-v1', resolveRuntimeMode()],
  { tags: [PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

export async function cachedPublicWorks(handle: string): Promise<MakerWork[]> {
  try { return await cached(handle); } catch { return []; }
}
