import type { SqlRunner } from '@/lib/db/sql-runner';
import type { BillingEnvironment, SubscriptionRow, PeriodRow, SubscriptionSummary } from './types';

export const SUBSCRIPTION_SCHEMA_VERSION = '0042-0127-v1';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const iso = (value: string | Date | null) => value === null ? null : new Date(value).toISOString();
export async function loadSubscription(sql: SqlRunner, id: string, lock = false): Promise<SubscriptionRow | null> {
  if (!UUID.test(id)) return null;
  return (await sql.query<SubscriptionRow>(`select * from creator_subscriptions where id=$1${lock ? ' for update' : ''}`, [id])).rows[0] ?? null;
}
/** Small read-only probe: core columns + enabled RLS + browser privilege revocation. */
export async function subscriptionSchemaReady(sql: SqlRunner): Promise<boolean> {
  try {
    await sql.query(`select s.billing_key_ciphertext,s.premium_edit_limit,p.reserved_units,u.render_ref from creator_subscriptions s
      left join creator_subscription_periods p on p.subscription_id=s.id
      left join creator_subscription_usage u on u.period_id=p.id where false`);
    await sql.query('select encrypted_key from creator_subscription_key_cleanup where false');
    const { rows } = await sql.query<{ ready: boolean }>(`select count(*)=4 and bool_and(c.relrowsecurity and c.relforcerowsecurity)
      and bool_and(not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        and not has_any_column_privilege('anon',c.oid,'SELECT,INSERT,UPDATE')
        and not has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE')
        and not exists(select 1 from pg_policy policy where policy.polrelid=c.oid)
        and has_table_privilege('service_role',c.oid,'SELECT')
        and has_table_privilege('service_role',c.oid,'INSERT')
        and has_table_privilege('service_role',c.oid,'UPDATE')) as ready
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('creator_subscriptions','creator_subscription_periods','creator_subscription_usage','creator_subscription_key_cleanup')`);
    return rows[0]?.ready === true;
  } catch { return false; }
}
export async function getSubscriptionSummary(sql: SqlRunner, userId: string,
  options: { environment?: BillingEnvironment; now?: Date; subscriptionId?: string } = {}): Promise<SubscriptionSummary | null> {
  if (!UUID.test(userId) || (options.subscriptionId !== undefined && !UUID.test(options.subscriptionId))) return null;
  const { rows } = await sql.query<SubscriptionRow>(`select * from creator_subscriptions where user_id=$1 and environment=$2
    and ($3::uuid is null or id=$3)
    order by case when status not in ('ended','refunded') then 0 else 1 end, created_at desc limit 1`, [userId, options.environment ?? 'live',options.subscriptionId ?? null]);
  const s = rows[0];
  if (!s) return null;
  const p = (await sql.query<PeriodRow>('select * from creator_subscription_periods where subscription_id=$1 and period_index=$2', [s.id, s.current_period_index])).rows[0];
  const now = options.now ?? new Date();
  const hasAccess = ['active','past_due'].includes(s.status) && p?.status === 'paid' && new Date(p.starts_at) <= now && new Date(p.ends_at) > now;
  const used = p ? (p.reserved_units + p.consumed_units) / p.monthly_units * 100 : 0;
  return { id: s.id, planId: s.plan_id, status: s.status, environment: s.environment, cancelAtPeriodEnd: s.cancel_at_period_end,
    periodStart: iso(p?.starts_at ?? null), periodEnd: iso(p?.ends_at ?? null),
    nextBillingAt: s.cancel_at_period_end ? null : iso(s.next_billing_at),
    remainingPercent: hasAccess ? Math.max(0, 100 - used) : 0, usedPercent: used, hasAccess: !!hasAccess };
}

/** Display estimate against this member's stored contract, never today's pricing-model capacity. */
export async function getSubscriptionUsePercent(sql: SqlRunner, userId: string, environment: BillingEnvironment, units: number): Promise<number | null> {
  if (!UUID.test(userId) || !Number.isSafeInteger(units) || units <= 0) return null;
  const { rows } = await sql.query<{ monthly_units: number }>(`select p.monthly_units from creator_subscriptions s
    join creator_subscription_periods p on p.subscription_id=s.id and p.period_index=s.current_period_index
    where s.user_id=$1 and s.environment=$2 and s.status in ('active','past_due') and p.status='paid'
    order by s.created_at desc limit 1`, [userId, environment]);
  const capacity = Number(rows[0]?.monthly_units);
  return Number.isSafeInteger(capacity) && capacity > 0 ? units / capacity * 100 : null;
}
