import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { approvedCreator } from '@/lib/creator-platform/service';

/**
 * The one door every creative write passes (studio routes and the MCP server alike): a known
 * account, the supplier program open (`TWINGS_FORMAT_CREATORS`), and an ACTIVE creative row. The
 * account id always comes from the server — a session or a resolved token — never from the request.
 */
export type CreativeGate = { ok: true; userId: string } | { ok: false; code: 'sign_in_required' | 'not_open' | 'forbidden' };

export async function creativeGate(sql: SqlRunner, userId: string | null): Promise<CreativeGate> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!(await platformAccess(sql)).creators) return { ok: false, code: 'not_open' };
  if (!(await approvedCreator(sql, userId))) return { ok: false, code: 'forbidden' };
  return { ok: true, userId };
}
