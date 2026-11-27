import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { parseInstagramPost } from '@/lib/posts/schema';

/**
 * Admin setting of `platform_formats.example_url` for the studio's own company-payout formats (`format.setOriginalPost`).
 *
 * Mirrors `lib/creator-platform/format-revision.ts` in boundary: only an accepted format whose owner has
 * `platform_creators.payout = 'company'` can be updated here, never an external creative's format.
 */

export const ORIGINAL_POST_ACTION = 'format.setOriginalPost';

export const SetOriginalPostInput = z
  .object({
    id: z.string().uuid(),
    url: z.string().max(4096),
  })
  .strict();
export type SetOriginalPostInput = z.infer<typeof SetOriginalPostInput>;

export type OriginalPostRefusalCode =
  | 'input'
  | 'not_found'
  | 'not_accepted'
  | 'not_company'
  | 'not_post'
  | 'unchanged';

export type OriginalPostResult =
  | { ok: true; slug: string }
  | { ok: false; code: OriginalPostRefusalCode };

/** `originalPost:<code>` — the admin outcome's detail; the panel translates it through the admin dictionary. */
export function originalPostRefusalDetail(result: Extract<OriginalPostResult, { ok: false }>): string {
  return `originalPost:${result.code}`;
}

/** Reads `originalPost:<code>` back for the panel's refusal note. */
export function readOriginalPostRefusal(detail: string | null | undefined): OriginalPostRefusalCode | null {
  const match = /^originalPost:([a-z_0-9]+)$/.exec(detail ?? '');
  return match ? (match[1] as OriginalPostRefusalCode) : null;
}

const refuse = (code: OriginalPostRefusalCode): Extract<OriginalPostResult, { ok: false }> => ({
  ok: false,
  code,
});

function normalizeStoredUrl(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Sets or clears `platform_formats.example_url` for an accepted company-payout format in one audited transaction.
 * Refuses non-Instagram-post URLs, unchanged values, non-accepted formats, and external creatives' formats without
 * writing anything or creating an audit row.
 */
export async function setFormatOriginalPost(
  sql: SqlRunner,
  actorId: string | null,
  raw: unknown,
): Promise<OriginalPostResult> {
  const parsedInput = SetOriginalPostInput.safeParse(raw);
  if (!parsedInput.success) return refuse('input');
  const input = parsedInput.data;

  return sql.transaction(async (tx): Promise<OriginalPostResult> => {
    const { rows: formats } = await tx.query<{
      id: string;
      user_id: string;
      status: string;
      example_url: string | null;
      slug: string;
    }>(
      `select f.id, f.user_id, f.status, f.example_url, p.slug
         from platform_formats f
         join prompt_items p on p.id = f.template_id
        where f.template_id = $1
          and p.audience <> 'brand'
          for update of f`,
      [input.id],
    );
    const format = formats[0];
    if (!format) return refuse('not_found');
    if (format.status !== 'accepted') return refuse('not_accepted');

    const { rows: owners } = await tx.query<{ payout: string | null }>(
      "select to_jsonb(c.*)->>'payout' as payout from platform_creators c where user_id = $1 for share",
      [format.user_id],
    );
    if (owners[0]?.payout !== 'company') return refuse('not_company');

    const trimmed = input.url.trim();
    let after: string | null;
    if (trimmed === '') {
      after = null;
    } else {
      const post = parseInstagramPost(trimmed);
      if (!post) return refuse('not_post');
      after = post.url;
    }

    const before = normalizeStoredUrl(format.example_url);
    if (before === after) return refuse('unchanged');

    const auditId = randomUUID();
    await tx.query(
      'insert into platform_audit (id, actor_id, entity_id, action, reason, details) values ($1, $2, $3, $4, $5, $6::jsonb)',
      [
        auditId,
        actorId,
        input.id,
        ORIGINAL_POST_ACTION,
        'admin_format_original_post',
        JSON.stringify({
          formatId: format.id,
          slug: format.slug,
          before,
          after,
        }),
      ],
    );

    await tx.query('update platform_formats set example_url = $2 where id = $1', [format.id, after]);

    return { ok: true, slug: format.slug };
  });
}

// --- The admin panel's view ------------------------------------------------------------------------------------------

export type OriginalPostStatus = 'visible' | 'not_post' | 'empty';

export interface OriginalPostView {
  formatId: string;
  exampleUrl: string | null;
  status: OriginalPostStatus;
}

/**
 * View model for the admin template page's "원본 게시물 주소" panel: null unless the template is an ACCEPTED format
 * owned by the company-payout account (same boundary as `loadFormatRevisionView`).
 */
export async function loadOriginalPostView(sql: SqlRunner, templateId: string): Promise<OriginalPostView | null> {
  const { rows: ready } = await sql.query<{ formats: string | null; creators: string | null }>(
    "select to_regclass('public.platform_formats')::text as formats, to_regclass('public.platform_creators')::text as creators",
  );
  if (!ready[0]?.formats || !ready[0].creators) return null;

  const { rows } = await sql.query<{
    format_id: string;
    status: string;
    example_url: string | null;
    payout: string | null;
  }>(
    `select f.id as format_id, f.status, f.example_url, to_jsonb(c.*)->>'payout' as payout
       from platform_formats f
       join prompt_items p on p.id = f.template_id
       left join platform_creators c on c.user_id = f.user_id
      where f.template_id = $1
        and p.audience <> 'brand'`,
    [templateId],
  );
  const row = rows[0];
  if (!row || row.status !== 'accepted' || row.payout !== 'company') return null;

  const exampleUrl = normalizeStoredUrl(row.example_url);
  const status: OriginalPostStatus =
    exampleUrl === null ? 'empty' : parseInstagramPost(exampleUrl) !== null ? 'visible' : 'not_post';

  return {
    formatId: row.format_id,
    exampleUrl,
    status,
  };
}
