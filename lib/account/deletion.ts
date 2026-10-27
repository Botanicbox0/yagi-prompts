import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';

/**
 * docs/APP-STORE-LAUNCH.md §3.2 — the in-app account deletion request (Apple 5.1.1(v), Google Play's
 * account-deletion policy). A member asks from `/account/delete`; an operator works the request
 * through docs/RUNBOOK-deletion.md and marks it in `/admin/account-deletions`.
 *
 * Nothing here deletes an account. The request row is the intake and the record that the privacy
 * policy's "탈퇴 요청을 받으면 7일 이내에 삭제" was kept; it drops the address once it closes (0064).
 */
export const DELETION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN = "status in ('requested','processing')";

export type DeletionStatus = 'requested' | 'processing' | 'completed' | 'cancelled';

interface DeletionRow {
  id: string;
  user_id: string | null;
  email: string | null;
  status: DeletionStatus;
  requested_at: Date | string;
  due_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  note: string | null;
}

export interface DeletionRequest {
  id: string;
  status: DeletionStatus;
  requestedAt: string;
  dueAt: string;
  startedAt: string | null;
}

const iso = (value: Date | string) => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null) => (value === null ? null : iso(value));

function view(row: DeletionRow): DeletionRequest {
  return { id: row.id, status: row.status, requestedAt: iso(row.requested_at), dueAt: iso(row.due_at), startedAt: isoOrNull(row.started_at) };
}

/** `false` before 0064: `/account` then keeps the mail link and the queue says it is not ready. */
export async function deletionReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>("select to_regclass('public.account_deletion_requests') is not null as ready");
  return rows[0]?.ready === true;
}

export async function openDeletionRequest(sql: SqlRunner, userId: string): Promise<DeletionRequest | null> {
  const { rows } = await sql.query<DeletionRow>(`select * from account_deletion_requests where user_id=$1 and ${OPEN} limit 1`, [userId]);
  return rows[0] ? view(rows[0]) : null;
}

/**
 * What is still moving on the account, shown on the confirmation step so nobody loses a video in the
 * oven, a payment in flight, a monthly plan or a campaign payout by surprise. Counts only; the
 * request is never refused because of them. A table that is not in this database counts as zero.
 */
export interface DeletionPending {
  renders: number;
  payments: number;
  subscription: boolean;
  campaigns: number;
}
export const NOTHING_PENDING: DeletionPending = { renders: 0, payments: 0, subscription: false, campaigns: 0 };

export const DELETION_PENDING_QUERIES = {
  render_jobs: "select count(*)::int n from render_jobs where user_id=$1 and status in ('held','queued','running')",
  billing_payments: "select count(*)::int n from billing_payments where user_id=$1 and status in ('confirming','refund_pending')",
  creator_subscriptions: "select count(*)::int n from creator_subscriptions where user_id=$1 and status in ('awaiting_auth','authorizing','active','past_due','refund_pending')",
  campaign_applications: "select count(*)::int n from campaign_applications where creator_id=$1 and status in ('selected','posted','verified')",
} as const;

export async function deletionPending(sql: SqlRunner, userId: string): Promise<DeletionPending> {
  const tables = Object.keys(DELETION_PENDING_QUERIES) as Array<keyof typeof DELETION_PENDING_QUERIES>;
  const present = new Set(
    (await sql.query<{ name: string }>("select t.name from unnest($1::text[]) as t(name) where to_regclass('public.' || t.name) is not null", [tables])).rows.map(r => r.name),
  );
  const count = async (table: keyof typeof DELETION_PENDING_QUERIES) =>
    present.has(table) ? ((await sql.query<{ n: number }>(DELETION_PENDING_QUERIES[table], [userId])).rows[0]?.n ?? 0) : 0;
  const renders = await count('render_jobs');
  const payments = await count('billing_payments');
  const subscriptions = await count('creator_subscriptions');
  const campaigns = await count('campaign_applications');
  return { renders, payments, subscription: subscriptions > 0, campaigns };
}

export type DeletionRequestResult =
  | { ok: true; request: DeletionRequest; created: boolean }
  | { ok: false; code: 'signedOut' | 'unconfirmed' | 'unavailable' };

/**
 * Record the request. The box on the confirmation step must be ticked; a second press answers with
 * the open request instead of a second row (the partial unique index decides a race). The address
 * is the signed-in one, falling back to the profile's — never a form field.
 */
export async function requestAccountDeletion(
  sql: SqlRunner,
  viewer: Pick<Viewer, 'userId' | 'email'>,
  confirmed: boolean,
  now: Date = new Date(),
): Promise<DeletionRequestResult> {
  if (!viewer.userId) return { ok: false, code: 'signedOut' };
  if (!confirmed) return { ok: false, code: 'unconfirmed' };
  if (!(await deletionReady(sql))) return { ok: false, code: 'unavailable' };
  const due = new Date(now.getTime() + DELETION_DAYS * DAY_MS);
  const { rows } = await sql.query<DeletionRow>(
    `insert into account_deletion_requests (user_id, email, requested_at, due_at, updated_at)
     select p.id, coalesce($2, p.email), $3, $4, $3 from profiles p where p.id=$1
     on conflict do nothing returning *`,
    [viewer.userId, viewer.email, now, due],
  );
  if (rows[0]) return { ok: true, request: view(rows[0]), created: true };
  const existing = await openDeletionRequest(sql, viewer.userId);
  return existing ? { ok: true, request: existing, created: false } : { ok: false, code: 'unavailable' };
}

