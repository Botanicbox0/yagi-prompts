import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import { socialReady, type SocialPlatform } from './rules';

/**
 * The local AI's queue (docs/PLATFORM-2.0.md §17.1) — the campaign-risk shape: the app hands out a
 * lease, the workstation reads the screenshot with its vision model and reports back. The answer
 * lands in `ai_*` only: status, follower_count and the queue order are untouched, so a member is
 * never verified or rejected by a model, and the admin queue works the same with no worker at all.
 *
 * Three tries per submission (a lease that runs out counts as one), then `ai_state='failed'` with
 * the reason in `ai_note`. A re-submission starts the count over.
 */
export const SOCIAL_LEASE_MS = 300_000;
export const SOCIAL_MAX_ATTEMPTS = 3;
/** Long enough for one model call on a busy GPU, short enough to die with the lease. */
export const SOCIAL_EVIDENCE_URL_TTL_S = 600;
const BACKOFF_S = "(case ai_attempts when 1 then 60 else 300 end)";
const WAITING = "(status='submitted' or recheck_at is not null)";

export interface SocialClaim {
  id: string;
  leaseToken: string;
  platform: SocialPlatform;
  handle: string;
  /** A signed URL to the screenshot, or null when the store has none (local) — then POST `evidence`. */
  imageUrl: string | null;
}

