import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db/connect", () => ({ getSqlRunner: async () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
import { renderToStaticMarkup } from "react-dom/server";
import { CampaignShortlist } from "@/components/brand-workspace/shortlist";
import { ShortlistTriage, type TriageDoor } from "@/components/brand-workspace/shortlist-triage";
import { ADMIN_OPERATIONS } from "@/lib/admin/operations";
import { ProjectTabs } from "@/components/brand-workspace/project-tabs";
import { getDictionary } from "@/lib/i18n/dictionaries";
import type { ShortlistCandidate, StudioShortlistCandidate } from "@/lib/brands/shortlist/service";
import { shortlistCount, shortlistFit, shortlistMedian, shortlistTags, sortShortlist } from "@/lib/brands/shortlist/format";
import { brandRouteAllowed, adminRouteAllowed } from "@/lib/routing/surfaces";
import { shortlistWorkerAuthorized } from "@/lib/brands/shortlist/http";

/** The brand's shortlist card, KO and EN. Fixture handles and figures only. */
const one: ShortlistCandidate = {
  id: "00000000-0000-4000-8000-000000000001", platform: "instagram", handle: "fixture.one", displayName: "Fixture One", category: "뷰티",
  avatarUrl: "/api/brand-workspace/shortlist/00000000-0000-4000-8000-000000000001/avatar?v=abcdefabcdef", avatarTone: "#3366cc", measuredOn: "2026-10-27", picked: true, passed: false, confirmed: false,
  metrics: { followers: 67000, following: 164, posts: 562, feedPosts30d: 18, feedEngagement: 343, feedEngagementRate: 0.5, feedLikes: 330, feedComments: 13,
    adPosts30d: 9.3, adShare: 53, adEngagement: 290, adEngagementRate: 0.4, adLikes: 279, adComments: 12,
    reelsPosts30d: 20, reelsEngagement: 266, reelsEngagementRate: 0.4, reelsLikes: 261, reelsComments: 4.2, viewsMedian90d: 10000, viewsMax90d: 39000 },
};
const bare: ShortlistCandidate = { ...one, id: "00000000-0000-4000-8000-000000000002", handle: "fixture_two", displayName: null, category: null, avatarUrl: null, avatarTone: null, picked: false, metrics: { followers: 9042 } };
const third: ShortlistCandidate = { ...bare, id: "00000000-0000-4000-8000-000000000003", handle: "fixture_three", metrics: { followers: 30000, viewsMedian90d: 25000, feedEngagementRate: 3.2, adShare: 5, reelsPosts30d: 14 } };

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
    expect(html).toMatch(/data-shortlist-tab="picked">선호(<!-- -->)? <b>1<\/b>/);
    expect(html).toMatch(/data-shortlist-tab="open">후보(<!-- -->)? <b>2<\/b>/);
    // A candidate with only a follower count shows no empty table rows.
    const two = html.slice(html.indexOf('data-shortlist-candidate="fixture_two"'));
    expect(two).not.toContain("data-shortlist-row");
    expect(two).toContain("지표를 정리하고 있어요.");
    // Initial instead of a picture when none was imported.
    expect(two).toContain(">F</span>");
  });

  it("washes the card in the picture's colour and compares against the shortlist median from three candidates on", () => {
    const html = renderToStaticMarkup(<CampaignShortlist candidates={[one, bare, third]} canPick copy={getDictionary("ko").brandWorkspace.shortlist} locale="ko" />);
    expect(html).toContain("--bw-tone:#3366cc");
    expect(html).toContain("이 후보들 중앙값 대비");
    expect(html).toContain('data-shortlist-rel="above"');
    const card = html.slice(html.indexOf('data-shortlist-candidate="fixture_three"'));
    expect(card).toContain('data-shortlist-tag="views"');
    expect(card).toContain('data-shortlist-tag="organic"');
    expect(card).toContain("조회수 강세");
    expect(card).toContain('title="광고 비중이 15% 이하예요."');
    expect(html).toContain('data-shortlist-select="fixture.one"');
    // Two candidates are not enough for a median.
    expect(renderToStaticMarkup(<CampaignShortlist candidates={[one, bare]} canPick copy={getDictionary("ko").brandWorkspace.shortlist} locale="ko" />)).not.toContain("중앙값 대비");
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

  it("moves set-aside candidates to their own tab and shows confirmed bookings", () => {
    const passed = { ...third, picked: false, passed: true };
    const booked = { ...one, confirmed: true };
    const html = renderToStaticMarkup(<CampaignShortlist candidates={[booked, bare, passed]} canPick copy={getDictionary("ko").brandWorkspace.shortlist} locale="ko" />);
    // The main tab leaves the set-aside card out; the counts say where everyone is.
    expect(html).not.toContain('data-shortlist-candidate="fixture_three"');
    expect(html).toMatch(/data-shortlist-tab="open">후보(<!-- -->)? <b>2<\/b>/);
    expect(html).toMatch(/data-shortlist-tab="passed">제외(<!-- -->)? <b>1<\/b>/);
    expect(html).toMatch(/data-shortlist-tab="confirmed">섭외 확정(<!-- -->)? <b>1<\/b>/);
    const card = html.slice(html.indexOf('data-shortlist-candidate="fixture.one"'));
    expect(card).toContain('data-shortlist-confirmed="true"');
    expect(card).toContain('data-shortlist-pass="off"');
    // Everyone on screen can be selected at once; cards and list are both offered, cards first.
    expect(html).toContain("보이는 2명 모두 선택");
    expect(html).toMatch(/aria-pressed="true"[^>]*data-shortlist-view-button="cards"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-shortlist-view-button="list"/);
    // No booking yet means no booked tab.
    expect(renderToStaticMarkup(<CampaignShortlist candidates={[one, bare]} canPick copy={getDictionary("ko").brandWorkspace.shortlist} locale="ko" />)).not.toContain('data-shortlist-tab="confirmed"');
  });

  it("lays the same candidates out as a sortable list with the same controls", () => {
    const html = renderToStaticMarkup(<CampaignShortlist candidates={[bare, one, third]} canPick copy={getDictionary("en").brandWorkspace.shortlist} locale="en" defaultView="list" />);
    expect(html).toContain('data-shortlist-view="list"');
    expect(html).toContain('data-shortlist-list="3"');
    expect(html).not.toContain("data-shortlist-candidate=");
    const order = ["fixture.one", "fixture_three", "fixture_two"].map((h) => html.indexOf(`data-shortlist-row-candidate="${h}"`));
    expect(order.every((n) => n > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toMatch(/aria-sort="descending"><button[^>]*data-shortlist-sort-head="followers"/);
    expect(html).toContain('data-shortlist-select="fixture_two"');
    expect(html).toContain('data-shortlist-pick="on"');
    expect(html).toContain('data-shortlist-pass="off"');
    expect(html).toContain("67K");
    expect(html).toContain("53%");
  });

  it("lets a read-only viewer select and compare but not mark", () => {
    for (const defaultView of ["cards", "list"] as const) {
      const html = renderToStaticMarkup(<CampaignShortlist candidates={[one, bare]} canPick={false} copy={getDictionary("ko").brandWorkspace.shortlist} locale="ko" defaultView={defaultView} />);
      expect(html).not.toContain("data-shortlist-pick=");
      expect(html).not.toContain("data-shortlist-pass=");
      expect(html).toContain('data-shortlist-select="fixture.one"');
      expect(html).toContain("고른 후보 비교는 누구나 할 수 있어요.");
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

  it("reads candidates against ranges: inside, outside, or missing a figure the ranges need", () => {
    const m = { followers: 5000, viewsMedian90d: 4000, feedEngagementRate: 1.2, reelsEngagementRate: 2.5 };
    expect(shortlistFit(m, null)).toBeNull();
    expect(shortlistFit(m, { followers: { min: 1000, max: 10000 }, engagement: { min: 2 } })).toBe("in");
    expect(shortlistFit(m, { followers: { min: 6000 } })).toBe("out");
    expect(shortlistFit(m, { adShare: { max: 20 } })).toBe("unknown");
    // Any range the candidate is outside of decides, even when another figure is missing.
    expect(shortlistFit(m, { adShare: { max: 20 }, views: { min: 9000 } })).toBe("out");
    expect(shortlistMedian([3, 1, 2])).toBe(2);
    expect(shortlistMedian([4, 1, 2, 3])).toBe(2.5);
    expect(shortlistTags({ followers: 1000, viewsMedian90d: 600, adShare: 40, feedEngagementRate: 3 }, 2)).toEqual(["views", "engagement"]);
    expect(shortlistTags({ followers: 1000 }, null)).toEqual([]);
  });

  it("lists the studio's candidates biggest first, with states, marks and a working form for each move", () => {
    const at = (c: ShortlistCandidate, state: StudioShortlistCandidate["state"], createdAt = "2026-10-01T00:00:00.000Z"): StudioShortlistCandidate =>
      ({ ...c, state, shared: state === "shared", pickedAt: null, createdAt, updatedAt: createdAt });
    const door: TriageDoor = { path: "/admin/do", headers: {}, opField: "_op", backField: "_back", back: "/admin/brand-workspace/x#shortlist-admin", triageOp: "brandWorkspace.shortlistTriage", criteriaOp: "brandWorkspace.shortlistCriteria" };
    const list = [at(bare, "waiting", "2026-10-29T03:00:00.000Z"), at(third, "excluded"), at(one, "shared")];
    const html = renderToStaticMarkup(<ShortlistTriage projectId="00000000-0000-4000-8000-0000000000aa" candidates={list} criteria={{ followers: { min: 10000 } }}
      newSince="2026-10-28T12:00:00.000Z" door={door} copy={getDictionary("ko").brandWorkspace.shortlistAdmin} locale="ko" />);
    expect(html).toContain('data-shortlist-triage="3"');
    // Followers, biggest first, by default.
    expect(html).toContain('aria-sort="descending"');
    const order = ["fixture.one", "fixture_three", "fixture_two"].map((h) => html.indexOf(`data-triage-row="${h}"`));
    expect(order.every((n) => n > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toMatch(/data-triage-tab="excluded">제외(<!-- -->)? <b>1<\/b>/);
    // A new waiting candidate outside the saved criteria says both.
    const two = html.slice(html.indexOf('data-triage-row="fixture_two"'));
    expect(two).toContain('data-mark="new"');
    expect(two).toContain('data-triage-fit="out"');
    expect(html).toContain("캠페인 기준");
    expect(html).toContain("팔로워 ≥ 1만");
    // Without scripting each row still posts its own move to the same door.
    expect(html).toContain('action="/admin/do"');
    expect(html).toContain('name="_op" value="brandWorkspace.shortlistTriage"');
    expect(html).toMatch(new RegExp(`<button type="submit" value="share:${bare.id}"[^>]*name="one"`));
    expect(html).toMatch(new RegExp(`<button type="submit" value="wait:${third.id}"[^>]*name="one"`));
    expect(html).not.toContain(`value="exclude:${third.id}"`);
  });

  it("shows the studio what the client set aside and who is booked", () => {
    const at = (c: ShortlistCandidate, state: StudioShortlistCandidate["state"]): StudioShortlistCandidate =>
      ({ ...c, state, shared: state === "shared", pickedAt: null, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" });
    const door: TriageDoor = { path: "/admin/do", headers: {}, opField: "_op", backField: "_back", back: "/admin/brand-workspace/x#shortlist-admin", triageOp: "brandWorkspace.shortlistTriage", criteriaOp: "brandWorkspace.shortlistCriteria" };
    const list = [at({ ...one, picked: false, passed: true, confirmed: true }, "shared"), at(bare, "waiting")];
    const html = renderToStaticMarkup(<ShortlistTriage projectId="00000000-0000-4000-8000-0000000000aa" candidates={list} criteria={null}
      newSince="2026-10-28T12:00:00.000Z" door={door} copy={getDictionary("ko").brandWorkspace.shortlistAdmin} locale="ko" />);
    expect(html).toMatch(/data-triage-tab="passed">고객 제외(<!-- -->)? <b>1<\/b>/);
    expect(html).toMatch(/data-triage-tab="confirmed">섭외 확정(<!-- -->)? <b>1<\/b>/);
    const row = html.slice(html.indexOf('data-triage-row="fixture.one"'));
    expect(row).toContain('data-triage-passed="true"');
    expect(row).toContain('data-triage-confirmed="true"');
  });

  it("reads a row's button, a selection or the split lists into one triage call", () => {
    const parse = (entries: Array<[string, string]>) => {
      const form = new FormData();
      for (const [k, v] of entries) form.append(k, v);
      return ADMIN_OPERATIONS["brandWorkspace.shortlistTriage"].parse(form);
    };
    const [p, a, b] = ["00000000-0000-4000-8000-0000000000aa", "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    expect(parse([["projectId", p], ["one", `exclude:${a}`], ["action", "share"], ["candidateId", b]])).toEqual({ ok: true, value: { projectId: p, share: [], exclude: [a], wait: [] } });
    expect(parse([["projectId", p], ["action", "wait"], ["candidateId", a], ["candidateId", b]])).toEqual({ ok: true, value: { projectId: p, share: [], exclude: [], wait: [a, b] } });
    expect(parse([["projectId", p], ["share", a], ["exclude", b]])).toEqual({ ok: true, value: { projectId: p, share: [a], exclude: [b], wait: [] } });
    expect(parse([["projectId", p], ["one", `delete:${a}`]])).toMatchObject({ ok: false });
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
