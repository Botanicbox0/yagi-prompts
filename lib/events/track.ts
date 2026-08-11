import type { SqlRunner } from '@/lib/db/sql-runner';

/**
 * PLAN §3.4 / §6 — the funnel, five types and no more.
 *
 * The CHECK constraint on `events.type` is the same list; keeping the literal union here means a
 * typo is a type error rather than a runtime constraint violation on a fire-and-forget insert that
 * nobody would ever see fail.
 *
 * The contract that matters: **analytics must never break a render**. `recordEvent` returns a
 * boolean and swallows everything — a missing table, a closed pool, a malformed meta payload. A
 * playbook page that 500s because an insert failed would be a strictly worse product than one with
 * an incomplete funnel.
 */

export const EVENT_TYPES = [
  'view_playbook',
  'hit_lock',
  'start_checkout',
  'unlock_success',
  'hire_click',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * What may ride in `meta`.
 *
 * Deliberately tiny and non-free-form: the beacon route accepts a slug and nothing else, and the
 * server fills the rest. "No PII beyond the session user id" is enforced by there being no field
 * that could carry any (§ M3 brief).
 */
export interface EventMeta {
  slug?: string;
  /** Where the event happened: 'detail' | 'footer' | 'pricing' | 'success' — a closed vocabulary. */
  surface?: string;
  locale?: string;
}

export interface EventInput {
  type: EventType;
  userId?: string | null;
  playbookId?: string | null;
  meta?: EventMeta | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanMeta(meta: EventMeta | null | undefined): string | null {
  if (!meta) return null;
  const out: Record<string, string> = {};
  for (const key of ['slug', 'surface', 'locale'] as const) {
    const value = meta[key];
    if (typeof value === 'string' && value.length > 0) out[key] = value.slice(0, 120);
  }
  return Object.keys(out).length === 0 ? null : JSON.stringify(out);
}

/**
 * Insert one funnel row. Returns whether it landed; NEVER throws.
 *
 * `user_id` and `playbook_id` are plain columns with no FK (§6), so an anonymous event is a NULL
 * rather than a missing row, and a deleted user's events survive as orphans until the deletion
 * runbook anonymises them (§3.7).
 */
export async function recordEvent(sql: SqlRunner, input: EventInput): Promise<boolean> {
  if (!isEventType(input.type)) return false;
  const userId = typeof input.userId === 'string' && UUID.test(input.userId) ? input.userId : null;
  const playbookId =
    typeof input.playbookId === 'string' && UUID.test(input.playbookId) ? input.playbookId : null;

  try {
    await sql.query(
      `insert into events (user_id, type, playbook_id, meta)
       values ($1::uuid, $2, $3::uuid, $4::jsonb)`,
      [userId, input.type, playbookId, cleanMeta(input.meta)],
    );
    return true;
  } catch {
    // Fire and forget, by contract. Nothing upstream may branch on analytics.
    return false;
  }
}
