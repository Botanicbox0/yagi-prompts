import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewItem, ReviewStatus } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-CLIENT-WORK.md §1 row 4: a member seated in the room can save the cut once it is approved.
 * Drafts (open, changes requested) stay watch-only. Share-link guests keep their link's own rule.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/rooms/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { ReviewStage } from "@/components/brand-studio/review/stage";
import { roomDownload } from "@/components/brand-rooms/review";

const item = (status: ReviewStatus, extra: Partial<ReviewItem> = {}): ReviewItem => ({
  id: "c0000000-0000-4000-8000-000000000002",
  organizationId: "a0000000-0000-4000-8000-00000000000a",
  title: "Main film",
  status,
  kind: "video",
  thumbUrl: null,
  available: true,
  commentsOpen: 0,
  commentsTotal: 0,
  lastActivityAt: "2026-11-11T01:00:00.000Z",
  createdAt: "2026-11-11T00:00:00.000Z",
  subject: { assetId: "d0000000-0000-4000-8000-000000000001" },
  mediaUrl: "https://media.twings.app/st/film.mp4",
  width: 1920,
  height: 1080,
  seconds: 6,
  createdRole: "studio",
  statusChangedAt: null,
  version: 2,
  ...extra,
});
const actions = { addComment: async () => ({ ok: true as const }), resolveComment: async () => ({ ok: true as const }), setStatus: async () => ({ ok: true as const }) };

/** The stage exactly as the room's deliverables tab renders it for a viewer (index.tsx). */
function roomStage(review: ReviewItem) {
  const download = roomDownload(review);
  return renderToStaticMarkup(
    <ReviewStage
      review={review}
      comments={[]}
      canWrite={false}
      canComment
      canManage={false}
      extended
      copy={getDictionary("ko").studioReview}
      locale="ko"
      actions={actions}
      downloadUrl={download?.url ?? null}
      downloadName={download?.name ?? null}
    />,
  );
}

describe("download in the room", () => {
  it("shows the download control on an approved cut, named after title and version", () => {
    const html = roomStage(item("approved"));
    expect(html).toContain("data-review-download");
    expect(html).toContain('download="Main film-v2.mp4"');
    expect(html).toContain(getDictionary("ko").studioReview.download);
  });

  it.each(["open", "changes_requested"] as const)("keeps a %s draft watch-only", (status) => {
    expect(roomStage(item(status))).not.toContain("data-review-download");
    expect(roomDownload(item(status))).toBeNull();
  });

  it("has nothing to download when the piece is gone", () => {
    expect(roomDownload(item("approved", { mediaUrl: null }))).toBeNull();
  });

  it("passes the rule to the stage in the room tab", () => {
    const source = readFileSync(path.join(process.cwd(), "components/brand-rooms/review/index.tsx"), "utf8");
    expect(source).toMatch(/downloadUrl=\{download\?\.url \?\? null\}/);
    expect(source).toMatch(/const download = detail \? roomDownload\(detail\.review\) : null/);
  });

  it("leaves share-link guests on their link's own rule", () => {
    const source = readFileSync(path.join(process.cwd(), "components/brand-rooms/share/shared-page.tsx"), "utf8");
    expect(source).toContain("downloadUrl={share.allowDownload ? item.review.mediaUrl : null}");
  });
});
