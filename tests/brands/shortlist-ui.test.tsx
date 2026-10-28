import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignShortlist } from "@/components/brand-workspace/shortlist";
import { ProjectTabs } from "@/components/brand-workspace/project-tabs";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ShortlistCandidate } from "@/lib/brands/shortlist/service";
import { shortlistCount, sortShortlist } from "@/lib/brands/shortlist/format";
import { brandRouteAllowed, adminRouteAllowed } from "@/lib/routing/surfaces";
import { shortlistWorkerAuthorized } from "@/lib/brands/shortlist/http";

/** The brand's shortlist card, KO and EN. Fixture handles and figures only. */
const one: ShortlistCandidate = {
  id: "00000000-0000-4000-8000-000000000001", platform: "instagram", handle: "fixture.one", displayName: "Fixture One", category: "뷰티",
  avatarUrl: "/api/brand-workspace/shortlist/00000000-0000-4000-8000-000000000001/avatar?v=abcdefabcdef", measuredOn: "2026-10-27", picked: true,
  metrics: { followers: 67000, following: 164, posts: 562, feedPosts30d: 18, feedEngagement: 343, feedEngagementRate: 0.5, feedLikes: 330, feedComments: 13,
    adPosts30d: 9.3, adShare: 53, adEngagement: 290, adEngagementRate: 0.4, adLikes: 279, adComments: 12,
    reelsPosts30d: 20, reelsEngagement: 266, reelsEngagementRate: 0.4, reelsLikes: 261, reelsComments: 4.2, viewsMedian90d: 10000, viewsMax90d: 39000 },
};
const bare: ShortlistCandidate = { ...one, id: "00000000-0000-4000-8000-000000000002", handle: "fixture_two", displayName: null, category: null, avatarUrl: null, picked: false, metrics: { followers: 9042 } };

describe("campaign shortlist", () => {
  it("shows identity, the figures table and the facts in Korean, with the brand's mark", () => {
    const html = renderToStaticMarkup(<CampaignShortlist candidates={[bare, one]} canPick copy={getDictionary("ko").brandWorkspace.shortlist} locale="ko" />);
    expect(html).toContain('data-brand-shortlist="2"');
    expect(html).toContain("지표 기준 10월 27일");
    // Biggest first by default.
    expect(html.indexOf('data-shortlist-candidate="fixture.one"')).toBeLessThan(html.indexOf('data-shortlist-candidate="fixture_two"'));
    expect(html).toContain("6.7만");
    expect(html).toContain("9,042");
    expect(html).toContain("3.9만");
    expect(html).toContain("9.3");
    expect(html).toContain("261 · 4.2");
    expect(html).toContain("53%");
    expect(html).toContain('href="https://www.instagram.com/fixture.one/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('data-shortlist-picked="true"');
    expect(html).toContain('data-shortlist-pick="on"');
    expect(html).toContain('data-shortlist-pick="off"');
    expect(html).toContain("선호만 보기 1");
    // A candidate with only a follower count shows no empty table rows.
    const two = html.slice(html.indexOf('data-shortlist-candidate="fixture_two"'));
    expect(two).not.toContain("data-shortlist-row");
    expect(two).toContain("지표를 정리하고 있어요.");
    // Initial instead of a picture when none was imported.
    expect(two).toContain(">F</span>");
  });

  it("never shows a pick control to a read-only viewer, and says why", () => {
    const html = renderToStaticMarkup(<CampaignShortlist candidates={[one]} canPick={false} copy={getDictionary("en").brandWorkspace.shortlist} locale="en" />);
    expect(html).not.toContain("data-shortlist-pick=");
    expect(html).toContain("Campaign contacts with comment access can mark preferences.");
    expect(html).toContain("67K");
    expect(html).toContain("Figures as of Oct 27");
  });

  it("has no wording about fees or where candidates came from", () => {
    for (const locale of ["ko", "en"] as const) {
      const html = renderToStaticMarkup(<CampaignShortlist candidates={[one, bare]} canPick copy={getDictionary(locale).brandWorkspace.shortlist} locale={locale} />);
      expect(html).not.toMatch(/₩|\d\s*원|단가|\bfees?\b|\bprice|brand\s*azine|브랜더진|페널티|penalty/i);
    }
  });

  it("sorts by views and engagement with unknown figures last", () => {
    const a = { handle: "a", metrics: { viewsMedian90d: 100, feedEngagementRate: 0.2, reelsEngagementRate: 1.5 } };
    const b = { handle: "b", metrics: { viewsMedian90d: 900, feedEngagementRate: 0.9 } };
    const c = { handle: "c", metrics: {} };
    expect(sortShortlist([c, a, b], "views").map((x) => x.handle)).toEqual(["b", "a", "c"]);
    expect(sortShortlist([c, b, a], "engagement").map((x) => x.handle)).toEqual(["a", "b", "c"]);
    expect(shortlistCount(undefined, "ko")).toBe("—");
  });

  it("adds the tab only when there are shared candidates", () => {
    const b = getDictionary("ko").brandWorkspace;
    expect(renderToStaticMarkup(<ProjectTabs b={b}><div /></ProjectTabs>)).not.toContain('href="#shortlist"');
    const html = renderToStaticMarkup(<ProjectTabs b={b} shortlist={9}><div /></ProjectTabs>);
    expect(html).toContain('href="#shortlist"');
    expect(html).toContain('data-shortlist-count="9"');
  });

  it("serves pictures on the brand and admin hosts for reading only", () => {
    const path = "/api/brand-workspace/shortlist/00000000-0000-4000-8000-000000000001/avatar";
    expect(brandRouteAllowed(path, "GET")).toBe(true);
    expect(brandRouteAllowed(path, "POST")).toBe(false);
    expect(adminRouteAllowed(path, "GET")).toBe(true);
    expect(adminRouteAllowed(path, "POST")).toBe(false);
    expect(brandRouteAllowed("/api/brand-shortlist-worker/import", "POST")).toBe(false);
  });

  it("opens the import worker's door only for its own long secret", () => {
    const secret = "s".repeat(40);
    const call = (authorization?: string) => new Request("https://twings.app/api/brand-shortlist-worker/import", { method: "POST", headers: authorization ? { authorization } : {} });
    expect(shortlistWorkerAuthorized(call(`Bearer ${secret}`), { BRAND_SHORTLIST_IMPORT_SECRET: secret })).toBe(true);
    expect(shortlistWorkerAuthorized(call(`Bearer ${secret}x`), { BRAND_SHORTLIST_IMPORT_SECRET: secret })).toBe(false);
    expect(shortlistWorkerAuthorized(call(), { BRAND_SHORTLIST_IMPORT_SECRET: secret })).toBe(false);
    expect(shortlistWorkerAuthorized(call("Bearer short"), { BRAND_SHORTLIST_IMPORT_SECRET: "short" })).toBe(false);
    expect(shortlistWorkerAuthorized(call("Bearer "), {})).toBe(false);
  });
});
