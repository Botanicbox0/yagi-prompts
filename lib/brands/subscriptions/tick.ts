import { planGraceDaysFromEnv } from '@/lib/brand-studio/env';
import type { SqlRunner } from '@/lib/db/sql-runner';
import { brandBillingAutoIssueOpen } from '@/lib/flags';
import { addCalendarDays, kstDayOf } from '../billing/math';
import { loadSubscriptionSchemaReady } from '../billing/schema-guard';
import { periodOfDay } from './engine';
import {
  enqueueAttentionNotice,
  enqueueReconcileFailureNotice,
  enqueueSubscriptionNotice,
  subscriptionIssuesOfKstDay,
  systemVoidNoticeText,
  systemVoidsOfKstDay,
  voidEventsKey,
} from './notices';
import { reconcileErrorCode, reconcileSubscriptionInTx, recordReconcileFailure } from './service';
import type { BrandSubscriptionTickResult } from './types';

export const DEFAULT_SUBSCRIPTION_TICK_BATCH = 100 as const;
export const DEFAULT_SUBSCRIPTION_TICK_BUDGET_MS = 45_000 as const;
/** Consecutive failed reconciles at which the team is told (round 4, B5: daily while it lasts). */
export const RECONCILE_FAILURE_ALERT_AT = 3 as const;

/**
 * Hourly scheduled subscription reconciler (`BRAND_BILLING_AUTO_ISSUE=on`).
 *
 * - Flag off: returns immediately with zero database queries.
 * - Schema not ready (`0182` not yet applied): returns `{ ok: true, skipped: 'schema_not_ready' }`.
 * - Flag on: selects non-ended subscriptions ordered by `last_reconciled_at asc nulls first, organization_id asc`
 *   so no org starves across batches; stamps `last_reconciled_at` on processed, skipped, AND failing orgs.
 * - Internal `ops_alert` notices (counts only): invoices issued in the run (keyed on their ids); system voids
 *   of the KST day from the invoice events (round 4, B6); organizations at 3+ failed reconciles (B5).
 */
