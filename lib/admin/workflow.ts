import type { CampaignCounts } from "@/lib/campaigns/repo";

export const ADMIN_NAV_GROUPS = [
  { key: "operations", items: ["home", "inquiries", "risk"] },
  { key: "campaigns", items: ["brandWorkspace", "campaigns", "funding"] },
  { key: "content", items: ["prompts", "community"] },
  { key: "system", items: ["subscriptions", "playbooks", "policy"] },
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
  subscriptions: "/admin/subscriptions",
  playbooks: "/admin/playbooks",
  policy: "/admin/policy",
} as const;
export type AdminNavKey = keyof typeof ADMIN_NAV_PATHS;

export interface AdminQueueCounts {
  posts: number;
  applicants: number;
  payouts: number;
  studio: number;
  inquiries: number;
  feedback: number;
  templates: number;
  risk?: number;
  creatorApplications?: number;
}
export type AdminTaskKey = keyof AdminQueueCounts;
const QUEUES: Array<{ key: AdminTaskKey; href: string }> = [
  { key: "risk", href: "/admin/risk" },
  { key: "posts", href: "/admin/campaigns" },
  { key: "applicants", href: "/admin/campaigns" },
  { key: "payouts", href: "/admin/campaigns#payout-queue" },
  { key: "studio", href: "/admin/brand-workspace#studio-inbox" },
  { key: "inquiries", href: "/admin/inquiries?kind=brand&status=new" },
  { key: "feedback", href: "/admin/inquiries?kind=feedback&status=new" },
  { key: "templates", href: "/admin/prompts?tab=pending" },
  { key: "creatorApplications", href: "/admin/community#applications" },
];

/** Read-only links: no mutation, inferred approval, or invented zero for unavailable data. */
export function adminNextActions(counts: AdminQueueCounts) {
  return QUEUES.filter((queue) => (counts[queue.key] ?? 0) > 0).map(
    (queue) => ({ ...queue, count: counts[queue.key] ?? 0 }),
  );
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
