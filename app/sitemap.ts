import type { MetadataRoute } from 'next';
import { getPublicCatalog } from '@/lib/content/public-catalog';
import { buildSitemap } from '@/lib/seo/sitemap';
import { siteUrl } from '@/lib/seo/site-url';

/**
 * `/sitemap.xml` — PLAN §8 M5.
 *
 * It reads the SAME cached projection the landing page does (`getPublicCatalog()`, tag `catalog` +
 * a 1h TTL floor), so publishing a showcase playbook invalidates the sitemap through the very same
 * `revalidateTag('catalog')` call, and a lost invalidation self-heals within the hour. Matching the
 * marketing pages' cache posture is deliberate: a sitemap that disagrees with the pages it lists is
 * worse than a slightly stale one.
 *
 * The showcase-only filter and the alternates live in `lib/seo/sitemap.ts`, where they are tested.
 */
/**
 * `CATALOG_TTL_SECONDS`, spelled as a literal: Next parses segment config statically and rejects an
 * imported identifier here. `tests/routes/cache-contract.test.ts` asserts the two stay equal.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const catalog = await getPublicCatalog();
  return buildSitemap({ origin: siteUrl(), cards: catalog.cards });
}
