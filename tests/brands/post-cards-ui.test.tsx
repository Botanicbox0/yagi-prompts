import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignPerformance, ReportResult } from "@/components/brand-workspace/performance";
import { CampaignList } from "@/components/brand-workspace/campaign-list";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { PostPresentationAdmin } from "@/components/brand-workspace/post-presentation-admin";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { UNKNOWN_POST_PRESENTATION } from "@/lib/brands/workspace/performance";
import { campaignDateLine, unsetDateKey } from "@/lib/brands/workspace/schedule";
import type { BrandPost, BrandProjectDetail, BrandProjectSummary, BrandProjectStatus } from "@/lib/brands/workspace/types";
/** Text a person can read or hear: tags removed, but alt/aria-label/title kept since screen readers speak them. */
const visible = (html: string) => html.replace(/<[^>]*?(?:alt|aria-label|title)="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]*>/g, " ");
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

/** Fixture values only: no real customer, creator handle, image or figure. */
const THUMB = "/api/brand-workspace/attachments/a0000000-0000-4000-8000-00000000000a";
const COVER = "/api/brand-workspace/attachments/cover";
const base: BrandPost = {
  id: "p1", origin: "external_import", contentVersionId: null, url: "https://www.instagram.com/p/FIXTURE01/", platform: "instagram",
  publishedAt: null, metricRevision: 1, verification: "unverified", metricsSource: "studio_review", measuredAt: "2026-09-22T03:00:00Z",
  views: 12300, viewsApproximate: true, likes: 410, comments: 22, shares: null, saves: null, createdAt: "2026-09-20T00:00:00Z",
  presentation: { revision: 1, thumbnailUrl: THUMB, handle: "fixture.creator", displayName: "Fixture Creator", followers: 123000, followersApproximate: true, followersSource: "studio_review", followersMeasuredAt: "2026-09-22T03:00:00Z" },
};
const bare: BrandPost = { ...base, id: "p2", url: "https://www.instagram.com/p/FIXTURE02/", views: 800, viewsApproximate: false, likes: null, comments: null, presentation: UNKNOWN_POST_PRESENTATION };
const project: BrandProjectDetail = {
  id: "project", organizationId: "org", organizationName: "Fixture brand", title: "Fixture campaign", objective: "Share results", audience: "",
  budgetKrw: null, budgetTaxBasis: "unspecified", criteria: { platforms: ["instagram"], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null },
  startsOn: null, endsOn: null, productionMode: "creator", status: "active", revision: 3, createdAt: "2026-09-20", updatedAt: "2026-09-20",
  coverUrl: COVER, role: "viewer", canComment: false, referenceLinks: [], contents: [], decisions: [], messages: [], attachments: [], posts: [base, bare], reports: [],
};
const cards = (html: string) => html.split('data-post-card="').slice(1);

describe.each(["ko", "en"] as const)("post cards in %s", locale => {
  const b = getDictionary(locale).brandWorkspace, c = b.performance;
  const html = renderToStaticMarkup(<CampaignPerformance project={project} b={b} locale={locale} />);

  it("shows each post's own thumbnail, @handle, follower count with its date and three counts", () => {
    const [first] = cards(html);
    expect(first).toContain(`src="${THUMB}"`);
    expect(first).toContain("@fixture.creator");
    expect(first).toContain("Fixture Creator");
    expect(first).toContain(c.followers.replace("{count}", c.approxValue.replace("{value}", (123000).toLocaleString(locale))));
    expect(first).toContain('data-followers="approximate"');
    expect(first).toContain(c.followersAsOf.replace("{date}", locale === "ko" ? "9월 22일" : "Sep 22"));
    expect(first).toContain(c.approxValue.replace("{value}", (12300).toLocaleString(locale)));
    expect(first).toContain(`>${(410).toLocaleString(locale)}<`);
    expect(first).toContain(`href="${base.url}"`);
    expect(first).toContain(c.openPost);
    // Metric provenance stays as small context; how the post was added to the campaign does not.
    expect(first).toContain(b.sourceLabels[base.metricsSource]);
    expect(visible(first!)).not.toContain("FIXTURE01");
    expect(first).toContain(c.publishedUnknown);
  });

  it("withholds unready customer cards and rankings without dropping measured totals", () => {
    expect(cards(html)).toHaveLength(1);
    expect(html).not.toContain(`href="${bare.url}"`);
    expect(html).not.toContain('data-thumbnail-missing="true"');
    expect(html).toContain((13100).toLocaleString(locale));
    expect(html).toContain('data-pending-post-cards="1"');
    const ready = { ...bare, presentation: { ...bare.presentation, thumbnailUrl: THUMB } };
    const after = renderToStaticMarkup(<CampaignPerformance project={{ ...project, posts: [base, ready] }} b={b} locale={locale} />);
    expect(cards(after)).toHaveLength(2);
    expect(after).toContain(`href="${bare.url}"`);
    expect(after).not.toContain('data-pending-post-cards');
  });

  it("keeps incomplete cards available to administrators", () => {
    const admin = renderToStaticMarkup(<CampaignPerformance project={project} b={b} locale={locale} showUnready />);
    const second = cards(admin)[1]!;
    expect(second).toContain('data-thumbnail-missing="true"');
    expect(second).toContain(c.thumbnailMissing);
    expect(second).not.toContain("<img");
    expect(second).toContain(c.followersUnknown);
    expect(second).toContain('data-followers="unknown"');
    expect(second).not.toMatch(/<dd>0<\/dd>/);
    expect(second).toContain("<dd>—</dd>");
    expect(visible(second)).not.toContain("FIXTURE02");
    // No handle, title or display name: the localized generic post name, never the post code.
    expect(second).toContain(`<strong class="bw-post-name">${b.platforms.instagram}</strong>`);
  });

  it("explains an all-pending gallery without saying the campaign has no posts", () => {
    const pending = renderToStaticMarkup(<CampaignPerformance project={{ ...project, posts: [bare] }} b={b} locale={locale} />);
    expect(cards(pending)).toHaveLength(0);
    expect(pending).toContain(c.cardsNotReady);
    expect(pending).not.toContain(b.noPosts);
    expect(pending).toContain('data-pending-post-cards="1"');
    expect(pending).toContain('>800<');
  });

  it("never shows the campaign cover or the old linked-post banner as a post image", () => {
    expect(html).not.toContain(COVER);
    expect(html).not.toContain("bw-preview");
    expect(html).not.toContain("data-linked-posts");
  });

  it("uses the same thumbnail in the rankings", () => {
    const rankings = html.split("bw-top-posts").slice(1).join("");
    expect(rankings).toContain(`src="${THUMB}"`);
    expect(rankings).toContain("@fixture.creator");
  });

  it("still filters and sorts, and finds posts by handle", () => {
    expect(html).toContain(c.searchHint);
    expect(html).toContain(`<option value="latest">${c.latest}</option>`);
  });
});

describe("frozen reports", () => {
  it("show the presentation stored with the report, not the live one", () => {
    const b = getDictionary("en").brandWorkspace;
    const frozen: BrandPost = { ...base, presentation: { ...base.presentation, handle: "fixture.before", thumbnailUrl: null } };
    const html = renderToStaticMarkup(<ReportResult project={{ ...project, posts: [base] }} report={{ id: "r", version: 1, summary: "Fixture", periodStart: "2026-09-01", periodEnd: "2026-09-30", createdAt: "2026-10-01T00:00:00Z",
      snapshot: { totalPosts: 1, measuredPosts: 1, viewsTotal: 12300, viewsTotalApproximate: true, metricDefinition: "sum_of_latest_post_views", posts: [frozen] } }} b={b} locale="en" />);
    expect(html).toContain("@fixture.before");
    expect(html).not.toContain("@fixture.creator");
    expect(html).not.toContain(THUMB);
    expect(html).toContain('data-thumbnail-missing="true"');
  });
});

describe("studio presentation editor", () => {
  it("offers only this campaign's images and blank-as-unknown fields", () => {
    const b = getDictionary("ko").brandWorkspace;
    const html = renderToStaticMarkup(<PostPresentationAdmin projectId="project" posts={[base, bare]} attachments={[
      { id: "a0000000-0000-4000-8000-00000000000a", name: "thumb.png", mime: "image/png", sizeBytes: 8, createdAt: "2026-09-20" },
      { id: "doc", name: "brief.pdf", mime: "application/pdf", sizeBytes: 8, createdAt: "2026-09-20" }]} b={b} />);
    expect(html).toContain('value="brandWorkspace.postPresentation"');
    expect(html).toMatch(/checked="" value="a0000000-0000-4000-8000-00000000000a"/);
    expect(html).not.toContain("brief.pdf");
    expect(html).toContain('name="expectedRevision" value="1"');
    expect(html).toMatch(/type="number"[^>]*name="followers" value=""/);
    expect(html).toContain(b.postPresentation.reportNote);
  });
});

describe("campaign dates by status", () => {
  const summary = (status: BrandProjectStatus, endsOn: string | null = null): BrandProjectSummary => ({ ...project, id: `c-${status}`, title: `Fixture ${status}`, status, endsOn });
  it("only a requested campaign without dates is still being scheduled", () => {
    expect(campaignDateLine(summary("requested"))).toEqual({ kind: "pending" });
    for (const status of ["active", "completed", "cancelled"] as const) expect(campaignDateLine(summary(status))).toBeNull();
    for (const status of ["requested", "active", "completed", "cancelled"] as const) expect(campaignDateLine(summary(status, "2026-10-01"))).toEqual({ kind: "endsOn", date: "2026-10-01" });
    expect(unsetDateKey("requested")).toBe("pending");
    for (const status of ["active", "completed", "cancelled"] as const) expect(unsetDateKey(status)).toBe("notSet");
  });
  it.each(["ko", "en"] as const)("never shows 'to be agreed' on active, completed or cancelled cards in %s", locale => {
    const b = getDictionary(locale).brandWorkspace;
    for (const studio of [false, true]) {
      for (const status of ["active", "completed", "cancelled"] as const) {
        const html = renderToStaticMarkup(<CampaignList projects={[summary(status)]} b={b} locale={locale} studio={studio} />);
        expect(html).not.toContain(b.dashboard.noDate);
      }
      const requested = renderToStaticMarkup(<CampaignList projects={[summary("requested")]} b={b} locale={locale} studio={studio} />);
      expect(requested).toContain(b.dashboard.noDate);
      const dated = renderToStaticMarkup(<CampaignList projects={[summary("completed", "2026-10-01")]} b={b} locale={locale} studio={studio} />);
      expect(dated).toContain('data-campaign-date="endsOn"');
    }
  });
  it.each(["ko", "en"] as const)("says an unset brief date is not set once the request is accepted, in %s", locale => {
    const b = getDictionary(locale).brandWorkspace;
    const completed = renderToStaticMarkup(<ProjectDetail project={{ ...project, status: "completed" }} b={b} locale={locale} />);
    expect(completed).toContain(`${b.dateNotSet} — ${b.dateNotSet}`);
    const requested = renderToStaticMarkup(<ProjectDetail project={{ ...project, status: "requested" }} b={b} locale={locale} />);
    expect(requested).toContain(`${b.tax.unspecified} — ${b.tax.unspecified}`);
  });
});

describe("dictionary parity", () => {
  it("has every new string in both languages", () => {
    const ko = getDictionary("ko").brandWorkspace, en = getDictionary("en").brandWorkspace;
    expect(Object.keys(ko.postPresentation).sort()).toEqual(Object.keys(en.postPresentation).sort());
    for (const key of ["thumbnailAlt", "thumbnailMissing", "followers", "followersUnknown", "followersAsOf", "publishedOn"] as const) {
      expect(ko.performance[key]).toBeTruthy(); expect(en.performance[key]).toBeTruthy(); expect(ko.performance[key]).not.toBe(en.performance[key]);
    }
    for (const value of [...Object.values(ko.postPresentation), ...Object.values(en.postPresentation), ko.dateNotSet, en.dateNotSet]) expect(value.trim()).not.toBe("");
  });
});

/**
 * Regression: an opaque platform post code (the fixture stands in for a real one) must never be
 * customer-visible text, whether or not a handle is known, live or frozen. Only the real link keeps it.
 */
describe.each(["ko", "en"] as const)("no raw post code in customer text (%s)", locale => {
  const b = getDictionary(locale).brandWorkspace;
  const CODE = "Xq9FixtureCode7", url = `https://www.instagram.com/p/${CODE}/`;
  const unknown: BrandPost = { ...bare, id: "u", url, presentation: { ...UNKNOWN_POST_PRESENTATION, thumbnailUrl: THUMB } };
  const known: BrandPost = { ...base, id: "k", url: `https://www.instagram.com/p/${CODE}K/` };
  const named: BrandPost = { ...bare, id: "n", url: `https://www.instagram.com/p/${CODE}N/`, presentation: { ...UNKNOWN_POST_PRESENTATION, thumbnailUrl: THUMB, displayName: "Fixture Name" } };
  const posts = [unknown, known, named];
  const check = (html: string) => {
    const text = visible(html);
    expect(text).not.toContain(CODE);
    // Beyond visible text: no attribute except the real link destination carries the code either.
    expect(html.replace(/href="[^"]*"/g, "")).not.toContain(CODE);
    expect(html).toContain(`href="${url}"`);
  };
  it("live cards, rankings and the project page", () => {
    const html = renderToStaticMarkup(<CampaignPerformance project={{ ...project, posts }} b={b} locale={locale} />);
    check(html);
    expect(visible(html)).toContain(b.platforms.instagram);
    expect(visible(html)).toContain("@fixture.creator");
    expect(visible(html)).toContain("Fixture Name");
    const report = { id: "r", version: 1, summary: "Fixture", periodStart: "2026-09-01", periodEnd: "2026-09-30", createdAt: "2026-10-01T00:00:00Z",
      snapshot: { totalPosts: 3, measuredPosts: 3, viewsTotal: 13900, viewsTotalApproximate: true, metricDefinition: "sum_of_latest_post_views" as const, posts } };
    check(renderToStaticMarkup(<ProjectDetail project={{ ...project, posts, reports: [report] }} b={b} locale={locale} />));
  });
  it("frozen report", () => {
    const html = renderToStaticMarkup(<ReportResult project={{ ...project, posts: [] }} report={{ id: "r", version: 1, summary: "Fixture", periodStart: "2026-09-01", periodEnd: "2026-09-30", createdAt: "2026-10-01T00:00:00Z",
      snapshot: { totalPosts: 3, measuredPosts: 3, viewsTotal: 13900, viewsTotalApproximate: true, metricDefinition: "sum_of_latest_post_views", posts } }} b={b} locale={locale} />);
    check(html);
  });
});
