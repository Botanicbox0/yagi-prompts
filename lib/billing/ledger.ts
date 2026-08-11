import type { SqlRunner } from '@/lib/db/sql-runner';
import {
  linkStripeCustomer,
  reconcileSubscription,
  userIdForStripeCustomer,
  type ReconcileDeps,
} from './reconcile';
import type { StripeWebhookEvent } from './stripe-gateway';

/**
 * PLAN §3.4 / §6 — the `stripe_events` ledger.
 *
 * Semantics, verbatim from the plan:
 *   · insert the event id (PK) with `processed_at = NULL`;
 *   · skip an event ONLY if it already exists with `processed_at NOT NULL`;
 *   · process = `reconcileSubscription(userId)` then stamp `processed_at`;
 *   · a failed handler leaves NULL, and the retry sweep reprocesses it.
 *
 * The ledger is an at-least-once trigger log, NOT a state store. Every handler does the same thing
 * — re-fetch truth and apply the fenced upsert — so replays, retries and out-of-order delivery all
 * converge on the newest fetch. That is why "process" needs no per-type branching: the event type
 * only decides *whether* to reconcile, never *what* to write.
 */

export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export function isHandledEventType(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

export type LedgerOutcome =
  /** Reconciled and stamped. */
  | { status: 'processed'; userId: string }
  /** Already stamped by an earlier delivery — the replay case. */
  | { status: 'skipped' }
  /** A type we do not act on. Ledgered and stamped so it is never retried (§ M3 brief). */
  | { status: 'ignored' }
  /**
   * Known type, but no profile maps to the customer yet — typically a subscription event that
   * overtook `checkout.session.completed`. Left NULL so the sweep picks it up once the mapping
   * lands; harmless either way, because whoever reconciles next re-fetches current truth.
   */
  | { status: 'unresolved'; customerId: string | null }
  /** The handler threw. `processed_at` stays NULL; the sweep (and Stripe) will retry. */
  | { status: 'failed'; error: Error };

// ---------------------------------------------------------------------------
// ledger rows
// ---------------------------------------------------------------------------

/** Insert-if-absent, then read back. Returns true when a previous delivery already finished it. */
async function record(sql: SqlRunner, event: StripeWebhookEvent): Promise<boolean> {
  await sql.query(
    `insert into stripe_events (id, type, created, payload)
     values ($1, $2, to_timestamp($3::double precision), $4::jsonb)
     on conflict (id) do nothing`,
    [event.id, event.type, event.created, JSON.stringify(event.payload ?? {})],
  );
  const { rows } = await sql.query<{ processed_at: string | Date | null }>(
    'select processed_at from stripe_events where id = $1',
    [event.id],
  );
  return (rows[0]?.processed_at ?? null) !== null;
}

async function stamp(sql: SqlRunner, id: string): Promise<void> {
  await sql.query('update stripe_events set processed_at = now() where id = $1', [id]);
}

// ---------------------------------------------------------------------------
// processing
// ---------------------------------------------------------------------------

/**
 * Which user does this event concern?
 *
 * `client_reference_id` (set by our own checkout creation) is preferred over the customer map,
 * because on `checkout.session.completed` it is the ONLY link that exists yet — and taking it also
 * writes the map, so every later event resolves by customer id alone.
 */
async function resolveUser(
  sql: SqlRunner,
  event: StripeWebhookEvent,
): Promise<string | null> {
  if (event.clientReferenceId !== null && event.customerId !== null) {
    const { rows } = await sql.query<{ id: string }>('select id from profiles where id = $1', [
      event.clientReferenceId,
    ]);
    if (rows.length > 0) {
      await linkStripeCustomer(sql, event.clientReferenceId, event.customerId);
      return event.clientReferenceId;
    }
  }
  if (event.customerId === null) return null;
  return userIdForStripeCustomer(sql, event.customerId);
}

/** Record → (maybe) reconcile → stamp. The only entry point for a verified event. */
export async function ingestEvent(
  deps: ReconcileDeps,
  event: StripeWebhookEvent,
): Promise<LedgerOutcome> {
  const { sql } = deps;

  if (await record(sql, event)) return { status: 'skipped' };

  if (!isHandledEventType(event.type)) {
    // "Unknown event types: ledger + stamp processed (no-op) — do not error."
    await stamp(sql, event.id);
    return { status: 'ignored' };
  }

  try {
    const userId = await resolveUser(sql, event);
    if (userId === null) {
      return { status: 'unresolved', customerId: event.customerId };
    }
    await reconcileSubscription(deps, userId);
    await stamp(sql, event.id);
    return { status: 'processed', userId };
  } catch (err) {
    // Deliberately no stamp: NULL is the retry marker (§3.4).
    return { status: 'failed', error: err instanceof Error ? err : new Error(String(err)) };
  }
}

// ---------------------------------------------------------------------------
// retry sweep (`npm run stripe:retry`, and the same function for a future cron)
// ---------------------------------------------------------------------------

export interface RetryReport {
  attempted: number;
  processed: number;
  unresolved: number;
  failed: number;
}

interface PendingRow {
  id: string;
  type: string;
  created: string | Date;
  payload: unknown;
}

/**
 * Rebuild the flattened event from the stored payload.
 *
 * The sweep must not re-verify a signature it no longer has, and must not call Stripe to re-read
 * the event: the row IS the record of delivery. Only the identifiers are re-extracted — the state
 * still comes from `reconcileSubscription`'s own fetch.
 */
function eventFromRow(row: PendingRow): StripeWebhookEvent {
  const payload = (row.payload ?? {}) as { data?: { object?: Record<string, unknown> } };
  const object = payload.data?.object ?? {};
  const customer = object.customer;
  const reference = object.client_reference_id;
  const created = row.created instanceof Date ? row.created : new Date(row.created);
  return {
    id: row.id,
    type: row.type,
    created: Math.floor(created.getTime() / 1000),
    customerId:
      typeof customer === 'string'
        ? customer
        : customer && typeof customer === 'object' && typeof (customer as { id?: unknown }).id === 'string'
          ? ((customer as { id: string }).id)
          : null,
    clientReferenceId: typeof reference === 'string' ? reference : null,
    payload: row.payload,
  };
}

/**
 * Reprocess every `processed_at IS NULL` row, oldest first.
 *
 * Bounded by `limit` so a cron invocation has a predictable cost, and idempotent by construction:
 * a row that succeeds is stamped, a row that fails stays NULL for the next run.
 */
export async function retryUnprocessedEvents(
  deps: ReconcileDeps,
  options: { limit?: number } = {},
): Promise<RetryReport> {
  const limit = options.limit ?? 100;
  const { rows } = await deps.sql.query<PendingRow>(
    `select id, type, created, payload from stripe_events
      where processed_at is null
      order by created asc, id asc
      limit $1`,
    [limit],
  );

  const report: RetryReport = { attempted: rows.length, processed: 0, unresolved: 0, failed: 0 };
  for (const row of rows) {
    // `ingestEvent` re-reads the row and finds it unprocessed, so the retry path is literally the
    // delivery path — there is no second implementation to drift.
    const outcome = await ingestEvent(deps, eventFromRow(row));
    if (outcome.status === 'processed' || outcome.status === 'ignored') report.processed += 1;
    else if (outcome.status === 'unresolved') report.unresolved += 1;
    else if (outcome.status === 'failed') report.failed += 1;
  }
  return report;
}

/** How many events are waiting — surfaced by `npm run stripe:retry` and useful in an admin view. */
export async function countUnprocessedEvents(sql: SqlRunner): Promise<number> {
  const { rows } = await sql.query<{ n: number | string }>(
    'select count(*)::int as n from stripe_events where processed_at is null',
  );
  return Number(rows[0]?.n ?? 0);
}
