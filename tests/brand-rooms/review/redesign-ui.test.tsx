import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewComment, ReviewItem } from "@/lib/brand-studio/review-contracts";
import { getDictionary } from "@/lib/i18n/dictionaries";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 (review stage redesign, 2026-11-18) — rendered: quiet markers with spoken
 * names and no numbers, the YAGI team's ring, a team-only note that never becomes a marker (or a row) for a
 * brand member or a guest and keeps its unmistakable marking on the team's page, one filled button at most,
 * the hint sentence gone and the "?" in its place.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/brand/rooms/x",
  useSearchParams: () => new URLSearchParams(),
}));

import { ReviewStage } from "@/components/brand-studio/review/stage";
import { SharedPage } from "@/components/brand-rooms/share/shared-page";

const ORG = "a0000000-0000-4000-8000-00000000000a";
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
    commentsOpen: 3,
    commentsTotal: 3,
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
const note = (n: number, extra: Partial<ReviewComment> = {}): ReviewComment => ({
  id: `e0000000-0000-4000-8000-00000000000${n}`,
  parentId: null,
  authorName: "minji",
  authorRole: "brand",
  body: `note ${n} about the logo`,
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
const brandNote = note(1);
const rangeNote = note(2, { endMs: 4000, body: "colour too cold here" });
const studioNote = note(3, { authorRole: "studio", authorName: "Jisoo" });
const teamOnly = note(4, { authorRole: "studio", authorName: "Jisoo", team: true, body: "internal: push back" });
const actions = { addComment: async () => ({ ok: true as const }), resolveComment: async () => ({ ok: true as const }), setStatus: async () => ({ ok: true as const }) };

const markerOf = (html: string, id: string) => {
  const at = html.indexOf(`data-review-pin="${id}"`);
  if (at < 0) return null;
  const start = html.lastIndexOf("<button", at);
  return html.slice(start, html.indexOf("</button>", at) + 9);
};

describe.each(["ko", "en"] as const)("the quiet timeline (%s)", (locale) => {
  const dict = getDictionary(locale);
  const copy = dict.studioReview;

  it("draws one quiet marker per note with a spoken name and no number", () => {
    const html = renderToStaticMarkup(<ReviewStage review={item()} comments={[brandNote, rangeNote, studioNote]} canWrite copy={copy} locale={locale} actions={actions} extended />);
    const brand = markerOf(html, brandNote.id)!;
    expect(brand).toContain('data-kind="brand"');
    expect(brand).toContain(`aria-label="minji, ${copy.pinLabel.replace("{time}", "0:01:00").replace("{text}", "note 1 about the logo")}"`);
    // No number on the lane: the dot is an empty span.
    expect(brand).toMatch(/<span class="bsv-marker-dot" aria-hidden="true"><\/span><\/button>$/);
    const range = markerOf(html, rangeNote.id)!;
    expect(range).toContain(copy.range.spanLabel.replace("{start}", "0:02:00").replace("{end}", "0:04:00").replace("{text}", "colour too cold here"));
    // At rest a range is only its start dot: no line until it is selected or under the pointer (2026-11-19).
    expect(html).not.toContain(`data-review-span="${rangeNote.id}"`);
    expect(markerOf(html, studioNote.id)).toContain('data-kind="studio"');
    // The lane is one tab stop.
    expect((html.match(/data-lane-stop="" data-review-pin="[^"]+" data-kind="[^"]+"[^>]*tabindex="0"/g) ?? []).length).toBe(1);
  });

  it("never makes a team-only note into a marker or a row for a brand member or a guest", () => {
    const brand = renderToStaticMarkup(<ReviewStage review={item()} comments={[brandNote, teamOnly]} canWrite copy={copy} locale={locale} actions={actions} extended />);
    expect(markerOf(brand, teamOnly.id)).toBeNull();
    expect(brand).not.toContain(teamOnly.id);
    expect(brand).not.toContain("internal: push back");
    const guest = renderToStaticMarkup(
      <SharedPage
        token={"T".repeat(43)}
        view={{ state: "open", share: { kind: "review", allowComments: true, allowDownload: false, expiresAt: "2026-11-25T00:00:00.000Z" }, review: { review: item({ organizationId: "" }), comments: [brandNote, teamOnly] } }}
        locale={locale}
        copy={dict.roomsReview}
        reviewCopy={copy}
        storyboardCopy={dict.roomsStoryboard}
      />,
    );
    expect(guest).not.toContain(teamOnly.id);
    expect(guest).not.toContain("internal: push back");
  });

  it("keeps a team-only note unmistakable on the team's page: a dashed marker, the hatched row and its tag", () => {
    const html = renderToStaticMarkup(
      <ReviewStage review={item()} comments={[brandNote, teamOnly]} canWrite copy={copy} locale={locale} actions={actions} extended team={{ copy: dict.adminConsole.reviewTeam }} />,
    );
    expect(markerOf(html, teamOnly.id)).toContain('data-kind="team-only"');
    // Its spoken name says so too; a public team note's does not.
    expect(markerOf(html, teamOnly.id)).toContain(`aria-label="Jisoo, ${dict.adminConsole.reviewTeam.tag}, `);
    const row = html.slice(html.indexOf(`data-review-thread="${teamOnly.id}"`));
    expect(row.slice(0, 200)).toContain('data-team=""');
    expect(row).toContain("data-review-team-tag");
    expect(row).toContain(dict.adminConsole.reviewTeam.tag);
  });

  it("has dropped the shortcut sentence for a ? button", () => {
    const html = renderToStaticMarkup(<ReviewStage review={item()} comments={[brandNote]} canWrite copy={copy} locale={locale} actions={actions} extended />);
    expect(html).not.toContain(copy.player.keys);
    expect(html).not.toContain(copy.range.keys);
    expect(html).toContain("data-review-shortcuts");
    expect(html).toContain(`aria-label="${copy.player.shortcuts}"`);
  });

  it("shows one filled button at most: 승인하기 for an owner, none once approved or for a guest", () => {
    const owner = renderToStaticMarkup(<ReviewStage review={item()} comments={[]} canWrite copy={copy} locale={locale} actions={actions} extended linkFor={() => "/x"} />);
    const head = owner.slice(0, owner.indexOf("</header>"));
    expect((head.match(/class="bsv-primary"/g) ?? []).length).toBe(1);
    expect(head).toContain('data-review-status-action="approved" data-primary=""');
    expect(head).toContain('class="bsv-ghost" data-review-status-action="changes_requested"');
    const approved = renderToStaticMarkup(<ReviewStage review={item({ status: "approved" })} comments={[]} canWrite copy={copy} locale={locale} actions={actions} extended linkFor={() => "/x"} downloadUrl="/x.mp4" />);
    expect(approved.slice(0, approved.indexOf("</header>"))).not.toContain("bsv-primary");
    const guest = renderToStaticMarkup(<ReviewStage review={item()} comments={[]} canWrite={false} canComment canManage={false} copy={copy} locale={locale} actions={{ addComment: actions.addComment }} extended />);
    const guestHead = guest.slice(0, guest.indexOf("</header>"));
    expect(guestHead).not.toContain("bsv-primary");
    // Nothing for the guest's "⋯" to hold: no menu button at all.
    expect(guestHead).not.toContain("data-review-more");
  });
});
