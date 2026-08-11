import type { SqlRunner } from '@/lib/db/sql-runner';
import { ENTITLED_STATUSES } from '@/lib/billing/entitlement';
import type { Localized } from '@/lib/content/schemas';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/config';
import { idempotencyKeyFor, type Mailer } from './mailer';
import { TOGGLE_FOR_KIND, isNotifyKind, type NotifyKind } from './kinds';
import { renderNotificationEmail } from './templates';
import { unsubscribePath } from './unsubscribe';

/**
 * PLAN §3.5 — the durable outbox worker. One pass, cron-invocable, safe to run concurrently.
 *
 * The pass, in order:
 *
 *   1. **recovery sweep** — `sending` rows whose lease is older than 10 minutes go back to
 *      `pending` (or to `failed` once the attempt budget is spent). A worker that was killed
 *      mid-send leaves exactly this state, and without the sweep those deliveries are lost.
 *   2. **expand** — new jobs become `notification_deliveries` rows, one per recipient, with the
 *      composite PK doing the de-duplication. Re-running inserts nothing (`on conflict do nothing`),
 *      which is the acceptance criterion "job re-run = zero duplicate rows".
 *   3. **claim** — a batch moves `pending → sending` under `FOR UPDATE ... SKIP LOCKED`, stamping
 *      `claimed_at` (the lease) and spending one attempt. Two workers racing take disjoint batches;
 *      a worker that dies holds its batch only until the lease expires.
 *   4. **send** — through the injected `Mailer`, with idempotency key `job_id:user_id`.
 *   5. **mark** — `sent`, or back to `pending` for another attempt, or `failed` when the budget is
 *      spent or the provider said the message can never be accepted.
 *
 * Three decisions worth stating, because they are where exactly-once actually lives:
 *
 * · **The attempt is spent at CLAIM time, not at failure time.** A worker killed between "provider
 *   accepted" and "row marked sent" would otherwise retry forever. Spending it up front bounds the
 *   damage to at most `maxAttempts` duplicate *attempts*, and the provider's idempotency key
 *   collapses those into one delivered email.
 * · **Preference AND entitlement are re-checked inside the claim predicate** (§3.5 "at claim time"),
 *   not only at expansion. Someone who unsubscribes or lapses between publish and send is simply
 *   never claimed; their row stays `pending` and ages out of the window.
 * · **Age windows, not an `expanded_at` column.** §6's schema is fixed, so "new job" is expressed as
 *   "created within `expandWindowHours`" and "still worth sending" as "created within
 *   `claimWindowHours`". A job that misses both is stale news, and stale news must not resurrect
 *   because someone re-subscribed a week later.
 */

// ---------------------------------------------------------------------------
// tuning
// ---------------------------------------------------------------------------

/** §3.5: "attempts ≤3". */
export const MAX_ATTEMPTS = 3;
/** §3.5: "a recovery sweep returns `sending` rows with `claimed_at` older than 10 min to `pending`". */
export const LEASE_MINUTES = 10;
/** Backoff by attempt count: after 1 failure wait 5 minutes, after 2 wait 20. */
export const BACKOFF_MINUTES: Readonly<Record<number, number>> = { 1: 5, 2: 20 };
/** A job younger than this still recruits recipients. */
export const EXPAND_WINDOW_HOURS = 24;
/** A delivery for a job older than this is never claimed — the news has gone stale. */
export const CLAIM_WINDOW_HOURS = 72;
export const DEFAULT_BATCH_SIZE = 50;

export interface NotifyWorkerOptions {
  sql: SqlRunner;
  /** `null` = not configured (§11 stop-gate). The pass then changes nothing and says so. */
  mailer: Mailer | null;
  /** Absolute origin for the links inside the emails (`lib/seo/site-url.ts`). */
  siteUrl: string;
  /** Injectable clock — every window and the backoff are tested against it, never against sleep. */
  now?: Date;
  batchSize?: number;
  maxAttempts?: number;
  leaseMinutes?: number;
  expandWindowHours?: number;
  claimWindowHours?: number;
  /** Signing secret override, so tests do not depend on process env. */
  unsubscribeSecret?: string;
}

export interface NotifyWorkerReport {
  mailer: 'live' | 'fake' | 'unconfigured';
  /** Leases returned to `pending` by the sweep. */
  recovered: number;
  /** Leases the sweep gave up on (attempt budget spent while abandoned). */
  abandoned: number;
  /** Delivery rows created this pass. A re-run of the same jobs must report 0. */
  expanded: number;
  claimed: number;
  sent: number;
  /** Sends that failed and will be retried. */
  deferred: number;
  /** Sends that will never be retried (budget spent, or the provider refused permanently). */
  failed: number;
  /** Recipients + subjects, for the operator's console output. */
  delivered: Array<{ to: string; subject: string; idempotencyKey: string }>;
}