export async function runBrandSubscriptionTick(args: {
  sql: SqlRunner;
  env?: Record<string, string | undefined>;
  now?: () => Date;
  batchLimit?: number;
  budgetMs?: number;
  graceDays?: number;
}): Promise<BrandSubscriptionTickResult> {
  const env = args.env ?? process.env;
  if (!brandBillingAutoIssueOpen(env)) {
    return { ok: true, skipped: 'disabled' };
  }

  const { sql } = args;
  if (!(await loadSubscriptionSchemaReady(sql))) {
    return { ok: true, skipped: 'schema_not_ready' };
  }

  const runNow = args.now?.() ?? new Date();
  const runNowIso = runNow.toISOString();
  const todayKst = kstDayOf(runNow);
  const period = periodOfDay(todayKst);
  const graceDays = args.graceDays ?? planGraceDaysFromEnv(env);
  const limit = Math.max(1, Math.min(500, Math.floor(args.batchLimit ?? DEFAULT_SUBSCRIPTION_TICK_BATCH)));
  const deadlineMs = Date.now() + Math.max(500, args.budgetMs ?? DEFAULT_SUBSCRIPTION_TICK_BUDGET_MS);

  const { rows } = await sql.query<{ organization_id: string }>(
    `select organization_id::text as organization_id
       from brand_subscriptions
      where status <> 'ended'
      order by last_reconciled_at asc nulls first, organization_id asc
      limit $1`,
    [limit],
  );

  let attempted = 0;
  let processed = 0;
  let drafted = 0;
  let issued = 0;
  let voided = 0;
  let statusChanged = 0;
  let ended = 0;
  let skippedIneligible = 0;
  let errors = 0;
  let partialFailures = 0;
  let adopted = 0;
  let blockedByOlderEpoch = 0;
  let budgetExhausted = false;
  const issuedInvoiceIds: string[] = [];

  for (const row of rows) {
    if (Date.now() >= deadlineMs) {
      budgetExhausted = true;
      break;
    }
    const orgId = String(row.organization_id);
    attempted += 1;
    try {
      const summary = await sql.transaction(async (txSql) => {
        const res = await reconcileSubscriptionInTx(txSql, {
          organizationId: orgId,
          actor: { kind: 'system' },
          now: runNow,
          graceDays,
        });
        await txSql.query(
          'update brand_subscriptions set last_reconciled_at = $2::timestamptz where organization_id = $1',
          [orgId, runNowIso],
        );
        return res;
      });
      if (!summary.applied) {
        skippedIneligible += 1;
        continue;
      }
      processed += 1;
      drafted += summary.draftedPeriods.length;
      issued += summary.issuedPeriods.length;
      issuedInvoiceIds.push(...summary.issuedInvoiceIds);
      voided += summary.voidedInvoiceIds.length;
      adopted += summary.adoptedInvoiceIds.length;
      blockedByOlderEpoch += summary.blockedByOlderEpoch.length;
      if (summary.failures.length > 0) partialFailures += 1;
      if (summary.ended) {
        ended += 1;
      } else if (summary.statusBefore && summary.statusAfter && summary.statusBefore !== summary.statusAfter) {
        statusChanged += 1;
      }
    } catch (error) {
      errors += 1;
      await sql
        .query('update brand_subscriptions set last_reconciled_at = $2::timestamptz where organization_id = $1', [
          orgId,
          runNowIso,
        ])
        .catch(() => {});
      // Round 3, item 2: a reconcile that threw is counted too (fresh statement after the rollback).
      await recordReconcileFailure(sql, orgId, reconcileErrorCode(error)).catch(() => 0);
      console.warn('[brand-billing-tick] org_reconcile_failed', JSON.stringify({ code: reconcileErrorCode(error) }));
    }
  }

  const warn = (error: unknown) =>
    console.warn(
      '[brand-billing-tick] notice_enqueue_failed',
      JSON.stringify({ message: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }),
    );

  // Round 5, B1: invoices issued that KST day (from the events, whichever path issued them) need a tax invoice.
  let noticeEnqueued = false;
  for (const day of [addCalendarDays(todayKst, -1), todayKst]) {
    try {
      const eventIds = await subscriptionIssuesOfKstDay(sql, day);
      if (eventIds.length === 0) continue;
      const sent = await enqueueSubscriptionNotice(sql, {
        keyParts: ['issued', day, voidEventsKey(eventIds)],
        preview: `[B2B 정기구독 안내] ${day} 청구서 ${eventIds.length}건 발행 (홈택스 발행 후 승인번호 기록 필요)`,
        period: periodOfDay(day),
      });
      noticeEnqueued = noticeEnqueued || sent;
    } catch (error) {
      warn(error);
    }
  }

  // Round 4, B6: system voids of the KST day from the invoice events, whichever path wrote them. Yesterday is
  // read again so voids written after its last run are not lost; an unchanged set dedupes to nothing.
  let voidNoticeEnqueued = false;
  for (const day of [addCalendarDays(todayKst, -1), todayKst]) {
    try {
      const { eventIds, voids } = await systemVoidsOfKstDay(sql, day);
      const text = systemVoidNoticeText(voids);
      if (text === null) continue;
      const sent = await enqueueSubscriptionNotice(sql, {
        keyParts: ['system_voids', day, voidEventsKey(eventIds)],
        preview: `[B2B 정기구독 안내] ${day} ${text}`,
        period: periodOfDay(day),
      });
      voidNoticeEnqueued = voidNoticeEnqueued || sent;
    } catch (error) {
      warn(error);
    }
  }

  // Rounds 4–5 (B5 / B2): one notice per KST day and count while an organization is at 3+ failed reconciles, or
  // 1+ when the failure cost the customer access — whoever counted the failures.
  let failureNoticeEnqueued = false;
  try {
    failureNoticeEnqueued = await enqueueReconcileFailureNotice(sql, todayKst);
  } catch (error) {
    warn(error);
  }

  // B1a-2, item 5: suspended subscriptions and pending ones waiting for a reissue, once per KST day.
  let attentionNoticeEnqueued = false;
  try {
    attentionNoticeEnqueued = await enqueueAttentionNotice(sql, todayKst);
  } catch (error) {
    warn(error);
  }

  return {
    ok: true,
    period,
    checked: rows.length,
    attempted,
    processed,
    drafted,
    issued,
    voided,
    statusChanged,
    ended,
    skippedIneligible,
    errors,
    partialFailures,
    adopted,
    blockedByOlderEpoch,
    noticeEnqueued,
    voidNoticeEnqueued,
    failureNoticeEnqueued,
    attentionNoticeEnqueued,
    // Item 7: with grace 0 access ends on the due date itself; the operator sets BRAND_PLAN_GRACE_DAYS=14.
    graceDaysBelowOne: graceDays < 1,
    ...(budgetExhausted ? { budgetExhausted: true } : {}),
  };
}
