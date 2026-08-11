import type { MetadataRoute } from 'next';
import { buildRobots } from '@/lib/seo/sitemap';
import { siteUrl } from '@/lib/seo/site-url';

/**
 * `/robots.txt` — PLAN §8 M5. Allows the public surface, disallows every `noindex` app path and the
 * whole API, and points at the sitemap.
 *
 * A courtesy, not a control: `/library`, `/account`, `/billing/*` and `/admin/*` are gated by
 * middleware and by the server-side shaper regardless of what any crawler chooses to read here.
 */
export default function robots(): MetadataRoute.Robots {
  return buildRobots(siteUrl());
}
