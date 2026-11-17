/**
 * Team notes (docs/BRAND-ROOMS-FEEDBACK.md §5, migration 0093): a review note with `visibility = 'team'`
 * is read by the YAGI team on /admin alone. Every other reader of `brand_studio_review_comments` asks for
 * public notes only, through the condition below. Its own small module so the room services (messages,
 * overview) can use it without importing the review service.
 */
import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * True once 0093 is applied. Before it no team note can exist, so readers add no condition and a team
 * note cannot be written. A positive answer is remembered (a schema does not go back); a negative one is
 * asked again, so applying 0093 needs no redeploy.
 */
let visibilitySeen = false;
export async function teamNotesReady(sql: SqlRunner): Promise<boolean> {
  if (visibilitySeen) return true;
  const { rows } = await sql.query<{ ready: boolean }>(
    `select exists (select 1 from pg_attribute where attrelid = to_regclass('public.brand_studio_review_comments')
                      and attname = 'visibility' and not attisdropped) as ready`,
  );
  visibilitySeen = rows[0]?.ready === true;
  return visibilitySeen;
}

/** ` and <alias>.visibility = 'public'` once the column exists, else nothing. Append to a `where`. */
export function publicNotesOnly(alias: string, ready: boolean): string {
  return ready ? ` and ${alias}.visibility = 'public'` : '';
}
