import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { CollectionConsole } from "@/components/brand-workspace/collection-console";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { BrandPost, BrandProjectDetail } from "@/lib/brands/workspace/types";
import { UNKNOWN_POST_PRESENTATION } from "@/lib/brands/workspace/performance";
/** Text a person can read or hear: tags removed, but alt/aria-label/title kept since screen readers speak them. */
const visible = (html: string) => html.replace(/<[^>]*?(?:alt|aria-label|title)="([^"]*)"[^>]*>/g, " $1 ").replace(/<[^>]*>/g, " ");
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const linked: BrandPost = {
  id: "linked", origin: "external_import", contentVersionId: null, url: "https://www.instagram.com/p/FIXTURE01/", platform: "instagram",
  publishedAt: null, metricRevision: 0, verification: "unverified", metricsSource: "unavailable", measuredAt: null,
  views: null, viewsApproximate: false, likes: null, comments: null, shares: null, saves: null, createdAt: "2026-09-20T00:00:00Z",
  presentation: UNKNOWN_POST_PRESENTATION,
};
const project: BrandProjectDetail = {
  id: "project", organizationId: "org", organizationName: "Fixture brand", title: "Fixture campaign", objective: "Share results", audience: "",
  budgetKrw: null, budgetTaxBasis: "unspecified", criteria: { platforms: ["instagram"], minFollowers: null, maxFollowers: null, primaryMetric: "views", targetValue: null },
  startsOn: null, endsOn: null, productionMode: "creator", status: "active", revision: 3, createdAt: "2026-09-20", updatedAt: "2026-09-20",
  coverUrl: "/api/brand-workspace/attachments/cover", role: "viewer", canComment: true, referenceLinks: [], contents: [], decisions: [],
  messages: [{ id: "m", body: "Fixture comment", authorRole: "studio", createdAt: "2026-09-20T00:00:00Z" }], attachments: [], posts: [linked],
  reports: [{ id: "r", version: 1, summary: "Fixture", periodStart: "2026-09-01", periodEnd: "2026-09-30", createdAt: "2026-10-01T00:00:00Z",
    snapshot: { totalPosts: 1, measuredPosts: 0, viewsTotal: null, viewsTotalApproximate: false, metricDefinition: "sum_of_latest_post_views", posts: [linked] } }],
};

describe.each(["ko", "en"] as const)("client sharing UI in %s", (locale) => {
  const b = getDictionary(locale).brandWorkspace;
  it("offers comments to an invited commenting guest without offering approval or uploads", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale={locale} />);
    expect(html).toContain('data-comments="open"');
    expect(html).toContain(b.sendComment);
    expect(html).toContain('data-comment-count="1"');
    expect(html).not.toContain(b.upload);
    expect(html).not.toContain("data-comments-read-only");
    expect(html).toContain('data-project-cover="true"');
    expect(html).toContain('src="/api/brand-workspace/attachments/cover"');
  });
  it("explains read-only access instead of showing a form", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={{ ...project, canComment: false }} b={b} locale={locale} />);
    expect(html).toContain('data-comments="read-only"');
    expect(html).toContain(b.commentsReadOnly);
    expect(html).not.toContain(b.sendComment);
  });
  it("labels linked posts as not approved here and leaves unknown dates and counts unknown", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={project} b={b} locale={locale} />);
    expect(html).toContain('data-linked-posts="1"');
    expect(html).toContain(b.performance.linkedPost);
    expect(html).toContain(b.performance.publishedUnknown);
    // The raw platform post code is never customer text; it stays only in the link destination.
    expect(visible(html)).not.toContain("FIXTURE01");
    expect(html).toContain('href="https://www.instagram.com/p/FIXTURE01/"');
    expect(html).toContain(b.platforms.instagram);
    expect(html).toContain(b.performance.reportUndated.replace("{count}", "1"));
    expect(html).not.toMatch(/>0<\/strong>/);
  });
});

describe.each(["ko", "en"] as const)("publicly rounded view counts in %s", (locale) => {
  const b = getDictionary(locale).brandWorkspace;
  const measured = (id: string, views: number, viewsApproximate: boolean): BrandPost => ({ ...linked, id, url: `https://www.instagram.com/p/${id}/`, metricsSource: "studio_review", measuredAt: "2026-09-22T00:00:00Z", views, viewsApproximate, likes: 10, comments: 2 });
  const rounded = measured("ROUNDED01", 12300, true), exact = measured("EXACT01", 1200, false);
  const approx = (n: number) => b.performance.approxValue.replace("{value}", n.toLocaleString(locale));
  const withPosts = (posts: BrandPost[]): BrandProjectDetail => ({ ...project, posts, reports: [{ ...project.reports[0]!, snapshot: { totalPosts: posts.length, measuredPosts: posts.length, viewsTotal: posts.reduce((n, p) => n + p.views!, 0), viewsTotalApproximate: posts.some(p => p.viewsApproximate), metricDefinition: "sum_of_latest_post_views", posts } }] });

  it("labels the rounded count, the total that includes it and the rate, and explains why", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={withPosts([rounded, exact])} b={b} locale={locale} />);
    expect(html).toContain(approx(12300));
    expect(html).toContain(approx(13500));
    expect(html).not.toMatch(new RegExp(`>${(13500).toLocaleString(locale)}<`));
    expect(html).toContain('data-approximate-views="1"');
    expect(html).toContain(b.performance.approxNote.replace("{count}", "1"));
    expect(html).toMatch(/data-approximate="true"><span>/);
    expect(html).toContain(`>${(1200).toLocaleString(locale)}<`);
    // No borrowed image or invented creator label, and the post codes are not shown as text.
    expect(visible(html)).not.toMatch(/ROUNDED01|EXACT01/);
    expect(html).toContain('href="https://www.instagram.com/p/ROUNDED01/"');
  });

  it("shows exact counts without any approximate marker", () => {
    const html = renderToStaticMarkup(<ProjectDetail project={withPosts([exact])} b={b} locale={locale} />);
    expect(html).not.toContain(approx(1200));
    expect(html).not.toContain("data-approximate");
  });
});

describe("collection console", () => {
  it("prefills the abbreviated-count box from the latest observation and names rows by post code", () => {
    const b = getDictionary("ko").brandWorkspace;
    const posts: BrandPost[] = [{ ...linked, id: "a0000000-0000-4000-8000-000000000001", url: "https://www.instagram.com/p/ROUNDED01/", views: 12300, viewsApproximate: true, metricsSource: "studio_review", measuredAt: "2026-09-22T00:00:00Z" },
      { ...linked, id: "a0000000-0000-4000-8000-000000000002", url: "https://www.instagram.com/p/EXACT01/", views: 1200, metricsSource: "studio_review", measuredAt: "2026-09-22T00:00:00Z" }];
    const html = renderToStaticMarkup(<CollectionConsole projectId="b0000000-0000-4000-8000-000000000001" status="active" posts={posts} b={b} locale="ko" />);
    expect(html).toMatch(/name="viewsApproximate:a0000000-0000-4000-8000-000000000001"[^>]*checked=""/);
    expect(html).toMatch(/name="viewsApproximate:a0000000-0000-4000-8000-000000000002"(?![^>]*checked)[^>]*>/);
    expect(html).toContain("ROUNDED01");
    expect(html).toContain(b.viewsApproximateHint);
  });
});
