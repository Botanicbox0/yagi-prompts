import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';

const PermitSchema = z.object({
  projectId: z.string().uuid(),
  requestId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

/** Operator-issued, server-only configuration. No request field can grant an exception. */
export function completedMetricsPermit(raw = process.env.BRAND_COMPLETED_METRICS_ONCE) {
  if (!raw) return null;
  try {
    const parsed = PermitSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || +new Date(parsed.data.expiresAt) <= Date.now()) return null;
    return { ...parsed.data, projectId: parsed.data.projectId.toLowerCase(), requestId: parsed.data.requestId.toLowerCase() };
  } catch { return null; }
}

/** Display only: the mutation repeats this check under the project's existing row lock. */
export async function availableCompletedMetricsRequest(sql: SqlRunner, projectId: string) {
  const permit = completedMetricsPermit();
  if (!permit || permit.projectId !== projectId.toLowerCase()) return null;
  const used = await sql.query('select id from brand_post_collection_batches where project_id=$1 and request_id=$2', [projectId, permit.requestId]);
  return used.rows.length ? null : permit.requestId;
}
