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
import { campaignWorkCounts } from "./workflow";

/**
 * The queue home's registry (docs/ADMIN.md §2.2). One entry = one thing someone is waiting on, the
 * function that counts it and the list that number opens. The home reads nothing else, so adding a
 * queue is one entry here, one counter below and one label in `messages/admin-console.ts`.
 *
 * Order is priority: customers who paid come first, then safety, then brands and campaign creators,
 * then supply. A count of `null` means "could not count" (missing table, failed query) and is never
 * shown as a zero — an unavailable source must not look like finished work.
 */
export type AdminQueueKey =
  | "risk"
  | "feedback"
  | "studio"
  | "inquiries"
  | "posts"
  | "payouts"
  | "applicants"
  | "socialAccounts"
  | "creatorApplications"
  | "formats"
  | "templates";

export type AdminQueueGroup =
  | "customers"
  | "safety"
  | "brands"
  | "campaigns"
  | "creatives";

export interface AdminQueueDefinition {
  key: AdminQueueKey;
  group: AdminQueueGroup;
  href: string;
}

export const ADMIN_QUEUES: readonly AdminQueueDefinition[] = [
  { key: "risk", group: "safety", href: "/admin/risk" },
  { key: "feedback", group: "customers", href: "/admin/inquiries?kind=feedback&status=new" },
  { key: "studio", group: "brands", href: "/admin/brand-workspace#studio-inbox" },
  { key: "inquiries", group: "brands", href: "/admin/inquiries?kind=brand&status=new" },
  { key: "posts", group: "campaigns", href: "/admin/campaigns" },
  { key: "payouts", group: "campaigns", href: "/admin/campaigns#payout-queue" },
  { key: "applicants", group: "campaigns", href: "/admin/campaigns" },
  { key: "socialAccounts", group: "campaigns", href: "/admin/community#social" },
  { key: "creatorApplications", group: "creatives", href: "/admin/community#applications" },
  { key: "formats", group: "creatives", href: "/admin/community#formats" },
  { key: "templates", group: "creatives", href: "/admin/prompts?tab=pending" },
];

export const ADMIN_QUEUE_GROUPS: readonly AdminQueueGroup[] = [
  "customers",
  "safety",
  "brands",
  "campaigns",
  "creatives",
];

export type AdminQueueCounts = Partial<Record<AdminQueueKey, number | null>>;

export interface AdminQueueState extends AdminQueueDefinition {
  /** `null` = the source could not be counted. */
  count: number | null;
}

/** Every queue in priority order, with its count or `null` when it could not be counted. */
export function adminQueueStates(counts: AdminQueueCounts): AdminQueueState[] {
  return ADMIN_QUEUES.map((queue) => ({ ...queue, count: counts[queue.key] ?? null }));
}

/** Read-only links: the queues with work in them, most urgent first. No inferred approval, no invented zero. */
export function adminNextActions(counts: AdminQueueCounts): Array<AdminQueueState & { count: number }> {
  return adminQueueStates(counts).filter(
    (queue): queue is AdminQueueState & { count: number } => (queue.count ?? 0) > 0,
  );
}

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

  const [risk, feedback, studio, inquiries, work, payouts, socialAccounts, creatorApplications, formats, templates] =
    await Promise.all([
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
