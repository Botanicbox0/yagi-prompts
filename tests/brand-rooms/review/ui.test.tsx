import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewComment, ReviewItem, ReviewVersion } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-ROOMS.md §6 — the screens, rendered: the extended stage (range lane, drawing, version
 * switcher, side by side, carried notes) only when asked, the v3 stage unchanged otherwise; the share
 * page's guest stage (name field, no status, no resolve, no workspace link); the share button only for
 * editors; the share gate; the deliverables tab's first paint.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/rooms/x",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { ReviewStage } from "@/components/brand-studio/review/stage";
import { ShareButton } from "@/components/brand-rooms/share";
import { SharedPage } from "@/components/brand-rooms/share/shared-page";
import { ProjectReviewTab } from "@/components/brand-rooms/review";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const PROJECT = "b0000000-0000-4000-8000-00000000000b";
const V1 = "c0000000-0000-4000-8000-000000000001";
const V2 = "c0000000-0000-4000-8000-000000000002";

function item(id: string, extra: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id,
    organizationId: ORG,
    title: "Main film",
    status: "open",
    kind: "video",
    thumbUrl: null,
    available: true,
    commentsOpen: 2,
    commentsTotal: 3,
    lastActivityAt: "2026-11-11T01:00:00.000Z",
    createdAt: "2026-11-11T00:00:00.000Z",
    subject: { assetId: "d0000000-0000-4000-8000-000000000001" },
    mediaUrl: "/api/brand-studio/media/st/film.mp4",
    width: 1920,
    height: 1080,
    seconds: 6,
    createdRole: "studio",
    statusChangedAt: null,
    projectId: PROJECT,
    stackId: V1,
    version: 2,
    source: "delivery",
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
  endMs: null,
  strokes: null,
  guest: false,
  carriedFrom: null,
  ...extra,
});
const version = (id: string, v: number): ReviewVersion => ({
  id,
  version: v,
  title: "Main film",
  status: "open",
  kind: "video",
  available: true,
  mediaUrl: "/api/brand-studio/media/st/film.mp4",
  thumbUrl: null,
  width: 1920,
  height: 1080,
  seconds: 6,
  commentsOpen: 1,
  createdAt: "2026-11-11T00:00:00.000Z",
});
const comments = [
  note(1, { atMs: 1200, endMs: 2400 }),
  note(2, { atMs: 3000, strokes: [{ tool: "arrow", color: "blue", points: [[0.1, 0.1], [0.5, 0.5]] }] }),
  note(3, { carriedFrom: { version: 1 }, body: "still too dark", mine: false }),
  note(4, { guest: true, authorName: "Jin", mine: false, body: "from outside" }),
];
const actions = { addComment: async () => ({ ok: true as const }), resolveComment: async () => ({ ok: true as const }), setStatus: async () => ({ ok: true as const }) };

