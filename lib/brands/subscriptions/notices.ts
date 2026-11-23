import { createHash } from 'node:crypto';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { deterministicNoticeSourceId, enqueueTeamNotice, opsAlertKindAllowed } from '../team-notice-outbox';

/**
 * Internal team notices of the B2B subscription job (never customer-facing). Counts only: no organization
 * names, no ids in the text.
 */

export interface SystemVoidRecord {
  reason: string;
  taxInvoiceRecorded: boolean;
}

const VOID_REASON_LABELS: Record<string, string> = {
  first_invoice_expired: '기한 지난 첫 청구서',
  stale_system_draft: '지난달 자동 초안',
  null_epoch_draft: '자동 발행을 끈 동안 만든 초안',
  subscription_canceled_unpaid: '해지(결제 없음)',
  subscription_canceled_future_draft: '해지(다음 달 초안)',
  subscription_canceled_future_invoice: '해지(다음 달 청구서)',
  subscription_canceled_current_draft: '해지(이번 달 초안)',
};

/** "시스템 취소 N건 (사유별) · 세금계산서 발행 기록이 있는 취소 M건 — 수정 세금계산서 필요" */
export function systemVoidNoticeText(voids: readonly SystemVoidRecord[]): string | null {
  if (voids.length === 0) return null;
  const byReason = new Map<string, number>();
  for (const v of voids) byReason.set(v.reason, (byReason.get(v.reason) ?? 0) + 1);
  const reasons = [...byReason.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reason, n]) => `${VOID_REASON_LABELS[reason] ?? reason} ${n}건`)
    .join(', ');
  const taxInvoiceRecordedOnVoided = voids.filter((v) => v.taxInvoiceRecorded).length;
  return [
    `시스템 취소 ${voids.length}건 (${reasons})`,
    // Round 4, B3: an expired first invoice can still be paid late; then the month must be issued again.
    ...(byReason.has('first_invoice_expired') ? ['기한 지난 첫 청구서는 이후 입금이 확인되면 다시 발행해야 합니다'] : []),
    ...(taxInvoiceRecordedOnVoided > 0
      ? [`세금계산서 발행 기록이 있는 취소 ${taxInvoiceRecordedOnVoided}건 — 수정 세금계산서 필요`]
      : []),
  ].join(' · ');
}

export async function enqueueSubscriptionNotice(
  sql: SqlRunner,
  params: { keyParts: readonly string[]; preview: string; period: string; surface?: string },
): Promise<boolean> {
  if (!(await opsAlertKindAllowed(sql))) return false;
  const res = await enqueueTeamNotice(sql, 'ops_alert', {
    organizationId: null,
    sourceTable: 'brand_invoices',
    sourceId: deterministicNoticeSourceId('brand_billing_tick', ...params.keyParts),
    surface: params.surface ?? 'brand_billing:tax_invoices_pending',
    actorUserId: null,
    actorLabel: 'B2B 정기구독 청구',
    preview: params.preview,
    adminPath: `/admin/brand-billing?period=${encodeURIComponent(params.period)}#tax-invoices`,
  });
  return res.enqueued;
}

/**
 * Review round 4, B6: the system voids of one KST day, read from `brand_invoice_events` (`voided` by the
 * system) of organizations with a subscription — whichever path wrote them (job, cancel, post-commit hook,
 * admin reconcile). Reason from the invoice's `void_reason`; tax invoice from `tax_invoice_issued_on`.
 */
export async function systemVoidsOfKstDay(
  sql: SqlRunner,
  kstDay: string,
): Promise<{ eventIds: string[]; voids: SystemVoidRecord[] }> {
  const { rows } = await sql.query<{ id: string; void_reason: string | null; tax_invoice_issued_on: string | null }>(
    `select e.id::text as id, i.void_reason, i.tax_invoice_issued_on::text as tax_invoice_issued_on
       from brand_invoice_events e
       join brand_invoices i on i.id = e.invoice_id
       join brand_subscriptions s on s.organization_id = i.organization_id
      where e.action = 'voided'
        and e.actor_kind = 'system'
        and e.created_at >= ($1::date)::timestamp at time zone 'Asia/Seoul'
        and e.created_at < ($1::date + 1)::timestamp at time zone 'Asia/Seoul'
      order by e.id`,
    [kstDay],
  );
  return {
    eventIds: rows.map((r) => String(r.id)),
    voids: rows.map((r) => ({ reason: String(r.void_reason ?? ''), taxInvoiceRecorded: r.tax_invoice_issued_on != null })),
  };
}

