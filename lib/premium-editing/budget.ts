import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BillingEnvironment } from '@/lib/creator-subscriptions/types';

/** Spend approval is explicit. Publish the configured limit before opening Premium; no default
 * creates an undisclosed allowance or substitutes a commercial decision.
 */
export function configuredPremiumEditLimit(env: Record<string, string | undefined> = process.env): number | null {
  const value = env.PREMIUM_EDIT_REQUESTS_PER_PERIOD?.trim();
  if (!value || !/^[1-9]\d{0,3}$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= 1000 ? limit : null;
}

export interface PremiumEditBudget { limit: number; attempted: number; remaining: number }

/** Safe owner projection. Attempts remain counted after refusals, uncertain responses and
 * generation allowance releases. Select neither private input nor prepared instructions.
 */
export async function getPremiumEditBudget(sql: SqlRunner, userId: string, options: { environment: BillingEnvironment; now?: Date }): Promise<PremiumEditBudget | null> {
  const { rows } = await sql.query<{ limit: number; attempted: number }>(`select s.premium_edit_limit as "limit", (
      select count(*)::int from creator_subscription_usage u join creator_subscription_renders e on e.render_ref=u.render_ref
      where u.period_id=p.id and u.user_id=s.user_id and u.environment=s.environment
        and e.user_id=s.user_id and e.environment=s.environment and e.edit_request_started_at is not null
    ) as attempted
    from creator_subscriptions s join creator_subscription_periods p on p.subscription_id=s.id and p.period_index=s.current_period_index and p.environment=s.environment
    where s.user_id=$1 and s.environment=$2 and s.plan_id='premium' and s.status in ('active','past_due') and s.premium_edit_limit between 1 and 1000
      and p.status='paid' and p.starts_at<=$3 and p.ends_at>$3 order by s.created_at desc limit 1`, [userId, options.environment, options.now ?? new Date()]);
  return rows[0] ? { limit: rows[0].limit, attempted: rows[0].attempted, remaining: Math.max(0, rows[0].limit - rows[0].attempted) } : null;
}

/** Claim immediately before OpenAI dispatch, following subscription->period->usage lock order.
 * The original paid period owns every attempt, including ambiguous and failed responses.
 */
export async function claimPremiumEditRequest(sql: SqlRunner, input: {
  renderId: string; userId: string; environment: BillingEnvironment; prepareToken: string; now: Date;
}): Promise<{ ok: true } | { ok: false; code: 'edit_request_limit' | 'edit_unavailable' | 'edit_in_progress' }> {
  const found = (await sql.query<{ subscription_id: string; period_id: string }>('select subscription_id,period_id from creator_subscription_usage where render_ref=$1 and user_id=$2 and environment=$3', [input.renderId, input.userId, input.environment])).rows[0];
  if (!found) return { ok: false, code: 'edit_unavailable' };
  return sql.transaction(async tx => {
    const subscription = (await tx.query<{ id: string; premium_edit_limit: number }>(`select id,premium_edit_limit from creator_subscriptions where id=$1 and user_id=$2 and environment=$3
      and plan_id='premium' and status in ('active','past_due') and premium_edit_limit between 1 and 1000 for update`, [found.subscription_id, input.userId, input.environment])).rows[0];
    if (!subscription) return { ok: false, code: 'edit_unavailable' };
    const period = (await tx.query<{ id: string }>(`select id from creator_subscription_periods where id=$1 and subscription_id=$2 and environment=$3
      and status='paid' and starts_at<=$4 and ends_at>$4 for update`, [found.period_id, subscription.id, input.environment, input.now])).rows[0];
    if (!period) return { ok: false, code: 'edit_unavailable' };
    const usage = (await tx.query<{ render_ref: string }>("select render_ref from creator_subscription_usage where render_ref=$1 and period_id=$2 and user_id=$3 and environment=$4 and state='reserved' for update", [input.renderId, period.id, input.userId, input.environment])).rows[0];
    if (!usage) return { ok: false, code: 'edit_unavailable' };
    const attempted = (await tx.query<{ attempted: number }>(`select count(*)::int as attempted from creator_subscription_usage u join creator_subscription_renders e on e.render_ref=u.render_ref
      where u.period_id=$1 and u.user_id=$2 and u.environment=$3 and e.user_id=$2 and e.environment=$3 and e.edit_request_started_at is not null`, [period.id, input.userId, input.environment])).rows[0]?.attempted ?? 0;
    if (attempted >= subscription.premium_edit_limit) return { ok: false, code: 'edit_request_limit' };
    const claimed = await tx.query<{ render_ref: string }>(`update creator_subscription_renders set edit_request_started_at=$5
      where render_ref=$1 and user_id=$2 and environment=$3 and prepare_token=$4 and edit_status='preparing' and edit_request_started_at is null returning render_ref`, [input.renderId, input.userId, input.environment, input.prepareToken, input.now]);
    return claimed.rows.length ? { ok: true } : { ok: false, code: 'edit_in_progress' };
  });
}
