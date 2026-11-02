import { createHash, randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { detectTransferRisk, RISK_VERSION, type RiskResult } from './detector';
export const sourceHash = (body: string) => createHash('sha256').update(body).digest('hex');
export const riskEnabled = () => process.env.CAMPAIGN_RISK_ENABLED === 'on';
export async function insertRiskFlag(
  sql: SqlRunner,
  source: { id: string; applicationId: string; hash: string },
  result: RiskResult,
  detector: 'rules' | 'local_model',
  modelId: string | null = null,
) {
  if (result.category === 'none') return;
  const id = randomUUID();
  // Evidence contains offsets only. Original text is loaded with admin authorization when reviewed.
  const r = await sql.query(
    `insert into campaign_risk_flags(id,message_id,application_id,source_hash,detector,detector_version,model_id,category,confidence,evidence) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb) on conflict do nothing returning id`,
    [
      id,
      source.id,
      source.applicationId,
      source.hash,
      detector,
      RISK_VERSION,
      modelId,
      result.category,
      result.confidence,
      JSON.stringify(result.evidence.map(({ start, end }) => ({ start, end }))),
    ],
  );
  if (r.rows.length)
    await sql.query(
      "insert into campaign_risk_slack_outbox(id,flag_id,event_type,message_id,source_hash) values($1,$2,'risk_review_required',$3,$4) on conflict(message_id,source_hash,event_type) do nothing",
      [randomUUID(), id, source.id, source.hash],
    );
}
/** Call inside the SAME message transaction. Only fixed metadata survives in the queue. */
export async function enqueueCampaignRisk(
  sql: SqlRunner,
  input: {
    id: string;
    threadId?: string;
    applicationId?: string;
    body: string;
    authorRole: string;
  },
) {
  if (!riskEnabled()) return;
  const applicationId = input.applicationId ?? input.threadId;
  if (!applicationId) throw Error('application_required');
  const hash = sourceHash(input.body);
  await sql.query(
    'insert into campaign_risk_jobs(id,message_id,application_id,source_hash,detector_version) values($1,$2,$3,$4,$5) on conflict(message_id) do nothing',
    [randomUUID(), input.id, applicationId, hash, RISK_VERSION],
  );
  for (const result of detectTransferRisk(input.body))
    await insertRiskFlag(sql, { id: input.id, applicationId, hash }, result, 'rules');
}
