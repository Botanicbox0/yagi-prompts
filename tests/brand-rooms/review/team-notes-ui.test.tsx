import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewComment, ReviewItem } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §5 — team notes on screen. The team's admin stage alone offers "팀만 보기",
 * tags a team note and marks it in the export; the same stage on any other screen has no switch, no tag,
 * and drops a team note even if one were handed to it. The words never sit in the copy blocks that brand
 * and share pages carry.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/admin/brand-studio/reviews/x",
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { ReviewStage, exportReviewComments } from "@/components/brand-studio/review/stage";
import { AdminReviewStage } from "@/components/brand-studio/review/admin-stage";

const ORG = "a0000000-0000-4000-8000-00000000000a";
const R1 = "c0000000-0000-4000-8000-000000000001";
const SECRET = "internal: keep the old cut as backup";

const item: ReviewItem = {
  id: R1,
  organizationId: ORG,
  title: "Main film",
  status: "open",
  kind: "video",
  thumbUrl: null,
  available: true,
  commentsOpen: 1,
  commentsTotal: 1,
  lastActivityAt: "2026-11-11T01:00:00.000Z",
  createdAt: "2026-11-11T00:00:00.000Z",
  subject: { assetId: "d0000000-0000-4000-8000-000000000001" },
  mediaUrl: "/api/brand-studio/media/st/film.mp4",
  width: 1920,
  height: 1080,
  seconds: 6,
  createdRole: "studio",
  statusChangedAt: null,
};
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
const comments = [note(1), note(2, { authorRole: "studio", authorName: null, body: SECRET, team: true })];
const actions = { addComment: async () => ({ ok: true as const }), resolveComment: async () => ({ ok: true as const }), setStatus: async () => ({ ok: true as const }) };
const WORDS = ["팀 메모", "팀만 보기", "Team note", "Team only"];

describe.each(["ko", "en"] as const)("team notes on the stage (%s)", (locale) => {
  const dict = getDictionary(locale);
  const copy = dict.studioReview;
  const teamCopy = dict.adminConsole.reviewTeam;

  it("the team's admin stage offers the switch and tags the team note", () => {
    const html = renderToStaticMarkup(
      <AdminReviewStage review={item} comments={comments} copy={copy} locale={locale} eyebrow="Brand" initialMs={null} extended teamCopy={teamCopy} />,
    );
    expect(html).toContain("data-review-team-toggle");
    expect(html).toContain(teamCopy.toggle);
    expect(html).toContain(SECRET);
    expect(html).toContain(`data-review-thread="${comments[1]!.id}"`);
    expect(html).toMatch(new RegExp(`data-review-thread="${comments[1]!.id}"[^>]*data-team=""`));
    expect(html).not.toMatch(new RegExp(`data-review-thread="${comments[0]!.id}"[^>]*data-team=""`));
    expect(html).toContain(`data-review-team-tag="true">${teamCopy.tag}<`);
  });

  it("keeps the switch in place: the hint's line is laid out while off (hidden), shown when on", () => {
    const html = renderToStaticMarkup(
      <AdminReviewStage review={item} comments={comments} copy={copy} locale={locale} eyebrow="Brand" initialMs={null} extended teamCopy={teamCopy} />,
    );
    // Below the switch, present but hidden while "팀만 보기" is off, so turning it on moves nothing. The switch is
    // the native checkbox (role="switch") drawn as the stage's track, never the browser's white box.
    expect(html).toMatch(
      new RegExp(`type="checkbox" role="switch" class="bsv-switch-input"[^>]*data-review-team-toggle="true"/><span class="bsv-switch-track" aria-hidden="true"></span><span class="bsv-switch-label">${teamCopy.toggle}</span></label><p class="bsv-team-hint"[^>]*data-shown="false" aria-hidden="true">`),
    );
    expect(html).not.toContain(`aria-describedby="bsv-team-hint-`);
  });

  it("any other stage has no switch and no tag, and drops a team note handed to it", () => {
    const html = renderToStaticMarkup(<ReviewStage review={item} comments={comments} canWrite copy={copy} locale={locale} actions={actions} extended />);
    expect(html).toContain("note 1");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("data-review-team-toggle");
    expect(html).not.toContain("data-review-team-tag");
    expect(html).not.toContain("data-team");
    for (const word of WORDS) expect(html).not.toContain(word);
    // A share link's guest stage, likewise.
    const guest = renderToStaticMarkup(
      <ReviewStage review={item} comments={comments} canWrite canManage={false} copy={copy} locale={locale} actions={{ addComment: actions.addComment }} extended guest={{ name: "", onName: () => undefined }} />,
    );
    expect(guest).not.toContain(SECRET);
    expect(guest).not.toContain("data-review-team-toggle");
  });

  it("keeps the words out of the copy that brand and share pages carry", () => {
    const carried = JSON.stringify({ studioReview: dict.studioReview, roomsReview: dict.roomsReview });
    for (const word of WORDS) expect(carried).not.toContain(word);
  });
});

describe("exporting notes", () => {
  it("the team's export marks team notes in every format", () => {
    const csv = exportReviewComments("Main film", comments, "csv", { team: true }).content;
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("#,Timecode,End,Status,Author,Role,Spot,Drawing,Visibility,Comment");
    expect(lines[1]).toContain(",public,note 1");
    expect(lines[2]).toContain(`,team,${SECRET}`);
    const md = exportReviewComments("Main film", comments, "markdown", { team: true }).content;
    expect(md).toContain(`**#2** [team] `);
    expect(md).not.toContain(`**#1** [team]`);
    const markers = exportReviewComments("Main film", comments, "markers", { team: true }).content;
    expect(markers).toContain("#2 [team] YAGI team");
  });

  it("any other export leaves team notes out and keeps its old columns", () => {
    for (const format of ["csv", "markdown", "markers"] as const) {
      const out = exportReviewComments("Main film", comments, format).content;
      expect(out).toContain("note 1");
      expect(out).not.toContain(SECRET);
      expect(out).not.toContain("[team]");
      expect(out).not.toContain("Visibility");
    }
    expect(exportReviewComments("Main film", comments, "csv").content.replace(/^﻿/, "").split("\r\n")[0]).toBe("#,Timecode,End,Status,Author,Role,Spot,Drawing,Comment");
  });
});
