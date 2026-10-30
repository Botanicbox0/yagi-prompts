import type { CampaignCounts } from "@/lib/campaigns/repo";

export const ADMIN_NAV_GROUPS = [
  { key: "operations", items: ["home", "inquiries", "risk"] },
  { key: "campaigns", items: ["brandWorkspace", "campaigns", "funding"] },
  { key: "content", items: ["prompts", "community", "contests", "landingMedia"] },
  { key: "system", items: ["subscriptions", "policy", "playbooks"] },
] as const;

export const ADMIN_NAV_PATHS = {
  home: "/admin",
  inquiries: "/admin/inquiries",
  risk: "/admin/risk",
  funding: "/admin/funding",
  brandWorkspace: "/admin/brand-workspace",
  campaigns: "/admin/campaigns",
  prompts: "/admin/prompts",
  community: "/admin/community",
  contests: "/admin/contests",
  landingMedia: "/admin/landing-media",
  subscriptions: "/admin/subscriptions",
  policy: "/admin/policy",
  playbooks: "/admin/playbooks",
} as const;
export type AdminNavKey = keyof typeof ADMIN_NAV_PATHS;

export type AdminTaskSeverity = "critical" | "high" | "normal";

export interface AdminQueueCounts {
  posts: number;
  applicants: number;
  payouts: number;
  studio: number;
  inquiries: number;
  feedback: number;
  templates: number;
  paymentsManual?: number;
  rendersFailed?: number;
  risk?: number;
  subscriptionReviews?: number;
  funding?: number;
  brandUsage?: number;
  creatorApplications?: number;
  formatsSubmitted?: number;
  socialAccounts?: number;
  contestEntries?: number;
}
export type AdminTaskKey = keyof AdminQueueCounts;

export interface AdminQueueOptions {
  now?: Date;
  locale?: string;
  firstPostCampaignId?: string | null;
  firstApplicantCampaignId?: string | null;
  oldestAt?: Partial<Record<AdminTaskKey, Date | string | null | undefined>>;
}

const QUEUES: ReadonlyArray<{
  key: AdminTaskKey;
  href: string;
  severity: AdminTaskSeverity;
}> = [
  // Critical: money, failed paid renders, conversation risk, and billing review holds
  {
    key: "paymentsManual",
    href: "/admin/inquiries?kind=feedback&status=new",
    severity: "critical",
  },
  {
    key: "rendersFailed",
    href: "/admin/inquiries?kind=feedback&status=new",
    severity: "critical",
  },
  { key: "risk", href: "/admin/risk", severity: "critical" },
  {
    key: "subscriptionReviews",
    href: "/admin/subscriptions",
    severity: "critical",
  },
  // High: active campaign execution, payouts, brand replies, and quotes
  { key: "posts", href: "/admin/campaigns", severity: "high" },
  { key: "applicants", href: "/admin/campaigns", severity: "high" },
  { key: "payouts", href: "/admin/campaigns#payout-queue", severity: "high" },
  {
    key: "studio",
    href: "/admin/brand-workspace#studio-inbox",
    severity: "high",
  },
  {
    key: "inquiries",
    href: "/admin/inquiries?kind=brand&status=new",
    severity: "high",
  },
  {
    key: "feedback",
    href: "/admin/inquiries?kind=feedback&status=new",
    severity: "high",
  },
  { key: "funding", href: "/admin/funding", severity: "high" },
  {
    key: "brandUsage",
    href: "/admin/brand-workspace/usage",
    severity: "high",
  },
  // Normal: catalog & creator review queues
  { key: "templates", href: "/admin/prompts?tab=pending", severity: "normal" },
  {
    key: "creatorApplications",
    href: "/admin/community#applications",
    severity: "normal",
  },
  {
    key: "formatsSubmitted",
    href: "/admin/community#formats",
    severity: "normal",
  },
  {
    key: "socialAccounts",
    href: "/admin/community#social",
    severity: "normal",
  },
  {
    key: "contestEntries",
    href: "/admin/contests#entries",
    severity: "normal",
  },
];

const SEVERITY_RANK: Record<AdminTaskSeverity, number> = {
  critical: 0,
  high: 1,
  normal: 2,
};

export function formatAdminWaitAge(
  since: Date | string | null | undefined,
  now: Date = new Date(),
  locale: string = "ko",
): { waitMs: number; label: string } | null {
  if (!since) return null;
  const date = since instanceof Date ? since : new Date(since);
  const ts = date.getTime();
  if (!Number.isFinite(ts)) return null;
  const waitMs = Math.max(0, now.getTime() - ts);
  const mins = Math.floor(waitMs / 60_000);
  const hours = Math.floor(waitMs / 3_600_000);
  const days = Math.floor(waitMs / 86_400_000);
  const ko = locale.startsWith("ko");
  if (days >= 1) {
    return { waitMs, label: ko ? `${days}일 대기` : `${days}d waiting` };
  }
  if (hours >= 1) {
    return { waitMs, label: ko ? `${hours}시간 대기` : `${hours}h waiting` };
  }
  if (mins >= 1) {
    return { waitMs, label: ko ? `${mins}분 대기` : `${mins}m waiting` };
  }
  return { waitMs, label: ko ? "방금 접수" : "Just arrived" };
}

/** Read-only links: no mutation, inferred approval, or invented zero for unavailable data. */
export function adminNextActions(
  counts: AdminQueueCounts,
  options?: AdminQueueOptions,
) {
  const now = options?.now ?? new Date();
  const locale = options?.locale ?? "ko";
  return QUEUES.map((queue, index) => ({ ...queue, index }))
    .filter((queue) => (counts[queue.key] ?? 0) > 0)
    .map((queue) => {
      let href = queue.href;
      if (queue.key === "posts" && options?.firstPostCampaignId) {
        href = `/admin/campaigns/${options.firstPostCampaignId}#posts`;
      } else if (
        queue.key === "applicants" &&
        options?.firstApplicantCampaignId
      ) {
        href = `/admin/campaigns/${options.firstApplicantCampaignId}#applications`;
      }
      const wait = formatAdminWaitAge(
        options?.oldestAt?.[queue.key],
        now,
        locale,
      );
      return {
        key: queue.key,
        href,
        severity: queue.severity,
        count: counts[queue.key] ?? 0,
        ...(wait ? { waitLabel: wait.label } : {}),
        _waitMs: wait?.waitMs ?? 0,
        _index: queue.index,
      };
    })
    .sort((a, b) => {
      const rankDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (rankDiff !== 0) return rankDiff;
      if (b._waitMs !== a._waitMs) return b._waitMs - a._waitMs;
      return a._index - b._index;
    })
    .map(({ _waitMs: _w, _index: _i, ...item }) => item);
}

export function campaignWorkCounts(counts: Iterable<CampaignCounts>) {
  let applicants = 0,
    posts = 0;
  for (const count of counts) {
    applicants += count.applied;
    posts += count.posted;
  }
  return { applicants, posts };
}