/** The member changed their mind. Only before an operator has started; the address goes with it. */
export async function cancelAccountDeletion(sql: SqlRunner, userId: string, now: Date = new Date()): Promise<boolean> {
  if (!(await deletionReady(sql))) return false;
  const { rows } = await sql.query<{ id: string }>(
    `update account_deletion_requests set status='cancelled', cancelled_at=$2, email=null, updated_at=$2
      where user_id=$1 and status='requested' returning id`,
    [userId, now],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// the operator's side
// ---------------------------------------------------------------------------

export interface DeletionQueueItem extends DeletionRequest {
  userId: string | null;
  email: string | null;
  /** The profile still exists (user_id is emptied by the auth user's deletion, runbook §2). */
  accountExists: boolean;
  /** Runbook §0: a staff account is handed to the founder, not deleted from the queue. */
  staff: boolean;
  completedAt: string | null;
  cancelledAt: string | null;
  note: string | null;
}

function queueItem(row: DeletionRow & { is_admin: boolean | null }): DeletionQueueItem {
  return {
    ...view(row),
    userId: row.user_id,
    email: row.email,
    accountExists: row.user_id !== null,
    staff: row.is_admin === true,
    completedAt: isoOrNull(row.completed_at),
    cancelledAt: isoOrNull(row.cancelled_at),
    note: row.note,
  };
}

/** Open requests by deadline, then the last 20 closed ones. `null` before 0064. */
export async function loadDeletionQueue(sql: SqlRunner): Promise<{ open: DeletionQueueItem[]; closed: DeletionQueueItem[] } | null> {
  if (!(await deletionReady(sql))) return null;
  const select = 'select r.*, p.is_admin from account_deletion_requests r left join profiles p on p.id = r.user_id';
  const open = await sql.query<DeletionRow & { is_admin: boolean | null }>(`${select} where r.${OPEN} order by r.due_at limit 200`);
  const closed = await sql.query<DeletionRow & { is_admin: boolean | null }>(`${select} where not r.${OPEN} order by r.updated_at desc limit 20`);
  return { open: open.rows.map(queueItem), closed: closed.rows.map(queueItem) };
}

export async function countDeletionQueue(sql: SqlRunner): Promise<number> {
  if (!(await deletionReady(sql))) return 0;
  return (await sql.query<{ n: number }>(`select count(*)::int n from account_deletion_requests where ${OPEN}`)).rows[0]?.n ?? 0;
}

export const DeletionDecision = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
}).strict();
export type DeletionOutcome =
  | { ok: true; status: DeletionStatus }
  | { ok: false; code: 'invalid' | 'forbidden' | 'notFound' | 'badTransition' | 'accountExists'; from?: DeletionStatus };

/** Re-read `is_admin` under the decision's transaction; the dispatcher's check is not the only one. */
async function stillAdmin(sql: SqlRunner, viewer: Viewer): Promise<boolean> {
  if (!viewer.userId) return false;
  return (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1 for share', [viewer.userId])).rows[0]?.is_admin === true;
}

type Move = 'start' | 'complete' | 'cancel';
const FROM: Record<Move, DeletionStatus[]> = {
  start: ['requested'],
  complete: ['requested', 'processing'],
  cancel: ['requested', 'processing'],
};

/**
 * The three marks an operator makes. `start` says the runbook is under way; `complete` is only
 * accepted once the account is gone (the auth user's deletion empties `user_id`), and it clears the
 * address; `cancel` closes a request the member withdrew by mail, with the reason written down.
 */
export async function decideDeletion(sql: SqlRunner, viewer: Viewer, move: Move, input: unknown, now: Date = new Date()): Promise<DeletionOutcome> {
  const parsed = DeletionDecision.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  if (move === 'cancel' && !parsed.data.note) return { ok: false, code: 'invalid' };
  if (!(await deletionReady(sql))) return { ok: false, code: 'notFound' };
  return sql.transaction(async tx => {
    if (!(await stillAdmin(tx, viewer))) return { ok: false, code: 'forbidden' };
    const row = (await tx.query<DeletionRow>('select * from account_deletion_requests where id=$1 for update', [parsed.data.id])).rows[0];
    if (!row) return { ok: false, code: 'notFound' };
    if (!FROM[move].includes(row.status)) return { ok: false, code: 'badTransition', from: row.status };
    const note = parsed.data.note || null;
    if (move === 'start') {
      await tx.query(
        "update account_deletion_requests set status='processing', started_at=$2, started_by=$3, note=coalesce($4, note), updated_at=$2 where id=$1",
        [row.id, now, viewer.userId, note],
      );
      return { ok: true, status: 'processing' };
    }
    if (move === 'complete') {
      if (row.user_id !== null) return { ok: false, code: 'accountExists', from: row.status };
      await tx.query(
        "update account_deletion_requests set status='completed', completed_at=$2, closed_by=$3, email=null, note=coalesce($4, note), updated_at=$2 where id=$1",
        [row.id, now, viewer.userId, note],
      );
      return { ok: true, status: 'completed' };
    }
    await tx.query(
      "update account_deletion_requests set status='cancelled', cancelled_at=$2, closed_by=$3, email=null, note=$4, updated_at=$2 where id=$1",
      [row.id, now, viewer.userId, note],
    );
    return { ok: true, status: 'cancelled' };
  });
}
