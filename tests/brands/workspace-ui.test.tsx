import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectDetail } from "@/components/brand-workspace/project-detail";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type {
  BrandProjectDetail,
  BrandPost,
} from "@/lib/brands/workspace/types";
import { UNKNOWN_POST_PRESENTATION } from "@/lib/brands/workspace/performance";
const post: BrandPost = {
  id: "post",
  origin: "approved_content",
  contentVersionId: "v1",
  url: "https://www.instagram.com/p/example/",
  platform: "instagram",
  publishedAt: "2026-09-20T00:00:00Z",
  metricRevision: 0,
  verification: "manual",
  metricsSource: "unavailable",
  measuredAt: null,
  views: null,
  viewsApproximate: false,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  createdAt: "2026-09-20T00:00:00Z",
  presentation: UNKNOWN_POST_PRESENTATION,
};
const project: BrandProjectDetail = {
  id: "project",
  organizationId: "org",
  organizationName: "Private Brand",
  title: "Autumn launch",
  objective: "Introduce the collection",
  audience: "Adults",
  budgetKrw: 3000000,
  budgetTaxBasis: "unspecified",
  criteria: {
    platforms: ["instagram"],
    minFollowers: null,
    maxFollowers: null,
    primaryMetric: "views",
    targetValue: 10000,
  },
  startsOn: null,
  endsOn: null,
  productionMode: "creator",
  status: "active",
  revision: 1,
  createdAt: "2026-09-20",
  updatedAt: "2026-09-20",
  role: "viewer",
  canComment: false,
  referenceLinks: [],
  contents: [],
  decisions: [],
  messages: [
    {
      id: "msg",
      body: "<script>alert(1)</script>",
      authorRole: "studio",
      createdAt: "2026-09-20",
    },
  ],
  attachments: [],
  posts: [post],
  reports: [
    {
      id: "report",
      version: 1,
      summary: "No measurements received yet",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-30",
      createdAt: "2026-10-01",
      snapshot: {
        totalPosts: 1,
        measuredPosts: 0,
        viewsTotal: null,
        viewsTotalApproximate: false,
        metricDefinition: "sum_of_latest_post_views",
        posts: [post],
      },
    },
  ],
};
describe("brand report and read-only UI", () => {
  it("shows Korean midnight as the next day while preserving authored date-only periods", () => {
    const instant = "2026-09-19T15:05:00Z";
    const b = getDictionary("ko").brandWorkspace;
    const dated = {
      ...project,
      startsOn: "2026-09-19",
      endsOn: "2026-09-20",
      updatedAt: instant,
      messages: [{ ...project.messages[0]!, createdAt: instant }],
      attachments: [
        {
          id: "file",
          name: "brief.pdf",
          mime: "application/pdf",
          sizeBytes: 100,
          createdAt: instant,
        },
      ],
      reports: [
        {
          ...project.reports[0]!,
          createdAt: instant,
          periodStart: "2026-09-19",
          periodEnd: "2026-09-20",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ProjectDetail project={dated} b={b} locale="ko" />,
    );
    expect(html).toContain(
      'dateTime="2026-09-19T15:05:00Z">2026년 9월 20일 00:05 KST</time>',
    );
    expect(html.match(/2026년 9월 20일 00:05 KST/g)).toHaveLength(4);
    expect(html).toContain("2026-09-19 — 2026-09-20");
  });
  it.each(["ko", "en"] as const)(
    "renders actual missing data and snapshot coverage in %s",
    (locale) => {
      const b = getDictionary(locale).brandWorkspace;
      const html = renderToStaticMarkup(
        <ProjectDetail project={project} b={b} locale={locale} />,
      );
      expect(html).toContain(b.notMeasured);
      expect(html).toContain("0 / 1");
      expect(html).toContain(b.metricsNote);
      expect(html).toContain('data-report-version="1"');
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;");
    },
  );
  it("never serializes unselected internal cost properties into the rendered brand view", () => {
    const b = getDictionary("en").brandWorkspace;
    const extra = {
      ...project,
      creatorPayout: "PAYMENT_SENTINEL",
      internalMargin: "MARGIN_SENTINEL",
    };
    const html = renderToStaticMarkup(
      <ProjectDetail project={extra} b={b} locale="en" />,
    );
    expect(html).not.toContain("PAYMENT_SENTINEL");
    expect(html).not.toContain("MARGIN_SENTINEL");
    expect(html).toContain("3,000,000");
  });
});
