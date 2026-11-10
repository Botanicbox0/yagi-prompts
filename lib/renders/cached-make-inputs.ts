import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import type { TemplateCast } from '@/lib/prompts/schemas';
import { templateMakeInputs, type CastMakeInputs } from './cast-inputs';

/**
 * docs/CAST-CATEGORIES.md §3 — what the static template page's make card asks for (selfie, pet,
 * partner), cached with the page (tag `prompts`). Only the three booleans: no prompt, engine or file.
 * The payment route and the render re-check the same rule from the database (`templateMakeInputs`).
 */
const cached = unstable_cache(
  async (templateId: string, cast: TemplateCast): Promise<CastMakeInputs | null> => {
    const sql = await getSqlRunner();
    if (sql === null) return cast === 'solo' ? { cast, selfie: true, pet: false, partner: false } : null;
    return templateMakeInputs(sql, { id: templateId, cast });
  },
  ['make-inputs-v1', resolveRuntimeMode()],
  { tags: ['prompts'], revalidate: 3600 },
);

export async function cachedMakeInputs(templateId: string, cast: TemplateCast): Promise<CastMakeInputs | null> {
  try {
    return await cached(templateId, cast);
  } catch {
    // No cache outside a Next request, or a read that failed: a solo template stays the one-selfie
    // template it always was; a pet or couple template is not offered rather than offered wrongly.
    return cast === 'solo' ? { cast, selfie: true, pet: false, partner: false } : null;
  }
}
