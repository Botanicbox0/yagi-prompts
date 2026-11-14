import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { SANDBOXED_CLIENT_ORG_IDS } from "@/lib/brands/features";
import type { ReviewComment, ReviewDetail, ReviewItem, ReviewList } from "@/lib/brand-studio/review-contracts";

/**
 * docs/BRAND-STUDIO-V3.md §7 and §9-1 through the real page with the data layer stubbed: the route
 * context is the gate (flag off, sandboxed or generation-closed brands get no page and the review
 * service is never asked), an ordinary brand gets the list, the stage with its timeline and spot pins,
 * the notes and the composer; a viewer reads only; `?review=&t=` picks the piece.
 */
const ORG = "a0000000-0000-4000-8000-00000000000a";
const R1 = "c0000000-0000-4000-8000-000000000001";
const R2 = "c0000000-0000-4000-8000-000000000002";
const MORPHIC_ID = [...SANDBOXED_CLIENT_ORG_IDS][0]!;

const state = vi.hoisted(() => ({
  locale: "ko" as "ko" | "en",
  org: { id: "", name: "Fixture brand", role: "owner", denied: undefined as string[] | undefined },
  list: null as unknown,
  details: {} as Record<string, unknown>,
  calls: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/studio/review",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/components/brand-workspace/context", async () => {
  const { getDictionary } = await import("@/lib/i18n/dictionaries");
  return {
    brandContext: async () => {
      const dict = getDictionary(state.locale);
      return {
        viewer: { userId: "00000000-0000-4000-8000-000000000001", isAdmin: false },
        sql: { query: async () => ({ rows: [] }), transaction: async () => undefined },
        verifiedEmail: undefined,
        brandHost: false,
        locale: state.locale,
        dict,
        b: dict.brandWorkspace,
      };
    },
  };
});
vi.mock("@/lib/brands/workspace/service", () => ({
  countPendingSharedCampaigns: async () => 0,
  loadBrandSupport: async () => [],
  loadBrandWorkspaceScope: async () => ({ choices: [{ ...state.org, logoUrl: null }], projectOrganizations: {} }),
  loadBrandWorkspace: async () => ({ organizations: [{ id: state.org.id, name: state.org.name, role: state.org.role }], projects: [] }),
}));
vi.mock("@/lib/brand-studio/review", () => ({
  loadReviewList: async () => {
    state.calls.push("list");
    return state.list;
  },
  loadReviewDetail: async (_deps: unknown, _viewer: unknown, _org: string, id: string) => {
    state.calls.push(`detail:${id}`);
    return state.details[id] ?? { ok: false, code: "not_found" };
  },
}));

import StudioReviewPage from "@/app/(brand)/brand/studio/review/page";
import { ReviewApp } from "@/components/brand-studio/review/review-app";
import { getDictionary } from "@/lib/i18n/dictionaries";

function item(id: string, kind: "image" | "video", extra: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id,
    organizationId: ORG,
    title: kind === "video" ? "Spring film v1" : "Logo still",
    status: "open",
    kind,
    thumbUrl: "/api/brand-studio/media/st/thumb.jpg",
    available: true,
    commentsOpen: 1,
    commentsTotal: 2,
    lastActivityAt: "2026-11-11T01:00:00.000Z",
    createdAt: "2026-11-11T00:00:00.000Z",
    subject: { outputId: "d0000000-0000-4000-8000-000000000001" },
    mediaUrl: kind === "video" ? "/api/brand-studio/media/st/film.mp4" : "/api/brand-studio/media/st/still.png",
    width: 1080,
    height: 1350,
    seconds: kind === "video" ? 6 : null,
    createdRole: "brand",
    statusChangedAt: null,
    ...extra,
  };
}
const note = (n: number, extra: Partial<ReviewComment> = {}): ReviewComment => ({
  id: `e0000000-0000-4000-8000-00000000000${n}`,
  parentId: null,
  authorName: "minji",
  authorRole: "brand",
  body: `note ${n}`,
  atMs: null,
  x: null,
  y: null,
  resolved: false,
  createdAt: "2026-11-11T00:30:00.000Z",
  deleted: false,
  mine: true,
  ...extra,
});

function seed(canWrite = true) {
  const list: ReviewList = { ok: true, canWrite, reviews: [item(R1, "video"), item(R2, "image", { status: "approved", commentsOpen: 0 })] };
  const video: ReviewDetail = {
    ok: true,
    canWrite,
    review: item(R1, "video"),
    comments: [note(1, { atMs: 1200, x: 0.3, y: 0.4 }), note(2, { parentId: note(1).id, authorRole: "studio", authorName: null, mine: false, body: "Fixed in v2" })],
  };
  const still: ReviewDetail = { ok: true, canWrite, review: item(R2, "image", { status: "approved" }), comments: [note(3, { x: 0.5, y: 0.5 })] };
  state.list = list;
  state.details = { [R1]: video, [R2]: still };
}

const page = async (query: Record<string, string> = {}) =>
  renderToStaticMarkup(await (StudioReviewPage({ searchParams: Promise.resolve({ organizationId: state.org.id, ...query }) }) as Promise<ReactElement>));

beforeEach(() => {
  state.locale = "ko";
  state.org = { id: ORG, name: "Fixture brand", role: "owner", denied: undefined };
  state.calls = [];
  seed();
});
afterEach(() => vi.unstubAllEnvs());

describe("/brand/studio/review", () => {
  it("has no page while the flag is off", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "off");
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.calls).toEqual([]);
  });

  it.each([
    ["a sandboxed organization id", { id: MORPHIC_ID, name: "Renamed client", role: "owner", denied: undefined }],
    ["an organization named Morphic", { id: ORG, name: "Morphic Korea", role: "owner", denied: undefined }],
    ["an organization named 모픽", { id: ORG, name: "모픽 마케팅", role: "owner", denied: undefined }],
    ["a brand whose policy closes generative media", { id: ORG, name: "Fixture brand", role: "owner", denied: ["generative_media"] }],
  ])("has no page for %s, and never asks the review service", async (_label, org) => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    state.org = org as typeof state.org;
    await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.calls).toEqual([]);
  });

  it("opens on /brand/studio/review for ordinary brands with the 1-click share & chat bridge header action", async () => {
    vi.stubEnv("BRAND_STUDIO_V2", "on");
    const html = await page({ review: R1 });
    expect(html).toContain("data-studio-review");
    expect(html).toContain("data-review-share-open");
    expect(state.calls).toEqual(["list", `detail:${R1}`]);
  });
});

