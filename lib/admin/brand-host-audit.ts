import type { SqlRunner } from '@/lib/db/sql-runner';
import type { AdminOutcome } from './context';
import type { BrandHostStudioOperation } from './brand-host-studio';

/**
 * Who did what through the brand host's studio door, and how often (docs/BRAND-STAFF-ACCESS.md "보안").
 *
 * The record is the existing `platform_audit` table (0046, applied): append-only by trigger, readable
 * only by the service role. Every action writes an `attempt` row BEFORE it runs — if that row cannot
 * be written, the action does not run — and a `result` row after it with the outcome code.
 *
 * The same `attempt` rows are the per-admin budget: a sliding window, counted per actor, so a script
 * running in an admin's browser can do at most `attempts` actions per `minutes` before the door
 * closes for that admin. Refused-by-budget requests write nothing, so a flood cannot fill the table.
 */
export const STUDIO_RATE_LIMIT = { attempts: 30, minutes: 10 } as const;
export const STUDIO_AUDIT_REASON = 'brand_host_studio';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (form: FormData, name: string): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined;
};
const flag = (form: FormData, name: string, allowed: readonly string[]): string | undefined => {
  const value = form.get(name);
  return typeof value === 'string' && allowed.includes(value) ? value : undefined;
};

/** What the row says about the action: ids and fixed values only, never free text from the form. */
export function studioAuditSubject(form: FormData, actorId: string) {
  const projectId = id(form, 'projectId'), organizationId = id(form, 'organizationId');
  const details = {
    ...(projectId ? { projectId } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(id(form, 'candidateId') ? { candidateId: id(form, 'candidateId') } : {}),
    ...(flag(form, 'shared', ['true', 'false']) ? { shared: flag(form, 'shared', ['true', 'false']) } : {}),
    ...(flag(form, 'status', ['active', 'completed', 'cancelled']) ? { status: flag(form, 'status', ['active', 'completed', 'cancelled']) } : {}),
  };
  return { entityId: projectId ?? organizationId ?? actorId, details };
}

export async function studioBudgetSpent(sql: SqlRunner, actorId: string): Promise<boolean> {
  const row = (await sql.query<{ n: number }>(
    `select count(*)::int as n from platform_audit
      where actor_id=$1 and action like 'brandHostStudio.%' and details->>'state'='attempt'
        and created_at > now() - make_interval(mins => $2)`,
    [actorId, STUDIO_RATE_LIMIT.minutes],
  )).rows[0];
  return Number(row?.n ?? 0) >= STUDIO_RATE_LIMIT.attempts;
}

export async function recordStudioAction(sql: SqlRunner, entry: {
  actorId: string; op: BrandHostStudioOperation; entityId: string; host: string;
  details: Record<string, unknown>; outcome?: AdminOutcome;
}): Promise<void> {
  const details = {
    ...entry.details, host: entry.host,
    state: entry.outcome ? 'result' : 'attempt',
    ...(entry.outcome ? { ok: entry.outcome.ok, code: entry.outcome.code } : {}),
  };
  await sql.query(
    'insert into platform_audit(actor_id,entity_id,action,reason,details) values($1,$2,$3,$4,$5::jsonb)',
    [entry.actorId, entry.entityId, `brandHostStudio.${entry.op}`, STUDIO_AUDIT_REASON, JSON.stringify(details)],
  );
}
