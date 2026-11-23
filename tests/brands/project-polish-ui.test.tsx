import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Brand workspace P3 polish from the surface audit, rendered from the real components: localized
 * dates and sizes, no hard-coded file-type word, the approval-only confirmation, the tab labels and
 * hash, the visible next-action note, the status filter group, uploads and the no-JS language form.
 */
const nav = vi.hoisted(() => ({ path: "/brand/projects/p", query: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => nav.path,
  useSearchParams: () => new URLSearchParams(nav.query),
}));
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { buildProjectPrototypeLayer } from "@/components/brand-workspace/project-prototype-layer";
import { DecisionFields } from "@/components/brand-workspace/decision-fields";
import { YagiStudioLockup } from "@/components/brand/yagi-mark";
import { ServiceGuide } from "@/components/brand-workspace/service-guide";
import { tabFromHash } from "@/components/brand-workspace/project-tabs";
import { CampaignList } from "@/components/brand-workspace/campaign-list";
import { uploadStopNotice } from "@/components/brand-workspace/upload";
import { WorkspaceLanguage } from "@/components/brand-workspace/language";
import { formatBrandDate, formatFileSize } from "@/components/brand-workspace/format";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { BrandProjectDetail } from "@/lib/brands/workspace/types";

const project: BrandProjectDetail = {
  id: "project", organizationId: "org", organizationName: "Fixture brand", title: "Fixture campaign", objective: "Fixture objective",
  audience: "", budgetKrw: null, budgetTaxBasis: "unspecified",
  criteria: { platforms: [], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null },
  startsOn: "2026-09-19", endsOn: "2026-10-02", productionMode: "creator", status: "active", revision: 1,
  createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", role: "editor", canComment: true, referenceLinks: [],
  contents: [{ id: "v1", slotKey: "main", version: 1, title: "Fixture cut", attachmentId: "a1", mediaUrl: "/api/brand-workspace/attachments/a1",
    caption: "", usageRights: "", reviewRevision: 0, decision: "pending", createdAt: "2026-09-20T00:00:00Z" }],
  decisions: [], messages: [], posts: [],
  attachments: [{ id: "file", name: "brief.pdf", mime: "application/pdf", sizeBytes: 2 * 1024 * 1024 + 300, createdAt: "2026-09-20T00:00:00Z" }],
  reports: [{ id: "report", version: 1, summary: "Fixture", periodStart: "2026-09-01", periodEnd: "2026-09-30", createdAt: "2026-10-01T00:00:00Z",
    snapshot: { totalPosts: 0, measuredPosts: 0, viewsTotal: null, viewsTotalApproximate: false, metricDefinition: "sum_of_latest_post_views", posts: [] } }],
  contracts: [{ id: "c1", documentKey: "main", title: "Fixture contract", version: 1, attachmentId: "a2", shared: true, revision: 1, createdAt: "2026-09-20T00:00:00Z" }],
  contractUploads: [],
};

