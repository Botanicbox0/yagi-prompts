import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Client results audit (2026-09-24): what a brand customer reads on a campaign's result tabs versus
 * what only the TWINGS team sees. Fixture values only: no real brand, creator, post code or figure.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/projects/project",
  useSearchParams: () => new URLSearchParams(),
}));
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { interpolate } from "@/lib/i18n/format";
import { campaignCsv, metricProvenance, UNKNOWN_POST_PRESENTATION } from "@/lib/brands/workspace/performance";
import type { BrandPost, BrandProjectDetail } from "@/lib/brands/workspace/types";
import type { BrandUsageView } from "@/lib/brands/usage/types";

const CODE = "FIXTURECODE01";
const post = (id: string, over: Partial<BrandPost> = {}): BrandPost => ({
  id, url: `https://www.instagram.com/p/${CODE}${id}/`, platform: "instagram", origin: "external_import", contentVersionId: null,
  publishedAt: null, metricRevision: 1, verification: "manual", metricsSource: "studio_review", measuredAt: "2026-09-23T05:00:00Z",
  views: 1200, viewsApproximate: false, likes: 40, comments: 3, shares: null, saves: null, createdAt: "2026-09-20T00:00:00Z",
  presentation: { ...UNKNOWN_POST_PRESENTATION, thumbnailUrl: `/api/brand-workspace/attachments/thumb-${id}` }, ...over,
});
const posts = [post("a"), post("b", { metricsSource: "creator_evidence", verification: "unverified", views: 12300, viewsApproximate: true })];
const base: BrandProjectDetail = {
  id: "project", organizationId: "org", organizationName: "Fixture brand", title: "Fixture campaign", objective: "Fixture objective",
  audience: "", budgetKrw: 5000000, budgetTaxBasis: "excluded",
  criteria: { platforms: ["instagram"], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null },
  startsOn: null, endsOn: null, productionMode: "creator", status: "active", revision: 1, clientVisible: false,
  createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z", role: "owner", canComment: true, referenceLinks: [],
  contents: [], decisions: [], messages: [], attachments: [], posts, contracts: [], contractUploads: [],
  reports: [{ id: "r1", version: 1, summary: "Fixture summary", periodStart: "2026-09-01", periodEnd: "2026-09-30", createdAt: "2026-09-23T00:00:00Z",
    snapshot: { totalPosts: 2, measuredPosts: 2, viewsTotal: 13500, viewsTotalApproximate: true, metricDefinition: "sum_of_latest_post_views", posts } }],
};
const usage = (role: BrandUsageView["role"]): BrandUsageView => ({ role, buyer: role === "owner", paymentsOpen: false, cases: [], eligible: [] });
const text = (html: string) => html.replace(/<[^>]+>/g, " ");
const tabs = (html: string) => [...html.matchAll(/<nav class="bw-tabs"[\s\S]*?<\/nav>/g)][0]![0].match(/href="#([a-z]+)"/g)!.map(h => h.slice(7, -1));

