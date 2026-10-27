import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { INFLUENCER_MIN_FOLLOWERS, socialReady, type SocialPlatform } from './rules';
import type { SocialRow } from './service';

/**
 * The "SNS 확인" queue (docs/PLATFORM-2.0.md §17.1). An administrator looks at the screenshot, the
 * link, what the member typed and what the local model read, then types the number that counts.
 * The AI suggestion is shown, never copied in: `social.verify` refuses without a typed count.
 */
const WAITING = "(status='submitted' or recheck_at is not null)";

export interface SocialQueueItem {
  id: string; userId: string; platform: SocialPlatform; handle: string; profileUrl: string;
  claimedCount: number | null; followerCount: number | null; status: SocialRow['status']; recheck: boolean;
  aiCount: number | null; aiConfidence: number | null; aiModel: string | null; aiNote: string | null; aiState: SocialRow['ai_state'];
  note: string | null; submittedAt: string; reviewedAt: string | null; evidenceUrl: string | null;
}
export const adminSocialEvidenceHref = (id: string) => `/api/admin/social/${id}/evidence`;

function item(row: SocialRow): SocialQueueItem {
  return {
    id: row.id, userId: row.user_id, platform: row.platform, handle: row.handle, profileUrl: row.profile_url,
    claimedCount: row.claimed_count, followerCount: row.follower_count, status: row.status, recheck: row.recheck_at !== null,
    aiCount: row.ai_count, aiConfidence: row.ai_confidence === null ? null : Number(row.ai_confidence), aiModel: row.ai_model,
    aiNote: row.ai_note, aiState: row.ai_state, note: row.note, submittedAt: new Date(row.updated_at).toISOString(),
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toISOString() : null,
    evidenceUrl: row.evidence_key ? adminSocialEvidenceHref(row.id) : null,
  };
}

/** Waiting first (oldest first), then the last 20 decisions. `null` before 0057. */
export async function loadSocialQueue(sql: SqlRunner): Promise<{ waiting: SocialQueueItem[]; decided: SocialQueueItem[] } | null> {
  if (!(await socialReady(sql))) return null;
  const [waiting, decided] = await Promise.all([
    sql.query<SocialRow>(`select * from social_accounts where ${WAITING} order by updated_at limit 100`),
    sql.query<SocialRow>(`select * from social_accounts where not ${WAITING} order by reviewed_at desc nulls last limit 20`),
  ]);
  return { waiting: waiting.rows.map(item), decided: decided.rows.map(item) };
}

export async function countSocialQueue(sql: SqlRunner): Promise<number> {
  if (!(await socialReady(sql))) return 0;
  return (await sql.query<{ n: number }>(`select count(*)::int n from social_accounts where ${WAITING}`)).rows[0]?.n ?? 0;
}

/** Re-read `is_admin` under the decision's transaction; the dispatcher's check is not the only one. */
async function stillAdmin(sql: SqlRunner, viewer: Viewer): Promise<boolean> {
  if (!viewer.userId) return false;
  return (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1 for share', [viewer.userId])).rows[0]?.is_admin === true;
}

export const VerifySocial = z.object({
  id: z.string().uuid(),
  followerCount: z.number().int().min(0).max(1_000_000_000),
}).strict();
export const RejectSocial = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type SocialDecision = { ok: true; influencer: boolean } | { ok: false; code: 'invalid' | 'forbidden' | 'notFound' | 'badTransition' };

/**
 * Confirm the number. `source=manual`, `measured_at=now`; the first confirmation at 3,000+ sets
 * `profiles.influencer_since` and later ones never move it.
 */
export async function verifySocialAccount(sql: SqlRunner, viewer: Viewer, input: unknown, now: Date = new Date()): Promise<SocialDecision> {
  const p = VerifySocial.safeParse(input);
  if (!p.success) return { ok: false, code: 'invalid' };
  if (!(await socialReady(sql))) return { ok: false, code: 'notFound' };
  return sql.transaction(async tx => {
    if (!(await stillAdmin(tx, viewer))) return { ok: false, code: 'forbidden' };
    const row = (await tx.query<SocialRow>('select * from social_accounts where id=$1 for update', [p.data.id])).rows[0];
    if (!row) return { ok: false, code: 'notFound' };
    if (row.status !== 'submitted' && row.recheck_at === null) return { ok: false, code: 'badTransition' };
    await tx.query(
      `update social_accounts set status='verified',follower_count=$2,measured_at=$3,source='manual',reviewed_by=$4,reviewed_at=$3,
         recheck_at=null,note=null,updated_at=$3,ai_state=case when ai_state in ('queued','leased') then 'done' else ai_state end,
         ai_lease_token=null,ai_lease_until=null where id=$1`,
      [row.id, p.data.followerCount, now, viewer.userId],
    );
    const influencer = p.data.followerCount >= INFLUENCER_MIN_FOLLOWERS;
    if (influencer) await tx.query('update profiles set influencer_since=coalesce(influencer_since,$2) where id=$1', [row.user_id, now]);
    return { ok: true, influencer };
  });
}

/** Turn it down with the reason the member reads on /identity/social. */
export async function rejectSocialAccount(sql: SqlRunner, viewer: Viewer, input: unknown, now: Date = new Date()): Promise<SocialDecision> {
  const p = RejectSocial.safeParse(input);
  if (!p.success) return { ok: false, code: 'invalid' };
  if (!(await socialReady(sql))) return { ok: false, code: 'notFound' };
  return sql.transaction(async tx => {
    if (!(await stillAdmin(tx, viewer))) return { ok: false, code: 'forbidden' };
    const row = (await tx.query<SocialRow>('select * from social_accounts where id=$1 for update', [p.data.id])).rows[0];
    if (!row) return { ok: false, code: 'notFound' };
    if (row.status !== 'submitted' && row.recheck_at === null) return { ok: false, code: 'badTransition' };
    await tx.query(
      `update social_accounts set status='rejected',note=$2,reviewed_by=$3,reviewed_at=$4,recheck_at=null,updated_at=$4,
         ai_state=case when ai_state in ('queued','leased') then 'done' else ai_state end,ai_lease_token=null,ai_lease_until=null where id=$1`,
      [row.id, p.data.reason, viewer.userId, now],
    );
    return { ok: true, influencer: false };
  });
}

/** Admin-only screenshot key, for the review image route. */
export async function adminSocialEvidence(sql: SqlRunner, id: string): Promise<string | null> {
  if (!z.string().uuid().safeParse(id).success || !(await socialReady(sql))) return null;
  return (await sql.query<{ evidence_key: string | null }>('select evidence_key from social_accounts where id=$1', [id])).rows[0]?.evidence_key ?? null;
}
