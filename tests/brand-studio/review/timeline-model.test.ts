import { describe, expect, it } from "vitest";
import { CLUSTER_GAP_PX, TOUCH_CLUSTER_GAP_PX, clusterGap, clusterMarkers, firstWords, laneX, markerKind, markerPress, nextStop, playheadOn } from "@/components/brand-studio/review/timeline-model";
import type { ReviewThread } from "@/lib/brand-studio/review-contracts";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — the quiet timeline's rules: dots closer than 14px become one count pill,
 * recomputed for the lane's width; the playhead "is on" a note within a frame of a moment or inside a range;
 * the YAGI team's notes draw a ring, a team-only note a dashed one (team view only); the lane's arrows.
 */
const at = (ms: number, duration = 60_000, width = 600) => laneX(ms, duration, width);

describe("clustering markers", () => {
  it("leaves one note alone and a lone far note too", () => {
    expect(clusterMarkers([{ id: "a", x: 100 }])).toEqual([{ ids: ["a"], x: 100 }]);
    expect(clusterMarkers([{ id: "a", x: 100 }, { id: "b", x: 300 }])).toEqual([
      { ids: ["a"], x: 100 },
      { ids: ["b"], x: 300 },
    ]);
  });

  it("chains neighbours closer than 14px into one group at the middle of its ends", () => {
    const groups = clusterMarkers([
      { id: "c", x: 120 },
      { id: "a", x: 100 },
      { id: "b", x: 110 },
      { id: "d", x: 300 },
    ]);
    expect(groups).toEqual([
      { ids: ["a", "b", "c"], x: 110 },
      { ids: ["d"], x: 300 },
    ]);
    // Exactly 14px apart stays apart.
    expect(clusterMarkers([{ id: "a", x: 0 }, { id: "b", x: CLUSTER_GAP_PX }])).toHaveLength(2);
  });

  it("clusters range notes by their start", () => {
    // Two ranges starting 0.5 s apart on a 60 s film at 600px are 5px apart: one pill.
    const groups = clusterMarkers([{ id: "range-1", x: at(10_000) }, { id: "range-2", x: at(10_500) }, { id: "moment", x: at(40_000) }]);
    expect(groups.map((g) => g.ids)).toEqual([["range-1", "range-2"], ["moment"]]);
  });

  it("splits again when the lane gets wider", () => {
    const notes = [10_000, 10_900, 11_800];
    const narrow = clusterMarkers(notes.map((ms, i) => ({ id: `n${i}`, x: at(ms, 60_000, 390) })));
    const wide = clusterMarkers(notes.map((ms, i) => ({ id: `n${i}`, x: at(ms, 60_000, 1400) })));
    expect(narrow).toHaveLength(1);
    expect(wide).toHaveLength(3);
  });

  it("handles 60 notes: dense runs fold, spread notes stay single, nothing is lost", () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, x: i < 20 ? 50 + i : 200 + (i - 20) * 15 }));
    const groups = clusterMarkers(points);
    expect(groups.flatMap((g) => g.ids).sort()).toEqual(points.map((p) => p.id).sort());
    expect(groups[0]!.ids).toHaveLength(20);
    expect(groups.slice(1).every((g) => g.ids.length === 1)).toBe(true);
    expect(groups).toHaveLength(41);
  });

  it("does not cluster before the lane is measured (gap 0)", () => {
    expect(clusterMarkers([{ id: "a", x: 0 }, { id: "b", x: 0 }], 0)).toHaveLength(2);
    expect(clusterGap(0, false)).toBe(0);
    expect(clusterGap(0, true)).toBe(0);
  });

  it("folds at a phone marker's 28px target, so a tap never lands on the neighbour's dot", () => {
    expect(clusterGap(600, false)).toBe(CLUSTER_GAP_PX);
    expect(clusterGap(330, true)).toBe(TOUCH_CLUSTER_GAP_PX);
    const twenty = [{ id: "a", x: 100 }, { id: "b", x: 120 }];
    expect(clusterMarkers(twenty, clusterGap(600, false))).toHaveLength(2);
    expect(clusterMarkers(twenty, clusterGap(330, true))).toHaveLength(1);
  });
});

describe("the playhead on a note", () => {
  it("is within a frame of a moment, inside a range (end exclusive)", () => {
    expect(playheadOn({ atMs: 1_000 }, 1_030, 24)).toBe(true);
    expect(playheadOn({ atMs: 1_000 }, 1_050, 24)).toBe(false);
    expect(playheadOn({ atMs: 1_000, endMs: 2_000 }, 1_999, 24)).toBe(true);
    expect(playheadOn({ atMs: 1_000, endMs: 2_000 }, 2_000, 24)).toBe(false);
    expect(playheadOn({ atMs: null }, 0, 24)).toBe(false);
    expect(playheadOn({ atMs: 1_000 }, 1_040, null)).toBe(true);
  });
});

describe("what a marker looks like", () => {
  const thread = (root: Partial<ReviewThread["root"]>): ReviewThread => ({ root: { authorRole: "brand", guest: false, team: false, ...root } as ReviewThread["root"], replies: [] });
  it("is a dot for a client or guest, a ring for the YAGI team, a dashed ring for a team-only note on the team's page", () => {
    expect(markerKind(thread({ authorRole: "brand" }), false)).toBe("brand");
    expect(markerKind(thread({ authorRole: "brand", guest: true }), false)).toBe("brand");
    expect(markerKind(thread({ authorRole: "studio" }), false)).toBe("studio");
    expect(markerKind(thread({ authorRole: "studio", team: true }), true)).toBe("team-only");
    // Off the team's page a team note would only ever be a ring (and the stage never passes one there).
    expect(markerKind(thread({ authorRole: "studio", team: true }), false)).toBe("studio");
  });
});

describe("a press on a marker", () => {
  it("picks the note for a mouse or the keyboard; a finger's first tap only shows the card, the second picks", () => {
    expect(markerPress({ touch: false, keyboard: false, cardShowing: false })).toBe("select");
    expect(markerPress({ touch: false, keyboard: true, cardShowing: false })).toBe("select");
    expect(markerPress({ touch: true, keyboard: false, cardShowing: false })).toBe("card");
    expect(markerPress({ touch: true, keyboard: false, cardShowing: true })).toBe("select");
    // Enter on a focused dot after an earlier tap still picks.
    expect(markerPress({ touch: true, keyboard: true, cardShowing: false })).toBe("select");
  });
});

describe("the lane's keys", () => {
  it("moves between stops and stays at the ends", () => {
    expect(nextStop(5, 2, "ArrowRight")).toBe(3);
    expect(nextStop(5, 4, "ArrowRight")).toBe(4);
    expect(nextStop(5, 0, "ArrowLeft")).toBe(0);
    expect(nextStop(5, 3, "Home")).toBe(0);
    expect(nextStop(5, 1, "End")).toBe(4);
    expect(nextStop(5, 1, "Enter")).toBeNull();
    expect(nextStop(0, 0, "ArrowRight")).toBeNull();
  });
  it("names a note by its first words", () => {
    expect(firstWords("the logo is too small in the last shot and also blurry", 4)).toBe("the logo is too…");
    expect(firstWords("  short   note ")).toBe("short note");
  });
});