describe.each(["ko", "en"] as const)("campaign results for the brand customer (%s)", locale => {
  const b = getDictionary(locale).brandWorkspace;
  const render = (p: Partial<BrandProjectDetail>, u: BrandUsageView | null) =>
    renderToStaticMarkup(<ProjectDetail project={{ ...base, ...p }} b={b} locale={locale} usage={u} />);

  it("gives every client role the same result tabs; only the commercial usage tab depends on membership", () => {
    const all = ["performance", "brief", "review", "conversation", "reports", "files", "contracts", "usage"];
    expect(tabs(render({ role: "owner" }, usage("owner")))).toEqual(all);
    expect(tabs(render({ role: "editor" }, usage("editor")))).toEqual(all);
    expect(tabs(render({ role: "viewer", canComment: false }, usage("viewer")))).toEqual(all);
    // A campaign-only guest: loadBrandUsage returns null, so no usage tab.
    expect(tabs(render({ role: "viewer", canComment: false }, null))).toEqual(all.filter(t => t !== "usage"));
  });

  it("never shows the customer the staff notice, the unshared marker or the raw post code as text", () => {
    for (const role of ["owner", "editor", "viewer"] as const) {
      const html = render({ role }, usage(role));
      expect(html).not.toContain("data-brand-staff-view");
      expect(html).not.toContain("data-project-unshared");
      expect(text(html)).not.toContain(CODE);
      // The link destination still carries the platform's own URL.
      expect(html).toContain(`href="https://www.instagram.com/p/${CODE}a/"`);
      expect(html).not.toContain(b.managed.contractEmpty);
      expect(html).toContain(b.managed.contractEmptyClient);
    }
  });

  it("marks the TWINGS team's read-only view as such, and only that view", () => {
    const html = render({ role: "studio" }, usage("studio"));
    expect(html).toContain("data-brand-staff-view");
    expect(html).toContain("data-project-unshared");
    expect(html).toContain(b.managed.contractEmpty);
  });

  it("keeps the client-agreed budget and truthfully labels approximate, unverified and undated figures", () => {
    const html = text(render({ role: "viewer" }, usage("viewer")));
    expect(html).toContain(b.tax.excluded);
    expect(html).toContain(b.performance.approxValue.replace("{value}", (12300).toLocaleString(locale)));
    // Creator-provided and not yet verified is said; the studio's own check is not repeated as "verified".
    expect(html).toContain(`${b.sourceLabels.creator_evidence} · ${b.verificationLabels.unverified}`);
    expect(html).not.toContain(`${b.sourceLabels.studio_review} · ${b.verificationLabels.manual}`);
    // The publish date is unknown for both fixture posts: said on the live page and in the report.
    expect(html).toContain(interpolate(b.performance.undatedNote, { count: 2 }));
    expect(html).toContain(b.performance.publishedUnknown);
    expect(html).toContain(b.performance.sourceNotice);
  });

  it("never explains to the customer how a post was added to the campaign", () => {
    for (const role of ["owner", "viewer"] as const) for (const u of [usage(role), null]) {
      const html = render({ role }, u);
      expect(html).not.toContain("data-linked-posts");
      expect(html).not.toMatch(/external_import|approved_content|creator_evidence|studio_review/);
      // Ingestion words from earlier copy, in either language.
      expect(text(html)).not.toMatch(/링크로 (등록|추가|모은)|Linked existing post|added by link|Added by link/i);
    }
  });
});

describe("metric provenance", () => {
  it("never drops an unverified or creator-provided figure's status", () => {
    expect(metricProvenance({ metricsSource: "studio_review", verification: "manual" })).toEqual([{ kind: "source", value: "studio_review" }]);
    expect(metricProvenance({ metricsSource: "studio_review", verification: "unverified" })).toHaveLength(2);
    expect(metricProvenance({ metricsSource: "creator_evidence", verification: "manual" })).toHaveLength(2);
    expect(metricProvenance({ metricsSource: "unavailable", verification: "unverified" })).toEqual([{ kind: "source", value: "unavailable" }]);
  });
});

describe.each(["ko", "en"] as const)("results CSV for the client (%s)", locale => {
  it("numbers rows instead of internal ids and writes words, not stored codes", () => {
    const b = getDictionary(locale).brandWorkspace, c = b.performance;
    const headers = ["n", "title", "platform", "url", "published", "views", "likes", "comments", "shares", "saves", "source", "measured", "approx"];
    const csv = campaignCsv(posts, {}, headers, { platform: c.platformNames, source: b.sourceLabels, verification: b.verificationLabels, yes: c.csvYes, no: c.csvNo });
    const [, first, second] = csv.split("\r\n");
    expect(first!.startsWith('"1",')).toBe(true);
    expect(second!.startsWith('"2",')).toBe(true);
    expect(csv).not.toMatch(/external_import|approved_content|creator_evidence|studio_review|"true"|"false"|"instagram"/);
    // No origin column: every row has exactly one cell per header.
    for (const line of [first!, second!]) expect(line.split('","').length).toBe(headers.length);
    expect(csv).not.toMatch(/링크로|by link/i);
    // Truthful attribution: creator-provided and unverified is written out; the studio's own check once.
    expect(second).toContain(`"${b.sourceLabels.creator_evidence} · ${b.verificationLabels.unverified}"`);
    expect(first).toContain(`"${b.sourceLabels.studio_review}"`);
    expect(first).not.toContain(b.verificationLabels.manual);
    expect(second).toMatch(new RegExp(`"12300",.*"${c.csvYes}"$`));
    expect(first).toMatch(new RegExp(`"${c.csvNo}"$`));
    // Unknown values stay empty, never 0.
    expect(first).toContain('"3","",""');
  });
});