describe("campaign page", () => {
  it.each(["ko", "en"] as const)("formats authored dates and file sizes for the reader (%s)", (locale) => {
    const b = getDictionary(locale).brandWorkspace;
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale={locale} />);
    expect(html).not.toMatch(/>[^<]*2026-09-19/);
    expect(html).not.toMatch(/>[^<]*2026-09-01/);
    expect(html).toContain(`${formatBrandDate("2026-09-19", locale)} — ${formatBrandDate("2026-10-02", locale)}`);
    expect(html).toContain(`${formatBrandDate("2026-09-01", locale)} — ${formatBrandDate("2026-09-30", locale)}`);
    expect(html).toContain(formatFileSize(project.attachments[0]!.sizeBytes, locale));
    expect(html).not.toMatch(/\d KB/);
    // The contract row's file mark is an icon, not an English word.
    expect(html).not.toMatch(/bw-file-symbol[^>]*>\s*PDF/);
  });

  it("formats dates as the same calendar day and sizes in the locale's unit", () => {
    expect(formatBrandDate("2026-09-19", "ko")).toBe("2026년 9월 19일");
    expect(formatBrandDate("2026-09-19", "en")).toBe("Sep 19, 2026");
    expect(formatFileSize(100, "ko")).toBe("1kB");
    expect(formatFileSize(1536 * 1024, "en")).toBe("1.5 MB");
  });

  it("names the tab list for what it is and shows the next step above the tabs", () => {
    const b = getDictionary("ko").brandWorkspace;
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" />);
    expect(html).toContain(`<nav class="bw-tabs" aria-label="${b.projectSections}">`);
    expect(html).not.toContain(`aria-label="${b.projectTitle}"`);
    const next = html.indexOf('data-project-next-action="review"'), tabs = html.indexOf('class="bw-project-sections"');
    expect(next).toBeGreaterThan(-1);
    expect(next).toBeLessThan(tabs);
    expect(html).toContain('href="#review"');
  });

  it("counts only the latest pending review per slot on active campaigns", () => {
    const b = getDictionary("en").brandWorkspace;
    const first = project.contents[0]!;
    const contents = [first, { ...first, id: "v2", version: 2, decision: "approved" as const }, { ...first, id: "other", slotKey: "other" }];
    const html = renderToStaticMarkup(<ProjectDetail project={{ ...project, contents }} b={b} locale="en" />);
    expect(html).toContain('data-review-count="1"');
    expect(html).not.toContain('data-review-count="2"');
    const closed = renderToStaticMarkup(<ProjectDetail project={{ ...project, contents, status: "completed" }} b={b} locale="en" />);
    expect(closed).not.toContain('data-review-count');
  });

  it("preserves a filtered list on explicit back without accepting another organization", () => {
    const b = getDictionary("en").brandWorkspace;
    const html = renderToStaticMarkup(<ProjectDetail project={project} backHref="/brand?organizationId=org&q=launch&status=active#campaigns" b={b} locale="en" />);
    expect(html).toContain('href="/brand?organizationId=org&amp;q=launch&amp;status=active#campaigns"');
    const foreign = renderToStaticMarkup(<ProjectDetail project={project} backHref="/brand?organizationId=other&q=launch" b={b} locale="en" />);
    expect(foreign).toContain('href="/brand?organizationId=org"');
    expect(foreign).not.toContain('organizationId=other');
  });

  it("opens the tab a link's fragment names", () => {
    expect(tabFromHash("#review")).toBe("review");
    // Files share the conversation tab; usage shares the contracts tab.
    expect(tabFromHash("#files")).toBe("conversation");
    expect(tabFromHash("#usage")).toBe("contracts");
    expect(tabFromHash("#applicants")).toBe("applicants");
    expect(tabFromHash("#main")).toBeNull();
    expect(tabFromHash("")).toBeNull();
  });

  it("asks for the confirmation only when approving", () => {
    const b = getDictionary("ko").brandWorkspace;
    const approve = renderToStaticMarkup(<DecisionFields b={b} />);
    expect(approve).toContain(b.approveConfirm);
    expect(approve).toMatch(/<input type="checkbox" required="" name="confirmed"/);
    const changes = renderToStaticMarkup(<DecisionFields b={b} initial="changes_requested" />);
    expect(changes).not.toContain(b.approveConfirm);
    expect(changes).not.toContain('name="confirmed"');
  });

  it("keeps prototype panels off by default on ProjectDetail and restores them only when BRAND_WORKSPACE_PROTOTYPE_LAYER=on", async () => {
    const b = getDictionary("ko").brandWorkspace;
    const lockup = renderToStaticMarkup(<YagiStudioLockup size={22} subtitle="by YAGI" />);
    expect(lockup).toContain("data-yagi-studio-lockup");
    expect(lockup).toContain("data-yagi-mark");
    expect(lockup).toContain("YAGI");
    expect(lockup).toContain("STUDIO");

    // Default off: prototype widgets absent; real project direction card and tracking tabs stay intact.
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" />);
    expect(html).not.toContain("data-aesthetic-engine");
    expect(html).not.toContain("data-brief-intake");
    expect(html).not.toContain("data-handoff");
    expect(html).not.toContain("data-review-stage");
    expect(html).not.toContain("data-stakeholder-share-bar");
    expect(html).toContain("data-project-direction-card");
    expect(html).toContain('data-track="creator"');
    expect(html).toContain('id="performance"');
    expect(html).toContain('id="reports"');
    expect(html).toContain('id="contracts"');

    // Explicit flag on: restores the prototype panels cleanly.
    vi.stubEnv("BRAND_WORKSPACE_PROTOTYPE_LAYER", "on");
    try {
      const layer = await buildProjectPrototypeLayer({ project, locale: "ko", generativeMediaAllowed: true });
      const onHtml = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale="ko" prototypeLayer={layer} />);
      expect(onHtml).toContain("data-aesthetic-engine");
      expect(onHtml).toContain("data-brief-intake");
      expect(onHtml).toContain("data-handoff");
      expect(onHtml).toContain('data-mood-dna="atelier-editorial"');
      expect(onHtml).toContain("data-review-stage");
      expect(onHtml).toContain("data-stakeholder-share-bar");
    } finally {
      vi.unstubAllEnvs();
    }

    const studioProjectHtml = renderToStaticMarkup(<ProjectDetail project={{ ...project, productionMode: "studio" }} b={b} locale="ko" />);
    expect(studioProjectHtml).toContain('data-track="studio"');

    const guideHtml = renderToStaticMarkup(<ServiceGuide kind="studio" b={b} />);
    expect(guideHtml).toContain("data-track-cards");
    expect(guideHtml).toContain("YAGI PRODUCTION");
    expect(guideHtml).toContain("CREATOR CAMPAIGN");

    // When generativeMediaAllowed is false (e.g. Morphic), no AI brief concierge, aesthetic engine, handoff, direction card, or studio track appears.
    const deniedProjectHtml = renderToStaticMarkup(
      <ProjectDetail
        project={{ ...project, productionMode: "studio" }}
        b={b}
        locale="ko"
        generativeMediaAllowed={false}
      />
    );
    expect(deniedProjectHtml).not.toContain("data-aesthetic-engine");
    expect(deniedProjectHtml).not.toContain("data-brief-intake");
    expect(deniedProjectHtml).not.toContain("data-project-direction-card");
    expect(deniedProjectHtml).not.toContain("data-handoff");
    expect(deniedProjectHtml).not.toContain("YAGI PRODUCTION");
  });
});

