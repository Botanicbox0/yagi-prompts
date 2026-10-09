import type { Viewer } from '@/lib/auth/identity';
import type { SqlRunner } from '@/lib/db/sql-runner';
import type { RenderStore } from '@/lib/renders/store';
import { UUID } from '@/lib/creator-subscriptions/repo';
import { subscriptionRenderSchemaReady, validatedEditReferenceKeys } from './repo';

export const PREMIUM_EDIT_PRIVACY_BATCH_ROWS = 5;
type CleanupFailure = 'forbidden' | 'bad_request' | 'confirmation_required' | 'not_found' | 'schema_not_ready' |
  'billing_active' | 'billing_pending' | 'render_pending' | 'invalid_private_data' | 'storage_unavailable' | 'database_unavailable';
export type PremiumEditPrivacyOutcome =
  | { ok: true; deletedRequests: number; processedReferences: number; remainingRequests: number; complete: boolean }
  | { ok: false; code: CleanupFailure; retryable: boolean };
class CleanupAbort extends Error { constructor(readonly code: CleanupFailure) { super(code); } }
const fail = (code: CleanupFailure, retryable = false): PremiumEditPrivacyOutcome => ({ ok: false, code, retryable });

/** Prepared operator helper, deliberately not wired to a route, server action or automatic
 * account deletion. The operator must first verify the deletion request and disable sign-in
 * through the existing/manual fulfillment process. Resolve all billing, keys and jobs first.
 * The Viewer must come from existing verified admin authentication, never a posted payload;
 * the stored admin role is checked again here. Confirm the actual target account UUID.
 *
 * Each call removes at most five server-selected private request rows and their validated
 * optional reference images. Financial/usage ledgers, accounts, identity and result assets
 * stay for their separate established cleanup/retention procedures. "complete" refers only
 * to this scoped private-edit cleanup. No prompt/request text is selected or returned.
 *
 * Locks prevent new FK-backed work while this batch is checked and deleted. Storage deletion
 * is idempotent: on a partial failure every SQL request row/key stays for a safe retry. Run
 * this manual helper in small batches; never pass external storage keys or user-selected render IDs.
 */
export async function purgePremiumEditDataForAccountDeletion(
  deps: { sql: SqlRunner; store: RenderStore; now?: Date },
  operator: Viewer,
  input: { userId: string; confirmedUserId: string },
): Promise<PremiumEditPrivacyOutcome> {
  if (operator.isAdmin !== true || !operator.userId || !UUID.test(operator.userId)) return fail('forbidden');
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['userId','confirmedUserId'].includes(key)) || typeof input.userId !== 'string' || !UUID.test(input.userId)) return fail('bad_request');
  if (typeof input.confirmedUserId !== 'string' || !UUID.test(input.confirmedUserId) || input.userId.toLowerCase() !== input.confirmedUserId.toLowerCase()) return fail('confirmation_required');
  const userId = input.userId.toLowerCase();
  const operatorId = operator.userId.toLowerCase();
  const now = deps.now ?? new Date();
  try {
    return await deps.sql.transaction(async sql => {
      // Stable ordering also handles a self-account request without separate role/target races.
      const accounts = (await sql.query<{ id: string; is_admin: boolean }>('select id,is_admin from profiles where id=any($1::uuid[]) order by id for update', [[operatorId, userId]])).rows;
      if (!accounts.some(row => row.id === operatorId && row.is_admin === true)) return fail('forbidden');
      if (!accounts.some(row => row.id === userId)) return fail('not_found');
      if (!await subscriptionRenderSchemaReady(sql)) return fail('schema_not_ready');

      const subscriptions = (await sql.query<{ id: string; status: string; has_key: boolean }>('select id,status,billing_key_ciphertext is not null as has_key from creator_subscriptions where user_id=$1 order by id for update', [userId])).rows;
      if (subscriptions.some(row => !['ended','refunded'].includes(row.status))) return fail('billing_active');
      if (subscriptions.some(row => row.has_key)) return fail('billing_pending');
      const ids = subscriptions.map(row => row.id);
      const periods = (await sql.query<{ status: string; ends_at: string | Date; reserved_units: number }>('select status,ends_at,reserved_units from creator_subscription_periods where subscription_id=any($1::uuid[]) order by id for update', [ids])).rows;
      if (periods.some(row => ['pending','charging','refund_pending'].includes(row.status) || row.reserved_units > 0 || (row.status === 'paid' && new Date(row.ends_at) > now))) return fail('billing_pending');
      if ((await sql.query("select render_ref from creator_subscription_usage where user_id=$1 and state='reserved' order by render_ref for update", [userId])).rows.length) return fail('billing_pending');
      if ((await sql.query("select id from creator_subscription_key_cleanup where subscription_id=any($1::uuid[]) and status<>'revoked' order by id for update", [ids])).rows.length) return fail('billing_pending');

      const legacySubscriptions = (await sql.query<{ status: string }>('select status from subscriptions where user_id=$1 for update', [userId])).rows;
      if (legacySubscriptions.some(row => !['canceled','cancelled','incomplete_expired','ended','refunded'].includes(row.status))) return fail('billing_active');
      const payments = (await sql.query<{ status: string; fulfillment_pending: boolean }>("select status,(payment_type='NORMAL' and fulfilled_at is null) as fulfillment_pending from billing_payments where user_id=$1 order by id for update", [userId])).rows;
      if (payments.some(row => ['pending','confirming','refund_pending'].includes(row.status) || (row.status === 'paid' && row.fulfillment_pending))) return fail('billing_pending');

      const renders = (await sql.query<{ status: string }>('select status from render_jobs where user_id=$1 order by id for update', [userId])).rows;
      if (renders.some(row => !['succeeded','failed'].includes(row.status))) return fail('render_pending');
      const requests = (await sql.query<{ render_ref: string; reference_keys: unknown; render_owner: string | null }>(`select e.render_ref,e.reference_keys,j.user_id as render_owner from creator_subscription_renders e left join render_jobs j on j.id=e.render_ref
        where e.user_id=$1 order by e.created_at,e.render_ref limit $2 for update of e`, [userId, PREMIUM_EDIT_PRIVACY_BATCH_ROWS])).rows;
      const targets = requests.map(row => ({ id: row.render_ref, keys: validatedEditReferenceKeys(row.render_ref, row.reference_keys), owner: row.render_owner }));
      // Validate the entire batch before the first irreversible byte deletion, including the
      // render's owner: a corrupted private row must not address another account's objects.
      if (targets.some(row => row.owner !== userId || row.keys === null)) return fail('invalid_private_data');
      if (targets.some(row => row.keys!.length) && !deps.store.delete) return fail('storage_unavailable', true);
      let processedReferences = 0;
      for (const row of targets) for (const key of row.keys!) {
        try { await deps.store.delete!(key); } catch { throw new CleanupAbort('storage_unavailable'); }
        processedReferences += 1;
      }
      const deleted = await sql.query<{ render_ref: string }>('delete from creator_subscription_renders where user_id=$1 and render_ref=any($2::uuid[]) returning render_ref', [userId, targets.map(row => row.id)]);
      const remaining = (await sql.query<{ count: number }>('select count(*)::int as count from creator_subscription_renders where user_id=$1', [userId])).rows[0]?.count ?? 0;
      return { ok: true, deletedRequests: deleted.rows.length, processedReferences, remainingRequests: remaining, complete: remaining === 0 };
    });
  } catch (error) {
    return error instanceof CleanupAbort ? fail(error.code, true) : fail('database_unavailable', true);
  }
}
