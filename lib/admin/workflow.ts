import type { CampaignCounts } from "@/lib/campaigns/repo";

/**
 * The admin menu (docs/ADMIN.md §2.1). Groups follow the operator's day: operations first, then the
 * work people wait on, then settings. An entry carries no description — the page header says what a
 * screen is for, and a two-line menu no longer fits a laptop screen (audit 2026-11-03 §3.1).
 */
export const ADMIN_NAV_GROUPS = [
  { key: "operations", items: ["home", "renders"] },
  { key: "templates", items: ["prompts", "community", "contests"] },
  { key: "brands", items: ["brandWorkspace", "campaigns", "inquiries", "funding"] },
  { key: "money", items: ["payments", "payouts", "subscriptions"] },
  { key: "people", items: ["users", "risk", "accountDeletions"] },
  { key: "settings", items: ["landingMedia"] },
] as const;

export const ADMIN_NAV_PATHS = {
  home: "/admin",
  renders: "/admin/renders",
  prompts: "/admin/prompts",
  community: "/admin/community",
  contests: "/admin/contests",
  brandWorkspace: "/admin/brand-workspace",
  campaigns: "/admin/campaigns",
  inquiries: "/admin/inquiries",
  funding: "/admin/funding",
  payments: "/admin/payments",
  payouts: "/admin/payouts",
  subscriptions: "/admin/subscriptions",
  users: "/admin/users",
  risk: "/admin/risk",
  // Self-serve account deletion: what the daily pass could not finish (docs/RUNBOOK-deletion.md).
  accountDeletions: "/admin/account-deletions",
  landingMedia: "/admin/landing-media",
} as const;
export type AdminNavKey = keyof typeof ADMIN_NAV_PATHS;
export type AdminNavGroupKey = (typeof ADMIN_NAV_GROUPS)[number]["key"];

/**
 * Screens from the product TWINGS used to be (the playbook editor and its block policy). They keep
 * their routes until the founder decides their removal (docs/ADMIN.md §10-1), but no menu entry.
 */
export const ADMIN_LEGACY_KEYS = ["playbooks", "policy"] as const;
export type AdminShellKey = AdminNavKey | (typeof ADMIN_LEGACY_KEYS)[number];

export function adminNavGroupOf(key: AdminShellKey): AdminNavGroupKey | null {
  for (const group of ADMIN_NAV_GROUPS) {
    if ((group.items as readonly string[]).includes(key)) return group.key;
  }
  return null;
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