/**
 * Review round 5, B1: invoices issued on one KST day for organizations with a subscription, read from
 * `brand_invoice_events` (`issued`) — whichever path issued them (job, post-payment reconcile, reissue, admin
 * reconcile). Each needs a Hometax tax invoice.
 */
export async function subscriptionIssuesOfKstDay(sql: SqlRunner, kstDay: string): Promise<string[]> {
  const { rows } = await sql.query<{ id: string }>(
    `select e.id::text as id
       from brand_invoice_events e
       join brand_invoices i on i.id = e.invoice_id
       join brand_subscriptions s on s.organization_id = i.organization_id
      where e.action = 'issued'
        and e.created_at >= ($1::date)::timestamp at time zone 'Asia/Seoul'
        and e.created_at < ($1::date + 1)::timestamp at time zone 'Asia/Seoul'
      order by e.id`,
    [kstDay],
  );
  return rows.map((r) => String(r.id));
}

/**
 * Rounds 4–5 (B5 / B2): one notice per KST day and count while any non-ended subscription has 3+ consecutive
 * failed reconciles, or 1+ when the last failure cost the customer access the facts give them (`access:`).
 */
export async function enqueueReconcileFailureNotice(sql: SqlRunner, kstDay: string): Promise<boolean> {
  const { rows } = await sql.query<{ organization_id: string }>(
    `select organization_id::text as organization_id from brand_subscriptions
      where status <> 'ended'
        and (reconcile_failures >= 3 or (reconcile_failures >= 1 and last_reconcile_error like 'access:%'))`,
  );
  const stuck = rows.length;
  if (stuck === 0) return false;
  // B1a-2, item 2: keyed on the KST day + a hash of WHICH organizations fail (never shown), so "A recovers, B
  // fails" on the same day is sent; an unchanged set is not.
  return enqueueSubscriptionNotice(sql, {
    keyParts: ['reconcile_failures', kstDay, voidEventsKey(rows.map((r) => String(r.organization_id)))],
    preview: `[B2B 정기구독 확인 필요] 자동 정산이 실패한 조직이 ${stuck}곳입니다(3회 이상 연속 실패, 또는 이용 기간을 반영하지 못한 실패). 조직 구독 카드에서 오류 코드를 확인하고 다시 정산해 주세요.`,
    period: kstDay.slice(0, 7),
    surface: 'brand_billing:subscription_reconcile_failures',
  });
}

/**
 * B1a-2, item 5: subscriptions the team must look at — `suspended`, and `pending` with nothing paid and nothing
 * open in the current epoch (the "reissue or cancel" alert). Counts only.
 */
export async function subscriptionAttentionCounts(sql: SqlRunner): Promise<{ suspended: number; pendingReissue: number }> {
  const row = (
    await sql.query<{ suspended: number; pending_reissue: number }>(
      `select count(*) filter (where s.status = 'suspended')::int as suspended,
              count(*) filter (
                where s.status = 'pending'
                  and not exists (
                    select 1 from brand_invoices i
                     where i.organization_id = s.organization_id
                       and i.subscription_epoch = s.epoch
                       and ((i.status = 'paid' and i.kind in ('subscription', 'prepay'))
                         or (i.status = 'issued' and i.kind in ('subscription', 'adjustment')))
                  )
              )::int as pending_reissue
         from brand_subscriptions s
        where s.status <> 'ended'`,
    )
  ).rows[0];
  return { suspended: Number(row?.suspended ?? 0), pendingReissue: Number(row?.pending_reissue ?? 0) };
}

/** Once per KST day, when anything is suspended or waiting for a reissue. */
export async function enqueueAttentionNotice(sql: SqlRunner, kstDay: string): Promise<boolean> {
  const { suspended, pendingReissue } = await subscriptionAttentionCounts(sql);
  if (suspended === 0 && pendingReissue === 0) return false;
  return enqueueSubscriptionNotice(sql, {
    keyParts: ['attention', kstDay],
    preview: `[B2B 정기구독 확인 필요] ${kstDay} 이용 정지 ${suspended}곳 · 다시 발행이 필요한 대기 ${pendingReissue}곳. 조직 구독 카드에서 확인해 주세요.`,
    period: kstDay.slice(0, 7),
    surface: 'brand_billing:subscription_attention',
  });
}

/** Hash of the void event ids for the dedupe key (a new void that day sends an updated notice). */
export function voidEventsKey(eventIds: readonly string[]): string {
  return createHash('sha256').update([...eventIds].sort().join(',')).digest('hex').slice(0, 24);
}
