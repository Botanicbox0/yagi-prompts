/**
 * The queue home's registry (docs/ADMIN.md §2.2). One entry = one thing someone is waiting on and
 * the list its number opens. The counters live in `queue-load.ts` (server-only reads); this file is
 * plain data so the menu, the tests and any later screen can import it anywhere.
 *
 * Order is priority: customers who paid come first, then safety, then brands and campaign creators,
 * then supply. A count of `null` means "could not count" (missing table, failed query) and is never
 * shown as a zero — an unavailable source must not look like finished work.
 */
export type AdminQueueKey =
  | "paymentsManual"
  | "renderFailures"
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
  // A customer paid and the automatic refund or fulfilment gave up (docs/PLATFORM-2.0.md §2.2-4).
  { key: "paymentsManual", group: "customers", href: "/admin/payments" },
  { key: "renderFailures", group: "customers", href: "/admin/renders?status=failed" },
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
