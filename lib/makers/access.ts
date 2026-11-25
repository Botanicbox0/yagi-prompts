import 'server-only';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { platformAccess } from '@/lib/creator-platform/runtime';
import { approvedCreator } from '@/lib/creator-platform/service';
import { openMakerEnabled } from '@/lib/makers/self-activate';

/**
 * Whether supplier writes are open at all: the invited program (`TWINGS_FORMAT_CREATORS=on`) or the
 * one-check start (lib/makers/self-activate.ts, on unless `TWINGS_OPEN_MAKER=off`). The web workspace
 * has used this rule since the one-check start; tokens and the MCP server follow it too (founder,
 * 2026-11-26), so the same people can use both. It says nothing about the account — see the gate.
 */
export async function creativeProgramOpen(sql: SqlRunner): Promise<boolean> {
  if ((await platformAccess(sql)).creators) return true;
  return openMakerEnabled(sql);
}

/**
 * The one door every creative write passes (studio routes and the MCP server alike): a known
 * account, the supplier program open (`creativeProgramOpen`), and an ACTIVE creative row — an
 * account that never started, or one an admin revoked, stays out whatever the switches say. The
 * account id always comes from the server — a session or a resolved token — never from the request.
 */
export type CreativeGate = { ok: true; userId: string } | { ok: false; code: 'sign_in_required' | 'not_open' | 'forbidden' };

export async function creativeGate(sql: SqlRunner, userId: string | null): Promise<CreativeGate> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!(await creativeProgramOpen(sql))) return { ok: false, code: 'not_open' };
  if (!(await approvedCreator(sql, userId))) return { ok: false, code: 'forbidden' };
  return { ok: true, userId };
}
