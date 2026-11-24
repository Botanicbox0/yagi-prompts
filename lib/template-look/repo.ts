import type { SqlRunner } from '@/lib/db/sql-runner';
import { isTemplateLook, type TemplateLook } from './look';

/**
 * docs/PERSONAL-STUDIO.md §3.4.10 — the account side of the template style preference (0190: `profiles.template_look`,
 * `profiles.template_look_set_at`). Server only: the profile row is closed to every browser key (0100, 0191).
 *
 * Nothing here runs while `TWINGS_TEMPLATE_LOOK` is off — the callers check the switch first.
 */

const READY_RECHECK_MS = 60_000;
let readyCache: { ready: boolean; at: number } | null = null;

/**
 * Whether 0190 is applied (all three columns). Probed once per process like the Sunra lane's schema gate
 * (lib/renders/sunra-lane.ts); a "yes" is kept (a migration is not taken back), a "no" is asked again after a minute so
 * applying the file needs no redeploy. Any error reads as "not ready": the feature then stays unset, it never throws.
 */
export async function templateLookSchemaReady(sql: SqlRunner, now: number = Date.now()): Promise<boolean> {
  if (readyCache && (readyCache.ready || now - readyCache.at < READY_RECHECK_MS)) return readyCache.ready;
  let ready = false;
  try {
    const { rows } = await sql.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public'
          and ((table_name = 'profiles' and column_name in ('template_look', 'template_look_set_at'))
            or (table_name = 'prompt_items' and column_name = 'look'))`,
    );
    ready = Number(rows[0]?.n) === 3;
  } catch {
    ready = false;
  }
  readyCache = { ready, at: now };
  return ready;
}

/** Test seam. */
export function resetTemplateLookSchemaCache(): void {
  readyCache = null;
}

/**
 * The account's stored choice; null when none, when the profile is missing, or when 0190 is not applied (read through
 * the row's JSON, so a missing column is "not chosen", never an error).
 */
export async function loadViewerLook(sql: SqlRunner, userId: string): Promise<TemplateLook | null> {
  try {
    const { rows } = await sql.query<{ look: string | null }>(
      `select to_jsonb(p.*)->>'template_look' as look from profiles p where id = $1`,
      [userId],
    );
    const look = rows[0]?.look;
    return isTemplateLook(look) ? look : null;
  } catch {
    return null;
  }
}

/**
 * Store (or clear, with null) the choice. Idempotent: the same value again changes nothing, not even the time. Returns
 * false when there is no profile row to write to.
 */
export async function saveViewerLook(sql: SqlRunner, userId: string, look: TemplateLook | null): Promise<boolean> {
  const { rows } = await sql.query<{ id: string }>(
    `update profiles
        set template_look = $2,
            template_look_set_at = case when template_look is distinct from $2 then now() else template_look_set_at end
      where id = $1
      returning id`,
    [userId, look],
  );
  return rows.length === 1;
}
