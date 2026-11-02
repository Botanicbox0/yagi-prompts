import { randomUUID } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import { cleanEvidence, socialEvidenceKey } from './evidence';
import {
  SOCIAL_DAILY_SUBMISSIONS,
  SOCIAL_RECHECK_DAYS,
  isSocialPlatform,
  normalizeProfileUrl,
  parseFollowerCount,
  socialReady,
  type SocialPlatform,
} from './rules';

/**
 * A member's linked SNS accounts (docs/PLATFORM-2.0.md §17.1): submit a profile link and one
 * follower screenshot, see where the check stands, unlink. The member never sets `status`,
 * `follower_count` or the AI suggestion; the administrator (`./admin.ts`) and the local worker
 * (`./worker.ts`) do. The screenshot is visible to its owner, administrators and, for the length
 * of a lease, the worker — nobody else, and it never decides anything by itself.
 */
export interface SocialRow {
  id: string; user_id: string; platform: SocialPlatform; handle: string; profile_url: string;
  claimed_count: number | null; follower_count: number | null; evidence_key: string | null;
  status: 'submitted' | 'verified' | 'rejected' | 'expired'; source: 'manual' | 'api';
  ai_count: number | null; ai_confidence: string | number | null; ai_model: string | null; ai_note: string | null;
  ai_state: 'queued' | 'leased' | 'done' | 'failed'; reviewed_at: Date | null; measured_at: Date | null;
  recheck_at: Date | null; note: string | null; pool_consent_at: Date | null; created_at: Date; updated_at: Date;
}
/** What the member sees: `checking` covers a first submission and a re-check alike. */
export type SocialState = 'checking' | 'verified' | 'rejected' | 'expired';
export interface SocialAccountView {
  id: string; platform: SocialPlatform; handle: string; profileUrl: string; claimedCount: number | null;
  followerCount: number | null; state: SocialState; recheck: boolean; measuredAt: string | null;
  source: 'manual' | 'api'; reason: string | null; poolConsent: boolean; submittedAt: string; evidenceUrl: string | null;
}
export interface SocialDeps { sql: SqlRunner; store: RenderStore; now?: Date }
export type SubmitFailure = 'sign_in_required' | 'unavailable' | 'bad_platform' | 'bad_url' | 'bad_count' | 'bad_photo' | 'rate_limited' | 'already_verified';
export type SubmitResult = { ok: true; id: string } | { ok: false; code: SubmitFailure };
export type ChangeResult = { ok: true } | { ok: false; code: 'sign_in_required' | 'unavailable' | 'not_found' };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = 86_400_000;
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
export const socialEvidenceHref = (id: string) => `/api/identity/social/${id}/evidence`;

/** A verified row past SOCIAL_RECHECK_DAYS, with no re-check pending, reads as expired. */
export function socialState(row: Pick<SocialRow, 'status' | 'measured_at' | 'recheck_at'>, now: Date = new Date()): SocialState {
  if (row.status === 'submitted') return 'checking';
  if (row.status === 'rejected') return 'rejected';
  if (row.status === 'expired') return 'expired';
  if (row.recheck_at) return 'checking';
  return row.measured_at && now.getTime() - new Date(row.measured_at).getTime() > SOCIAL_RECHECK_DAYS * DAY ? 'expired' : 'verified';
}

export function socialView(row: SocialRow, now: Date = new Date()): SocialAccountView {
  return {
    id: row.id, platform: row.platform, handle: row.handle, profileUrl: row.profile_url, claimedCount: row.claimed_count,
    followerCount: row.status === 'verified' ? row.follower_count : null, state: socialState(row, now), recheck: row.status === 'verified' && row.recheck_at !== null,
    measuredAt: row.status === 'verified' ? iso(row.measured_at) : null, source: row.source,
    reason: row.status === 'rejected' ? row.note : null, poolConsent: row.pool_consent_at !== null,
    submittedAt: iso(row.updated_at)!, evidenceUrl: row.evidence_key ? socialEvidenceHref(row.id) : null,
  };
}

export async function listSocialAccounts(sql: SqlRunner, userId: string, now: Date = new Date()): Promise<SocialAccountView[]> {
  if (!(await socialReady(sql))) return [];
  const { rows } = await sql.query<SocialRow>(
    "select * from social_accounts where user_id=$1 order by array_position(array['instagram','tiktok','youtube'], platform)",
    [userId],
  );
  return rows.map(row => socialView(row, now));
}

/** Owner-bound read of the screenshot key; a stranger's id is simply not found. */
export async function ownSocialEvidence(sql: SqlRunner, userId: string, id: string): Promise<string | null> {
  if (!uuid.test(id) || !(await socialReady(sql))) return null;
  const { rows } = await sql.query<{ evidence_key: string | null }>('select evidence_key from social_accounts where id=$1 and user_id=$2', [id, userId]);
  return rows[0]?.evidence_key ?? null;
}

/**
 * Submit (or re-submit) one platform. The same platform again replaces the link and the screenshot;
 * a verified account keeps counting while its re-check waits (`recheck_at`), unless the handle
 * changed — that is a different account and starts over. A confirmation younger than 90 days is
 * not re-submitted (`already_verified`). Five submissions a day per member, counted in a ledger an
 * unlink cannot reset. The object is written before the row so a crash leaves an orphan file, never
 * a row pointing at nothing.
 */
