/**
 * AI creative blog feature gate (Batch 3, maker-blog).
 *
 * Default OFF: active only when `TWINGS_MAKER_BLOG === 'on'`. While off, every public blog
 * page, `/api/posts/access`, workspace post routes, MCP blog tools, admin post controls, and
 * sitemap blog entries behave as if the feature does not exist.
 */
export function makerBlogOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.TWINGS_MAKER_BLOG === 'on';
}