const EMPTY_REPORT: Omit<NotifyWorkerReport, 'mailer'> = {
  recovered: 0,
  abandoned: 0,
  expanded: 0,
  claimed: 0,
  sent: 0,
  deferred: 0,
  failed: 0,
  delivered: [],
};

// ---------------------------------------------------------------------------
// step 1 — recovery sweep
// ---------------------------------------------------------------------------

const RECOVER_SQL = `
  update notification_deliveries d
     set status = case when d.attempts >= $2::int then 'failed' else 'pending' end
   where d.status = 'sending'
     and d.claimed_at is not null
     and d.claimed_at <= $1::timestamptz - make_interval(mins => $3::int)
  returning d.job_id, d.status
`;

// ---------------------------------------------------------------------------
// step 2 — expand jobs into deliveries
// ---------------------------------------------------------------------------

/**
 * The recipient set: an opted-in, entitled profile. The preference column is chosen by the job's
 * kind, and the entitlement is the §3.4 definition imported verbatim — never re-spelled here.
 */
const EXPAND_SQL = `
  insert into notification_deliveries (job_id, user_id)
  select j.id, p.id
    from notification_jobs j
    join profiles p
      on case j.kind
           when 'new_playbook' then p.notif_new_playbook
           else p.notif_updates
         end
    join subscriptions s
      on s.user_id = p.id and s.status = any($2::text[])
   where j.created_at > $1::timestamptz - make_interval(hours => $3::int)
  on conflict (job_id, user_id) do nothing
  returning job_id, user_id
`;

// ---------------------------------------------------------------------------
// step 3 — claim a batch
// ---------------------------------------------------------------------------

/**
 * `FOR UPDATE OF d SKIP LOCKED` inside the CTE is what makes two workers safe: each takes rows the
 * other is not holding, and neither waits. Only the delivery row is locked — the joined profile and
 * subscription rows are read, not reserved.
 */
const CLAIM_SQL = `
  with claimable as (
    select d.job_id, d.user_id
      from notification_deliveries d
      join notification_jobs j on j.id = d.job_id
      join profiles p on p.id = d.user_id
      join subscriptions s on s.user_id = d.user_id
     where d.status = 'pending'
       and d.attempts < $3::int
       and j.created_at > $1::timestamptz - make_interval(hours => $6::int)
       and case j.kind
             when 'new_playbook' then p.notif_new_playbook
             else p.notif_updates
           end
       and s.status = any($2::text[])
       and (
         d.claimed_at is null
         or d.attempts = 0
         or d.claimed_at <= $1::timestamptz - make_interval(
              mins => case d.attempts when 1 then $4::int else $5::int end
            )
       )
     order by j.created_at asc, d.user_id asc
     limit $7::int
     for update of d skip locked
  )
  update notification_deliveries d
     set status = 'sending', claimed_at = $1::timestamptz, attempts = d.attempts + 1
    from claimable c
   where d.job_id = c.job_id and d.user_id = c.user_id
  returning d.job_id, d.user_id, d.attempts
`;

/** The payload for a claimed batch. Paired via `unnest`, so no cross product can sneak in. */
const PAYLOAD_SQL = `
  select d.job_id,
         d.user_id,
         d.attempts,
         j.kind,
         p.email,
         p.locale,
         pb.slug,
         r.title,
         r.summary,
         r.change_note
    from unnest($1::uuid[], $2::uuid[]) as t(job_id, user_id)
    join notification_deliveries d on d.job_id = t.job_id and d.user_id = t.user_id
    join notification_jobs j on j.id = d.job_id
    join playbook_revisions r on r.id = j.revision_id
    join playbooks pb on pb.id = r.playbook_id
    join profiles p on p.id = d.user_id
`;

interface ClaimedRow {
  job_id: string;
  user_id: string;
  attempts: number;
}

interface PayloadRow extends ClaimedRow {
  kind: string;
  email: string;
  locale: string;
  slug: string;
  title: Localized;
  summary: Localized;
  change_note: Localized | null;
}

// ---------------------------------------------------------------------------
// the pass
// ---------------------------------------------------------------------------

/**
 * One worker pass. Exported rather than inlined into the script so the same function can be wired
 * to a Supabase Edge Function on a cron (§3.5 "a scheduled Edge Function, every minute") without a
 * second implementation to keep in step — exactly like `retryUnprocessedEvents` in M3.
 */
