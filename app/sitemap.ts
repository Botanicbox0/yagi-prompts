import type { MetadataRoute } from 'next';
import { getPublicCatalog } from '@/lib/content/public-catalog';
import { getPromptCatalog } from '@/lib/prompts/public-catalog';
import { buildSitemap } from '@/lib/seo/sitemap';
import { siteUrl } from '@/lib/seo/site-url';

/**
 * `/sitemap.xml` — PLAN §8 M5.
 *
 * It reads the SAME cached projections the pages do (`getPublicCatalog()` under tag `catalog`, the
 * template catalogue under tag `prompts`, each with the 1h TTL floor), so publishing a template
 * invalidates the sitemap through the very same `revalidateTag` call, and a lost invalidation
 * self-heals within the hour. Matching the marketing pages' cache posture is deliberate: a sitemap
 * that disagrees with the pages it lists is worse than a slightly stale one.
 *
 * Campaigns are deliberately NOT listed per page: a campaign is a month-long object whose detail
 * page varies by clock; the `/campaigns` listing is in the marketing list and is enough for a
 * crawler to find them. The contests surface left the sitemap with the contests (2026-09-05).
 */
/**
 * `CATALOG_TTL_SECONDS`, spelled as a literal: Next parses segment config statically and rejects an
 * imported identifier here. `tests/routes/cache-contract.test.ts` asserts the two stay equal.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [catalog, templates] = await Promise.all([getPublicCatalog(), getPromptCatalog()]);
  return buildSitemap({
    origin: siteUrl(),
    cards: catalog.cards,
    templates: [...templates.video, ...templates.image],
    pageModifiedAt: { '/brands': '2026-10-08T00:00:00+09:00' },
  });
}
