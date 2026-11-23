import type { SqlRunner } from "@/lib/db/sql-runner";
import type { Viewer } from "@/lib/auth/identity";
import {
  loadAllCampaigns,
  loadCampaignCounts,
  loadPayoutQueue,
} from "@/lib/campaigns/repo";
import { countBrandInquiries } from "@/lib/brands/repo";
import { countRenderFeedback } from "@/lib/renders/feedback";
import { loadStudioInbox } from "@/lib/brands/workspace/inbox";
import { loadRiskQueueSummary } from "@/lib/campaigns/risk/admin";
import { countSocialQueue } from "@/lib/influencers/admin";
import { platformReady } from "@/lib/creator-platform/service";
import { creatorApplicationCount } from "@/lib/creator-platform/onboarding";
import { countDeletionQueue, deletionReady } from "@/lib/account/deletion";
import { tableExists } from "@/lib/brands/team-notice-outbox";
import { BRAND_INVOICE_OVERDUE_DAYS } from "@/lib/brands/billing/math";
import { isAccountLaneStale } from "./brand-studio-ops";
import { campaignWorkCounts } from "./workflow";
import {
  countManualPayments,
  countRecentRenderFailures,
  defaultPaymentEnvironment,
} from "./render-board";
import type { AdminQueueCounts } from "./queues";

/**
 * The counters behind `queues.ts` (docs/ADMIN.md §2.2). Read-only: every statement here is a count
 * or an existing loader, and nothing approves, pays or changes state.
 */
export type AdminRiskStatus = Awaited<ReturnType<typeof loadRiskQueueSummary>>;

export interface AdminQueueLoad {
  counts: AdminQueueCounts;
  /** The risk worker's health, which the home reports under "System". `null` = not a risk admin. */
  risk: AdminRiskStatus;
}

async function counted(run: () => Promise<number>): Promise<number | null> {
  try {
    return await run();
  } catch {
    return null;
  }
}

