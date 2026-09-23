import { interpolate } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { BrandProjectDetail } from "@/lib/brands/workspace/types";

type Copy = Dictionary["brandWorkspace"];

/** Who is looking: the admin console, a customer who can approve, or someone who only reads. */
export type NextActionAudience = "studio" | "approver" | "reader";

export interface NextAction {
  kind: string;
  text: string;
  href: string | null;
  label: string | null;
}

/**
 * The one "next step" line above a campaign's tabs. It follows the campaign's real state and the
 * viewer's role, so a requested campaign with nothing made yet never asks anyone to "check the
 * posts' results". It only describes steps the product actually has; it promises no dates.
 * `null` means there is nothing to prompt (cancelled, or the requested note already says it).
 */
export function projectNextAction(
  p: Pick<BrandProjectDetail, "status" | "contents" | "posts" | "reports">,
  audience: NextActionAudience,
  b: Copy,
): NextAction | null {
  const t = b.nextSteps;
  const studio = audience === "studio";
  const toStudio = (kind: string, text: string): NextAction => ({ kind, text, href: "#studio-actions", label: b.performance.studioActions });
  if (p.status === "cancelled") return null;
  if (p.status === "requested") return studio ? toStudio("studio-request", t.studioRequested) : null;

  const newest = new Map<string, number>();
  for (const c of p.contents) newest.set(c.slotKey, Math.max(newest.get(c.slotKey) ?? 0, c.version));
  const pending = p.contents.filter((c) => c.version === newest.get(c.slotKey) && c.decision === "pending").length;

  if (p.status === "completed") {
    if (p.reports.length > 0) return studio ? null : { kind: "report", text: t.completedReport, href: "#reports", label: b.reports };
    if (studio) return toStudio("studio-report", t.studioCompleted);
    return p.posts.length > 0 ? { kind: "completed", text: t.completedPosts, href: "#performance", label: b.performance.title } : null;
  }

  // Active.
  if (pending > 0) {
    if (studio) return { kind: "review", text: interpolate(t.studioAwaitingReview, { count: pending }), href: "#review", label: b.review };
    return { kind: "review", text: interpolate(audience === "approver" ? b.performance.reviewAction : t.readerReview, { count: pending }), href: "#review", label: b.review };
  }
  if (p.posts.length > 0) {
    if (studio) return toStudio("studio-tracking", t.studioTracking);
    return { kind: "tracking", text: b.performance.trackingAction, href: "#performance", label: b.performance.title };
  }
  if (p.contents.length === 0) return studio ? toStudio("studio-content", t.studioNoContent) : { kind: "preparing", text: t.preparing, href: null, label: null };
  return studio ? toStudio("studio-publish", t.studioPublish) : { kind: "awaiting-posts", text: t.awaitingPosts, href: null, label: null };
}
