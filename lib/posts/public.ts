import type { SqlRunner } from '@/lib/db/sql-runner';
import type { MakerFileMime } from '@/lib/recipes/assets';
import { makerAvatarSrc, makerWorkSrc } from '@/lib/makers/links';
import { avatarVersionOf, makerHandleOf } from '@/lib/makers/profile';
import { makerBlogOpen } from './flag';
import { PUBLIC_POST_SQL_FILTER } from './publish-policy';
import { postsReady } from './repo';
import {
  POST_SLUG_PATTERN,
  estimateReadingMinutes,
  parseInstagramPost,
  parsePostBlocks,
  type ParsedInstagramPost,
  type PostBlock,
  type PostPromptBlock,
} from './schema';

/**
 * Public read projection for maker blog posts (Batch 3).
 *
 * SECURITY BOUNDARY: `toPublicBlock` constructs every block field-by-field without spreading.
 * For `prompt` blocks it keeps ONLY `type`, `title`, and `kind` — `meta`, `prompt`, and `note`
 * never enter the static HTML or RSC payload. Signed-in members unlock the full blocks through
 * `loadMemberPostBlocks` behind `/api/posts/access`.
 */

export type PublicPostPromptBlock = {
  type: 'prompt';
  title: string;
  kind: 'image' | 'video';
};

export type PublicPostBlock =
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'media'; workId: string; caption?: string }
  | PublicPostPromptBlock
  | { type: 'template'; slug: string }
  | { type: 'instagram'; url: string };

export interface PublicPostMedia {
  id: string;
  kind: 'image' | 'video';
  src: string;
  width: number | null;
  height: number | null;
}

export interface PublicPostAuthor {
  handle: string;
  displayName: string | null;
  headline: string | null;
  avatar: string | null;
}

export interface PublicPostSummary {
  slug: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  updatedAt: string;
  readingMinutes: number;
  cover: PublicPostMedia | null;
}

export interface PublicPost extends PublicPostSummary {
  author: PublicPostAuthor;
  blocks: PublicPostBlock[];
  works: Record<string, PublicPostMedia>;
}

export const FEED_POSTS_MAX = 60;

export interface PublicFeedPost extends PublicPostSummary {
  author: PublicPostAuthor;
}

export interface TemplateStoryCard {
  handle: string;
  authorName: string | null;
  authorAvatar: string | null;
  slug: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  cover: PublicPostMedia | null;
}

export interface SitemapPostEntry {
  handle: string;
  slug: string;
  updatedAt: string;
}

/**
 * Strips member-only prompt details (`meta`, `prompt`, `note`) by building the public object
 * field-by-field. Never spreads stored blocks.
 */
export function toPublicBlock(block: PostBlock): PublicPostBlock {
  switch (block.type) {
    case 'heading':
      return { type: 'heading', text: block.text };
    case 'text':
      return { type: 'text', text: block.text };
    case 'list':
      return { type: 'list', items: [...block.items] };
    case 'media':
      return block.caption
        ? { type: 'media', workId: block.workId, caption: block.caption }
        : { type: 'media', workId: block.workId };
    case 'prompt':
      return { type: 'prompt', title: block.title, kind: block.kind };
    case 'template':
      return { type: 'template', slug: block.slug };
    case 'instagram':
      return { type: 'instagram', url: block.url };
  }
}

export function toPublicBlocks(blocks: readonly PostBlock[]): PublicPostBlock[] {
  return blocks.map(toPublicBlock);
}

