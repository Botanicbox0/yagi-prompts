import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { threadComments, type ReviewComment, type ReviewItem, type ReviewVersion } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11.7, finishing pass of 2026-11-19 ("아쉬운 것 없을 때까지") — rendered:
 *   · a range draws its line only when selected (or under the pointer), and a range being drawn hides the
 *     selected one's line while the selected dot stays;
 *   · exactly one accent-filled control per view (the main act), docs/design/TASTE.md 19;
 *   · no browser-styled control left inside the review surfaces (select, checkbox);
 *   · the studio review page: one filled button on the page and no URL path in its words;
 *   · the filled body's height.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/rooms/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { MIN_FILL_BODY, ReviewStage, fillBodyHeight } from "@/components/brand-studio/review/stage";
import { ReviewTimeline, type TimelineNote } from "@/components/brand-studio/review/timeline";
import { CompareView } from "@/components/brand-studio/review/compare";
import { AdminReviewStage } from "@/components/brand-studio/review/admin-stage";
import { ReviewApp } from "@/components/brand-studio/review/review-app";
import { SharedPage } from "@/components/brand-rooms/share/shared-page";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const V1 = "c0000000-0000-4000-8000-000000000001";
const V2 = "c0000000-0000-4000-8000-000000000002";

function item(extra: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: V2,
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
    seconds: 10,
    createdRole: "studio",
    statusChangedAt: null,
    fps: 24,
    ...extra,
  };
}
const version = (id: string, n: number): ReviewVersion => ({
  id,
  version: n,
  title: "Main film",
  status: "open",
  kind: "video",
  available: true,
  mediaUrl: "/api/brand-studio/media/st/film.mp4",
  thumbUrl: null,
  width: 1920,
  height: 1080,
  seconds: 10,
  commentsOpen: 0,
  createdAt: "2026-11-11T00:00:00.000Z",
});
const note = (n: number, extra: Partial<ReviewComment> = {}): ReviewComment => ({
  id: `e0000000-0000-4000-8000-00000000000${n}`,
  parentId: null,
  authorName: "minji",
  authorRole: "brand",
  body: `note ${n}`,
  atMs: 1000 * n,
  x: null,
  y: null,
  resolved: false,
  createdAt: "2026-11-11T00:30:00.000Z",
  deleted: false,
  mine: false,
  endMs: null,
  strokes: null,
  guest: false,
  carriedFrom: null,
  ...extra,
});
const moment = note(1);
const range = note(2, { endMs: 4000, body: "colour too cold here" });
const actions = { addComment: async () => ({ ok: true as const }), resolveComment: async () => ({ ok: true as const }), setStatus: async () => ({ ok: true as const }) };

/** Buttons that wear the accent fill: a `bsv-primary` that is not the neutral (ink) one. */
const accentFilled = (html: string) => (html.match(/<button[^>]*class="bsv-primary"[^>]*>/g) ?? []).filter((tag) => !tag.includes('data-tone="neutral"')).length;

