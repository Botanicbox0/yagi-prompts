import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
import { getDictionary } from "@/lib/i18n/dictionaries";
import { CreatorPoolView } from "@/components/brand-workspace/creator-pool";
import type { CreatorPool, PoolQuery } from "@/lib/brands/creator-pool";

/**
 * docs/PLATFORM-2.0.md §17.3 — what the brand's creator pool page shows: one card per account with
 * handle, platform, rounded band and check date, a search and two filters (a GET form that keeps
 * the selected brand), and one action. No link to the profile. Closed, forbidden and empty states.
 */
const b = getDictionary("ko").brandWorkspace;
const ORG = "44444444-4444-4444-8444-444444444444";
const CAMPAIGN = "33333333-3333-4333-8333-333333333333";
const open: CreatorPool = {
  state: "open",
  canInvite: true,
  truncated: false,
  campaigns: [{ id: CAMPAIGN, slug: "fall", title: { en: "Fall", ko: "가을 신제품" }, slots: 3, invited: 1, cap: 15, closesAt: "2026-11-01T14:59:00Z" }],
  cards: [
    { id: "a1", handle: "hana.daily", platform: "instagram", followers: 3000, checkedOn: "2026-10-20", invitedTo: [] },
    { id: "a2", handle: "mina-cooks", platform: "youtube", followers: 125_000, checkedOn: "2026-10-19", invitedTo: [CAMPAIGN] },
  ],
};
const render = (pool: CreatorPool, query: PoolQuery = { q: "", platform: null, band: null }) =>
  renderToStaticMarkup(<CreatorPoolView pool={pool} query={query} b={b} locale="ko" organizationId={ORG} />);

describe("creator pool page", () => {
  it("shows a card per account with the rounded band, platform and check date, and no profile link", () => {
    const html = render(open);
    expect(html).toContain("data-creator-pool");
    expect((html.match(/data-creator-card=/g) ?? []).length).toBe(2);
    expect(html).toContain("@hana.daily");
    expect(html).toContain("팔로워 약 3천");
    expect(html).toContain("팔로워 약 12.5만");
    expect(html).toContain("2026-10-20 확인");
    expect(html).toContain('data-creator-platform="youtube"');
    expect(html).toContain("캠페인 1개에 초대함");
    for (const bad of ["instagram.com", "youtube.com", "tiktok.com", "125,000", "125000"]) expect(html).not.toContain(bad);
    expect((html.match(/data-creator-invite=/g) ?? []).length).toBe(2);
  });

  it("filters with a GET form that keeps the selected brand", () => {
    const html = render(open, { q: "hana", platform: "instagram", band: "3k-10k" });
    const form = html.match(/<form[^>]*data-creator-filters[^>]*>/)?.[0] ?? "";
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/brand/creators"');
    expect(html).toContain(`name="organizationId" value="${ORG}"`);
    expect(html).toContain('value="hana"');
    expect(html).toMatch(/<option value="instagram" selected=""/);
    expect(html).toMatch(/<option value="3k-10k" selected=""/);
    expect(html).toContain("10만 이상");
  });

  it("explains closed, forbidden, unavailable and empty pools", () => {
    expect(render({ state: "closed" })).toContain('data-creator-pool="closed"');
    expect(render({ state: "closed" })).toContain(b.creatorPool.closed);
    expect(render({ state: "forbidden" })).toContain(b.creatorPool.forbidden);
    expect(render({ state: "unavailable" })).toContain(b.creatorPool.unavailable);
    expect(render({ ...open, cards: [] })).toContain(b.creatorPool.emptyPool);
    expect(render({ ...open, cards: [] }, { q: "x", platform: null, band: null })).toContain(b.creatorPool.empty);
    expect(render({ ...open, truncated: true })).toContain("처음 60명만");
  });

  it("says why it cannot invite instead of hiding the reason", () => {
    expect(render({ ...open, canInvite: false })).toContain(b.creatorPool.inviteClosed);
    expect(render({ ...open, campaigns: [] })).toContain(b.creatorPool.noCampaign);
  });
});
