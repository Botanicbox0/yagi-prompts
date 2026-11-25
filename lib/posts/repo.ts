import type { SqlRunner } from '@/lib/db/sql-runner';
import { extractTemplateSlugs, type PostBlock } from './schema';

export type PostErrorCode =
  | 'not_open'
  | 'sign_in_required'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'too_large'
  | 'limit_reached'
  | 'hidden_locked'
  | 'not_draft'
  | 'rights_required'
  | 'empty_blocks'
  | 'invalid_work'
  | 'invalid_template'
  | 'unavailable';

export class PostError extends Error {
  constructor(readonly code: PostErrorCode, readonly detail?: string) {
    super(code);
    this.name = 'PostError';
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Migration 0196 probe (`to_regclass`), matching `recipeSchemaReady` / `creativeProfilesReady`.
 * Callers return empty reads and `unavailable` writes before 0196 is applied.
 */
export async function postsReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>(
    `select to_regclass('public.creator_posts') is not null
        and to_regclass('public.creator_post_templates') is not null as ready`,
  );
  return rows[0]?.ready === true;
}

/** Looks up the published public `prompt_items` rows for the slugs referenced in `blocks`. */
export async function resolvePublicTemplateIds(
  sql: SqlRunner,
  slugs: readonly string[],
): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const { rows } = await sql.query<{ id: string; slug: string }>(
    `select id, slug from prompt_items
      where slug = any($1::text[])
        and status = 'published'
        and audience = 'public'`,
    [slugs],
  );
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/**
 * Rebuilds `creator_post_templates` from `blocks` whenever a post is saved or published.
 * Returns the unique list of previously + currently linked template slugs for cache invalidation.
 */
export async function syncPostTemplates(
  tx: SqlRunner,
  postId: string,
  blocks: readonly PostBlock[],
): Promise<string[]> {
  const previous = (
    await tx.query<{ slug: string }>(
      `select p.slug from creator_post_templates cpt
         join prompt_items p on p.id = cpt.template_id
        where cpt.post_id = $1`,
      [postId],
    )
  ).rows.map((row) => row.slug);

  await tx.query('delete from creator_post_templates where post_id = $1', [postId]);

  const slugs = extractTemplateSlugs(blocks);
  if (slugs.length === 0) return previous;

  const resolved = await resolvePublicTemplateIds(tx, slugs);
  const templateIds = [...resolved.values()];
  if (templateIds.length > 0) {
    await tx.query(
      `insert into creator_post_templates(post_id, template_id)
       select $1, unnest($2::uuid[])
       on conflict (post_id, template_id) do nothing`,
      [postId, templateIds],
    );
  }

  return [...new Set([...previous, ...resolved.keys()])];
}

export async function linkedTemplateSlugs(sql: SqlRunner, postId: string): Promise<string[]> {
  const { rows } = await sql.query<{ slug: string }>(
    `select p.slug from creator_post_templates cpt
       join prompt_items p on p.id = cpt.template_id
      where cpt.post_id = $1`,
    [postId],
  );
  return rows.map((row) => row.slug);
}