export const ModelReading = z.object({
  handle: z.string().trim().max(60).nullable(),
  followers: z.number().int().min(0).max(1_000_000_000).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();
export type ModelReading = z.infer<typeof ModelReading>;

const ModelId = z.string().min(1).max(120).regex(/^[\w.:/-]+$/);
const Complete = z.object({
  id: z.string().uuid(),
  leaseToken: z.string().uuid(),
  modelId: ModelId,
  result: z.unknown().optional(),
  error: z.enum(['model_unavailable', 'image_unavailable', 'invalid_result']).optional(),
}).strict();

/** Give a failed lease back: queued again after a back-off, or `failed` once the tries are spent. */
async function failLease(sql: SqlRunner, id: string, token: string, code: string, now: Date): Promise<void> {
  await sql.query(
    `update social_accounts set ai_state=case when ai_attempts>=${SOCIAL_MAX_ATTEMPTS} then 'failed' else 'queued' end,
       ai_note=case when ai_attempts>=${SOCIAL_MAX_ATTEMPTS} then $3 else ai_note end,
       ai_available_at=$4::timestamptz + ${BACKOFF_S}*interval '1 second',ai_lease_token=null,ai_lease_until=null
     where id=$1 and ai_state='leased' and ai_lease_token=$2`,
    [id, token, `failed:${code}`, now],
  );
}

/** "@Some.Name" → "some.name": what a screenshot shows against what the member linked. */
const bareHandle = (value: string) => value.trim().replace(/^@/, '').toLowerCase();

export function aiNote(row: { handle: string }, reading: ModelReading): string {
  if (!reading.handle) return 'handle_unread';
  const read = bareHandle(reading.handle).slice(0, 60);
  return read === row.handle ? 'handle_match' : `handle_mismatch:@${read}`;
}

export async function claimSocialJobs(sql: SqlRunner, store: RenderStore, limit = 1, now: Date = new Date()): Promise<SocialClaim[]> {
  if (!(await socialReady(sql))) return [];
  const claims = await sql.transaction(async tx => {
    // Leases that ran out count as a try.
    const stale = (await tx.query<{ id: string; ai_lease_token: string }>(
      "select id,ai_lease_token from social_accounts where ai_state='leased' and ai_lease_until<=$1 for update skip locked",
      [now],
    )).rows;
    for (const row of stale) await failLease(tx, row.id, row.ai_lease_token, 'lease_expired', now);
    const rows = (await tx.query<{ id: string; platform: SocialPlatform; handle: string; evidence_key: string }>(
      `select id,platform,handle,evidence_key from social_accounts
        where ${WAITING} and ai_state='queued' and ai_available_at<=$1 and evidence_key is not null
        order by updated_at for update skip locked limit $2`,
      [now, Math.max(1, Math.min(5, limit))],
    )).rows;
    const out: Array<Omit<SocialClaim, 'imageUrl'> & { key: string }> = [];
    for (const row of rows) {
      const token = randomUUID();
      await tx.query(
        "update social_accounts set ai_state='leased',ai_attempts=ai_attempts+1,ai_lease_token=$2,ai_lease_until=$3 where id=$1",
        [row.id, token, new Date(now.getTime() + SOCIAL_LEASE_MS)],
      );
      out.push({ id: row.id, leaseToken: token, platform: row.platform, handle: row.handle, key: row.evidence_key });
    }
    return out;
  });
  return Promise.all(claims.map(async ({ key, ...claim }) => ({
    ...claim,
    imageUrl: await store.url(key, SOCIAL_EVIDENCE_URL_TTL_S).catch(() => null),
  })));
}

/** The screenshot for a live lease only — the local-store path where no signed URL exists. */
export async function leasedEvidence(sql: SqlRunner, store: RenderStore, input: unknown, now: Date = new Date()): Promise<Uint8Array | null> {
  const p = z.object({ id: z.string().uuid(), leaseToken: z.string().uuid() }).strict().safeParse(input);
  if (!p.success || !(await socialReady(sql))) return null;
  const row = (await sql.query<{ evidence_key: string | null }>(
    "select evidence_key from social_accounts where id=$1 and ai_state='leased' and ai_lease_token=$2 and ai_lease_until>$3",
    [p.data.id, p.data.leaseToken, now],
  )).rows[0];
  if (!row?.evidence_key) return null;
  return store.read(row.evidence_key).catch(() => null);
}

/**
 * Record the reading. Only the holder of a live lease on a still-waiting row is heard; a second
 * call with the same lease, a stale one or one for a row an administrator already decided is a
 * no-op that answers false. An unusable reading is a failed try, like an error report.
 */
export async function completeSocialJob(sql: SqlRunner, input: unknown, now: Date = new Date()): Promise<boolean> {
  if (!(await socialReady(sql))) return false;
  const p = Complete.safeParse(input);
  if (!p.success) {
    const identity = z.object({ id: z.string().uuid(), leaseToken: z.string().uuid() }).safeParse(input);
    if (identity.success) await failLease(sql, identity.data.id, identity.data.leaseToken, 'invalid_result', now);
    return false;
  }
  const v = p.data;
  return sql.transaction(async tx => {
    const row = (await tx.query<{ id: string; handle: string }>(
      `select id,handle from social_accounts where id=$1 and ai_state='leased' and ai_lease_token=$2 and ai_lease_until>$3 and ${WAITING} for update`,
      [v.id, v.leaseToken, now],
    )).rows[0];
    if (!row) return false;
    if (v.error) {
      await failLease(tx, v.id, v.leaseToken, v.error, now);
      return true;
    }
    const reading = ModelReading.safeParse(v.result);
    if (!reading.success) {
      await failLease(tx, v.id, v.leaseToken, 'invalid_result', now);
      return false;
    }
    await tx.query(
      `update social_accounts set ai_state='done',ai_count=$2,ai_confidence=$3,ai_model=$4,ai_note=$5,ai_lease_token=null,ai_lease_until=null where id=$1`,
      [row.id, reading.data.followers, Math.round(reading.data.confidence * 1000) / 1000, v.modelId, aiNote(row, reading.data)],
    );
    return true;
  });
}

export async function socialHeartbeat(sql: SqlRunner, input: unknown, now: Date = new Date()): Promise<boolean> {
  const p = z.object({ id: z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/), modelId: ModelId }).strict().safeParse(input);
  if (!p.success || !(await socialReady(sql))) return false;
  await sql.query(
    'insert into social_verify_workers(id,model_id,last_seen_at) values($1,$2,$3) on conflict(id) do update set model_id=excluded.model_id,last_seen_at=excluded.last_seen_at',
    [p.data.id, p.data.modelId, now],
  );
  return true;
}

/** For the admin queue's one status line: when a worker last checked in, and with which model. */
export async function lastSocialWorker(sql: SqlRunner): Promise<{ modelId: string; lastSeenAt: string } | null> {
  if (!(await socialReady(sql))) return null;
  const row = (await sql.query<{ model_id: string; last_seen_at: Date }>('select model_id,last_seen_at from social_verify_workers order by last_seen_at desc limit 1')).rows[0];
  return row ? { modelId: row.model_id, lastSeenAt: new Date(row.last_seen_at).toISOString() } : null;
}
