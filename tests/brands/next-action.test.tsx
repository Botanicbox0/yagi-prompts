import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { projectNextAction } from "@/components/brand-workspace/next-action";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import type { BrandProjectDetail } from "@/lib/brands/workspace/types";

/**
 * Release follow-up: the "다음 할 일" line asked a requested campaign with no content and no posts to
 * "check the posts' results". It now follows the campaign's state and the viewer's role.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/projects/p",
  useSearchParams: () => new URLSearchParams(""),
}));

const content = (decision: "pending" | "approved") => ({ id: `v-${decision}`, slotKey: "main", version: 1, title: "Fixture cut", attachmentId: "a1",
  mediaUrl: "/api/brand-workspace/attachments/a1", caption: "", usageRights: "", reviewRevision: 0, decision, createdAt: "2026-09-20T00:00:00Z" });
const post = { id: "post" } as BrandProjectDetail["posts"][number];
const report = { id: "r" } as BrandProjectDetail["reports"][number];
const base: BrandProjectDetail = {
  id: "project", organizationId: "org", organizationName: "Fixture brand", title: "Fixture campaign", objective: "Fixture objective",
  audience: "", budgetKrw: null, budgetTaxBasis: "unspecified",
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null },
  startsOn: null, endsOn: null, productionMode: "creator", status: "requested", revision: 1,
  createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", role: "owner", canComment: true, referenceLinks: [],
  contents: [], decisions: [], messages: [], posts: [], attachments: [], reports: [], contracts: [], contractUploads: [],
} as BrandProjectDetail;
const with_ = (over: Partial<BrandProjectDetail>) => ({ ...base, ...over });

describe.each(["ko", "en"] as const)("campaign next step (%s)", (locale) => {
  const b = getDictionary(locale).brandWorkspace;
  const kind = (p: BrandProjectDetail, who: "studio" | "approver" | "reader") => projectNextAction(p, who, b)?.kind ?? null;

  it("never asks about results before anything is made", () => {
    // Requested, nothing made: the client already sees the requested note; the studio decides.
    expect(kind(base, "approver")).toBeNull();
    expect(kind(base, "reader")).toBeNull();
    expect(projectNextAction(base, "studio", b)).toMatchObject({ kind: "studio-request", text: b.nextSteps.studioRequested, href: "#studio-actions" });
    // Active, nothing uploaded yet.
    const empty = with_({ status: "active" });
    expect(projectNextAction(empty, "approver", b)).toMatchObject({ kind: "preparing", text: b.nextSteps.preparing, href: null });
    expect(kind(empty, "studio")).toBe("studio-content");
    for (const who of ["studio", "approver", "reader"] as const) expect(projectNextAction(empty, who, b)?.text).not.toBe(b.performance.trackingAction);
  });

  it("points approvers to review, and tells readers who approves", () => {
    const p = with_({ status: "active", contents: [content("pending")] });
    expect(projectNextAction(p, "approver", b)).toMatchObject({ kind: "review", href: "#review" });
    expect(projectNextAction(p, "reader", b)?.text).toBe(interpolate(b.nextSteps.readerReview, { count: 1 }));
    expect(projectNextAction(p, "studio", b)?.text).not.toBe(projectNextAction(p, "approver", b)?.text);
  });

  it("asks for results only once there are posts, and handles the end of a campaign", () => {
    const reviewed = with_({ status: "active", contents: [content("approved")] });
    expect(kind(reviewed, "approver")).toBe("awaiting-posts");
    expect(kind(reviewed, "studio")).toBe("studio-publish");
    const posted = with_({ status: "active", contents: [content("approved")], posts: [post] });
    expect(projectNextAction(posted, "approver", b)).toMatchObject({ kind: "tracking", text: b.performance.trackingAction, href: "#performance" });
    expect(kind(with_({ status: "completed", posts: [post], reports: [report] }), "reader")).toBe("report");
    expect(kind(with_({ status: "completed", posts: [post], reports: [report] }), "studio")).toBeNull();
    expect(kind(with_({ status: "completed", posts: [post] }), "approver")).toBe("completed");
    expect(kind(with_({ status: "completed" }), "studio")).toBe("studio-report");
    expect(kind(with_({ status: "cancelled", posts: [post] }), "approver")).toBeNull();
  });

  it("renders the admin view of a requested, empty campaign without the results prompt", () => {
    const admin = renderToStaticMarkup(<ProjectDetail project={with_({ role: "studio" })} b={b} locale={locale} studio />);
    expect(admin).toContain('data-project-next-action="studio-request"');
    expect(admin).not.toContain(b.performance.trackingAction);
    const client = renderToStaticMarkup(<ProjectDetail project={base} b={b} locale={locale} />);
    expect(client).not.toContain("data-project-next-action");
    expect(client).toContain(b.requestedNext);
  });
});
