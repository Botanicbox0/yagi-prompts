import type { SqlRunner } from '@/lib/db/sql-runner';
import type { InquiryType } from './schemas';
import type { SlackInquiryConfiguration, SlackInquiryOutcome, SlackInquirySender } from './slack';

const MAX_ATTEMPTS = 5;
const LEASE_MINUTES = 5;

export type BrandInquiryDeliveryStatus = 'pending' | 'sending' | 'sent' | 'uncertain' | 'failed';

/** Admin-only callers use this separately from the enquiry's business status. */
export async function loadBrandInquiryDeliveryStates(sql: SqlRunner, inquiryIds: string[]): Promise<Map<string, BrandInquiryDeliveryStatus>> {
  if (inquiryIds.length === 0) return new Map();
  const { rows } = await sql.query<{ inquiry_id: string; status: BrandInquiryDeliveryStatus }>(
    'select inquiry_id, status from brand_inquiry_deliveries where inquiry_id = any($1::uuid[])', [inquiryIds],
  );
  return new Map(rows.map(row => [row.inquiry_id, row.status]));
}

export interface BrandInquiryDeliveryReport {
  configuration: SlackInquiryConfiguration;
  claimed: number;
  sent: number;
  deferred: number;
  uncertain: number;
  failed: number;
  recoveredUncertain: number;
}

interface ClaimedDelivery { inquiry_id: string; inquiry_type: InquiryType; claim_token: string; attempts: number }

/**
 * Each claim is one statement under row locks, so concurrent serverless invocations cannot send
 * the same pending row. A lost acknowledgement is quarantined, not retried: incoming webhooks
 * cannot prove whether an interrupted request posted. The inquiry remains in the admin inbox.
 */
export async function runBrandInquiryDeliveryPass(args: {
  sql: SqlRunner;
  sender: SlackInquirySender | null;
  configuration?: SlackInquiryConfiguration;
  now?: Date;
  limit?: number;
  inquiryId?: string;
}): Promise<BrandInquiryDeliveryReport> {
  const { sql, sender } = args;
  const now = args.now ?? new Date();
  const report: BrandInquiryDeliveryReport = {
    configuration: args.configuration ?? (sender ? 'configured' : 'unconfigured'),
    claimed: 0, sent: 0, deferred: 0, uncertain: 0, failed: 0, recoveredUncertain: 0,
  };
  if (!sender) return report;
  const iso = now.toISOString();
  const recovered = await sql.query(
    `update brand_inquiry_deliveries set status = 'uncertain', last_error_code = 'claim_expired'
      where status = 'sending' and claimed_at <= $1::timestamptz - make_interval(mins => $2::int)
      returning inquiry_id`, [iso, LEASE_MINUTES],
  );
  report.recoveredUncertain = recovered.rows.length;
  const limit = Math.max(1, Math.min(5, Math.floor(args.limit ?? 5)));
  // Claim one at a time. A worker that stops after a rate limit leaves the rest pending.
  for (let i = 0; i < limit; i += 1) {
    const { rows } = await sql.query<ClaimedDelivery>(
      `with candidate as (
         select inquiry_id from brand_inquiry_deliveries
         where status = 'pending' and attempts < $2::int
           and (next_attempt_at is null or next_attempt_at <= $1::timestamptz)
           and ($3::uuid is null or inquiry_id = $3::uuid)
         order by created_at, inquiry_id limit 1 for update skip locked
       ), claimed as (
         update brand_inquiry_deliveries d
         set status = 'sending', claimed_at = $1::timestamptz, claim_token = gen_random_uuid(), attempts = d.attempts + 1
         from candidate c where d.inquiry_id = c.inquiry_id
         returning d.inquiry_id, d.claim_token, d.attempts
       )
       select c.*, q.inquiry_type from claimed c join brand_inquiries q on q.id = c.inquiry_id`,
      [iso, MAX_ATTEMPTS, args.inquiryId ?? null],
    );
    const row = rows[0];
    if (!row) break;
    report.claimed += 1;
    let outcome: SlackInquiryOutcome;
    try { outcome = await sender.send({ inquiryId: row.inquiry_id, inquiryType: row.inquiry_type }); }
    catch { outcome = { status: 'uncertain', code: 'sender_error' }; }
    const status = outcome.status === 'retry' ? (row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending') : outcome.status;
    const code = outcome.status === 'sent' ? null : outcome.status === 'retry' && status === 'failed' ? 'attempt_limit' : outcome.code;
    // Reject unbounded transport text even if a future sender accidentally supplies it.
    const safeCode = code && /^[a-z0-9_]{1,64}$/.test(code) ? code : code ? 'delivery_error' : null;
    const delay = outcome.status === 'retry' ? Math.max(60, outcome.retryAfterSeconds) : null;
    const completedIso = (args.now ?? new Date()).toISOString();
    // Failure here deliberately leaves 'sending': a later pass marks it uncertain without a resend.
    const updated = await sql.query(
      `update brand_inquiry_deliveries set status = $3, last_error_code = $4,
         sent_at = case when $3 = 'sent' then $5::timestamptz else null end,
         next_attempt_at = case when $3 = 'pending' then $5::timestamptz + make_interval(secs => $6::double precision) else null end
       where inquiry_id = $1 and claim_token = $2::uuid and status = 'sending' returning inquiry_id`,
      [row.inquiry_id, row.claim_token, status, safeCode, completedIso, delay],
    );
    if (updated.rows.length > 0) {
      if (status === 'pending') report.deferred += 1;
      else report[status] += 1;
    }
    if (outcome.status !== 'sent') break;
  }
  return report;
}
