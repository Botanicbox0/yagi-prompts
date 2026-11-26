import type { Locale } from '@/lib/i18n/config';
import { makerRest } from '@/lib/makers/links';

/**
 * Pure route helpers for AI creative blog posts (public pages, workspace editor, access API).
 * Mirrors `lib/makers/links.ts` so pages, components, sitemap, and tests share one path format.
 */

export function makerBlogListRest(handle: string): string {
  return `${makerRest(handle)}/blog`;
}

export function makerBlogListHref(locale: Locale, handle: string): string {
  return `/${locale}${makerBlogListRest(handle)}`;
}

export function makerBlogPostRest(handle: string, slug: string): string {
  return `${makerBlogListRest(handle)}/${slug}`;
}

export function makerBlogPostHref(locale: Locale, handle: string, slug: string): string {
  return `/${locale}${makerBlogPostRest(handle, slug)}`;
}

export function postEditorHref(id: string): string {
  return `/creators/workspace/posts/${id}`;
}

export function postAccessEndpoint(handle: string, slug: string): string {
  return `/api/posts/access?handle=${encodeURIComponent(handle)}&slug=${encodeURIComponent(slug)}`;
}