describe.each(["ko", "en"] as const)("the review stage (%s)", (locale) => {
  const copy = getDictionary(locale).studioReview;

  it("shows the range lane, the drawing tool, the versions and the carried notes when extended", () => {
    const html = renderToStaticMarkup(
      <ReviewStage review={item(V2)} comments={comments} canWrite copy={copy} locale={locale} actions={actions} linkFor={() => "/x"} extended versions={[version(V2, 2), version(V1, 1)]} onVersion={() => undefined} />,
    );
    // "나란히 비교" now sits in the head's "⋯" menu (header-plan.test.ts pins the menu's items).
    for (const marker of ["data-review-range-lane", "data-review-versions", "data-review-more", 'data-review-carried="1"', "data-review-draw", `data-review-span="${note(1).id}"`, "data-review-drawing-tag"]) {
      expect(html, marker).toContain(marker);
    }
    expect(html).toContain("0:01.2–0:02.4");
    expect(html).toContain(locale === "ko" ? "v1에서 넘어온 의견" : "Open notes from v1");
    expect(html).toContain(locale === "ko" ? "외부 손님" : "Guest");
    expect(html).toContain('<option value="c0000000-0000-4000-8000-000000000002" selected="">v2');
    // A carried note offers resolve, never reply.
    const carried = html.slice(html.indexOf('data-review-carried="1"'));
    expect(carried).toContain(`data-review-resolve="${note(3).id}"`);
    expect(carried).not.toContain(copy.reply + "</button>");
  });

  it("is the v3 stage exactly when not extended", () => {
    const html = renderToStaticMarkup(<ReviewStage review={item(V2)} comments={comments.slice(0, 1)} canWrite copy={copy} locale={locale} actions={actions} linkFor={() => "/x"} />);
    for (const marker of ["data-review-range-lane", "data-review-versions", "data-review-draw", "data-review-ink", "data-review-guest-name"]) expect(html, marker).not.toContain(marker);
    // The link copy is in the "⋯" menu now; the status moves stay on the head.
    expect(html).toContain("data-review-more");
    expect(html).toContain("data-review-status-action");
  });

  it("gives a guest a name field and nothing to manage", () => {
    const html = renderToStaticMarkup(
      <ReviewStage
        review={item(V2)}
        comments={comments}
        canWrite={false}
        canComment
        canManage={false}
        extended
        guest={{ name: "", onName: () => undefined }}
        copy={copy}
        locale={locale}
        actions={{ addComment: actions.addComment }}
        downloadUrl="/api/brand-studio/media/st/film.mp4"
      />,
    );
    expect(html).toContain("data-review-guest-name");
    expect(html).toContain("data-review-composer");
    expect(html).toContain("data-review-download");
    for (const marker of ["data-review-status-action", "data-review-copy-link", "data-review-resolve"]) expect(html, marker).not.toContain(marker);
  });
});

describe("sharing", () => {
  const dict = getDictionary("ko");

  it("shows the share button to editors only", () => {
    expect(renderToStaticMarkup(<ShareButton organizationId={ORG} target={{ kind: "review", id: V1 }} locale="ko" copy={dict.roomsReview} canEdit={false} />)).toBe("");
    const html = renderToStaticMarkup(<ShareButton organizationId={ORG} target={{ kind: "review", id: V1 }} locale="ko" copy={dict.roomsReview} canEdit />);
    expect(html).toContain('data-share-open="review"');
    expect(html).toContain("공유");
  });

  it("asks a locked link for its passphrase and shows nothing else", () => {
    const html = renderToStaticMarkup(
      <SharedPage token={"T".repeat(43)} view={{ state: "locked", kind: "review" }} locale="ko" copy={dict.roomsReview} reviewCopy={dict.studioReview} storyboardCopy={dict.roomsStoryboard} />,
    );
    expect(html).toContain("data-share-gate");
    expect(html).toContain("암호를 입력해 주세요");
    expect(html).not.toContain("data-review-stage");
  });

  it("plays a shared draft with no way into the workspace", () => {
    const html = renderToStaticMarkup(
      <SharedPage
        token={"T".repeat(43)}
        view={{ state: "open", share: { kind: "review", allowComments: true, allowDownload: false, expiresAt: "2026-11-25T00:00:00.000Z" }, review: { review: item(V2, { organizationId: "" }), comments } }}
        locale="ko"
        copy={dict.roomsReview}
        reviewCopy={dict.studioReview}
        storyboardCopy={dict.roomsStoryboard}
      />,
    );
    expect(html).toContain(`data-review-stage="${V2}"`);
    expect(html).toContain("data-review-guest-name");
    expect(html).toContain("공유된 시안");
    expect(html).not.toContain("data-review-download");
    expect(html).not.toMatch(/href="\/brand|href="\/admin|slack|슬랙|웹훅/i);
    expect(html).not.toContain(ORG);
  });

  it("starts the deliverables tab with its own first paint", () => {
    const html = renderToStaticMarkup(
      <ProjectReviewTab organizationId={ORG} projectId={PROJECT} locale="ko" copy={dict.roomsReview} reviewCopy={dict.studioReview} chatCopy={dict.roomsChat} canEdit canTalk />,
    );
    expect(html).toContain("data-room-review");
    expect(html).toContain("시안을 불러오는 중");
    expect(html).toContain("data-room-review-add");
  });
});