describe("workspace controls", () => {
  it("groups the campaign status filter buttons", () => {
    const b = getDictionary("en").brandWorkspace;
    const html = renderToStaticMarkup(<CampaignList projects={[]} b={b} locale="en" />);
    expect(html).toContain(`class="bw-status-tabs" role="group" aria-label="${b.projectStatus}"`);
  });

  it("stays quiet on a cancelled upload and says so when the file limit is reached", () => {
    const b = getDictionary("ko").brandWorkspace;
    expect(uploadStopNotice("aborted", b)).toEqual({ notice: "", failed: false });
    expect(uploadStopNotice("rate_limited", b)).toEqual({ notice: b.errors.rateLimited, failed: true });
    expect(uploadStopNotice("failed", b)).toEqual({ notice: b.uploadFailed, failed: true });
  });

  it("keeps the selected brand in the no-JS language form", () => {
    nav.path = "/brand/projects/p"; nav.query = "organizationId=a0000000-0000-4000-8000-00000000000a";
    for (const compact of [true, false]) {
      const html = renderToStaticMarkup(<WorkspaceLanguage locale="ko" label="Language" compact={compact} />);
      expect(html).toContain('name="next" value="/brand/projects/p?organizationId=a0000000-0000-4000-8000-00000000000a"');
    }
    nav.query = "";
    expect(renderToStaticMarkup(<WorkspaceLanguage locale="ko" label="Language" compact />)).toContain('name="next" value="/brand/projects/p"');
  });
});
