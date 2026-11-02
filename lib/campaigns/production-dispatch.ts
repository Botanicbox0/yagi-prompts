import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { z } from 'zod';
import { campaignProductionSchemaReady } from './production';
import { markRenderFailed, markRenderRunningWithTask } from '@/lib/renders/repo';
export const CAMPAIGN_DISPATCH_PREFIX = 'campaign-dispatch:';

/** If a campaign render was already dispatched (dispatch_attempt > 0) but its queue row was
 * requeued (provider_task_id cleared), restore the persisted real task ID — or the dispatch
 * marker for unknown outcomes — so the normal poll path resumes without a duplicate paid create.
 * Returns `{ resumed: true }` when the caller should skip identity/photo/provider work entirely.
 */
export async function resumeCampaignDispatch(sql: SqlRunner, id: string): Promise<{ resumed: boolean }> {
  if (!await campaignProductionSchemaReady(sql)) return { resumed: false };
  return sql.transaction(async tx => {
    const linked = (await tx.query<{ dispatch_attempt: number; dispatch_task_id: string | null }>(
      'select dispatch_attempt,dispatch_task_id from campaign_render_jobs where render_id=$1 for update', [id],
    )).rows[0];
    if (!linked || linked.dispatch_attempt === 0) return { resumed: false };
    const job = (await tx.query<{ status: string; provider_task_id: string | null }>(
      'select status,provider_task_id from render_jobs where id=$1 for update', [id],
    )).rows[0];
    if (!job || job.status !== 'running') return { resumed: false };
    if (job.provider_task_id) return { resumed: false };
    const taskId = linked.dispatch_task_id ?? `${CAMPAIGN_DISPATCH_PREFIX}${linked.dispatch_attempt}`;
    await markRenderRunningWithTask(tx, id, { provider: 'modelark', taskId });
    return { resumed: true };
  });
}
export const CAMPAIGN_DISPATCH_REVIEW_MINUTES = 20;

/** Persist a fencing marker BEFORE the non-idempotent provider create call. A lost response or
 * killed invocation stays running, holds capacity/assets and is never automatically re-created.
 */
export async function claimCampaignDispatch(sql: SqlRunner, id: string, attempt: number, now: Date): Promise<{ campaign: boolean; claimed: boolean }> {
  if (!await campaignProductionSchemaReady(sql)) return { campaign: false, claimed: false };
  return sql.transaction(async tx => {
    const linked = (await tx.query('select render_id from campaign_render_jobs where render_id=$1 for update', [id])).rows[0];
    if (!linked) return { campaign: false, claimed: false };
    const claimed = (await tx.query<{ render_id: string }>(`update campaign_render_jobs l set dispatch_attempt=$2,dispatch_started_at=$3
      where l.render_id=$1 and l.dispatch_attempt=0 and exists(select 1 from render_jobs j where j.id=l.render_id and j.status='running' and j.attempts=$2) returning l.render_id`, [id, attempt, now])).rows.length > 0;
    if (claimed) await tx.query("update render_jobs set provider='modelark',provider_task_id=$2 where id=$1 and status='running'", [id, `${CAMPAIGN_DISPATCH_PREFIX}${attempt}`]);
    return { campaign: true, claimed };
  });
}
/** The provider acknowledgement and its queue link commit together. One task cannot be assigned
 * to two campaign creators, nor can recovery attach a task already belonging to another render.
 */
export async function acknowledgeCampaignTask(sql: SqlRunner, id: string, taskId: string) {
  return sql.transaction(async tx => {
    if ((await tx.query('select id from render_jobs where provider_task_id=$1 and id<>$2 limit 1', [taskId, id])).rows.length) throw Error('campaign_task_conflict');
    await tx.query('update campaign_render_jobs set dispatch_task_id=$2 where render_id=$1', [id, taskId]);
    await markRenderRunningWithTask(tx, id, { provider: 'modelark', taskId });
  });
}
/** Studio recovery only, after the invocation lease. An operator must identify the ORIGINAL task,
 * or confirm in the provider console that no task was created before releasing capacity.
 */
export async function resolveCampaignDispatch(deps: { sql: SqlRunner; now?: Date }, viewer: Viewer, input: unknown) {
  const parsed = z.object({ renderId: z.string().uuid(), action: z.enum(['attach', 'not_created']), taskId: z.string().trim().max(200).default(''), confirmed: z.literal(true) }).strict().safeParse(input);
  if (!parsed.success) return { ok: false as const, code: 'invalid' };
  if (!viewer.userId || !(await deps.sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1', [viewer.userId])).rows[0]?.is_admin) return { ok: false as const, code: 'forbidden' };
  const v = parsed.data, now = deps.now ?? new Date();
  if (v.action === 'attach' && !/^[a-zA-Z0-9_-]{10,200}$/.test(v.taskId)) return { ok: false as const, code: 'invalid' };
  if (!await campaignProductionSchemaReady(deps.sql)) return { ok: false as const, code: 'unavailable' };
  return deps.sql.transaction(async sql => {
    const row = (await sql.query<{ status: string; provider_task_id: string | null; dispatch_started_at: Date }>(`select j.status,j.provider_task_id,l.dispatch_started_at from campaign_render_jobs l join render_jobs j on j.id=l.render_id where j.id=$1 for update of l,j`, [v.renderId])).rows[0];
    if (!row || row.status !== 'running' || !row.provider_task_id?.startsWith(CAMPAIGN_DISPATCH_PREFIX)) return { ok: false as const, code: 'conflict' };
    if (!row.dispatch_started_at || +now - +new Date(row.dispatch_started_at) < CAMPAIGN_DISPATCH_REVIEW_MINUTES * 60000) return { ok: false as const, code: 'not_releasable' };
    if (v.action === 'attach') {
      if ((await sql.query('select id from render_jobs where provider_task_id=$1 and id<>$2 limit 1', [v.taskId, v.renderId])).rows.length) return { ok: false as const, code: 'conflict' };
      await acknowledgeCampaignTask(sql, v.renderId, v.taskId);
    }
    else await markRenderFailed(sql, v.renderId, { code: 'engine_error', message: 'Campaign provider console confirmed no task was created.', finishedAt: now });
    await sql.query('update campaign_render_jobs set dispatch_resolved_by=$2,dispatch_resolved_at=$3 where render_id=$1', [v.renderId, viewer.userId, now]);
    return { ok: true as const };
  });
}
