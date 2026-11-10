import { z } from 'zod';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { Viewer } from '@/lib/auth/identity';
import { isReviewAccountEmail } from '@/lib/auth/review-login';

/**
 * Self-serve account deletion (docs/RUNBOOK-deletion.md; Apple 5.1.1(v), Google Play's
 * account-deletion policy; privacy policy §3 "탈퇴 요청을 받으면 7일 이내에 삭제").
 *
 *   1. A member asks on `/account/delete`. The request is always accepted and sits for a grace
 *      period (`deletionGraceDays`), during which the member can cancel.
 *   2. Once the grace period has passed, the daily pass (`runDeletionPass`, from
 *      `/api/renders/tick`) looks at what holds the account (`deletionHolds`). Nothing → it deletes
 *      the account's rows in ONE transaction (`deleteAccountNow`); something → it writes the reason
 *      down and looks again tomorrow, and the admin queue shows it.
 *   3. What lives outside the database — the sign-in account, the private storage folders, the
 *      engine provider's asset group — is listed on the request inside that same transaction and
 *      removed afterwards (`finishDeletion`), item by item, retried until the list is empty.
 *
 * What is kept: `billing_payments` (전자상거래법, 5 years). Its `user_id` and `render_id` empty
 * themselves (`on delete set null`), the order's own copy of the photo is deleted with the rest and
 * marked `input_deleted_at`. Nothing here reads or changes a payment's status.
 *
 * What is never deleted automatically: an account with money or other people attached — a campaign
 * past selection, a brand membership, a creative's templates and settlements, a monthly plan, a
 * staff account. Those rows are records the company keeps (privacy policy §3) or belong to someone
 * else's workspace, so the request waits for an operator (`review` holds).
 */
export const DELETION_DAYS = 7;
export const DEFAULT_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN = "status in ('requested','processing')";

type Env = Record<string, string | undefined>;

/**
 * Days between the request and the deletion. 0–5: the pass runs once a day, so five still leaves a
 * day of retries inside the 7-day promise. Anything else falls back to the default.
 */
export function deletionGraceDays(env: Env = process.env): number {
  const raw = env.ACCOUNT_DELETION_GRACE_DAYS?.trim() ?? '';
  if (!/^[0-5]$/.test(raw)) return DEFAULT_GRACE_DAYS;
  return Number(raw);
}

export type DeletionStatus = 'requested' | 'processing' | 'completed' | 'cancelled';
/** Clears by itself: the pass looks again tomorrow. */
export type DeletionWait = 'render' | 'payment';
/** Needs a person: an operator settles it, then the pass (or "delete now") goes through. */
export type DeletionReview = 'staff' | 'campaign' | 'brand' | 'creative' | 'subscription' | 'records';
export type DeletionHold = DeletionWait | DeletionReview;
const WAITS: readonly DeletionWait[] = ['render', 'payment'];
const REVIEWS: readonly DeletionReview[] = ['staff', 'campaign', 'brand', 'creative', 'subscription', 'records'];
const HOLDS = new Set<string>([...WAITS, ...REVIEWS]);

interface Cleanup {
  authUserId: string | null;
  folders: string[];
  /** The provider's copies of the member's face, removed before the group that holds them. */
  providerAssets: string[];
  providerGroups: string[];
}
type StoredCleanup = Partial<Cleanup> | null;
/** The list as stored, with every part present (a row written before a part existed has none). */
const cleanupOf = (stored: StoredCleanup): Cleanup => ({
  authUserId: stored?.authUserId ?? null,
  folders: [...(stored?.folders ?? [])],
  providerAssets: [...(stored?.providerAssets ?? [])],
  providerGroups: [...(stored?.providerGroups ?? [])],
});

interface DeletionRow {
  id: string;
  user_id: string | null;
  email: string | null;
  status: DeletionStatus;
  requested_at: Date | string;
  scheduled_for: Date | string;
  due_at: Date | string;
  hold: string[] | null;
  attempts: number;
  last_attempt_at: Date | string | null;
  last_error: string | null;
  started_at: Date | string | null;
  cleanup: StoredCleanup;
  removed: Record<string, number> | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  note: string | null;
}

export interface DeletionRequest {
  id: string;
  status: DeletionStatus;
  requestedAt: string;
  /** When the grace period ends and the pass may delete. */
  scheduledFor: string;
  /** The promise: requested + 7 days. */
  dueAt: string;
  hold: DeletionHold[];
}

const iso = (value: Date | string) => new Date(value).toISOString();
const isoOrNull = (value: Date | string | null) => (value === null ? null : iso(value));
const holdsOf = (row: Pick<DeletionRow, 'hold'>) => (row.hold ?? []).filter((code): code is DeletionHold => HOLDS.has(code));

function view(row: DeletionRow): DeletionRequest {
  return { id: row.id, status: row.status, requestedAt: iso(row.requested_at), scheduledFor: iso(row.scheduled_for), dueAt: iso(row.due_at), hold: holdsOf(row) };
}

