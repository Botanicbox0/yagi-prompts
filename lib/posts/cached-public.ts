import 'server-only';
import { unstable_cache } from 'next/cache';
import { CATALOG_TTL_SECONDS, POSTS_TAG, PROMPTS_TAG } from '@/lib/cache';
import { getSqlRunner } from '@/lib/db/connect';
import { readPublicProjection } from '@/lib/db/read-policy';
import { resolveRuntimeMode } from '@/lib/runtime-mode';
import { makerBlogOpen } from './flag';
import {
  countPublicPostsByHandle,
  listPublicPostsByHandle,
  listPublicPostsForSitemap,
  listTemplateStories,
  loadPublicPostByHandleAndSlug,
  loadTemplateOriginalInstagram,
  type PublicPost,
  type PublicPostSummary,
  type SitemapPostEntry,
  type TemplateStoryCard,
} from './public';
import type { ParsedInstagramPost } from './schema';

const flagKey = () => (makerBlogOpen() ? 'blog-on' : 'blog-off');

const cachedList = unstable_cache(
  async (handle: string): Promise<PublicPostSummary[]> =>
    readPublicProjection(await getSqlRunner(), [], (sql) => listPublicPostsByHandle(sql, handle)),
  ['maker-posts-list-v1', resolveRuntimeMode(), flagKey()],
  { tags: [POSTS_TAG, PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

const cachedCount = unstable_cache(
  async (handle: string): Promise<number> =>
    readPublicProjection(await getSqlRunner(), 0, (sql) => countPublicPostsByHandle(sql, handle)),
  ['maker-posts-count-v1', resolveRuntimeMode(), flagKey()],
  { tags: [POSTS_TAG, PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

const cachedPost = unstable_cache(
  async (handle: string, slug: string): Promise<PublicPost | null> =>
    readPublicProjection(await getSqlRunner(), null, (sql) => loadPublicPostByHandleAndSlug(sql, handle, slug)),
  ['maker-post-detail-v1', resolveRuntimeMode(), flagKey()],
  { tags: [POSTS_TAG, PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

const cachedStories = unstable_cache(
  async (templateId: string): Promise<TemplateStoryCard[]> =>
    readPublicProjection(await getSqlRunner(), [], (sql) => listTemplateStories(sql, templateId, 3)),
  ['maker-template-stories-v1', resolveRuntimeMode(), flagKey()],
  { tags: [POSTS_TAG, PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

const cachedSitemapPosts = unstable_cache(
  async (): Promise<SitemapPostEntry[]> =>
    readPublicProjection(await getSqlRunner(), [], (sql) => listPublicPostsForSitemap(sql)),
  ['maker-posts-sitemap-v1', resolveRuntimeMode(), flagKey()],
  { tags: [POSTS_TAG, PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

const cachedOriginalInstagram = unstable_cache(
  async (templateId: string): Promise<ParsedInstagramPost | null> =>
    readPublicProjection(await getSqlRunner(), null, (sql) => loadTemplateOriginalInstagram(sql, templateId)),
  ['maker-template-original-ig-v1', resolveRuntimeMode(), flagKey()],
  { tags: [POSTS_TAG, PROMPTS_TAG], revalidate: CATALOG_TTL_SECONDS },
);

export async function cachedPublicPostsByHandle(handle: string): Promise<PublicPostSummary[]> {
  if (!makerBlogOpen()) return [];
  return cachedList(handle);
}

export async function cachedPublicPostCount(handle: string): Promise<number> {
  if (!makerBlogOpen()) return 0;
  return cachedCount(handle);
}

export async function cachedPublicPost(handle: string, slug: string): Promise<PublicPost | null> {
  if (!makerBlogOpen()) return null;
  return cachedPost(handle, slug);
}

export async function cachedTemplateStories(templateId: string): Promise<TemplateStoryCard[]> {
  if (!makerBlogOpen()) return [];
  return cachedStories(templateId);
}

export async function cachedSitemapMakerPosts(): Promise<SitemapPostEntry[]> {
  if (!makerBlogOpen()) return [];
  return cachedSitemapPosts();
}

export async function cachedTemplateOriginalInstagram(templateId: string): Promise<ParsedInstagramPost | null> {
  if (!makerBlogOpen()) return null;
  return cachedOriginalInstagram(templateId);
}