describe("ReviewApp component (preserved for room/shared review)", () => {
  const renderApp = (locale: "ko" | "en", list: ReviewList, detail: ReviewDetail | null, initialMs: number | null = null) =>
    renderToStaticMarkup(
      <ReviewApp
        organizationId={ORG}
        locale={locale}
        copy={getDictionary(locale).studioReview}
        initialList={list}
        initialDetail={detail}
        initialMs={initialMs}
      />,
    );

  it.each(["ko", "en"] as const)("opens the newest piece with its timeline, spot pins, notes and composer (%s)", (locale) => {
    seed(true);
    const html = renderApp(locale, state.list as ReviewList, state.details[R1] as ReviewDetail);
    for (const marker of ["data-studio-review", "data-review-list", `data-review-item="${R1}"`, `data-review-stage="${R1}"`, "data-review-timeline", "data-review-comments", "data-review-composer", "data-review-mark"]) {
      expect(html, marker).toContain(marker);
    }
    expect(html).toContain(`data-review-pin="${note(1).id}"`);
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("0:01.2");
    expect(html).toContain("Fixed in v2");
    expect(html).toContain(locale === "ko" ? "야기 팀" : "YAGI team");
    expect(html).toContain(locale === "ko" ? "이 장면에 남기기" : "Note this moment");
    expect(html).toContain(locale === "ko" ? "수정 요청" : "Request changes");
    expect(html).toContain('type="range"');
    // The customer never reads an internal tool name.
    expect(html).not.toMatch(/slack|슬랙|webhook|웹훅|admin\/brand-studio/i);
  });

  it("opens the piece named in the link and shows a still's spot pins", () => {
    seed(true);
    const html = renderApp("ko", state.list as ReviewList, state.details[R2] as ReviewDetail, 500);
    expect(html).toContain(`data-review-stage="${R2}"`);
    expect(html).toContain(`data-review-spot="${note(3).id}"`);
    expect(html).not.toContain("data-review-timeline");
    expect(html).toContain("위치 찍기");
    // Approved: only "다시 열기" is offered.
    expect(html).toContain('data-review-status-action="open"');
    expect(html).not.toContain('data-review-status-action="approved"');
  });

  it("lets a viewer read without writing", () => {
    seed(false);
    const html = renderApp("ko", state.list as ReviewList, state.details[R1] as ReviewDetail);
    expect(html).toContain("data-review-read-only");
    expect(html).not.toContain("data-review-composer");
    expect(html).not.toContain("data-review-status-action");
    expect(html).not.toContain("data-review-pick-open");
  });

  it("shows the empty state with the way in when nothing is under review", () => {
    const emptyList: ReviewList = { ok: true, canWrite: true, reviews: [] };
    const html = renderApp("ko", emptyList, null);
    expect(html).toContain("data-review-empty");
    expect(html).toContain("data-review-pick-open");
    expect(html).toContain("리뷰할 작업 고르기");
    expect(html).not.toContain("data-review-stage");
  });
});
