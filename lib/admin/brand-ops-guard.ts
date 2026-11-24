import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AdminContext, AdminOutcome } from './context';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * R3 item 8: a plan, billing or subscription operation's conflict reads as `billingConflict` (a neutral sentence), not
 * as the campaign sentence of `brandConflict`, which the shared `brandFailure` maps every `conflict` to. The detail is
 * unchanged.
 */
export function asBillingConflict(outcome: AdminOutcome): AdminOutcome {
  return !outcome.ok && outcome.code === 'brandConflict' ? { ...outcome, code: 'billingConflict' } : outcome;
}

type AnyOperation = { parse(form: FormData): unknown; run(ctx: AdminContext, input: never): Promise<AdminOutcome> };

/** Every operation of a billing registry with `asBillingConflict` applied to its result. */
export function withBillingConflicts<T extends Record<string, AnyOperation>>(operations: T): T {
  const wrapped: Record<string, AnyOperation> = {};
  for (const [name, op] of Object.entries(operations)) {
    // Review m5: every other member of the operation is kept as it is; only `run` is wrapped.
    wrapped[name] = { ...op, run: async (ctx: AdminContext, input: never) => asBillingConflict(await op.run(ctx, input)) };
  }
  return wrapped as T;
}

/**
 * Re-reads `profiles.is_admin` from the database before returning any admin read model.
 * Never trusts caller-supplied flags alone (`docs/ADMIN.md §1`).
 */
export async function isDbAdmin(sql: SqlRunner, viewer: Viewer | null | undefined): Promise<boolean> {
  if (!viewer || !viewer.userId || !UUID_RE.test(viewer.userId)) return false;
  const row = (
    await sql.query<{ is_admin: boolean | null }>('select is_admin from profiles where id = $1 limit 1', [
      viewer.userId,
    ])
  ).rows[0];
  return row?.is_admin === true;
}

export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function escapeLike(query: string): string {
  return query.replace(/[!%_\\]/g, '!$&');
}

export function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}
