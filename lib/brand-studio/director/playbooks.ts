/**
 * Organization playbook loader for the Silent Multimodal Director (`brand_studio_playbooks`).
 *
 * Reads published playbooks marked `inject_director = true` and stays 100% tolerant when the table or
 * columns have not been migrated yet or when no rows exist.
 */
import { containsInternalTerm } from '@/lib/brand-studio/enhancer/schema';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { DirectorPlaybookRule } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAYBOOKS_LIMIT = 8;
const BODY_RULE_MAX_CHARS = 320;

interface RawPlaybookRow {
  id: string;
  title: string;
  body_md: string;
  tags: string[] | null;
}

function isMissingSchemaError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === '42P01' || code === '42703') return true;
  const message = error instanceof Error ? error.message : '';
  return /(?:relation|column) .* does not exist/i.test(message);
}

/** Loads published organization playbooks with `inject_director = true` (never throws on schema mismatch). */
export async function loadDirectorPlaybooks(
  sql: SqlRunner | undefined,
  organizationId: string | undefined,
): Promise<DirectorPlaybookRule[]> {
  if (!sql || !organizationId || !UUID_RE.test(organizationId)) return [];
  try {
    const res = await sql.query<RawPlaybookRow>(
      `select id, title, body_md, tags
         from brand_studio_playbooks
        where organization_id = $1
          and status = 'published'
          and inject_director = true
          and deleted_at is null
        order by updated_at desc
        limit ${PLAYBOOKS_LIMIT}`,
      [organizationId],
    );
    return res.rows
      .map((row) => ({
        id: row.id,
        title: (row.title ?? '').trim(),
        bodyMd: (row.body_md ?? '').trim(),
        tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
      }))
      .filter((rule) => rule.title.length > 0 || rule.bodyMd.length > 0);
  } catch (error) {
    if (isMissingSchemaError(error)) return [];
    return [];
  }
}

/** Flattens published playbooks into concise, safe brand rule strings for prompt compilation. */
export function playbookRuleLines(playbooks: readonly DirectorPlaybookRule[]): string[] {
  const lines: string[] = [];
  for (const pb of playbooks) {
    const cleanBody = pb.bodyMd
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^#+\s*/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, BODY_RULE_MAX_CHARS);
    const combined = cleanBody ? `${pb.title}: ${cleanBody}` : pb.title;
    if (combined && !containsInternalTerm(combined)) {
      lines.push(combined);
    }
  }
  return lines;
}
