import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomReviewDetail, RoomReviewList, ReviewItem } from "@/lib/brand-studio/review-contracts";
import type { ShareLink } from "@/lib/brand-rooms/share-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { mountDom, type MountedDom } from "@/tests/brands/_dom-harness";

/**
 * Fix Round 3 Item 1 Step 0 parity snapshots — captured on UNTOUCHED `e062d4a7`
 * `components/brand-rooms/review/index.tsx` and `components/brand-rooms/share/index.tsx`
 * with `보내기` closed, BEFORE any Fix Round 3 UI edits.
 * NEVER regenerate these snapshots after Fix Round 3 edits begin.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/brand/rooms/b0000000-0000-4000-8000-00000000000b",
  useSearchParams: () => new URLSearchParams(),
}));

import { ProjectReviewTab } from "@/components/brand-rooms/review";
import { ShareButton, ShareDialog } from "@/components/brand-rooms/share";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const PROJECT = "b0000000-0000-4000-8000-00000000000b";
const IMG_REVIEW_ID = "c0000000-0000-4000-8000-000000000001";
const VID_REVIEW_ID = "c0000000-0000-4000-8000-000000000002";
const SHARE_ID = "d0000000-0000-4000-8000-000000000001";

const KO_DICT = getDictionary("ko");
const EN_DICT = getDictionary("en");

function makeReview(id: string, kind: "image" | "video"): ReviewItem {
  return {
    id,
    organizationId: ORG,
    title: kind === "image" ? "Key still visual" : "Launch film cut",
    status: "open",
    kind,
    thumbUrl: kind === "image" ? "/api/brand-studio/media/st/still-thumb.webp" : null,
    available: true,
    commentsOpen: 0,
    commentsTotal: 0,
    lastActivityAt: "2026-11-26T01:00:00.000Z",
    createdAt: "2026-11-26T00:00:00.000Z",
    subject: { outputId: kind === "image" ? "e0000000-0000-4000-8000-000000000001" : "e0000000-0000-4000-8000-000000000002" },
    mediaUrl: kind === "image" ? "/api/brand-studio/media/st/still.png" : "/api/brand-studio/media/st/film.mp4",
    width: 1080,
    height: kind === "image" ? 1350 : 1920,
    seconds: kind === "video" ? 6 : null,
    createdRole: "studio",
    statusChangedAt: null,
    projectId: PROJECT,
    stackId: id,
    version: 1,
    source: "delivery",
  };
}

const LIVE_SHARE: ShareLink = {
  id: SHARE_ID,
  kind: "review",
  targetId: IMG_REVIEW_ID,
  allowComments: true,
  allowDownload: false,
  hasPassphrase: false,
  expiresAt: "2026-12-10T00:00:00.000Z",
  revokedAt: null,
  state: "live",
  views: 3,
  lastViewedAt: "2026-11-26T12:00:00.000Z",
  createdAt: "2026-11-26T00:00:00.000Z",
  createdRole: "brand",
};

function serializeFakeDom(node: unknown): string {
  const n = node as {
    nodeType?: number;
    nodeName?: string;
    tagName?: string;
    data?: string;
    textContent?: string;
    attributes?: Record<string, string>;
    childNodes?: unknown[];
    disabled?: boolean;
  };
  if (!n || typeof n !== "object") return "";
  if (n.nodeType === 3) return String(n.data ?? n.textContent ?? "");
  if (n.nodeType === 8) return "";
  const tag = (n.tagName ?? n.nodeName ?? "div").toLowerCase();
  if (tag === "#document-fragment") {
    return (n.childNodes ?? []).map(serializeFakeDom).join("");
  }
  const attrs = Object.entries(n.attributes ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`)
    .join("");
  const children = (n.childNodes ?? []).map(serializeFakeDom).join("");
  return `<${tag}${attrs}>${children}</${tag}>`;
}

function normalizeReactIds(html: string): string {
  const map = new Map<string, string>();
  return html.replace(/(?:«|_r_|:r)[a-zA-Z0-9]+(?:»|_:?)/g, (hit) => {
    if (!map.has(hit)) map.set(hit, `_rid_${map.size + 1}_`);
    return map.get(hit)!;
  });
}

function patchSelectOptions(doc: MountedDom["document"]) {
  const origCreate = doc.createElement.bind(doc);
  doc.createElement = ((tag: string) => {
    const el = origCreate(tag);
    if (String(tag).toLowerCase() === "select" && !("options" in el)) {
      Object.defineProperty(el, "options", {
        get() {
          return el.children.filter((c) => c.tagName === "OPTION");
        },
        configurable: true,
      });
    }
    return el;
  }) as MountedDom["document"]["createElement"];
}

describe("Fix Round 3 Item 1 Step 0 parity baseline (room review & share UI untouched / 보내기 closed)", () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    vi.stubEnv("BRAND_SEND", "off");
    vi.stubEnv("BRAND_SEND_INVITE", "off");
    vi.stubEnv("BRAND_ROOMS", "on");
    vi.stubEnv("BRAND_ROOM_INVITES", "off");
    vi.stubGlobal("getComputedStyle", () => ({
      top: "0px",
      paddingTop: "0px",
      getPropertyValue: () => "",
    }));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (mounted) {
      await mounted.unmount();
      mounted = null;
    }
  });

  it("ShareButton and ShareDialog static markup match baseline in ko and en", async () => {
    const imgBtnKo = renderToStaticMarkup(
      createElement(ShareButton, {
        organizationId: ORG,
        target: { kind: "review", id: IMG_REVIEW_ID },
        locale: "ko",
        copy: KO_DICT.roomsReview,
        canEdit: true,
      }),
    );
    const imgDialogKo = normalizeReactIds(
      renderToStaticMarkup(
        createElement(ShareDialog, {
          organizationId: ORG,
          target: { kind: "review", id: IMG_REVIEW_ID },
          locale: "ko",
          copy: KO_DICT.roomsReview,
          onClose: () => undefined,
        }),
      ),
    );
    const imgDialogEn = normalizeReactIds(
      renderToStaticMarkup(
        createElement(ShareDialog, {
          organizationId: ORG,
          target: { kind: "review", id: IMG_REVIEW_ID },
          locale: "en",
          copy: EN_DICT.roomsReview,
          onClose: () => undefined,
        }),
      ),
    );
    await expect(imgBtnKo).toMatchFileSnapshot("./__snapshots__/send-image-closed/room-share-button.html");
    await expect(imgDialogKo).toMatchFileSnapshot("./__snapshots__/send-image-closed/room-share-dialog-ko.html");
    await expect(imgDialogEn).toMatchFileSnapshot("./__snapshots__/send-image-closed/room-share-dialog-en.html");
  });

  it("ProjectReviewTab (image & video loaded stage + ShareDialog opened) matches baseline when 보내기 is closed", async () => {
    const imgItem = makeReview(IMG_REVIEW_ID, "image");
    const vidItem = makeReview(VID_REVIEW_ID, "video");
    const listBody: RoomReviewList = {
      ok: true,
      canEdit: true,
      canTalk: true,
      stacks: [
        { stackId: imgItem.id, versions: [imgItem] },
        { stackId: vidItem.id, versions: [vidItem] },
      ],
    };

    const makeFetchMock = (detailItem: ReviewItem, shares: ShareLink[]) =>
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/brand-rooms/shares")) {
          return new Response(JSON.stringify({ ok: true, shares }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (url.includes("review=")) {
          const detail: RoomReviewDetail = {
            ok: true,
            canWrite: true,
            canEdit: true,
            canTalk: true,
            review: detailItem,
            comments: [],
            extended: true,
            versions: [
              {
                id: detailItem.id,
                version: 1,
                title: detailItem.title,
                status: detailItem.status,
                kind: detailItem.kind,
                available: true,
                mediaUrl: detailItem.mediaUrl,
                thumbUrl: detailItem.thumbUrl,
                width: detailItem.width,
                height: detailItem.height,
                seconds: detailItem.seconds,
                commentsOpen: 0,
                createdAt: detailItem.createdAt,
              },
            ],
          };
          return new Response(JSON.stringify(detail), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify(listBody), { status: 200, headers: { "content-type": "application/json" } });
      });

    // 1. Loaded image review stage + opened ShareDialog with live link
    vi.stubGlobal("fetch", makeFetchMock(imgItem, [LIVE_SHARE]));
    mounted = await mountDom(
      createElement(ProjectReviewTab, {
        organizationId: ORG,
        projectId: PROJECT,
        locale: "ko",
        copy: KO_DICT.roomsReview,
        reviewCopy: KO_DICT.studioReview,
        chatCopy: KO_DICT.roomsChat,
        canEdit: true,
        canTalk: true,
        initial: { reviewId: IMG_REVIEW_ID },
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const imgStageHtml = normalizeReactIds(serializeFakeDom(mounted.container));
    expect(imgStageHtml).toContain('data-share-open="review"');
    await expect(imgStageHtml).toMatchFileSnapshot("./__snapshots__/send-image-closed/room-review-image.html");

    patchSelectOptions(mounted.document);
    await mounted.click('[data-share-open="review"]');
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const imgOpenDialogHtml = normalizeReactIds(serializeFakeDom(mounted.container));
    expect(imgOpenDialogHtml).toContain("data-share-form");
    expect(imgOpenDialogHtml).toContain("data-share-item");
    expect(imgOpenDialogHtml).toContain("data-share-revoke");
    await expect(imgOpenDialogHtml).toMatchFileSnapshot("./__snapshots__/send-image-closed/room-review-image-dialog-open.html");

    await mounted.unmount();
    mounted = null;

    // 2. Loaded video review stage
    vi.stubGlobal("fetch", makeFetchMock(vidItem, []));
    mounted = await mountDom(
      createElement(ProjectReviewTab, {
        organizationId: ORG,
        projectId: PROJECT,
        locale: "ko",
        copy: KO_DICT.roomsReview,
        reviewCopy: KO_DICT.studioReview,
        chatCopy: KO_DICT.roomsChat,
        canEdit: true,
        canTalk: true,
        initial: { reviewId: VID_REVIEW_ID },
      }),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const vidStageHtml = normalizeReactIds(serializeFakeDom(mounted.container));
    expect(vidStageHtml).toContain('data-share-open="review"');
    await expect(vidStageHtml).toMatchFileSnapshot("./__snapshots__/send-image-closed/room-review-video.html");
  });
});