interface SummaryQueryRow {
  slug: string;
  title: string;
  summary: string | null;
  blocks: unknown;
  published_at: unknown;
  updated_at: unknown;
  cover_id: string | null;
  cover_kind: 'image' | 'video' | null;
  cover_mime: MakerFileMime | null;
  cover_width: number | null;
  cover_height: number | null;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function workFromColumns(row: {
  id: string | null;
  kind: 'image' | 'video' | null;
  mime: MakerFileMime | null;
  width: number | null;
  height: number | null;
}): PublicPostMedia | null {
  if (!row.id || !row.kind || !row.mime) return null;
  return {
    id: row.id,
    kind: row.kind,
    src: makerWorkSrc(row.id, row.mime),
    width: row.width,
    height: row.height,
  };
}

export async function countPublicPostsByHandle(sql: SqlRunner, rawHandle: string): Promise<number> {
  if (!makerBlogOpen()) return 0;
  const handle = makerHandleOf(rawHandle);
  if (!handle || !(await postsReady(sql))) return 0;
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int as n
       from creator_posts cp
       join platform_creators pc on pc.user_id = cp.user_id
      where pc.handle = $1 and ${PUBLIC_POST_SQL_FILTER}`,
    [handle],
  );
  return rows[0]?.n ?? 0;
}

export async function listPublicPostsByHandle(sql: SqlRunner, rawHandle: string): Promise<PublicPostSummary[]> {
  if (!makerBlogOpen()) return [];
  const handle = makerHandleOf(rawHandle);
  if (!handle || !(await postsReady(sql))) return [];

  const { rows } = await sql.query<SummaryQueryRow>(
    `select cp.slug, cp.title, cp.summary, cp.blocks, cp.published_at, cp.updated_at,
            mw.id as cover_id, mw.kind as cover_kind, mw.mime as cover_mime,
            mw.width as cover_width, mw.height as cover_height
       from creator_posts cp
       join platform_creators pc on pc.user_id = cp.user_id
       left join maker_works mw on mw.id = cp.cover_work_id and mw.user_id = cp.user_id
      where pc.handle = $1 and ${PUBLIC_POST_SQL_FILTER}
      order by cp.published_at desc nulls last, cp.updated_at desc`,
    [handle],
  );

  return rows.map((row) => {
    const parsed = parsePostBlocks(row.blocks);
    const publicBlocks = parsed.ok ? toPublicBlocks(parsed.blocks) : [];
    return {
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      publishedAt: nullableIso(row.published_at),
      updatedAt: iso(row.updated_at),
      readingMinutes: estimateReadingMinutes(row.title, row.summary, publicBlocks),
      cover: workFromColumns({
        id: row.cover_id,
        kind: row.cover_kind,
        mime: row.cover_mime,
        width: row.cover_width,
        height: row.cover_height,
      }),
    };
  });
}

export async function loadPublicPostByHandleAndSlug(
  sql: SqlRunner,
  rawHandle: string,
  rawSlug: string,
): Promise<PublicPost | null> {
  if (!makerBlogOpen()) return null;
  const handle = makerHandleOf(rawHandle);
  const slug = rawSlug.trim().toLowerCase();
  if (!handle || !POST_SLUG_PATTERN.test(slug) || !(await postsReady(sql))) return null;

  const { rows } = await sql.query<
    SummaryQueryRow & {
      user_id: string;
      handle: string;
      display_name: string | null;
      headline: string | null;
      avatar_key: string | null;
    }
  >(
    `select cp.user_id, cp.slug, cp.title, cp.summary, cp.blocks, cp.published_at, cp.updated_at,
            pc.handle, to_jsonb(pc.*)->>'display_name' as display_name,
            to_jsonb(pc.*)->>'headline' as headline,
            to_jsonb(pc.*)->>'avatar_key' as avatar_key,
            mw.id as cover_id, mw.kind as cover_kind, mw.mime as cover_mime,
            mw.width as cover_width, mw.height as cover_height
       from creator_posts cp
       join platform_creators pc on pc.user_id = cp.user_id
       left join maker_works mw on mw.id = cp.cover_work_id and mw.user_id = cp.user_id
      where pc.handle = $1 and cp.slug = $2 and ${PUBLIC_POST_SQL_FILTER}
      limit 1`,
    [handle, slug],
  );
  const row = rows[0];
  if (!row) return null;

  const parsed = parsePostBlocks(row.blocks);
  const publicBlocks = parsed.ok ? toPublicBlocks(parsed.blocks) : [];

  const mediaIds = new Set<string>();
  if (row.cover_id) mediaIds.add(row.cover_id);
  for (const block of publicBlocks) {
    if (block.type === 'media') mediaIds.add(block.workId);
  }

  const works: Record<string, PublicPostMedia> = {};
  if (mediaIds.size > 0) {
    const workRes = await sql.query<{
      id: string;
      kind: 'image' | 'video';
      mime: MakerFileMime;
      width: number | null;
      height: number | null;
    }>(
      `select id, kind, mime, width, height
         from maker_works
        where user_id = $1 and id = any($2::text[])`,
      [row.user_id, [...mediaIds]],
    );
    for (const work of workRes.rows) {
      works[work.id] = {
        id: work.id,
        kind: work.kind,
        src: makerWorkSrc(work.id, work.mime),
        width: work.width,
        height: work.height,
      };
    }
  }

  const avatarVersion = avatarVersionOf(row.avatar_key);
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    publishedAt: nullableIso(row.published_at),
    updatedAt: iso(row.updated_at),
    readingMinutes: estimateReadingMinutes(row.title, row.summary, publicBlocks),
    cover: workFromColumns({
      id: row.cover_id,
      kind: row.cover_kind,
      mime: row.cover_mime,
      width: row.cover_width,
      height: row.cover_height,
    }),
    author: {
      handle: row.handle,
      displayName: row.display_name ?? null,
      headline: row.headline ?? null,
      avatar: avatarVersion ? makerAvatarSrc(row.handle, avatarVersion) : null,
    },
    blocks: publicBlocks,
    works,
  };
}

/**
 * Signed-in member endpoint loader (`/api/posts/access`): returns full blocks (including prompt
 * `meta`, `prompt`, `note`) ONLY for a currently public published post.
 */
export async function loadMemberPostBlocks(
  sql: SqlRunner,
  rawHandle: string,
  rawSlug: string,
): Promise<{ blocks: PostBlock[]; prompts: PostPromptBlock[] } | null> {
  if (!makerBlogOpen()) return null;
  const handle = makerHandleOf(rawHandle);
  const slug = rawSlug.trim().toLowerCase();
  if (!handle || !POST_SLUG_PATTERN.test(slug) || !(await postsReady(sql))) return null;

  const { rows } = await sql.query<{ blocks: unknown }>(
    `select cp.blocks
       from creator_posts cp
       join platform_creators pc on pc.user_id = cp.user_id
      where pc.handle = $1 and cp.slug = $2 and ${PUBLIC_POST_SQL_FILTER}
      limit 1`,
    [handle, slug],
  );
  const row = rows[0];
  if (!row) return null;

  const parsed = parsePostBlocks(row.blocks);
  if (!parsed.ok) return null;
  return {
    blocks: parsed.blocks,
    prompts: parsed.blocks.filter((block): block is PostPromptBlock => block.type === 'prompt'),
  };
}

/**
 * Stories displayed on a template page ("이 템플릿 이야기").
 * Strict authorship filter: returns ONLY public posts written by the template's own supplier
 * (`prompt_items.author_id` or accepted `platform_formats.user_id`), capped at 3.
 */
export async function listTemplateStories(
  sql: SqlRunner,
  templateId: string,
  limit = 3,
): Promise<TemplateStoryCard[]> {
  if (!makerBlogOpen() || !(await postsReady(sql))) return [];
  const { rows } = await sql.query<{
    handle: string;
    display_name: string | null;
    avatar_key: string | null;
    slug: string;
    title: string;
    summary: string | null;
    published_at: unknown;
    cover_id: string | null;
    cover_kind: 'image' | 'video' | null;
    cover_mime: MakerFileMime | null;
    cover_width: number | null;
    cover_height: number | null;
  }>(
    `select pc.handle,
            to_jsonb(pc.*)->>'display_name' as display_name,
            to_jsonb(pc.*)->>'avatar_key' as avatar_key,
            cp.slug, cp.title, cp.summary, cp.published_at,
            mw.id as cover_id, mw.kind as cover_kind, mw.mime as cover_mime,
            mw.width as cover_width, mw.height as cover_height
       from creator_post_templates cpt
       join creator_posts cp on cp.id = cpt.post_id
       join prompt_items pi on pi.id = cpt.template_id
       join platform_creators pc on pc.user_id = cp.user_id
       left join maker_works mw on mw.id = cp.cover_work_id and mw.user_id = cp.user_id
      where cpt.template_id = $1
        and ${PUBLIC_POST_SQL_FILTER}
        and pi.status = 'published'
        and pi.audience = 'public'
        and (
          pi.author_id = cp.user_id
          or exists (
            select 1 from platform_formats f
             where f.template_id = pi.id and f.user_id = cp.user_id and f.status = 'accepted'
          )
        )
      order by cp.published_at desc nulls last, cp.updated_at desc
      limit $2`,
    [templateId, Math.max(1, Math.min(limit, 3))],
  );

  return rows.map((row) => {
    const avatarVersion = avatarVersionOf(row.avatar_key);
    return {
      handle: row.handle,
      authorName: row.display_name ?? null,
      authorAvatar: avatarVersion ? makerAvatarSrc(row.handle, avatarVersion) : null,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      publishedAt: nullableIso(row.published_at),
      cover: workFromColumns({
        id: row.cover_id,
        kind: row.cover_kind,
        mime: row.cover_mime,
        width: row.cover_width,
        height: row.cover_height,
      }),
    };
  });
}

export async function listPublicPostsForSitemap(sql: SqlRunner): Promise<SitemapPostEntry[]> {
  if (!makerBlogOpen() || !(await postsReady(sql))) return [];
  const { rows } = await sql.query<{ handle: string; slug: string; updated_at: unknown }>(
    `select pc.handle, cp.slug, cp.updated_at
       from creator_posts cp
       join platform_creators pc on pc.user_id = cp.user_id
      where ${PUBLIC_POST_SQL_FILTER}
      order by cp.published_at desc nulls last, cp.updated_at desc`,
  );
  return rows.map((row) => ({
    handle: row.handle,
    slug: row.slug,
    updatedAt: iso(row.updated_at),
  }));
}

/**
 * Reads `platform_formats.example_url` for an accepted template and returns the normalized
 * Instagram post/reel metadata if the supplier provided an Instagram link. No new column needed.
 */
export async function loadTemplateOriginalInstagram(
  sql: SqlRunner,
  templateId: string,
): Promise<ParsedInstagramPost | null> {
  if (!makerBlogOpen()) return null;
  const { rows } = await sql.query<{ exists: boolean }>(
    `select to_regclass('public.platform_formats') is not null as exists`,
  );
  if (rows[0]?.exists !== true) return null;

  const { rows: formatRows } = await sql.query<{ example_url: string | null }>(
    `select f.example_url
       from platform_formats f
       join prompt_items pi on pi.id = f.template_id
      where f.template_id = $1
        and f.status = 'accepted'
        and pi.status = 'published'
        and pi.audience = 'public'
      limit 1`,
    [templateId],
  );
  const url = formatRows[0]?.example_url;
  return url ? parseInstagramPost(url) : null;
}

export async function listPublicBlogFeed(sql: SqlRunner, limit = FEED_POSTS_MAX): Promise<PublicFeedPost[]> {
  if (!makerBlogOpen() || !(await postsReady(sql))) return [];
  const safeLimit = Math.max(1, Math.min(limit, FEED_POSTS_MAX));

  const { rows } = await sql.query<
    SummaryQueryRow & {
      handle: string;
      display_name: string | null;
      headline: string | null;
      avatar_key: string | null;
    }
  >(
    `select cp.slug, cp.title, cp.summary, cp.blocks, cp.published_at, cp.updated_at,
            pc.handle, to_jsonb(pc.*)->>'display_name' as display_name,
            to_jsonb(pc.*)->>'headline' as headline,
            to_jsonb(pc.*)->>'avatar_key' as avatar_key,
            mw.id as cover_id, mw.kind as cover_kind, mw.mime as cover_mime,
            mw.width as cover_width, mw.height as cover_height
       from creator_posts cp
       join platform_creators pc on pc.user_id = cp.user_id
       left join maker_works mw on mw.id = cp.cover_work_id and mw.user_id = cp.user_id
      where ${PUBLIC_POST_SQL_FILTER}
      order by cp.published_at desc nulls last, cp.updated_at desc
      limit $1`,
    [safeLimit],
  );

  return rows.map((row) => {
    const parsed = parsePostBlocks(row.blocks);
    const publicBlocks = parsed.ok ? toPublicBlocks(parsed.blocks) : [];
    const avatarVersion = avatarVersionOf(row.avatar_key);
    return {
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      publishedAt: nullableIso(row.published_at),
      updatedAt: iso(row.updated_at),
      readingMinutes: estimateReadingMinutes(row.title, row.summary, publicBlocks),
      cover: workFromColumns({
        id: row.cover_id,
        kind: row.cover_kind,
        mime: row.cover_mime,
        width: row.cover_width,
        height: row.cover_height,
      }),
      author: {
        handle: row.handle,
        displayName: row.display_name ?? null,
        headline: row.headline ?? null,
        avatar: avatarVersion ? makerAvatarSrc(row.handle, avatarVersion) : null,
      },
    };
  });
}

export async function countPublicPostsByAllHandles(sql: SqlRunner): Promise<Record<string, number>> {
  if (!makerBlogOpen() || !(await postsReady(sql))) return {};
  const { rows } = await sql.query<{ handle: string; n: number }>(
    `select pc.handle, count(*)::int as n
       from creator_posts cp
       join platform_creators pc on pc.user_id = cp.user_id
      where ${PUBLIC_POST_SQL_FILTER}
      group by pc.handle`,
  );
  return Object.fromEntries(rows.map((row) => [row.handle, row.n]));
}

export function splitFeaturedFeedPost(posts: readonly PublicFeedPost[]): {
  featured: PublicFeedPost | null;
  grid: PublicFeedPost[];
} {
  const index = posts.findIndex((post) => post.cover !== null);
  if (index === -1) return { featured: null, grid: [...posts] };
  return {
    featured: posts[index]!,
    grid: posts.filter((_, i) => i !== index),
  };
}
