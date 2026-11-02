import type { SqlRunner } from '@/lib/db/sql-runner';
import { UUID } from './repo';
import type { BillingEnvironment, Failure, PeriodRow, SubscriptionRow } from './types';

interface UsageRow { render_ref: string; subscription_id: string; period_id: string; user_id: string;
  environment: BillingEnvironment; units: number; state: 'reserved' | 'consumed' | 'released' }
export type UsageReservation = { ok: true; subscriptionId: string; periodId: string; remainingUnits: number; alreadyReserved: boolean } | Failure;

/** The caller derives units from the stored catalog and validated render options, never the browser. */
export async function reserveSubscriptionUsage(sql: SqlRunner, input: {
  userId: string; renderRef: string; units: number; environment: BillingEnvironment; now?: Date; premium?: boolean;
}): Promise<UsageReservation> {
  if (!UUID.test(input.userId) || !UUID.test(input.renderRef) || !Number.isSafeInteger(input.units) || input.units <= 0 ||
    !['test','live'].includes(input.environment)) return { ok: false, code: 'bad_request' };
  const now = input.now ?? new Date();
  return sql.transaction(async tx => {
    // Global order: subscription -> period -> usage. Refunds take the same locks.
    const s = (await tx.query<SubscriptionRow>(`select * from creator_subscriptions where user_id=$1 and environment=$2
      and status in ('active','past_due') order by created_at desc limit 1 for update`, [input.userId,input.environment])).rows[0];
    if (!s) return {ok:false,code:'subscription_required'};
    if (input.premium && s.plan_id !== 'premium') return {ok:false,code:'premium_required'};
    const existing = (await tx.query<UsageRow>('select * from creator_subscription_usage where render_ref=$1', [input.renderRef])).rows[0];
    if (existing) {
      if (existing.user_id !== input.userId || existing.environment !== input.environment || existing.units !== input.units || existing.subscription_id !== s.id)
        return {ok:false,code:'reservation_mismatch'};
      if (existing.state === 'released') return {ok:false,code:'reservation_released'};
      const p = (await tx.query<PeriodRow>('select * from creator_subscription_periods where id=$1', [existing.period_id])).rows[0];
      if (!p) return {ok:false,code:'reservation_mismatch'};
      return {ok:true,subscriptionId:s.id,periodId:p.id,remainingUnits:p.monthly_units-p.reserved_units-p.consumed_units,alreadyReserved:true};
    }
    const p = (await tx.query<PeriodRow>(`select * from creator_subscription_periods where subscription_id=$1 and period_index=$2
      and environment=$3 for update`,[s.id,s.current_period_index,input.environment])).rows[0];
    if (!p || p.status !== 'paid' || new Date(p.starts_at) > now || new Date(p.ends_at) <= now) return {ok:false,code:'period_expired'};
    const available = p.monthly_units-p.reserved_units-p.consumed_units;
    if (available < input.units) return {ok:false,code:'insufficient_allowance'};
    await tx.query(`insert into creator_subscription_usage(render_ref,subscription_id,period_id,user_id,environment,units,created_at)
      values($1,$2,$3,$4,$5,$6,$7)`,[input.renderRef,s.id,p.id,input.userId,input.environment,input.units,now]);
    await tx.query('update creator_subscription_periods set reserved_units=reserved_units+$2 where id=$1',[p.id,input.units]);
    return {ok:true,subscriptionId:s.id,periodId:p.id,remainingUnits:available-input.units,alreadyReserved:false};
  });
}

/** An old period can settle after renewal; it never adds units to the new period. */
export async function settleSubscriptionUsage(sql: SqlRunner, renderRef: string, outcome: 'completed' | 'failed'): Promise<void> {
  if (!UUID.test(renderRef)) return;
  const found = (await sql.query<UsageRow>('select * from creator_subscription_usage where render_ref=$1',[renderRef])).rows[0];
  if (!found) return;
  await sql.transaction(async tx => {
    await tx.query('select id from creator_subscriptions where id=$1 for update',[found.subscription_id]);
    await tx.query('select id from creator_subscription_periods where id=$1 for update',[found.period_id]);
    const changed = await tx.query<UsageRow>(`update creator_subscription_usage set state=$2,settled_at=now()
      where render_ref=$1 and state='reserved' returning *`,[renderRef,outcome === 'completed' ? 'consumed' : 'released']);
    if (!changed.rows.length) return;
    await tx.query(`update creator_subscription_periods set reserved_units=reserved_units-$2,
      consumed_units=consumed_units+$3 where id=$1`,[found.period_id,found.units,outcome === 'completed' ? found.units : 0]);
  });
}