async function countRows(sql: SqlRunner, statement: string): Promise<number> {
  const { rows } = await sql.query<{ n: number | string }>(statement);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Count every queue at once. Each source fails on its own: one missing table turns its queue into
 * "could not count", never the whole page into an error.
 */
export async function loadAdminQueues(
  sql: SqlRunner,
  viewer: Viewer,
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<AdminQueueLoad> {
  const campaignWork = (async () => {
    const campaigns = await loadAllCampaigns(sql);
    const counts = await loadCampaignCounts(sql, campaigns.map((row) => row.id));
    return campaignWorkCounts(counts.values());
  })().catch(() => null);
  const creatorTables = platformReady(sql).catch(() => false);
  const paymentEnv = defaultPaymentEnvironment(env);

  const oneDayAgoIso = new Date(now.getTime() - 86_400_000).toISOString();
  const overdueCutoffIso = new Date(now.getTime() - BRAND_INVOICE_OVERDUE_DAYS * 86_400_000).toISOString();

  const [
    paymentsManual,
    renderFailures,
    brandStudioLaneStale,
    brandStudioFailures,
    accountDeletions,
    risk,
    feedback,
    supportDeliveryFailed,
    supportAwaitingReply,
    brandOverdueInvoices,
    brandWaitingForPlan,
    studio,
    inquiries,
    work,
    payouts,
    socialAccounts,
    creatorApplications,
    formats,
    templates,
  ] = await Promise.all([
    counted(() => countManualPayments(sql, paymentEnv)),
    counted(() => countRecentRenderFailures(sql, now)),
    counted(async () => {
      if (!(await tableExists(sql, "brand_studio_lanes")) || !(await tableExists(sql, "brand_studio_jobs"))) {
        throw new Error("brand studio lane tables unavailable");
      }
      const [laneRow, waitingRow] = await Promise.all([
        sql.query<{ seen_at: unknown }>("select seen_at from brand_studio_lanes where lane = 'sunra_mcp' limit 1"),
        sql.query<{ waiting_n: number; oldest_waiting_at: unknown }>(
          `select count(*)::int as waiting_n, min(created_at) as oldest_waiting_at
             from brand_studio_jobs
            where (lane = 'sunra_mcp' and status = 'queued')
               or (lane is null and status = 'held')`,
        ),
      ]);
      const rawSeen = laneRow.rows[0]?.seen_at;
      const seenAt = rawSeen == null ? null : rawSeen instanceof Date ? rawSeen : new Date(String(rawSeen));
      const rawOldest = waitingRow.rows[0]?.oldest_waiting_at;
      const oldestWaitingAt = rawOldest == null ? null : rawOldest instanceof Date ? rawOldest : new Date(String(rawOldest));
      const waitingCount = Number(waitingRow.rows[0]?.waiting_n ?? 0);
      return isAccountLaneStale(seenAt, now, { waitingCount, oldestWaitingAt }) ? 1 : 0;
    }),
    counted(async () => {
      if (!(await tableExists(sql, "brand_studio_jobs"))) throw new Error("brand_studio_jobs unavailable");
      const { rows } = await sql.query<{ n: number | string }>(
        `select count(*)::int as n
           from brand_studio_jobs
          where status = 'failed'
            and coalesce(finished_at, created_at) >= $1::timestamptz`,
        [oneDayAgoIso],
      );
      return Number(rows[0]?.n ?? 0);
    }),
    // Before 0064 the table is missing: "could not count", never a zero.
    counted(async () => {
      if (!(await deletionReady(sql))) throw new Error("account deletion table unavailable");
      return countDeletionQueue(sql, now);
    }),
    loadRiskQueueSummary(sql, viewer, now).catch(() => null),
    counted(() => countRenderFeedback(sql, "new")),
    counted(async () => {
      if (!(await tableExists(sql, "team_notice_deliveries"))) throw new Error("team notice outbox unavailable");
      return countRows(sql, "select count(*)::int as n from team_notice_deliveries where status = 'failed'");
    }),
    counted(async () => {
      const brandWaiting = await countRows(
        sql,
        `select count(*)::int as n
           from (select distinct on (organization_id) organization_id, author_role
                   from brand_support_messages
                  order by organization_id, created_at desc, id desc) latest
          where latest.author_role = 'brand'`,
      );
      const consumerWaiting = (await tableExists(sql, "consumer_support_messages"))
        ? await countRows(
            sql,
            `select count(*)::int as n
               from (select distinct on (user_id) user_id, author_role
                       from consumer_support_messages
                      order by user_id, created_at desc, id desc) latest
              where latest.author_role = 'customer'`,
          )
        : 0;
      return brandWaiting + consumerWaiting;
    }),
    counted(async () => {
      if (!(await tableExists(sql, "brand_invoices"))) throw new Error("brand_invoices unavailable");
      const { rows } = await sql.query<{ n: number | string }>(
        "select count(*)::int as n from brand_invoices where status = 'issued' and issued_at < $1::timestamptz",
        [overdueCutoffIso],
      );
      return Number(rows[0]?.n ?? 0);
    }),
    counted(async () => {
      if (!(await tableExists(sql, "brand_plan_assignments"))) throw new Error("brand_plan_assignments unavailable");
      if (!(await tableExists(sql, "team_notice_deliveries"))) return 0;
      return countRows(
        sql,
        `select count(*)::int as n
           from brand_organizations o
          where not exists (select 1 from brand_plan_assignments p where p.organization_id = o.id)
            and exists (
              select 1 from team_notice_deliveries nd
               where nd.organization_id = o.id
                 and (
                   nd.kind = 'allowance_request'
                   or (
                     nd.kind = 'plan_request'
                     and coalesce(nd.surface, '') not like 'billing:plan_question%'
                   )
                 )
            )`,
      );
    }),
    counted(async () => {
      const inbox = await loadStudioInbox({ sql }, viewer);
      if (inbox === null) throw new Error("studio inbox unavailable");
      return inbox.length;
    }),
    counted(() => countBrandInquiries(sql, "new")),
    campaignWork,
    counted(async () => (await loadPayoutQueue(sql, now)).length),
    // docs/PLATFORM-2.0.md §17.1 — throws before 0057, which reads as "could not count".
    counted(() => countSocialQueue(sql)),
    creatorTables.then((ready) => (ready ? counted(() => creatorApplicationCount(sql)) : null)),
    creatorTables.then((ready) =>
      ready ? counted(() => countRows(sql, "select count(*)::int as n from platform_formats where status = 'submitted'")) : null,
    ),
    counted(() => countRows(sql, "select count(*)::int as n from prompt_items where status = 'pending'")),
  ]);

  return {
    risk,
    counts: {
      paymentsManual,
      renderFailures,
      brandStudioLaneStale,
      brandStudioFailures,
      accountDeletions,
      risk: risk === null ? null : risk.ready ? risk.open : null,
      feedback,
      supportDeliveryFailed,
      supportAwaitingReply,
      brandOverdueInvoices,
      brandWaitingForPlan,
      studio,
      inquiries,
      posts: work?.posts ?? null,
      applicants: work?.applicants ?? null,
      payouts,
      socialAccounts,
      creatorApplications,
      formats,
      templates,
    },
  };
}