export async function runNotifyPass(options: NotifyWorkerOptions): Promise<NotifyWorkerReport> {
  const {
    sql,
    mailer,
    siteUrl,
    now = new Date(),
    batchSize = DEFAULT_BATCH_SIZE,
    maxAttempts = MAX_ATTEMPTS,
    leaseMinutes = LEASE_MINUTES,
    expandWindowHours = EXPAND_WINDOW_HOURS,
    claimWindowHours = CLAIM_WINDOW_HOURS,
    unsubscribeSecret,
  } = options;

  // No mailer configured ⇒ change nothing and say so. Expanding or claiming here would move rows
  // that cannot be sent, which is the dishonest kind of partial success (§11 stop-gate).
  if (mailer === null) return { mailer: 'unconfigured', ...EMPTY_REPORT };

  const report: NotifyWorkerReport = { mailer: mailer.kind, ...EMPTY_REPORT, delivered: [] };
  const iso = now.toISOString();
  const entitled = [...ENTITLED_STATUSES];

  // 1 — recovery sweep
  const recovered = await sql.query<{ status: string }>(RECOVER_SQL, [
    iso,
    maxAttempts,
    leaseMinutes,
  ]);
  for (const row of recovered.rows) {
    if (row.status === 'failed') report.abandoned += 1;
    else report.recovered += 1;
  }

  // 2 — expand
  const expanded = await sql.query(EXPAND_SQL, [iso, entitled, expandWindowHours]);
  report.expanded = expanded.rows.length;

  // 3 — claim
  const claimed = await sql.query<ClaimedRow>(CLAIM_SQL, [
    iso,
    entitled,
    maxAttempts,
    BACKOFF_MINUTES[1],
    BACKOFF_MINUTES[2],
    claimWindowHours,
    batchSize,
  ]);
  report.claimed = claimed.rows.length;
  if (claimed.rows.length === 0) return report;

  const payloads = await sql.query<PayloadRow>(PAYLOAD_SQL, [
    claimed.rows.map((row) => row.job_id),
    claimed.rows.map((row) => row.user_id),
  ]);

  // 4 + 5 — send, then mark
  for (const row of payloads.rows) {
    const outcome = await sendOne(row, { mailer, siteUrl, unsubscribeSecret });

    if (outcome.sent) {
      await sql.query(
        `update notification_deliveries set status = 'sent', sent_at = $3::timestamptz
          where job_id = $1 and user_id = $2`,
        [row.job_id, row.user_id, iso],
      );
      report.sent += 1;
      report.delivered.push(outcome.record);
      continue;
    }

    const terminal = !outcome.retryable || row.attempts >= maxAttempts;
    await sql.query(
      `update notification_deliveries set status = $3 where job_id = $1 and user_id = $2`,
      [row.job_id, row.user_id, terminal ? 'failed' : 'pending'],
    );
    if (terminal) report.failed += 1;
    else report.deferred += 1;
    console.warn(
      `[notify] ${terminal ? 'failed' : 'deferred'} ${row.job_id}:${row.user_id} ` +
        `(attempt ${row.attempts}/${maxAttempts}) — ${outcome.error}`,
    );
  }

  return report;
}

type SendResult =
  | { sent: true; record: { to: string; subject: string; idempotencyKey: string } }
  | { sent: false; retryable: boolean; error: string };

async function sendOne(
  row: PayloadRow,
  deps: { mailer: Mailer; siteUrl: string; unsubscribeSecret?: string },
): Promise<SendResult> {
  const kind: NotifyKind = isNotifyKind(row.kind) ? row.kind : 'new_playbook';
  const locale: Locale = isLocale(row.locale) ? row.locale : DEFAULT_LOCALE;
  const origin = deps.siteUrl.replace(/\/+$/, '');

  const unsubscribe = unsubscribePath(
    { userId: row.user_id, toggle: TOGGLE_FOR_KIND[kind] },
    deps.unsubscribeSecret,
  );

  const email = renderNotificationEmail(
    {
      kind,
      locale,
      title: row.title,
      summary: row.summary,
      changeNote: row.change_note,
    },
    {
      playbookUrl: `${origin}/${locale}/p/${row.slug}`,
      unsubscribeUrl: `${origin}${unsubscribe}`,
      accountUrl: `${origin}/account`,
    },
  );

  const idempotencyKey = idempotencyKeyFor(row.job_id, row.user_id);
  const outcome = await deps.mailer.send({
    to: row.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    idempotencyKey,
    unsubscribeUrl: `${origin}${unsubscribe}`,
  });

  if (outcome.ok) {
    return { sent: true, record: { to: row.email, subject: email.subject, idempotencyKey } };
  }
  return { sent: false, retryable: outcome.retryable, error: outcome.error };
}

/** One-line summary for the worker script and the future Edge Function log. */
export function formatReport(report: NotifyWorkerReport): string {
  return (
    `mailer ${report.mailer} · recovered ${report.recovered} · abandoned ${report.abandoned} · ` +
    `expanded ${report.expanded} · claimed ${report.claimed} · sent ${report.sent} · ` +
    `deferred ${report.deferred} · failed ${report.failed}`
  );
}
