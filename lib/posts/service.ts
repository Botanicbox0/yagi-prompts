import 'server-only';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Viewer } from '@/lib/auth/identity';
import { revalidateMakerPosts } from '@/lib/cache';
import { audit, lockUser } from '@/lib/creator-platform/service';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { creativeGate } from '@/lib/makers/access';
import { loadMakerSettings } from '@/lib/makers/profile';
import type { PublicRecipeLabels } from '@/lib/recipes/public';
import { displayStepPrompt, parseRecipe } from '@/lib/recipes/schema';
import { publicPromptText } from '@/lib/template-director/public-text';
import { makerBlogOpen } from './flag';
import { resolvePublishTransition } from './publish-policy';
import {
  PostError,
  UUID_PATTERN,
  linkedTemplateSlugs,
  postsReady,
  resolvePublicTemplateIds,
  syncPostTemplates,
} from './repo';
import {
  POST_MAX_NEW_PER_DAY,
  POST_MAX_PER_MAKER,
  POST_SLUG_MAX,
  baseSlugFromTitle,
  compactPostBlock,
  extractMediaWorkIds,
  extractTemplateSlugs,
  parsePostBlocks,
  parsePostSaveInput,
  type PostBlock,
  type PostStatus,
} from './schema';

export interface MakerPostSummary {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  coverWorkId: string | null;
  status: PostStatus;
  hiddenReason: string | null;
  blockCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MakerPost extends MakerPostSummary {
  blocks: PostBlock[];
}

export interface MakerImportableTemplate {
  id: string;
  slug: string;
  title: string;
  titleKo: string | null;
  clips: Array<{
    title: string;
    kind: 'image' | 'video';
    meta?: string;
    prompt: string;
    note?: string;
  }>;
}

interface PostRow {
  id: string;
  user_id: string;
  slug: string;
  title: string;
  summary: string | null;
  cover_work_id: string | null;
  blocks: unknown;
  status: PostStatus;
  hidden_reason: string | null;
  published_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : iso(value);
}

function storedBlocksOf(raw: unknown): PostBlock[] {
  const parsed = parsePostBlocks(raw);
  return parsed.ok ? parsed.blocks : [];
}

function toMakerPostSummary(row: PostRow): MakerPostSummary {
  const blocks = storedBlocksOf(row.blocks);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    coverWorkId: row.cover_work_id,
    status: row.status,
    hiddenReason: row.hidden_reason,
    blockCount: blocks.length,
    publishedAt: nullableIso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function toMakerPost(row: PostRow): MakerPost {
  const blocks = storedBlocksOf(row.blocks);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    coverWorkId: row.cover_work_id,
    status: row.status,
    hiddenReason: row.hidden_reason,
    blockCount: blocks.length,
    publishedAt: nullableIso(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    blocks,
  };
}

function safeRevalidate(handle: string | null | undefined, slug?: string, templateSlugs: readonly string[] = []): void {
  if (!handle) return;
  try {
    revalidateMakerPosts(handle, slug, templateSlugs);
  } catch {
    // Outside a Next.js request/ISR context (e.g., unit tests or CLI scripts), cache tags are absent.
  }
}

async function requireMakerBlogAccess(sql: SqlRunner, userId: string | null): Promise<string> {
  if (!makerBlogOpen()) throw new PostError('not_open');
  const gate = await creativeGate(sql, userId);
  if (!gate.ok) throw new PostError(gate.code);
  if (!(await postsReady(sql))) throw new PostError('unavailable');
  return gate.userId;
}

async function assertOwnWorks(tx: SqlRunner, userId: string, workIds: readonly string[]): Promise<void> {
  if (workIds.length === 0) return;
  const { rows } = await tx.query<{ id: string }>(
    'select id from maker_works where user_id = $1 and id = any($2::text[])',
    [userId, workIds],
  );
  if (rows.length !== workIds.length) {
    throw new PostError('invalid_work');
  }
}

async function assertPublishedTemplates(tx: SqlRunner, slugs: readonly string[]): Promise<void> {
  if (slugs.length === 0) return;
  const resolved = await resolvePublicTemplateIds(tx, slugs);
  if (resolved.size !== slugs.length) {
    throw new PostError('invalid_template');
  }
}

async function allocateUniqueSlug(tx: SqlRunner, userId: string, title: string): Promise<string> {
  const base = baseSlugFromTitle(title) ?? `p-${randomBytes(4).toString('hex')}`;
  const { rows } = await tx.query<{ slug: string }>(
    'select slug from creator_posts where user_id = $1',
    [userId],
  );
  const used = new Set(rows.map((row) => row.slug));
  if (!used.has(base)) return base;

  for (let suffix = 2; suffix < 100; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${base.slice(0, POST_SLUG_MAX - tail.length)}${tail}`;
    if (!used.has(candidate)) return candidate;
  }

  return `p-${randomBytes(6).toString('hex')}`;
}

export async function listMakerPosts(sql: SqlRunner, userId: string | null): Promise<MakerPostSummary[]> {
  const makerId = await requireMakerBlogAccess(sql, userId);
  const { rows } = await sql.query<PostRow>(
    `select id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
            published_at, created_at, updated_at
       from creator_posts
      where user_id = $1
      order by updated_at desc, created_at desc
      limit $2`,
    [makerId, POST_MAX_PER_MAKER],
  );
  return rows.map(toMakerPostSummary);
}

/** Workspace home loader: returns empty list while feature flag or migration is off. */
export async function listMakerPostsForWorkspace(sql: SqlRunner, userId: string): Promise<MakerPostSummary[]> {
  if (!makerBlogOpen()) return [];
  if (!(await postsReady(sql))) return [];
  const { rows } = await sql.query<PostRow>(
    `select id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
            published_at, created_at, updated_at
       from creator_posts
      where user_id = $1
      order by updated_at desc, created_at desc
      limit $2`,
    [userId, POST_MAX_PER_MAKER],
  );
  return rows.map(toMakerPostSummary);
}

export async function loadMakerPost(sql: SqlRunner, userId: string | null, postId: string): Promise<MakerPost | null> {
  const makerId = await requireMakerBlogAccess(sql, userId);
  if (!UUID_PATTERN.test(postId)) return null;
  const { rows } = await sql.query<PostRow>(
    `select id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
            published_at, created_at, updated_at
       from creator_posts
      where id = $1 and user_id = $2
      limit 1`,
    [postId, makerId],
  );
  return rows[0] ? toMakerPost(rows[0]) : null;
}

export async function saveMakerPost(
  sql: SqlRunner,
  userId: string | null,
  rawInput: unknown,
): Promise<{ post: MakerPost; created: boolean }> {
  const makerId = await requireMakerBlogAccess(sql, userId);
  const parsed = parsePostSaveInput(rawInput);
  if (!parsed.ok) throw new PostError(parsed.code);

  const input = parsed.value;
  const blocks = input.blocks.map(compactPostBlock);
  const workIds = extractMediaWorkIds(input.coverWorkId, blocks);
  const templateSlugs = extractTemplateSlugs(blocks);

  const outcome = await sql.transaction(async (tx) => {
    await tx.query('select id from profiles where id = $1 for update', [makerId]);
    await assertOwnWorks(tx, makerId, workIds);

    if (input.id) {
      const existingRes = await tx.query<PostRow>(
        `select id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
                published_at, created_at, updated_at
           from creator_posts
          where id = $1
          for update`,
        [input.id],
      );
      const existing = existingRes.rows[0];
      if (!existing || existing.user_id !== makerId) {
        throw new PostError('not_found');
      }
      if (existing.status === 'hidden') {
        throw new PostError('hidden_locked');
      }
      if (existing.status === 'published') {
        if (blocks.length === 0) throw new PostError('empty_blocks');
        await assertPublishedTemplates(tx, templateSlugs);
      }

      const { rows } = await tx.query<PostRow>(
        `update creator_posts
            set title = $2,
                summary = $3,
                cover_work_id = $4,
                blocks = $5::jsonb,
                updated_at = now()
          where id = $1 and user_id = $6
          returning id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
                    published_at, created_at, updated_at`,
        [input.id, input.title, input.summary, input.coverWorkId, JSON.stringify(blocks), makerId],
      );
      const saved = rows[0]!;
      const invalidatedTemplates = await syncPostTemplates(tx, saved.id, blocks);
      return { post: toMakerPost(saved), created: false, invalidatedTemplates };
    }

    const counts = (
      await tx.query<{ total: number; daily: number }>(
        `select count(*)::int as total,
                count(*) filter (where created_at > now() - interval '1 day')::int as daily
           from creator_posts
          where user_id = $1`,
        [makerId],
      )
    ).rows[0]!;

    if (counts.total >= POST_MAX_PER_MAKER || counts.daily >= POST_MAX_NEW_PER_DAY) {
      throw new PostError('limit_reached');
    }

    const id = randomUUID();
    const slug = await allocateUniqueSlug(tx, makerId, input.title);
    const { rows } = await tx.query<PostRow>(
      `insert into creator_posts(id, user_id, slug, title, summary, cover_work_id, blocks, status)
       values($1, $2, $3, $4, $5, $6, $7::jsonb, 'draft')
       returning id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
                 published_at, created_at, updated_at`,
      [id, makerId, slug, input.title, input.summary, input.coverWorkId, JSON.stringify(blocks)],
    );
    const created = rows[0]!;
    const invalidatedTemplates = await syncPostTemplates(tx, created.id, blocks);
    return { post: toMakerPost(created), created: true, invalidatedTemplates };
  });

  if (outcome.post.status === 'published') {
    const settings = await loadMakerSettings(sql, makerId).catch(() => null);
    safeRevalidate(settings?.handle, outcome.post.slug, outcome.invalidatedTemplates);
  }

  return { post: outcome.post, created: outcome.created };
}

export async function publishMakerPost(
  sql: SqlRunner,
  userId: string | null,
  postId: string,
  options: { rightsConfirmed?: boolean },
): Promise<MakerPost> {
  const makerId = await requireMakerBlogAccess(sql, userId);
  if (options.rightsConfirmed !== true) throw new PostError('rights_required');
  if (!UUID_PATTERN.test(postId)) throw new PostError('not_found');

  const outcome = await sql.transaction(async (tx) => {
    const existingRes = await tx.query<PostRow>(
      `select id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
              published_at, created_at, updated_at
         from creator_posts
        where id = $1
        for update`,
      [postId],
    );
    const existing = existingRes.rows[0];
    if (!existing || existing.user_id !== makerId) {
      throw new PostError('not_found');
    }

    const transition = resolvePublishTransition(existing.status);
    if (!transition.ok) {
      throw new PostError(transition.code);
    }

    const parsedBlocks = parsePostBlocks(existing.blocks);
    if (!parsedBlocks.ok) throw new PostError(parsedBlocks.code);
    const blocks = parsedBlocks.blocks;
    if (blocks.length === 0) throw new PostError('empty_blocks');

    await assertOwnWorks(tx, makerId, extractMediaWorkIds(existing.cover_work_id, blocks));
    await assertPublishedTemplates(tx, extractTemplateSlugs(blocks));

    const { rows } = await tx.query<PostRow>(
      `update creator_posts
          set status = $2,
              published_at = coalesce(published_at, now()),
              updated_at = now()
        where id = $1 and user_id = $3
        returning id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
                  published_at, created_at, updated_at`,
      [postId, transition.nextStatus, makerId],
    );
    const published = rows[0]!;
    const invalidatedTemplates = await syncPostTemplates(tx, published.id, blocks);
    return { post: toMakerPost(published), invalidatedTemplates };
  });

  const settings = await loadMakerSettings(sql, makerId).catch(() => null);
  safeRevalidate(settings?.handle, outcome.post.slug, outcome.invalidatedTemplates);
  return outcome.post;
}

export async function unpublishMakerPost(
  sql: SqlRunner,
  userId: string | null,
  postId: string,
): Promise<MakerPost> {
  const makerId = await requireMakerBlogAccess(sql, userId);
  if (!UUID_PATTERN.test(postId)) throw new PostError('not_found');

  const outcome = await sql.transaction(async (tx) => {
    const existingRes = await tx.query<PostRow>(
      `select id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
              published_at, created_at, updated_at
         from creator_posts
        where id = $1
        for update`,
      [postId],
    );
    const existing = existingRes.rows[0];
    if (!existing || existing.user_id !== makerId) {
      throw new PostError('not_found');
    }
    if (existing.status === 'hidden') {
      throw new PostError('hidden_locked');
    }

    const invalidatedTemplates = await linkedTemplateSlugs(tx, postId);
    const { rows } = await tx.query<PostRow>(
      `update creator_posts
          set status = 'draft',
              updated_at = now()
        where id = $1 and user_id = $2
        returning id, user_id, slug, title, summary, cover_work_id, blocks, status, hidden_reason,
                  published_at, created_at, updated_at`,
      [postId, makerId],
    );
    return { post: toMakerPost(rows[0]!), invalidatedTemplates };
  });

  const settings = await loadMakerSettings(sql, makerId).catch(() => null);
  safeRevalidate(settings?.handle, outcome.post.slug, outcome.invalidatedTemplates);
  return outcome.post;
}

export async function deleteMakerPost(sql: SqlRunner, userId: string | null, postId: string): Promise<void> {
  const makerId = await requireMakerBlogAccess(sql, userId);
  if (!UUID_PATTERN.test(postId)) throw new PostError('not_found');

  await sql.transaction(async (tx) => {
    const existingRes = await tx.query<{ id: string; user_id: string; status: PostStatus }>(
      'select id, user_id, status from creator_posts where id = $1 for update',
      [postId],
    );
    const existing = existingRes.rows[0];
    if (!existing || existing.user_id !== makerId) {
      throw new PostError('not_found');
    }
    if (existing.status !== 'draft') {
      throw new PostError('not_draft');
    }
    await tx.query('delete from creator_posts where id = $1 and user_id = $2', [postId, makerId]);
  });
}

export async function adminHidePost(
  sql: SqlRunner,
  viewer: Viewer,
  input: { id: string; reason: string },
): Promise<{ id: string; status: PostStatus }> {
  if (!makerBlogOpen()) throw new PostError('not_open');
  if (!viewer.isAdmin || !viewer.userId) throw new PostError('forbidden');
  if (!(await postsReady(sql))) throw new PostError('unavailable');
  if (!UUID_PATTERN.test(input.id)) throw new PostError('not_found');
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 2000) throw new PostError('invalid');

  const outcome = await sql.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; user_id: string; slug: string; status: PostStatus }>(
      'select id, user_id, slug, status from creator_posts where id = $1 for update',
      [input.id],
    );
    const row = rows[0];
    if (!row) throw new PostError('not_found');
    // Only a post the public can see is hidden. A draft is already private, and hiding one would let
    // `post.restore` publish a post its author had taken down.
    if (row.status === 'draft') throw new PostError('invalid');

    await lockUser(tx, row.user_id);
    await tx.query(
      `update creator_posts
          set status = 'hidden',
              hidden_reason = $2,
              updated_at = now()
        where id = $1`,
      [input.id, reason],
    );
    await audit(tx, viewer.userId!, input.id, 'post.hide', reason, { before: row.status, after: 'hidden' });
    const templateSlugs = await linkedTemplateSlugs(tx, input.id);
    return { userId: row.user_id, slug: row.slug, templateSlugs };
  });

  const settings = await loadMakerSettings(sql, outcome.userId).catch(() => null);
  safeRevalidate(settings?.handle, outcome.slug, outcome.templateSlugs);
  return { id: input.id, status: 'hidden' };
}

export async function adminRestorePost(
  sql: SqlRunner,
  viewer: Viewer,
  input: { id: string; reason: string },
): Promise<{ id: string; status: PostStatus }> {
  if (!makerBlogOpen()) throw new PostError('not_open');
  if (!viewer.isAdmin || !viewer.userId) throw new PostError('forbidden');
  if (!(await postsReady(sql))) throw new PostError('unavailable');
  if (!UUID_PATTERN.test(input.id)) throw new PostError('not_found');
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 2000) throw new PostError('invalid');

  const outcome = await sql.transaction(async (tx) => {
    const { rows } = await tx.query<{ id: string; user_id: string; slug: string; status: PostStatus; published_at: unknown }>(
      'select id, user_id, slug, status, published_at from creator_posts where id = $1 for update',
      [input.id],
    );
    const row = rows[0];
    if (!row) throw new PostError('not_found');
    // Restore undoes a hide and nothing else: it never publishes a draft.
    if (row.status !== 'hidden') throw new PostError('invalid');
    const restoredStatus: PostStatus = row.published_at ? 'published' : 'draft';

    await lockUser(tx, row.user_id);
    await tx.query(
      `update creator_posts
          set status = $2,
              hidden_reason = null,
              updated_at = now()
        where id = $1`,
      [input.id, restoredStatus],
    );
    await audit(tx, viewer.userId!, input.id, 'post.restore', reason, { before: row.status, after: restoredStatus });
    const templateSlugs = await linkedTemplateSlugs(tx, input.id);
    return { userId: row.user_id, slug: row.slug, status: restoredStatus, templateSlugs };
  });

  const settings = await loadMakerSettings(sql, outcome.userId).catch(() => null);
  safeRevalidate(settings?.handle, outcome.slug, outcome.templateSlugs);
  return { id: input.id, status: outcome.status };
}

/**
 * Loads the maker's own published templates that declare `recipe.guide[]` clips so the blog editor's
 * "템플릿에서 클립 가져오기" button can insert readable clip cards (`[내 사진]`, etc.) + a template block.
 */
export async function loadMakerTemplatesForImport(
  sql: SqlRunner,
  userId: string,
  labels: PublicRecipeLabels,
): Promise<MakerImportableTemplate[]> {
  if (!makerBlogOpen()) return [];
  const { rows } = await sql.query<{
    id: string;
    slug: string;
    title: string;
    title_ko: string | null;
    recipe: unknown;
  }>(
    `select p.id, p.slug, p.title, p.title_ko, to_jsonb(p.*)->'recipe' as recipe
       from prompt_items p
      where p.status = 'published'
        and p.audience = 'public'
        and to_jsonb(p.*)->'recipe' is not null
        and (
          p.author_id = $1
          or exists (
            select 1 from platform_formats f
             where f.template_id = p.id and f.user_id = $1 and f.status = 'accepted'
          )
        )
      order by p.published_at desc nulls last, p.created_at desc
      limit 50`,
    [userId],
  );

  const out: MakerImportableTemplate[] = [];
  for (const row of rows) {
    let checked = parseRecipe(row.recipe, { studio: true });
    if (!checked.ok) {
      checked = parseRecipe(row.recipe, { studio: true, allowUserReferenceSlots: true });
    }
    if (!checked.ok || !checked.recipe.guide?.length) continue;
    const recipe = checked.recipe;
    out.push({
      id: row.id,
      slug: row.slug,
      title: row.title,
      titleKo: row.title_ko,
      clips: recipe.guide!.map((item) => ({
        title: item.title,
        kind: item.kind,
        ...(item.meta?.trim() ? { meta: item.meta.trim() } : {}),
        prompt: publicPromptText(displayStepPrompt(recipe, item, labels)),
        ...(item.note?.trim() ? { note: item.note.trim() } : {}),
      })),
    });
  }
  return out;
}
