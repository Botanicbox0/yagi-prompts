import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewItem } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-CLIENT-WORK.md §4 row A: a note on a film carries the moment it was written at, as on
 * Frame.io. The composer's focus/typing handler pins the playhead through `stampMoment`, `send()` posts
 * what `composeNote` builds; the chip's × (`general`) makes it a whole-film note. A still has no time.
 * The repo runs vitest in node (no DOM), so the handlers' rules are driven through the same functions
 * the stage calls, and the composer is checked in the rendered markup.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/studio/review",
  useSearchParams: () => new URLSearchParams(),
}));

import { ReviewStage, composeNote, reviewDownloadName, stampMoment } from "@/components/brand-studio/review/stage";

const film = { isVideo: true, general: false, extended: false, currentMs: 3456.7, strokes: null };

/** What happens between focus and submit: focus stamps (stampMoment), submit posts (composeNote). */
function writeAndSend(opts: { isVideo: boolean; general?: boolean; focus?: boolean; currentMs: number; extended?: boolean }) {
  const at = { isVideo: opts.isVideo, general: opts.general ?? false, currentMs: opts.currentMs };
  const mark = opts.focus === false ? null : stampMoment(null, at);
  // The playhead may move on (the film plays again) before the note is sent; the pinned moment stays.
  return composeNote("Logo is too small here", mark, { ...at, extended: opts.extended ?? false, currentMs: opts.currentMs + 2000, strokes: null });
}

describe("a note on a film carries its moment", () => {
  it("pins the playhead on focus and posts it", () => {
    const note = writeAndSend({ isVideo: true, currentMs: 3456.7 });
    expect(note.atMs).toBe(3457);
    expect(note.body).toBe("Logo is too small here");
  });

  it("keeps the same moment on the extended (room) stage, with no range", () => {
    const note = writeAndSend({ isVideo: true, currentMs: 1200, extended: true });
    expect(note).toMatchObject({ atMs: 1200, endMs: null, strokes: null });
  });

  it("never drops the time silently when the note is sent without a focus event", () => {
    const note = composeNote("pasted", null, film);
    expect(note.atMs).toBe(3457);
  });

  it("posts a whole-film note once the chip's time was removed", () => {
    expect(writeAndSend({ isVideo: true, general: true, currentMs: 3456.7 }).atMs).toBeNull();
    expect(composeNote("pasted", null, { ...film, general: true }).atMs).toBeNull();
    // Focus again after removing: no re-stamp.
    expect(stampMoment(null, { isVideo: true, general: true, currentMs: 500 })).toBeNull();
  });

  it("keeps a mark already made and its drawing", () => {
    const strokes = [{ tool: "arrow" as const, color: "blue" as const, points: [[0.1, 0.1], [0.5, 0.5]] as Array<[number, number]> }];
    expect(stampMoment({ atMs: 800, x: null, y: null }, { isVideo: true, general: false, currentMs: 5000 })).toEqual({ atMs: 800, x: null, y: null });
    expect(stampMoment({ atMs: null, x: 0.2, y: 0.3, strokes }, { isVideo: true, general: false, currentMs: 5000 })).toEqual({
      atMs: 5000,
      endMs: null,
      x: 0.2,
      y: 0.3,
      strokes,
    });
    const range = composeNote("cut here", { atMs: 1000, endMs: 2500, x: null, y: null }, { ...film, extended: true });
    expect(range).toMatchObject({ atMs: 1000, endMs: 2500 });
  });

  it("gives a still no time", () => {
    expect(writeAndSend({ isVideo: false, currentMs: 3456.7 }).atMs).toBeNull();
    expect(stampMoment(null, { isVideo: false, general: false, currentMs: 900 })).toBeNull();
    expect(composeNote("spot", { atMs: null, x: 0.5, y: 0.5 }, { ...film, isVideo: false })).toMatchObject({ atMs: null, x: 0.5, y: 0.5 });
  });
});

describe("the composer and the download link", () => {
  const item = (extra: Partial<ReviewItem> = {}): ReviewItem => ({
    id: "c0000000-0000-4000-8000-000000000001",
    organizationId: "a0000000-0000-4000-8000-00000000000a",
    title: "Spring film",
    status: "open",
    kind: "video",
    thumbUrl: null,
    available: true,
    commentsOpen: 0,
    commentsTotal: 0,
    lastActivityAt: "2026-11-11T01:00:00.000Z",
    createdAt: "2026-11-11T00:00:00.000Z",
    subject: { outputId: "d0000000-0000-4000-8000-000000000001" },
    mediaUrl: "/api/brand-studio/media/st/film.mp4",
    width: 1920,
    height: 1080,
    seconds: 6,
    createdRole: "brand",
    statusChangedAt: null,
    ...extra,
  });
  const actions = { addComment: async () => ({ ok: true as const }), resolveComment: async () => ({ ok: true as const }), setStatus: async () => ({ ok: true as const }) };

  it.each(["ko", "en"] as const)("has the remove-time label in %s", (locale) => {
    const copy = getDictionary(locale).studioReview;
    expect(copy.dropMoment.trim().length).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<ReviewStage review={item()} comments={[]} canWrite copy={copy} locale={locale} actions={actions} />);
    expect(html).toContain(`id="bsv-draft-${item().id}"`);
    expect(html).not.toContain("data-review-download");
  });

  it("names the saved file after the title and version", () => {
    expect(reviewDownloadName("Spring film", 2, "https://media.twings.app/st/abc.MP4?x=1")).toBe("Spring film-v2.mp4");
    expect(reviewDownloadName('a/b:c*?"<>|', 1, "/api/brand-studio/media/st/k.png")).toBe("a b c-v1.png");
    expect(reviewDownloadName("...", null, "/x")).toBe("review");
    expect(reviewDownloadName("봄 캠페인 본편", 3, "/st/k.mp4")).toBe("봄 캠페인 본편-v3.mp4");
  });

  it("saves under that name when asked", () => {
    const copy = getDictionary("ko").studioReview;
    const html = renderToStaticMarkup(
      <ReviewStage review={item()} comments={[]} canWrite copy={copy} locale="ko" actions={actions} downloadUrl="/api/brand-studio/media/st/film.mp4" downloadName="Spring film-v2.mp4" />,
    );
    expect(html).toContain("data-review-download");
    expect(html).toContain('download="Spring film-v2.mp4"');
  });
});