export async function submitSocialAccount(
  d: SocialDeps,
  userId: string | null,
  input: { platform: unknown; profileUrl: unknown; claimedCount?: unknown; poolConsent: boolean; bytes: Uint8Array; mime: string },
): Promise<SubmitResult> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!isSocialPlatform(input.platform)) return { ok: false, code: 'bad_platform' };
  const platform = input.platform;
  const profile = typeof input.profileUrl === 'string' ? normalizeProfileUrl(platform, input.profileUrl) : null;
  if (!profile) return { ok: false, code: 'bad_url' };
  const claimed = parseFollowerCount(input.claimedCount);
  if (claimed === undefined) return { ok: false, code: 'bad_count' };
  let evidence: Uint8Array;
  try { evidence = await cleanEvidence(input.bytes, input.mime); } catch { return { ok: false, code: 'bad_photo' }; }
  if (!(await socialReady(d.sql))) return { ok: false, code: 'unavailable' };
  const now = d.now ?? new Date();
  return d.sql.transaction(async sql => {
    if (!(await sql.query('select id from profiles where id=$1 for update', [userId])).rows.length) return { ok: false, code: 'sign_in_required' };
    const recent = (await sql.query<{ n: number }>('select count(*)::int n from social_account_writes where user_id=$1 and created_at>$2', [userId, new Date(now.getTime() - DAY)])).rows[0]?.n ?? 0;
    if (recent >= SOCIAL_DAILY_SUBMISSIONS) return { ok: false, code: 'rate_limited' };
    const existing = (await sql.query<SocialRow>('select * from social_accounts where user_id=$1 and platform=$2 for update', [userId, platform])).rows[0] ?? null;
    if (existing && socialState(existing, now) === 'verified' && existing.handle === profile.handle) return { ok: false, code: 'already_verified' };
    const id = existing?.id ?? randomUUID();
    const key = socialEvidenceKey(id);
    await d.store.put(key, evidence, 'image/jpeg');
    const consent = input.poolConsent ? now : null;
    if (!existing) {
      await sql.query(
        `insert into social_accounts(id,user_id,platform,handle,profile_url,claimed_count,evidence_key,pool_consent_at,created_at,updated_at,ai_available_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9)`,
        [id, userId, platform, profile.handle, profile.url, claimed, key, consent, now],
      );
    } else {
      // Keep an earlier consent time when the box stays ticked; a fresh submission starts the AI over.
      const recheck = existing.status === 'verified' && existing.handle === profile.handle;
      await sql.query(
        `update social_accounts set handle=$2,profile_url=$3,claimed_count=$4,evidence_key=$5,
           pool_consent_at=case when $6::timestamptz is null then null else coalesce(pool_consent_at,$6::timestamptz) end,
           ai_count=null,ai_confidence=null,ai_model=null,ai_note=null,ai_state='queued',ai_attempts=0,ai_available_at=$7::timestamptz,ai_lease_token=null,ai_lease_until=null,
           updated_at=$7::timestamptz,
           status=case when $8::boolean then status else 'submitted' end,
           recheck_at=case when $8::boolean then $7::timestamptz else null end,
           note=case when $8::boolean then note else null end,
           reviewed_by=case when $8::boolean then reviewed_by else null end,
           reviewed_at=case when $8::boolean then reviewed_at else null end
         where id=$1`,
        [id, profile.handle, profile.url, claimed, key, consent, now, recheck],
      );
    }
    await sql.query('insert into social_account_writes(user_id,platform,created_at) values($1,$2,$3)', [userId, platform, now]);
    return { ok: true, id };
  });
}

/** The pool box alone, ticked or not (§17.3 reads it); nothing else about the row moves. */
export async function setPoolConsent(d: Pick<SocialDeps, 'sql' | 'now'>, userId: string | null, id: string, consent: boolean): Promise<ChangeResult> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!uuid.test(id)) return { ok: false, code: 'not_found' };
  if (!(await socialReady(d.sql))) return { ok: false, code: 'unavailable' };
  const { rows } = await d.sql.query(
    'update social_accounts set pool_consent_at=case when $3::boolean then coalesce(pool_consent_at,$4::timestamptz) else null end where id=$1 and user_id=$2 returning id',
    [id, userId, consent, d.now ?? new Date()],
  );
  return rows.length ? { ok: true } : { ok: false, code: 'not_found' };
}

/**
 * Unlink: the row and its screenshot go. This is the member's choice, not a rejection, so nothing
 * is kept for the queue; `profiles.influencer_since` stays the historical first date.
 */
export async function deleteSocialAccount(d: SocialDeps, userId: string | null, id: string): Promise<ChangeResult> {
  if (!userId) return { ok: false, code: 'sign_in_required' };
  if (!uuid.test(id)) return { ok: false, code: 'not_found' };
  if (!(await socialReady(d.sql))) return { ok: false, code: 'unavailable' };
  const { rows } = await d.sql.query<{ evidence_key: string | null }>('delete from social_accounts where id=$1 and user_id=$2 returning evidence_key', [id, userId]);
  if (!rows.length) return { ok: false, code: 'not_found' };
  const key = rows[0]!.evidence_key;
  if (key) await d.store.delete?.(key).catch(() => undefined);
  return { ok: true };
}