describe.each(["ko", "en"] as const)("the finishing pass (%s)", (locale) => {
  const dict = getDictionary(locale);
  const copy = dict.studioReview;

  describe("range lines on the lane", () => {
    const notes: TimelineNote[] = threadComments([moment, range]).map((thread, i) => ({ thread, number: i + 1 }));
    const timeline = (props: { activeId: string | null; mark: { atMs: number | null; endMs?: number | null } | null }) =>
      renderToStaticMarkup(
        <ReviewTimeline
          reviewId={V2}
          durationMs={10_000}
          currentMs={0}
          fps={24}
          stepMs={1000 / 24}
          notes={notes}
          hoverId={null}
          teamView={false}
          copy={copy}
          roleOf={(c) => ({ role: c.authorRole, label: copy.roles[c.authorRole] })}
          tc={(ms) => String(ms)}
          extended
          canComment
          selectedRange={props.activeId === range.id ? { startMs: 2000, endMs: 4000 } : null}
          onScrub={() => undefined}
          onSelect={() => undefined}
          onRange={() => undefined}
          onSeekTo={() => undefined}
          onPause={() => undefined}
          onEscape={() => undefined}
          {...props}
        />,
      );

    it("draws no range line at rest; the range is its start dot", () => {
      const html = timeline({ activeId: null, mark: null });
      expect(html).not.toContain("data-review-span");
      expect(html).toContain(`data-review-pin="${range.id}"`);
      expect(html).not.toContain("bsv-scrub-wash");
    });

    it("draws the selected range's line in primary ink (data-active), with the wash on the bar", () => {
      const html = timeline({ activeId: range.id, mark: null });
      expect(html).toMatch(new RegExp(`class="bsv-range-line" data-review-span="${range.id}"[^>]*data-active=""`));
      expect(html).toContain("bsv-scrub-wash");
    });

    it("hides the selected range's line and wash while a new range is drawn; its dot stays selected", () => {
      const html = timeline({ activeId: range.id, mark: { atMs: 5000, endMs: 8000 } });
      expect(html).not.toContain(`data-review-span="${range.id}"`);
      expect(html).not.toContain("bsv-scrub-wash");
      expect(html).toContain('class="bsv-range-line" data-pending=""');
      expect(html).toMatch(new RegExp(`data-review-pin="${range.id}"[^>]*data-active=""`));
    });
  });

  describe("one accent-filled control per view", () => {
    it("an owner who may approve: 승인하기 is the accent, 보내기 is the neutral filled button", () => {
      const html = renderToStaticMarkup(<ReviewStage review={item()} comments={[moment]} canWrite copy={copy} locale={locale} actions={actions} extended linkFor={() => "/x"} />);
      expect(accentFilled(html)).toBe(1);
      expect(html).toMatch(/class="bsv-primary" data-review-status-action="approved"/);
      expect(html).toMatch(/class="bsv-primary" data-tone="neutral" data-review-send="true"/);
    });

    it("an approved draft: no primary in the head, so 보내기 is the accent", () => {
      const html = renderToStaticMarkup(<ReviewStage review={item({ status: "approved" })} comments={[]} canWrite copy={copy} locale={locale} actions={actions} extended />);
      expect(accentFilled(html)).toBe(1);
      expect(html).toMatch(/class="bsv-primary" data-review-send="true"/);
    });

    it("a guest on the share page and the team's page: 보내기 is the one accent", () => {
      const guest = renderToStaticMarkup(
        <SharedPage
          token={"T".repeat(43)}
          view={{ state: "open", share: { kind: "review", allowComments: true, allowDownload: false, expiresAt: "2026-11-25T00:00:00.000Z" }, review: { review: item({ organizationId: "" }), comments: [moment] } }}
          locale={locale}
          copy={dict.roomsReview}
          reviewCopy={copy}
          storyboardCopy={dict.roomsStoryboard}
        />,
      );
      expect(accentFilled(guest)).toBe(1);
      const team = renderToStaticMarkup(
        <AdminReviewStage review={item()} comments={[moment]} copy={copy} locale={locale} eyebrow="Brand" initialMs={null} extended teamCopy={dict.adminConsole.reviewTeam} />,
      );
      expect(accentFilled(team)).toBe(1);
      expect(team).toMatch(/class="bsv-primary" data-review-send="true"/);
    });

    it("a viewer who can only read: no accent fill at all", () => {
      const html = renderToStaticMarkup(<ReviewStage review={item()} comments={[moment]} canWrite={false} canComment={false} canManage={false} copy={copy} locale={locale} actions={{ addComment: actions.addComment }} extended />);
      expect(accentFilled(html)).toBe(0);
    });
  });

  describe("a note's own controls", () => {
    const mine = note(5, { mine: true, body: "my own note" });
    const resolved = note(6, { resolved: true, body: "already fixed" });
    const myReply = note(7, { parentId: mine.id, mine: true, atMs: null, body: "my reply" });
    const owner = () =>
      renderToStaticMarkup(
        <ReviewStage
          review={item()}
          comments={[moment, mine, resolved, myReply]}
          canWrite
          copy={copy}
          locale={locale}
          actions={{ ...actions, deleteComment: async () => ({ ok: true as const }) }}
          extended
        />,
      );
    /** Every button's own text (tags stripped), as a person would read the button. */
    const buttonTexts = (html: string) => (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []).map((b) => b.replace(/<[^>]+>/g, "").trim());

    it("never puts 해결, 다시 열기 or 삭제 straight in a row: they wait in the \"⋯\" menu", () => {
      const html = owner();
      const texts = buttonTexts(html);
      for (const word of [copy.resolve, copy.reopenThread, copy.deleteComment]) expect(texts, word).not.toContain(word);
      // Each note a person may act on has 답글 and one "⋯" that opens a menu; a reply of one's own has a "⋯".
      for (const id of [moment.id, mine.id, resolved.id]) {
        const row = html.slice(html.indexOf(`data-review-thread="${id}"`));
        const at = row.indexOf(`data-review-row-actions="${id}"`);
        const tools = row.slice(at, row.indexOf('class="bsv-body"', at));
        expect(tools, id).toContain(`data-review-reply-open="${id}"`);
        expect(tools, id).toMatch(new RegExp(`aria-haspopup="menu"[^>]*data-review-row-more="${id}"`));
        // Tab order inside the row: 답글, then "⋯".
        expect(tools.indexOf("data-review-reply-open"), id).toBeLessThan(tools.indexOf("data-review-row-more"));
      }
      expect(html).toMatch(new RegExp(`aria-haspopup="menu"[^>]*data-review-row-more="${myReply.id}"`));
      // The menu button is named with the existing words, no new sentence.
      expect(html).toMatch(new RegExp(`aria-label="${copy.more}"[^>]*data-review-row-more`));
    });

    it("keeps the controls' place laid out in the row's time line, so showing them never moves the row", () => {
      const html = owner();
      const head = html.slice(html.indexOf(`data-review-thread="${mine.id}"`));
      const meta = head.slice(head.indexOf('class="bsv-meta"'));
      expect(meta.indexOf("data-review-row-actions")).toBeGreaterThan(0);
      expect(meta.indexOf("data-review-row-actions")).toBeLessThan(meta.indexOf('class="bsv-body"'));
      const css = readFileSync("components/brand-studio/review/review.css", "utf8");
      // Hidden with a pointer until hover, focus or selection, and not clickable while hidden; always on touch.
      expect(css).toMatch(/@media \(hover: hover\) \{\s*\.bsv-row-actions \{\s*opacity: 0;\s*pointer-events: none;/);
      expect(css).toMatch(/\.bsv-thread:is\(:hover, :focus-within, \[data-active\], \[data-replying\]\) > \.bsv-comment \.bsv-row-actions/);
      expect(css).not.toContain("bsv-thread-actions");
    });
  });

  describe("no browser-styled controls on the stage", () => {
    it("the version switcher, the speed, the author filter and the team switch are the stage's own", () => {
      const html = renderToStaticMarkup(
        <AdminReviewStage
          review={item()}
          comments={[moment, range, note(3, { authorRole: "studio", authorName: "Jisoo" })]}
          copy={copy}
          locale={locale}
          eyebrow="Brand"
          initialMs={null}
          extended
          versions={[version(V2, 2), version(V1, 1)]}
          teamCopy={dict.adminConsole.reviewTeam}
        />,
      );
      expect(html).not.toContain("<select");
      expect(html).toContain('data-review-version-select=""');
      expect(html).toMatch(/class="bsv-select bsv-speed"[^>]*aria-haspopup="menu"[^>]*data-review-speed=""/);
      // Every checkbox is a switch drawn by the stage; every range input sits invisible under a scrub bar.
      const checkboxes = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
      expect(checkboxes.length).toBeGreaterThan(0);
      for (const box of checkboxes) expect(box).toContain('role="switch" class="bsv-switch-input"');
      const ranges = html.match(/<input[^>]*type="range"[^>]*>/g) ?? [];
      for (const r of ranges) expect(r).toContain('class="bsv-range"');
    });

    it("side by side picks its versions with the same select", () => {
      const html = renderToStaticMarkup(<CompareView versions={[version(V2, 2), version(V1, 1)]} currentId={V2} copy={copy} onClose={() => undefined} />);
      expect(html).not.toContain("<select");
      expect((html.match(/data-compare-version="(left|right)"/g) ?? []).length).toBe(2);
      expect(html).toContain('class="bsv-scrub"');
    });
  });

  describe("the studio review page", () => {
    const listItem = { ...item(), commentsOpen: 1, commentsTotal: 1 };
    const page = () =>
      renderToStaticMarkup(
        <ReviewApp
          organizationId={ORG}
          locale={locale}
          copy={copy}
          initialList={{ ok: true, canWrite: true, reviews: [listItem] }}
          initialDetail={{ ok: true, canWrite: true, review: item(), comments: [moment], extended: true }}
          initialMs={null}
        />,
      );

    it("carries one filled button on the page: the stage's 승인하기", () => {
      const html = page();
      const outerHead = html.slice(html.indexOf('<header class="bsv-head">'), html.indexOf("</header>") + 9);
      expect(outerHead).toContain("data-review-pick-open");
      expect(outerHead).not.toContain("bsv-primary");
      expect(outerHead).not.toContain("data-review-share-open");
      expect(accentFilled(html)).toBe(1);
      // Share is the ghost button in the stage head, as in the room.
      const stageHead = html.slice(html.indexOf("data-review-stage="));
      expect(stageHead.slice(0, stageHead.indexOf("</header>"))).toMatch(/class="bsv-ghost"[^>]*data-review-share-open="true"/);
      expect(html).toContain("data-review-fit-anchor");
    });

    it("never shows a URL path in its words", () => {
      const html = page();
      expect(html).not.toContain("(/s/");
      expect(html).toContain(copy.shareOpen);
      expect(copy.shareOpen).not.toMatch(/\//);
    });
  });
});

describe("the filled body", () => {
  it("runs from the body's top to the window's bottom, less the stage's padding and a bar the page keeps there", () => {
    expect(fillBodyHeight({ viewportH: 900, anchorTop: 12, above: 130 })).toBe(900 - 12 - 130 - 32);
    expect(fillBodyHeight({ viewportH: 844, anchorTop: 12, above: 200, bottomBar: 64 })).toBe(Math.max(MIN_FILL_BODY, 844 - 12 - 200 - 32 - 64));
    // A short window keeps the notes column usable.
    expect(fillBodyHeight({ viewportH: 500, anchorTop: 40, above: 300 })).toBe(MIN_FILL_BODY);
  });
});

describe("the review surfaces' source", () => {
  const files = [
    "components/brand-studio/review/stage.tsx",
    "components/brand-studio/review/compare.tsx",
    "components/brand-studio/review/timeline.tsx",
    "components/brand-studio/review/ink.tsx",
    "components/brand-studio/review/stage-menu.tsx",
    "components/brand-studio/review/review-app.tsx",
    "components/brand-rooms/review/index.tsx",
    "components/brand-rooms/share/shared-page.tsx",
  ];
  it("keeps no native select, and checkboxes only inside the stage's switch", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/<select\b/);
      if (!file.endsWith("stage-menu.tsx")) expect(src, file).not.toMatch(/type="checkbox"/);
    }
    const css = readFileSync("components/brand-studio/review/review.css", "utf8");
    // The browser's tinted checkbox is gone; the switch carries its own focus ring.
    expect(css).not.toMatch(/accent-color/);
    expect(css).toMatch(/\.bsv-switch-input:focus-visible \+ \.bsv-switch-track\s*\{\s*outline: 2px solid var\(--bsv-accent\)/);
  });
  it("hides the floating help button over an open review only where it floats, not in a phone's top bar", () => {
    for (const [file, open] of [
      ["components/brand-studio/review/review.css", "[data-studio-review] [data-review-stage]"],
      ["components/brand-rooms/room/room.css", "[data-room-review-mode]"],
    ] as const) {
      const css = readFileSync(file, "utf8");
      const esc = open.replace(/[[\]()]/g, "\\$&");
      // Wider than a phone: hidden while a review is open.
      expect(css, file).toMatch(new RegExp(`@media \\(min-width: 641px\\) \\{\\s*body:has\\(${esc}\\) \\.bw-support-launch \\{\\s*display: none;`));
      // A phone in the rail shell keeps it in the top bar; only a shell without the rail hides it.
      expect(css, file).toContain(`body:has(${open}):not(:has([data-brand-layout-mode="rail"])) .bw-support-launch`);
    }
  });

  it("opens the team desk's version like the client's review mode: filled to the window's bottom", () => {
    const admin = readFileSync("components/brand-studio/review/admin-stage.tsx", "utf8");
    expect(admin).toMatch(/layout=\{deskOrg && deskProject \? "wide" : "inline"\}/);
    expect(admin).toContain('scrollIntoView({ block: "start", behavior: "auto" })');
    const page = readFileSync("app/(admin)/admin/brand-rooms/[organizationId]/[projectId]/page.tsx", "utf8");
    expect(page).toMatch(/data-admin-desk-stage=\{chosen\.review\.id\} data-review-fit-scroll/);
    const stage = readFileSync("components/brand-studio/review/stage.tsx", "utf8");
    expect(stage).toContain('"[data-room-review-mode], [data-review-fit-scroll]"');
  });

  it("writes the accent rule into the stage's CSS", () => {
    const css = readFileSync("components/brand-studio/review/review.css", "utf8");
    expect(css).toContain("THE ACCENT RULE");
    expect(css).toMatch(/\.bsv-thread\[data-active\] \{[^}]*inset 2px 0 0 var\(--bsv-ink\)/);
    expect(css).toMatch(/\.bsv-range-line\[data-active\] \{[^}]*background: var\(--bsv-ink\)/);
    expect(css).toMatch(/\.bsv-range-line\[data-pending\] \{[^}]*background: var\(--bsv-accent\)/);
  });
});
