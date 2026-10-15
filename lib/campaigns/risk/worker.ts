import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { insertRiskFlag, riskEnabled, sourceHash } from './queue';
import { RISK_VERSION, validateModelResult } from './detector';
export const LEASE_MS = 300_000;
export const RETRY_MS = [60_000, 240_000, 900_000, 3_600_000, 14_400_000];
export interface RiskClaim {
  id: string;
  leaseToken: string;
  messageId: string;
  applicationId: string;
  body: string;
  authorRole: string;
  sourceHash: string;
}
export async function failRiskJob(
  sql: SqlRunner,
  id: string,
  token: string,
  code: 'model_unavailable' | 'invalid_result' | 'source_changed',
  now = new Date(),
) {
  return sql.query(
    `update campaign_risk_jobs set state=case when attempts>=5 then 'dead' else 'queued' end,available_at=$4::timestamptz + (case attempts when 1 then 60 when 2 then 240 when 3 then 900 when 4 then 3600 else 14400 end)*interval '1 second',lease_token=null,lease_until=null,error_code=$3 where id=$1 and state='leased' and lease_token=$2 and lease_until>$4 returning id`,
    [id, token, code, now],
  );
}
export async function claimRiskJobs(
  sql: SqlRunner,
  limit = 1,
  now = new Date(),
): Promise<RiskClaim[]> {
  if (!riskEnabled()) return [];
  return sql.transaction(async (tx) => {
    await tx.query(
      `update campaign_risk_jobs set state=case when attempts>=5 then 'dead' else 'queued' end,error_code='lease_expired',available_at=$1::timestamptz + (case attempts when 1 then 60 when 2 then 240 when 3 then 900 when 4 then 3600 else 14400 end)*interval '1 second',lease_token=null,lease_until=null where state='leased' and lease_until<=$1`,
      [now],
    );
    const rows = (
      await tx.query<{
        id: string;
        message_id: string;
        application_id: string;
        source_hash: string;
      }>(
        `select id,message_id,application_id,source_hash from campaign_risk_jobs where state='queued' and available_at<=$1 order by created_at for update skip locked limit $2`,
        [now, Math.max(1, Math.min(10, limit))],
      )
    ).rows;
    const claims: RiskClaim[] = [];
    for (const j of rows) {
      const token = randomUUID();
      await tx.query(
        "update campaign_risk_jobs set state='leased',attempts=attempts+1,lease_token=$2,lease_until=$3 where id=$1",
        [j.id, token, new Date(now.getTime() + LEASE_MS)],
      );
      const m = (
        await tx.query<{ body: string; author_role: string }>(
          'select body,author_role from campaign_participant_messages where id=$1 and application_id=$2',
          [j.message_id, j.application_id],
        )
      ).rows[0];
      if (!m || sourceHash(m.body) !== j.source_hash) {
        await failRiskJob(tx, j.id, token, 'source_changed', now);
        continue;
      }
      claims.push({
        id: j.id,
        leaseToken: token,
        messageId: j.message_id,
        applicationId: j.application_id,
        body: m.body,
        authorRole: m.author_role,
        sourceHash: j.source_hash,
      });
    }
    return claims;
  });
}
const Complete = z
  .object({
    id: z.string().uuid(),
    leaseToken: z.string().uuid(),
    modelId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\w.:/-]+$/),
    result: z.unknown().optional(),
    error: z.literal('model_unavailable').optional(),
  })
  .strict();
export async function completeRiskJob(
  sql: SqlRunner,
  input: unknown,
  now = new Date(),
): Promise<boolean> {
  if (!riskEnabled()) return false;
  const p = Complete.safeParse(input);
  if (!p.success) {
    const identity = z
      .object({ id: z.string().uuid(), leaseToken: z.string().uuid() })
      .safeParse(input);
    if (identity.success)
      await failRiskJob(sql, identity.data.id, identity.data.leaseToken, 'invalid_result', now);
    return false;
  }
  const v = p.data;
  return sql.transaction(async (tx) => {
    const j = (
      await tx.query<{ message_id: string; application_id: string; source_hash: string }>(
        "select message_id,application_id,source_hash from campaign_risk_jobs where id=$1 and state='leased' and lease_token=$2 and lease_until>$3 for update",
        [v.id, v.leaseToken, now],
      )
    ).rows[0];
    if (!j) return false;
    if (v.error) {
      await failRiskJob(tx, v.id, v.leaseToken, v.error, now);
      return true;
    }
    const m = (
      await tx.query<{ body: string }>(
        'select body from campaign_participant_messages where id=$1 and application_id=$2',
        [j.message_id, j.application_id],
      )
    ).rows[0];
    if (!m || sourceHash(m.body) !== j.source_hash) {
      await failRiskJob(tx, v.id, v.leaseToken, 'source_changed', now);
      return false;
    }
    const result = validateModelResult(m.body, v.result);
    if (!result) {
      await failRiskJob(tx, v.id, v.leaseToken, 'invalid_result', now);
      return false;
    }
    await insertRiskFlag(
      tx,
      { id: j.message_id, applicationId: j.application_id, hash: j.source_hash },
      result,
      'local_model',
      v.modelId,
    );
    await tx.query(
      "update campaign_risk_jobs set state='done',lease_token=null,lease_until=null,error_code=null where id=$1",
      [v.id],
    );
    return true;
  });
}
export async function riskHeartbeat(sql: SqlRunner, input: unknown, now = new Date()) {
  const p = z
    .object({
      id: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[\w.-]+$/),
      version: z.literal(RISK_VERSION),
      modelId: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[\w.:/-]+$/),
    })
    .strict()
    .safeParse(input);
  if (!p.success) return false;
  await sql.query(
    'insert into campaign_risk_workers(id,version,model_id,last_seen_at) values($1,$2,$3,$4) on conflict(id) do update set version=excluded.version,model_id=excluded.model_id,last_seen_at=excluded.last_seen_at',
    [p.data.id, p.data.version, p.data.modelId, now],
  );
  return true;
}
