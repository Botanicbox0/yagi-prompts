import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { sourceHash, riskEnabled } from './queue';
import { slackRiskConfig } from './slack';
export async function isRiskAdmin(sql: SqlRunner, viewer: Viewer) {
  return (
    !!viewer.userId &&
    (
      await sql.query<{ is_admin: boolean }>(
        'select is_admin from profiles where id=$1 for share',
        [viewer.userId],
      )
    ).rows[0]?.is_admin === true
  );
}
export async function riskSchemaReady(sql: SqlRunner) {
  return (
    (
      await sql.query<{ ready: boolean }>(
        "select count(*)=7 as ready from unnest(array['public.campaign_risk_jobs','public.campaign_risk_flags','public.campaign_risk_reviews','public.campaign_risk_workers','public.campaign_risk_slack_outbox','public.campaign_risk_access','public.campaign_participant_messages']) as required(name) where to_regclass(required.name) is not null",
      )
    ).rows[0]?.ready === true
  );
}
export async function loadRiskInbox(
  sql: SqlRunner,
  viewer: Viewer,
  viewId?: string,
  now = new Date(),
  flagId?: string,
) {
  if (!(await isRiskAdmin(sql, viewer))) return null;
  if (!(await riskSchemaReady(sql))) return { ready: false as const };
  const target = z
    .string()
    .uuid()
    .safeParse(flagId ?? viewId);
  const flags = (
    await sql.query<{
      id: string;
      application_id: string;
      category: string;
      confidence: number;
      detector: string;
      detector_version: string;
      model_id: string | null;
      state: string;
      evidence: Array<{ start: number; end: number }>;
      created_at: Date;
      review_reason: string | null;
    }>(
      `select id,application_id,category,confidence,detector,detector_version,model_id,state,evidence,created_at,review_reason from campaign_risk_flags order by (id=$1::uuid) desc nulls last,(state='open') desc,created_at desc limit 100`,
      [target.success ? target.data : null],
    )
  ).rows;
  const jobs = (
    await sql.query<{ state: string; error_code: string | null; n: number }>(
      'select state,error_code,count(*)::int as n from campaign_risk_jobs group by state,error_code',
    )
  ).rows;
  const slack = (
    await sql.query<{ state: string; n: number }>(
      'select state,count(*)::int as n from campaign_risk_slack_outbox group by state',
    )
  ).rows;
  const last =
    (
      await sql.query<{ last_seen_at: Date }>(
        'select last_seen_at from campaign_risk_workers order by last_seen_at desc limit 1',
      )
    ).rows[0]?.last_seen_at ?? null;
  let source: { body: string; id: string; stale: boolean } | null = null;
  if (viewId && z.string().uuid().safeParse(viewId).success) {
    source = await sql.transaction(async (tx) => {
      // Recheck current admin status in the same transaction as original-source access and audit.
      if (!(await isRiskAdmin(tx, viewer))) return null;
      const r = (
        await tx.query<{ body: string; source_hash: string }>(
          `select m.body,f.source_hash from campaign_risk_flags f join campaign_participant_messages m on m.id=f.message_id and m.application_id=f.application_id where f.id=$1`,
          [viewId],
        )
      ).rows[0];
      if (!r) return null;
      await tx.query(
        "insert into campaign_risk_access(id,flag_id,actor_id,purpose) values($1,$2,$3,'risk_review')",
        [randomUUID(), viewId, viewer.userId],
      );
      return { id: viewId, body: r.body, stale: sourceHash(r.body) !== r.source_hash };
    });
  }
  return {
    ready: true as const,
    flags,
    jobs,
    slack,
    lastSeen: last,
    workerUnavailable: !last || now.getTime() - new Date(last).getTime() > 1800000,
    modelUnavailable: jobs.some((job) => job.error_code === 'model_unavailable'),
    enabled: riskEnabled(),
    slackConfig: slackRiskConfig(process.env).status,
    source,
  };
}
export async function reviewRiskFlag(sql: SqlRunner, viewer: Viewer, input: unknown) {
  const p = z
    .object({
      id: z.string().uuid(),
      state: z.enum(['reviewed', 'dismissed', 'escalated']),
      reason: z.string().trim().min(1).max(1000),
    })
    .strict()
    .safeParse(input);
  if (!p.success) return { ok: false as const, code: 'invalid' as const };
  return sql.transaction(async (tx) => {
    if (!(await isRiskAdmin(tx, viewer))) return { ok: false as const, code: 'forbidden' as const };
    const row = (
      await tx.query(
        'update campaign_risk_flags set state=$2,review_reason=$3,reviewed_by=$4,reviewed_at=now() where id=$1 returning id',
        [p.data.id, p.data.state, p.data.reason, viewer.userId],
      )
    ).rows[0];
    if (!row) return { ok: false as const, code: 'notFound' as const };
    await tx.query(
      'insert into campaign_risk_reviews(id,flag_id,actor_id,state,reason) values($1,$2,$3,$4,$5)',
      [randomUUID(), p.data.id, viewer.userId, p.data.state, p.data.reason],
    );
    return { ok: true as const };
  });
}
export async function loadRiskQueueSummary(sql: SqlRunner, viewer: Viewer, now = new Date()) {
  if (!(await isRiskAdmin(sql, viewer))) return null;
  if (!(await riskSchemaReady(sql))) return { ready: false as const };
  const count = (
    await sql.query<{ open: number; dead: number; last_seen_at: Date | null }>(
      `select (select count(*)::int from campaign_risk_flags where state='open') as open,(select count(*)::int from campaign_risk_jobs where state='dead') as dead,(select max(last_seen_at) from campaign_risk_workers) as last_seen_at`,
    )
  ).rows[0]!;
  return {
    ready: true as const,
    open: count.open,
    dead: count.dead,
    workerUnavailable:
      !count.last_seen_at || now.getTime() - new Date(count.last_seen_at).getTime() > 1800000,
    enabled: riskEnabled(),
  };
}
