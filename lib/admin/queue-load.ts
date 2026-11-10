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
import { countManualTossPayments } from "@/lib/billing/toss-service";
import { campaignWorkCounts } from "./workflow";
import { countRecentRenderFailures } from "./render-board";
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
export async function loadAdminQueues(sql: SqlRunner, viewer: Viewer, now: Date = new Date()): Promise<AdminQueueLoad> {
  const campaignWork = (async () => {
    const campaigns = await loadAllCampaigns(sql);
    const counts = await loadCampaignCounts(sql, campaigns.map((row) => row.id));
    return campaignWorkCounts(counts.values());
  })().catch(() => null);
  const creatorTables = platformReady(sql).catch(() => false);

  const [paymentsManual, renderFailures, risk, feedback, studio, inquiries, work, payouts, socialAccounts, creatorApplications, formats, templates] =
    await Promise.all([
      counted(() => countManualTossPayments(sql)),
      counted(() => countRecentRenderFailures(sql, now)),
      loadRiskQueueSummary(sql, viewer, now).catch(() => null),
      counted(() => countRenderFeedback(sql, "new")),
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
      risk: risk === null ? null : risk.ready ? risk.open : null,
      feedback,
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