/** `false` before 0064: `/account` then keeps the mail request and the pass does nothing. */
export async function deletionReady(sql: SqlRunner): Promise<boolean> {
  const { rows } = await sql.query<{ ready: boolean }>("select to_regclass('public.account_deletion_requests') is not null as ready");
  return rows[0]?.ready === true;
}

/** The member's open request. Past `requested` the account is gone, so nobody is left to ask. */
export async function openDeletionRequest(sql: SqlRunner, userId: string): Promise<DeletionRequest | null> {
  const { rows } = await sql.query<DeletionRow>("select * from account_deletion_requests where user_id=$1 and status='requested' limit 1", [userId]);
  return rows[0] ? view(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// what holds an account back
// ---------------------------------------------------------------------------

/**
 * The explicit checks (`$1` the account, `$2` now). A test reads the status names out of these and
 * compares them with the tables' own CHECK constraints.
 */
export const DELETION_HOLD_CHECKS: ReadonlyArray<{ table: string; hold: DeletionHold; sql: string }> = [
  // A video in the oven: deleting now would throw away something the member paid for.
  { table: 'render_jobs', hold: 'render', sql: "select 1 from render_jobs where user_id=$1 and status in ('held','queued','running') and $2::timestamptz is not null limit 1" },
  // Money in flight: an open checkout, an approval being confirmed, a paid order not yet delivered
  // (the render or its automatic refund is still owed), a refund on its way — and a delivered order
  // whose render then FAILED. `reconcileTossPayments` finds that last one through its render
  // (`r.status='failed'`); were the render to cascade away, `render_id` would empty itself, the order
  // would never be selected again and the refund would never be sent.
  { table: 'billing_payments', hold: 'payment', sql: `select 1 from billing_payments where user_id=$1 and (
      (status = 'pending' and expires_at > $2::timestamptz)
      or status in ('confirming','refund_pending')
      or (status = 'paid' and fulfilled_at is null)
      or (status = 'paid' and exists (select 1 from render_jobs r where r.id = billing_payments.render_id and r.status = 'failed'))) limit 1` },
  // Selected, posted or verified: a brand is waiting or a payout is owed. Paid: a settlement record
  // the privacy policy keeps for 5 years, which the cascade from `profiles` would erase.
  { table: 'campaign_applications', hold: 'campaign', sql: "select 1 from campaign_applications where creator_id=$1 and status in ('selected','posted','verified','paid') and $2::timestamptz is not null limit 1" },
  // A creative: public templates, files other members rendered from, royalties.
  { table: 'platform_creators', hold: 'creative', sql: 'select 1 from platform_creators where user_id=$1 and $2::timestamptz is not null limit 1' },
  // The cookie-and-subscription era (0002, 0008). These rows cascade from `profiles`, so nothing in
  // the schema would stop the delete: a plan the old payment provider is still charging has to be
  // stopped by a person first, and an ended plan or a paid cookie pack is a transaction record the
  // company keeps for 5 years. Free cookies and what they opened (`prompt_unlocks`) go with the account.
  { table: 'subscriptions', hold: 'subscription', sql: "select 1 from subscriptions where user_id=$1 and status in ('active','past_due') and $2::timestamptz is not null limit 1" },
  { table: 'subscriptions', hold: 'records', sql: "select 1 from subscriptions where user_id=$1 and status not in ('active','past_due') and $2::timestamptz is not null limit 1" },
  { table: 'cookie_purchase_events', hold: 'records', sql: 'select 1 from cookie_purchase_events where profile_id=$1 and $2::timestamptz is not null limit 1' },
  { table: 'cookie_ledger', hold: 'records', sql: "select 1 from cookie_ledger where profile_id=$1 and reason = 'purchase' and $2::timestamptz is not null limit 1" },
];

/** A table found by the catalogue scan, named for the member in broad terms. */
function reviewOf(table: string): DeletionReview {
  if (table.startsWith('brand_')) return 'brand';
  if (table.startsWith('campaign_')) return 'campaign';
  // `prompt_items.author_id`: a template this account submitted and other members may be using.
  if (table.startsWith('platform_') || table.startsWith('maker_') || table === 'prompt_items') return 'creative';
  if (table.startsWith('creator_subscription')) return 'subscription';
  return 'records';
}

export interface DeletionHolds {
  wait: DeletionWait[];
  review: DeletionReview[];
  /** The tables behind the `review` codes, for the operator; never shown to the member. */
  tables: string[];
}
export const NO_HOLDS: DeletionHolds = { wait: [], review: [], tables: [] };

/**
 * Everything that stops this account from being deleted right now.
 *
 * Besides the explicit checks, it reads the catalogue for every foreign key that points at
 * `profiles` (or straight at `auth.users`) and would REFUSE the delete (no action / restrict) and asks whether this account has
 * a row there. Those are exactly the rows the schema says must outlive the account or be dealt with
 * first — brand workspaces, subscriptions, settlements — and a table added later is covered
 * without anyone remembering this file.
 */
export async function deletionHolds(sql: SqlRunner, userId: string, now: Date = new Date()): Promise<DeletionHolds> {
  const found = new Set<DeletionHold>();
  const tables = new Set<string>();

  const profile = (await sql.query<{ is_admin: boolean; email: string | null }>('select is_admin, email from profiles where id=$1', [userId])).rows[0];
  // Staff, and the account the payment provider and the app stores review the service with
  // (lib/auth/review-login.ts): deleting either by a button press would lock a review out.
  if (profile?.is_admin === true || isReviewAccountEmail(profile?.email)) found.add('staff');

  const names = [...new Set(DELETION_HOLD_CHECKS.map((check) => check.table))];
  const present = new Set(
    (await sql.query<{ name: string }>("select t.name from unnest($1::text[]) as t(name) where to_regclass('public.' || t.name) is not null", [names])).rows.map((r) => r.name),
  );
  for (const check of DELETION_HOLD_CHECKS) {
    if (!present.has(check.table)) continue;
    if ((await sql.query(check.sql, [userId, now])).rows.length === 0) continue;
    found.add(check.hold);
    if (!WAITS.includes(check.hold as DeletionWait)) tables.add(check.table);
  }

  const refs = (await sql.query<{ tbl: string; name: string; col: string }>(
    `select format('%s', c.conrelid::regclass) as tbl, cl.relname as name, quote_ident(a.attname) as col
       from pg_constraint c
       join pg_class cl on cl.oid = c.conrelid
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.confdeltype in ('a','r') and array_length(c.conkey, 1) = 1
        -- The sign-in row too: a table hung on auth.users would refuse the last step, after the profile is gone.
        and c.confrelid in (select r from (values (to_regclass('public.profiles')), (to_regclass('auth.users'))) as known(r) where r is not null)
        and cl.relnamespace = 'public'::regnamespace
      order by 1, 3`,
  )).rows;
  if (refs.length > 0) {
    // Identifiers come from the catalogue, already quoted by Postgres; the account id is a parameter.
    const scan = refs.map((ref, i) => `select ${i}::int as i where exists (select 1 from ${ref.tbl} where ${ref.col} = $1)`).join(' union all ');
    for (const hit of (await sql.query<{ i: number }>(scan, [userId])).rows) {
      const table = refs[hit.i]!.name;
      tables.add(table);
      found.add(reviewOf(table));
    }
  }

  return {
    wait: WAITS.filter((code) => found.has(code)),
    review: REVIEWS.filter((code) => found.has(code)),
    tables: [...tables].sort(),
  };
}

const codesOf = (holds: DeletionHolds): DeletionHold[] => [...holds.wait, ...holds.review];

// ---------------------------------------------------------------------------
// the member's side
// ---------------------------------------------------------------------------

export type DeletionRequestResult =
  | { ok: true; request: DeletionRequest; created: boolean }
  | { ok: false; code: 'signedOut' | 'unconfirmed' | 'unavailable' };

/**
 * Record the request. The box on the confirmation step must be ticked; a second press answers with
 * the open request instead of a second row (the partial unique index decides a race). The address
 * is the signed-in one, falling back to the profile's — never a form field. Holds do not refuse the
 * request: they are written on it, shown to the member and looked at again before anything is deleted.
 */
export async function requestAccountDeletion(
  sql: SqlRunner,
  viewer: Pick<Viewer, 'userId' | 'email'>,
  confirmed: boolean,
  now: Date = new Date(),
  graceDays: number = deletionGraceDays(),
): Promise<DeletionRequestResult> {
  if (!viewer.userId) return { ok: false, code: 'signedOut' };
  if (!confirmed) return { ok: false, code: 'unconfirmed' };
  if (!(await deletionReady(sql))) return { ok: false, code: 'unavailable' };
  const holds = await deletionHolds(sql, viewer.userId, now);
  const { rows } = await sql.query<DeletionRow>(
    `insert into account_deletion_requests (user_id, email, requested_at, scheduled_for, due_at, hold, updated_at)
     select p.id, coalesce($2, p.email), $3, $4, $5, $6::text[], $3 from profiles p where p.id=$1
     on conflict do nothing returning *`,
    [viewer.userId, viewer.email, now, new Date(now.getTime() + graceDays * DAY_MS), new Date(now.getTime() + DELETION_DAYS * DAY_MS), codesOf(holds)],
  );
  if (rows[0]) return { ok: true, request: view(rows[0]), created: true };
  const existing = await openDeletionRequest(sql, viewer.userId);
  return existing ? { ok: true, request: existing, created: false } : { ok: false, code: 'unavailable' };
}

/** The member changed their mind. Possible for as long as the account exists; the address goes with it. */
export async function cancelAccountDeletion(sql: SqlRunner, userId: string, now: Date = new Date()): Promise<boolean> {
  if (!(await deletionReady(sql))) return false;
  const { rows } = await sql.query<{ id: string }>(
    `update account_deletion_requests set status='cancelled', cancelled_at=$2, email=null, hold='{}', last_error=null, updated_at=$2
      where user_id=$1 and status='requested' returning id`,
    [userId, now],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// deleting
// ---------------------------------------------------------------------------

/**
 * The three things outside the database. Each call must be safe to repeat: a folder, a user or a
 * group that is already gone is a success.
 */
export interface DeletionDeps {
  sql: SqlRunner;
  /** The private `renders` bucket: every object under `{uuid}/` (or `social/{uuid}/`). */
  files: { deleteFolder(folder: string): Promise<void> } | null;
  /** The sign-in account (Supabase Auth in production). */
  auth: { deleteUser(userId: string): Promise<void> } | null;
  /**
   * The engine provider's copies of the member's face: each asset, then the group that held them
   * (the order lib/identity/rotation.ts uses). `null` when no provider is configured.
   */
  provider: { deleteAsset(assetId: string): Promise<void>; deleteAssetGroup(groupId: string): Promise<void> } | null;
}

/**
 * Is this sign-in account on a deletion's cleanup list? Its rows are gone and the sign-in account
 * itself is about to be removed (or the removal failed and is retried daily). Until the request
 * closes, nothing may start a new profile on that id — the retry would cascade it away.
 * `/auth/callback` asks before it creates a profile.
 */
export async function deletionInProgress(sql: SqlRunner, authUserId: string): Promise<boolean> {
  if (!(await deletionReady(sql))) return false;
  const { rows } = await sql.query(
    "select 1 from account_deletion_requests where status='processing' and cleanup->>'authUserId' = $1 limit 1", [authUserId],
  );
  return rows.length > 0;
}

/**
 * May the daily tick run the deletion pass? Only behind the cron secret — an unauthenticated tick
 * was "open but harmless" while every step was idempotent, and deleting accounts is not that — and
 * only when the render and payment pass before it went through: that pass settles the refunds the
 * holds wait for, and a pass that threw says nothing about what is still owed.
 */
export function deletionPassGate(input: { cronSecret: string | undefined; renderPassOk: boolean }): 'run' | 'no_secret' | 'render_pass_failed' {
  if (!input.cronSecret?.trim()) return 'no_secret';
  return input.renderPassOk ? 'run' : 'render_pass_failed';
}

/** What an operator types before "delete now" skips the grace period: the account's address. */
export const deletionConfirmPhrase = (email: string | null): string => email?.trim().toLowerCase() || 'DELETE';

const FOLDER = /^(?:social\/)?[0-9a-f-]{36}$/i;

/**
 * Every private-storage folder that belongs to the account. A render's files live under its own id
 * (`{jobId}/input.png`, `result.mp4`, `poster.jpg`, extra frames), a saved photo under its id, an
 * order's copy of the photo under the order id — so the folder, not the key, is what goes.
 */
async function ownedFolders(tx: SqlRunner, userId: string): Promise<string[]> {
  const sources: Array<[table: string, sql: string]> = [
    ['identity_selfies', 'select input_key as key from identity_selfies where user_id=$1'],
    ['render_jobs', `select id::text || '/x' as key from render_jobs where user_id=$1
       union all select input_key from render_jobs where user_id=$1 and input_key is not null
       union all select result_key from render_jobs where user_id=$1 and result_key is not null`],
    ['render_job_outputs', 'select o.storage_key as key from render_job_outputs o join render_jobs j on j.id=o.render_id where j.user_id=$1'],
    ['billing_payments', 'select input_key as key from billing_payments where user_id=$1 and input_key is not null'],
    ['identity_portrait_attempts', `select input_key as key from identity_portrait_attempts where user_id=$1
       union all select result_key from identity_portrait_attempts where user_id=$1 and result_key is not null`],
    ['social_accounts', 'select evidence_key as key from social_accounts where user_id=$1 and evidence_key is not null'],
    // A pet's or a partner's photo for one render (docs/CAST-CATEGORIES.md): someone else's face, so it must not be missed.
    ['render_slot_inputs', 'select storage_key as key from render_slot_inputs where user_id=$1'],
  ];
  const present = new Set(
    (await tx.query<{ name: string }>("select t.name from unnest($1::text[]) as t(name) where to_regclass('public.' || t.name) is not null", [sources.map(([table]) => table)])).rows.map((r) => r.name),
  );
  const folders = new Set<string>();
  for (const [table, text] of sources) {
    if (!present.has(table)) continue;
    for (const { key } of (await tx.query<{ key: string }>(text, [userId])).rows) {
      const folder = key.slice(0, key.lastIndexOf('/'));
      // A key that does not look like ours is left alone rather than guessed at.
      if (FOLDER.test(folder)) folders.add(folder);
    }
  }
  return [...folders].sort();
}

const count = async (tx: SqlRunner, text: string, userId: string) => (await tx.query<{ n: number }>(text, [userId])).rows[0]?.n ?? 0;

/** A database refusal without the row it was about: constraint and table names only. */
function refusal(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '…').slice(0, 300);
}
const isForeignKeyRefusal = (error: unknown) =>
  (error as { code?: string } | null)?.code === '23503' || /foreign key constraint/i.test(error instanceof Error ? error.message : '');

export type DeleteOutcome =
  | { ok: true; status: 'processing' | 'completed' }
  | { ok: false; code: 'notFound' | 'notDue' | 'unavailable' | 'badTransition' | 'removedElsewhere'; from?: DeletionStatus }
  | { ok: false; code: 'held'; hold: DeletionHold[] };

const REMOVED_ELSEWHERE = 'account removed outside this flow: its storage folders and provider assets were not checked — follow docs/RUNBOOK-deletion.md, then mark done with a note';

/** The delete was refused by a row we did not know about; carries the database's words across the rollback. */
class Refused extends Error {
  constructor(readonly detail: string) { super('refused'); }
}

/**
 * Delete the account's rows. ONE transaction: the request and the profile are locked, the holds are
 * read again, the folders and the provider group are written onto the request, the analytics rows
 * lose the id, the order photos are marked as gone, and the profile is deleted (everything personal
 * cascades from it; `billing_payments` stays). Either all of that happened or none of it did — a row
 * that refuses the delete rolls everything back and becomes a `records` hold for an operator.
 *
 * Nothing outside the database is touched here; `finishDeletion` does that from the list.
 */
export async function deleteAccountNow(
  deps: DeletionDeps,
  requestId: string,
  options: { now?: Date; force?: boolean; actorId?: string | null } = {},
): Promise<DeleteOutcome> {
  const now = options.now ?? new Date();
  const { sql } = deps;
  // Without the tools to remove files and the sign-in account, deleting the rows would orphan both.
  if (deps.files === null || deps.auth === null) return { ok: false, code: 'unavailable' };

  const hold = (tx: SqlRunner, codes: DeletionHold[], error: string | null) =>
    tx.query(
      'update account_deletion_requests set hold=$2::text[], attempts=attempts+1, last_attempt_at=$3, last_error=$4, updated_at=$3 where id=$1',
      [requestId, codes, now, error],
    );

  try {
    return await sql.transaction(async (tx) => {
      const row = (await tx.query<DeletionRow>('select * from account_deletion_requests where id=$1 for update', [requestId])).rows[0];
      if (!row) return { ok: false, code: 'notFound' } as const;
      if (row.status !== 'requested') return { ok: false, code: 'badTransition', from: row.status } as const;
      if (row.user_id === null) {
        // The account was removed some other way (a console, by hand). The rows that knew where its
        // files and provider assets were went with it, so nothing here can vouch that those are gone:
        // the request stays open for an operator instead of being called done.
        if (row.last_error !== REMOVED_ELSEWHERE) await hold(tx, [], REMOVED_ELSEWHERE);
        return { ok: false, code: 'removedElsewhere' } as const;
      }
      if (!options.force && new Date(row.scheduled_for).getTime() > now.getTime()) return { ok: false, code: 'notDue' } as const;
      const userId = row.user_id;

      // Locks out a new order or render for this account until we commit (their FK needs the row).
      await tx.query('select id from profiles where id=$1 for update', [userId]);
      const holds = await deletionHolds(tx, userId, now);
      const codes = codesOf(holds);
      if (codes.length > 0) {
        await hold(tx, codes, holds.tables.length > 0 ? `tables: ${holds.tables.join(', ')}`.slice(0, 300) : null);
        return { ok: false, code: 'held', hold: codes } as const;
      }

      const folders = await ownedFolders(tx, userId);
      // The provider's side of the face: every asset, and every group the provider may still hold —
      // a failed or revoked group exists there too; only an evicted one was already removed
      // (lib/identity/repo.ts evictIdentityGroup). The cascade below takes these ids with it.
      const providerAssets = (await tx.query<{ asset_id: string }>(
        'select asset_id from identity_assets where user_id=$1 order by asset_id', [userId],
      )).rows.map((r) => r.asset_id);
      const providerGroups = (await tx.query<{ group_id: string }>(
        `select group_id from identity_groups where user_id=$1 and group_id is not null and status <> 'evicted'
         union select group_id from identity_assets where user_id=$1
         order by 1`, [userId],
      )).rows.map((r) => r.group_id);
      const removed = {
        selfies: await count(tx, 'select count(*)::int n from identity_selfies where user_id=$1', userId),
        renders: await count(tx, 'select count(*)::int n from render_jobs where user_id=$1', userId),
        folders: folders.length,
        paymentsKept: await count(tx, 'select count(*)::int n from billing_payments where user_id=$1', userId),
      };
      const cleanup: Cleanup = { authUserId: userId, folders, providerAssets, providerGroups };

      // The order's own copy of the photo goes with the folders; the order itself stays.
      await tx.query('update billing_payments set input_deleted_at=$2 where user_id=$1 and input_key is not null and input_deleted_at is null', [userId, now]);
      // These rows hang on auth.users, not on profiles, so the cascade below would not reach them until the
      // sign-in account goes. Their files are already on the list; the rows go now.
      if ((await tx.query<{ ready: boolean }>("select to_regclass('public.render_slot_inputs') is not null as ready")).rows[0]?.ready) {
        await tx.query('delete from render_slot_inputs where user_id=$1', [userId]);
      }
      // `events.user_id` has no foreign key on purpose (analytics outlive the account), so it is emptied by hand.
      await tx.query('update events set user_id=null where user_id=$1', [userId]);
      try {
        await tx.query('delete from profiles where id=$1', [userId]);
      } catch (error) {
        if (isForeignKeyRefusal(error)) throw new Refused(refusal(error));
        throw error;
      }
      await tx.query(
        `update account_deletion_requests
            set status='processing', started_at=$2, started_by=$3, cleanup=$4::jsonb, removed=$5::jsonb,
                hold='{}', attempts=attempts+1, last_attempt_at=$2, last_error=null, updated_at=$2
          where id=$1`,
        [requestId, now, options.actorId ?? null, JSON.stringify(cleanup), JSON.stringify(removed)],
      );
      return { ok: true, status: 'processing' } as const;
    });
  } catch (error) {
    // Rolled back: the account is whole. Write the reason down outside the dead transaction.
    if (error instanceof Refused || isForeignKeyRefusal(error)) {
      await hold(sql, ['records'], error instanceof Refused ? error.detail : refusal(error));
      return { ok: false, code: 'held', hold: ['records'] };
    }
    throw error;
  }
}

export type FinishOutcome =
  | { ok: true; status: 'completed' }
  | { ok: false; code: 'notFound' | 'badTransition'; from?: DeletionStatus }
  | { ok: false; code: 'cleanupLeft'; left: number };

const left = (cleanup: Cleanup) => (cleanup.authUserId ? 1 : 0) + cleanup.folders.length + cleanup.providerAssets.length + cleanup.providerGroups.length;
const label = (kind: string, error: unknown) => `${kind}: ${refusal(error)}`.slice(0, 300);

/**
 * Remove what the request lists, outside the database: the sign-in account first (so the session
 * dies), then the files, then the provider's assets and their group. A failed item stays on the list
 * with the first error; when the list is empty the request closes and forgets the address.
 *
 * The sign-in account is never removed while a profile exists on its id. Ours was deleted before
 * this list was written, so a profile there now is a NEW account (the person came back after a
 * failed try); removing the sign-in account would cascade it away. That item waits for an operator.
 */
export async function finishDeletion(deps: DeletionDeps, requestId: string, now: Date = new Date()): Promise<FinishOutcome> {
  const row = (await deps.sql.query<DeletionRow>('select * from account_deletion_requests where id=$1', [requestId])).rows[0];
  if (!row) return { ok: false, code: 'notFound' };
  if (row.status !== 'processing' || row.cleanup === null) return { ok: false, code: 'badTransition', from: row.status };

  const todo = cleanupOf(row.cleanup);
  let firstError: string | null = null;
  const fail = (text: string) => { firstError ??= text; };

  if (todo.authUserId) {
    const reborn = (await deps.sql.query('select 1 from profiles where id=$1', [todo.authUserId])).rows.length > 0;
    if (reborn) fail('auth: this person signed in again and has a new account on the same sign-in — not removed; decide by hand');
    else if (deps.auth === null) fail('auth: unavailable');
    else {
      try { await deps.auth.deleteUser(todo.authUserId); todo.authUserId = null; }
      catch (error) { fail(label('auth', error)); }
    }
  }
  const foldersLeft: string[] = [];
  for (const folder of todo.folders) {
    if (deps.files === null) { fail('files: unavailable'); foldersLeft.push(folder); continue; }
    try { await deps.files.deleteFolder(folder); }
    catch (error) { fail(label('files', error)); foldersLeft.push(folder); }
  }
  todo.folders = foldersLeft;
  const assetsLeft: string[] = [];
  for (const asset of todo.providerAssets) {
    if (deps.provider === null) { fail('provider: unavailable'); assetsLeft.push(asset); continue; }
    try { await deps.provider.deleteAsset(asset); }
    catch (error) { fail(label('provider', error)); assetsLeft.push(asset); }
  }
  todo.providerAssets = assetsLeft;
  // A group goes only after its assets: while one is left, the groups wait for the next try.
  if (assetsLeft.length === 0) {
    const groupsLeft: string[] = [];
    for (const group of todo.providerGroups) {
      if (deps.provider === null) { fail('provider: unavailable'); groupsLeft.push(group); continue; }
      try { await deps.provider.deleteAssetGroup(group); }
      catch (error) { fail(label('provider', error)); groupsLeft.push(group); }
    }
    todo.providerGroups = groupsLeft;
  }

  const remaining = left(todo);
  if (remaining === 0) {
    await deps.sql.query(
      `update account_deletion_requests set status='completed', completed_at=$2, email=null, cleanup=null, last_error=null, last_attempt_at=$2, updated_at=$2
        where id=$1 and status='processing'`,
      [requestId, now],
    );
    return { ok: true, status: 'completed' };
  }
  await deps.sql.query(
    `update account_deletion_requests set cleanup=$2::jsonb, last_error=$3, last_attempt_at=$4, updated_at=$4 where id=$1 and status='processing'`,
    [requestId, JSON.stringify(todo), firstError, now],
  );
  return { ok: false, code: 'cleanupLeft', left: remaining };
}

export interface DeletionPassReport {
  ready: boolean;
  /** Accounts whose rows were deleted in this pass. */
  deleted: number;
  /** Requests closed in this pass (including cleanups finished from an earlier one). */
  completed: number;
  /** Requests past their grace period that something still holds. */
  held: number;
  /** Cleanups that still have something left, or a pass that could not run. */
  failed: number;
}

/**
 * One pass: finish the cleanups left over, then delete every account whose grace period has run
 * out. Counts only — no id and no address ever leaves through the report.
 */
export async function runDeletionPass(deps: DeletionDeps, options: { now?: Date; limit?: number } = {}): Promise<DeletionPassReport> {
  const now = options.now ?? new Date();
  const report: DeletionPassReport = { ready: false, deleted: 0, completed: 0, held: 0, failed: 0 };
  if (!(await deletionReady(deps.sql))) return report;
  report.ready = true;
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

  const finish = async (id: string) => {
    const done = await finishDeletion(deps, id, now).catch(() => null);
    if (done?.ok) report.completed += 1;
    else report.failed += 1;
  };

  const unfinished = await deps.sql.query<{ id: string }>(
    "select id from account_deletion_requests where status='processing' order by due_at limit $1", [limit],
  );
  for (const { id } of unfinished.rows) await finish(id);

  const due = await deps.sql.query<{ id: string }>(
    "select id from account_deletion_requests where status='requested' and (scheduled_for <= $1 or user_id is null) order by due_at limit $2", [now, limit],
  );
  for (const { id } of due.rows) {
    const outcome = await deleteAccountNow(deps, id, { now }).catch(() => null);
    if (outcome === null) report.failed += 1;
    else if (outcome.ok && outcome.status === 'completed') report.completed += 1;
    else if (outcome.ok) { report.deleted += 1; await finish(id); }
    // Removed by hand: it waits for an operator like any other hold.
    else if (outcome.code === 'held' || outcome.code === 'removedElsewhere') report.held += 1;
    else if (outcome.code === 'unavailable') report.failed += 1;
  }
  return report;
}

// ---------------------------------------------------------------------------
// the operator's side
// ---------------------------------------------------------------------------

export interface DeletionQueueItem extends DeletionRequest {
  userId: string | null;
  email: string | null;
  /** The profile still exists (its deletion empties `user_id`). */
  accountExists: boolean;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** Items still to remove outside the database (processing only). */
  cleanupLeft: number;
  removed: Record<string, number> | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  note: string | null;
}

function queueItem(row: DeletionRow): DeletionQueueItem {
  return {
    ...view(row),
    userId: row.user_id,
    email: row.email,
    accountExists: row.user_id !== null,
    attempts: row.attempts,
    lastAttemptAt: isoOrNull(row.last_attempt_at),
    lastError: row.last_error,
    cleanupLeft: row.cleanup ? left(cleanupOf(row.cleanup)) : 0,
    removed: row.removed,
    startedAt: isoOrNull(row.started_at),
    completedAt: isoOrNull(row.completed_at),
    cancelledAt: isoOrNull(row.cancelled_at),
    note: row.note,
  };
}

/** Open requests by deadline, then the last 20 closed ones. `null` before 0064. */
export async function loadDeletionQueue(sql: SqlRunner): Promise<{ open: DeletionQueueItem[]; closed: DeletionQueueItem[] } | null> {
  if (!(await deletionReady(sql))) return null;
  const open = await sql.query<DeletionRow>(`select * from account_deletion_requests where ${OPEN} order by due_at limit 200`);
  const closed = await sql.query<DeletionRow>(`select * from account_deletion_requests where not ${OPEN} order by updated_at desc limit 20`);
  return { open: open.rows.map(queueItem), closed: closed.rows.map(queueItem) };
}

/**
 * What an operator has to look at: a cleanup that did not finish, a request something holds, and
 * anything past its grace period. A request quietly waiting out its grace period is not work.
 */
export async function countDeletionQueue(sql: SqlRunner, now: Date = new Date()): Promise<number> {
  if (!(await deletionReady(sql))) return 0;
  const { rows } = await sql.query<{ n: number }>(
    `select count(*)::int n from account_deletion_requests
      where status='processing' or (status='requested' and (cardinality(hold) > 0 or scheduled_for <= $1 or user_id is null))`,
    [now],
  );
  return rows[0]?.n ?? 0;
}

export const DeletionDecision = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(500).optional(),
  /** "Delete now" only: the account's address, typed by the operator (`deletionConfirmPhrase`). */
  confirm: z.string().trim().max(320).optional(),
}).strict();
export type DeletionOutcome =
  | { ok: true; status: DeletionStatus }
  | { ok: false; code: 'invalid' | 'forbidden' | 'notFound' | 'badTransition' | 'accountExists' | 'unavailable' | 'notDue' | 'unconfirmed' | 'removedElsewhere'; from?: DeletionStatus }
  | { ok: false; code: 'held'; hold: DeletionHold[] }
  | { ok: false; code: 'cleanupLeft'; left: number };

/** Re-read `is_admin`; the dispatcher's check is not the only one. */
async function stillAdmin(sql: SqlRunner, viewer: Viewer): Promise<boolean> {
  if (!viewer.userId) return false;
  return (await sql.query<{ is_admin: boolean }>('select is_admin from profiles where id=$1', [viewer.userId])).rows[0]?.is_admin === true;
}

export type DeletionMove = 'run' | 'complete' | 'cancel';

/**
 * The operator's three buttons.
 *   run      — delete now, without waiting for the grace period (a member who wrote "today, please"),
 *              or retry the cleanup of a request already under way. Holds are never skipped.
 *   complete — mark a request done by hand: only once the account is gone, and with a note when
 *              cleanup items are being written off (removed in a console, say).
 *   cancel   — close a request the member withdrew by mail, with the reason. Never after deletion.
 */
export async function decideDeletion(deps: DeletionDeps, viewer: Viewer, move: DeletionMove, input: unknown, now: Date = new Date()): Promise<DeletionOutcome> {
  const parsed = DeletionDecision.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'invalid' };
  const { sql } = deps;
  const { id } = parsed.data;
  const note = parsed.data.note || null;
  if (move === 'cancel' && !note) return { ok: false, code: 'invalid' };
  if (!(await deletionReady(sql))) return { ok: false, code: 'notFound' };
  if (!(await stillAdmin(sql, viewer))) return { ok: false, code: 'forbidden' };

  if (move === 'run') {
    const row = (await sql.query<DeletionRow>('select * from account_deletion_requests where id=$1', [id])).rows[0];
    if (!row) return { ok: false, code: 'notFound' };
    if (row.status === 'requested') {
      // One click must not skip a member's grace period: the operator types whose account this is.
      if ((parsed.data.confirm ?? '').toLowerCase() !== deletionConfirmPhrase(row.email).toLowerCase()) return { ok: false, code: 'unconfirmed' };
      const deleted = await deleteAccountNow(deps, id, { now, force: true, actorId: viewer.userId });
      if (!deleted.ok) return deleted;
      if (deleted.status === 'completed') return deleted;
    } else if (row.status !== 'processing') return { ok: false, code: 'badTransition', from: row.status };
    return finishDeletion(deps, id, now);
  }

  return sql.transaction(async (tx): Promise<DeletionOutcome> => {
    const row = (await tx.query<DeletionRow>('select * from account_deletion_requests where id=$1 for update', [id])).rows[0];
    if (!row) return { ok: false, code: 'notFound' };
    if (move === 'complete') {
      if (row.status !== 'requested' && row.status !== 'processing') return { ok: false, code: 'badTransition', from: row.status };
      if (row.user_id !== null) return { ok: false, code: 'accountExists', from: row.status };
      // Writing off what the list still holds needs the operator's word for where it went — and so
      // does an account removed by hand, whose files and provider assets this flow never listed.
      const unchecked = row.status === 'requested' || (row.cleanup !== null && left(cleanupOf(row.cleanup)) > 0);
      if (unchecked && !note) return { ok: false, code: 'invalid' };
      await tx.query(
        `update account_deletion_requests set status='completed', completed_at=$2, closed_by=$3, email=null, cleanup=null, hold='{}', note=coalesce($4, note), updated_at=$2 where id=$1`,
        [id, now, viewer.userId, note],
      );
      return { ok: true, status: 'completed' };
    }
    if (row.status !== 'requested') return { ok: false, code: 'badTransition', from: row.status };
    await tx.query(
      `update account_deletion_requests set status='cancelled', cancelled_at=$2, closed_by=$3, email=null, hold='{}', last_error=null, note=$4, updated_at=$2 where id=$1`,
      [id, now, viewer.userId, note],
    );
    return { ok: true, status: 'cancelled' };
  });
}
