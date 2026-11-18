import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewComment, ReviewItem } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — the stage-2 screens, rendered: the frame rate and `m:ss:ff` once a rate
 * is known (tenths before), the loop control on the room stage only, the wide layout, the room tab's review
 * mode on arrival with a draft and its list without one, and the small rules behind them.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/rooms/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { ReviewStage, Timecode, fillNodes, fitHeightCap, isTypingTarget, snapNoteToFrames } from "@/components/brand-studio/review/stage";
import { ProjectReviewTab } from "@/components/brand-rooms/review";
import { SharedPage } from "@/components/brand-rooms/share/shared-page";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const PROJECT = "b0000000-0000-4000-8000-00000000000b";
const V1 = "c0000000-0000-4000-8000-000000000001";

function item(extra: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: V1,
    organizationId: ORG,
    title: "Main film",
    status: "open",
    kind: "video",
    thumbUrl: null,
    available: true,
    commentsOpen: 2,
    commentsTotal: 2,
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
    version: 1,
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
const comments = [note(1, { atMs: 1200, endMs: 2400 }), note(2, { atMs: 3000 })];
const actions = { addComment: async () => ({ ok: true as const }), resolveComment: async () => ({ ok: true as const }), setStatus: async () => ({ ok: true as const }) };

describe.each(["ko", "en"] as const)("the stage-2 player (%s)", (locale) => {
  const copy = getDictionary(locale).studioReview;

  it("shows the stored frame rate and frame timecodes, the frame set apart from the clock", () => {
    const html = renderToStaticMarkup(<ReviewStage review={item({ fps: 23.976 })} comments={comments} canWrite copy={copy} locale={locale} actions={actions} extended />);
    expect(html).toContain('data-review-fps="23.976"');
    expect(html).toContain("23.976 fps");
    // 1200 ms at 23.976 is frame 28: second 1, its fifth frame; 2400 ms is frame 57: second 2, frame 9.
    const ff = (clock: string, frames: string) => `<span class="bsv-tc" data-review-timecode="">${clock}<span class="bsv-tc-ff">${frames}</span></span>`;
    expect(html).toContain(`${ff("0:01", ":04")}–${ff("0:02", ":09")}`);
    // The playhead keeps its frame; a six-second length is shown as 0:06 alone.
    expect(html).toContain(ff("0:00", ":00"));
    expect(html).toContain('/ <span class="bsv-tc" data-review-timecode="">0:06</span>');
    // Labels keep the whole value as text.
    expect(html).toContain(`aria-label="${copy.seekTo.replace("{time}", "0:01:04–0:02:09")}"`);
    expect(html).not.toContain("0:01.2");
  });

  it("keeps tenths while the rate is not known", () => {
    const html = renderToStaticMarkup(<ReviewStage review={item({ fps: null })} comments={comments} canWrite copy={copy} locale={locale} actions={actions} extended />);
    expect(html).toContain("0:01.2–0:02.4");
    expect(html).not.toContain("data-review-fps");
  });

  it("offers the range loop on the room stage, off until a range is picked, and not on the v3 stage", () => {
    const room = renderToStaticMarkup(<ReviewStage review={item()} comments={comments} canWrite copy={copy} locale={locale} actions={actions} extended />);
    expect(room).toContain('data-review-loop="none"');
    expect(room).toContain(`aria-label="${copy.player.loop}"`);
    expect(room).toMatch(/data-review-loop="none"[^>]*disabled=""|disabled=""[^>]*data-review-loop="none"/);
    const v3 = renderToStaticMarkup(<ReviewStage review={item()} comments={comments} canWrite copy={copy} locale={locale} actions={actions} />);
    expect(v3).not.toContain("data-review-loop");
  });

  it("takes keys anywhere in the stage and tags the wide layout", () => {
    const html = renderToStaticMarkup(<ReviewStage review={item()} comments={comments} canWrite copy={copy} locale={locale} actions={actions} extended layout="wide" />);
    expect(html).toMatch(/<section class="bsv-stage"[^>]*data-layout="wide"[^>]*tabindex="-1"/);
    expect(html).toContain("data-review-body");
    // Full screen is offered only once the browser says it can (never in the server's first paint).
    expect(html).not.toContain("data-review-fullscreen");
    expect(renderToStaticMarkup(<ReviewStage review={item()} comments={comments} canWrite copy={copy} locale={locale} actions={actions} />)).toContain('data-layout="inline"');
  });

  it("has every new label in both languages", () => {
    for (const key of ["fullscreen", "exitFullscreen", "loop", "notesShow", "notesHide"] as const) {
      expect(copy.player[key].length).toBeGreaterThan(1);
    }
    expect(copy.player.notesShow).not.toBe(copy.filter.label);
  });
});

describe("the room tab", () => {
  const dict = getDictionary("ko");

  it("opens review mode on arrival with a draft named in the address", () => {
    const html = renderToStaticMarkup(
      <ProjectReviewTab organizationId={ORG} projectId={PROJECT} locale="ko" copy={dict.roomsReview} reviewCopy={dict.studioReview} chatCopy={dict.roomsChat} canEdit canTalk initial={{ reviewId: V1, atMs: 1500 }} />,
    );
    expect(html).toContain("data-room-review-mode");
    expect(html).toContain("data-room-review-back");
    expect(html).toContain(dict.roomsReview.tab.back);
    expect(html).not.toContain("data-room-review-add");
  });

  it("shows the list without one", () => {
    const html = renderToStaticMarkup(
      <ProjectReviewTab organizationId={ORG} projectId={PROJECT} locale="ko" copy={dict.roomsReview} reviewCopy={dict.studioReview} chatCopy={dict.roomsChat} canEdit canTalk />,
    );
    expect(html).not.toContain("data-room-review-mode");
    expect(html).toContain("data-room-review-add");
  });

  it("plays a shared draft in the wide layout", () => {
    const html = renderToStaticMarkup(
      <SharedPage
        token={"T".repeat(43)}
        view={{ state: "open", share: { kind: "review", allowComments: true, allowDownload: false, expiresAt: "2026-11-25T00:00:00.000Z" }, review: { review: item({ organizationId: "" }), comments } }}
        locale="ko"
        copy={dict.roomsReview}
        reviewCopy={dict.studioReview}
        storyboardCopy={dict.roomsStoryboard}
      />,
    );
    expect(html).toContain('data-layout="wide"');
  });
});

describe("the rules behind the player", () => {
  it("draws a timecode in two parts, or the old tenths without a rate", () => {
    expect(renderToStaticMarkup(<Timecode ms={8008} fps={23.976} />)).toBe('<span class="bsv-tc" data-review-timecode="">0:08<span class="bsv-tc-ff">:00</span></span>');
    expect(renderToStaticMarkup(<Timecode ms={8008} fps={23.976} clockOnly />)).toBe('<span class="bsv-tc" data-review-timecode="">0:08</span>');
    expect(renderToStaticMarkup(<Timecode ms={1250} fps={null} />)).toBe("0:01.2");
    expect(renderToStaticMarkup(<>{fillNodes("{start}부터 {end}까지", { start: <b>a</b>, end: <i>b</i> })}</>)).toBe("<b>a</b>부터 <i>b</i>까지");
  });

  it("sets the frame part in the secondary ink, and keeps the help button off an open draft", () => {
    const review = readFileSync(join(process.cwd(), "components/brand-studio/review/review.css"), "utf8");
    const rule = /\.bsv-tc-ff \{([^}]*)\}/.exec(review)?.[1] ?? "";
    expect(rule).toContain("color: var(--bsv-body)");
    expect(rule).toContain("font-size: 0.82em");
    const room = readFileSync(join(process.cwd(), "components/brand-rooms/room/room.css"), "utf8");
    expect(room).toMatch(/body:has\(\[data-room-review-mode\]\) \.bw-support-launch \{\s*display: none;/);
  });

  it("snaps a note to the start of the frame on screen when the rate is known", () => {
    expect(snapNoteToFrames({ body: "x", atMs: 1020, endMs: 2030 }, 24)).toEqual({ body: "x", atMs: 1000, endMs: 2000 });
    expect(snapNoteToFrames({ body: "x", atMs: 1020, endMs: null }, 23.976)).toEqual({ body: "x", atMs: 1001, endMs: null });
    expect(snapNoteToFrames({ body: "x", atMs: 1020 }, null)).toEqual({ body: "x", atMs: 1020 });
    expect(snapNoteToFrames({ body: "x", atMs: null, x: 0.5, y: 0.5 }, 24)).toEqual({ body: "x", atMs: null, x: 0.5, y: 0.5 });
  });

  it("caps the height at two thirds inline and fills the window in the wide layout", () => {
    expect(fitHeightCap(900, false, 0)).toBe(594);
    expect(fitHeightCap(1400, false, 0)).toBe(760);
    expect(fitHeightCap(900, true, 260)).toBe(640);
    expect(fitHeightCap(300, true, 260)).toBe(200);
  });

  it("stays out of the way while typing", () => {
    const el = (match: (sel: string) => boolean, input?: { type: string }) =>
      ({
        isContentEditable: false,
        closest: (sel: string) => (sel === "input" ? (input ? { getAttribute: () => input.type } : null) : match(sel) ? {} : null),
      }) as unknown as EventTarget;
    expect(isTypingTarget(el((s) => s.includes("textarea")))).toBe(true);
    expect(isTypingTarget(el(() => false, { type: "text" }))).toBe(true);
    expect(isTypingTarget(el(() => false, { type: "range" }))).toBe(false);
    expect(isTypingTarget(el(() => false, { type: "checkbox" }))).toBe(false);
    expect(isTypingTarget(el(() => false))).toBe(false);
    expect(isTypingTarget({ isContentEditable: true, closest: () => null } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(null)).toBe(false);
  });
});
