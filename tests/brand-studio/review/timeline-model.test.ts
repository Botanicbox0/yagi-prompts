import { describe, expect, it } from "vitest";
import {
  CLUSTER_GAP_PX,
  DENSE_PX_PER_NOTE,
  STRETCH_PX,
  TOUCH_CLUSTER_GAP_PX,
  TOUCH_DENSE_PX_PER_NOTE,
  TOUCH_STRETCH_PX,
  clusterGap,
  clusterMarkers,
  firstWords,
  laneX,
  markerKind,
  markerPress,
  nextStop,
  planLane,
  playheadOn,
  rangeLinesShown,
  stretchLevel,
  stretchMarkers,
} from "@/components/brand-studio/review/timeline-model";
import type { ReviewThread } from "@/lib/brand-studio/review-contracts";

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — the quiet timeline's rules: dots closer than a 24px target become one count pill,
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

  it("chains neighbours closer than a marker's 24px target into one group at the middle of its ends", () => {
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
    // Exactly a target apart stays apart.
    expect(clusterMarkers([{ id: "a", x: 0 }, { id: "b", x: CLUSTER_GAP_PX }])).toHaveLength(2);
  });

  it("clusters range notes by their start", () => {
    // Two ranges starting 0.5 s apart on a 60 s film at 600px are 5px apart: one pill.
    const groups = clusterMarkers([{ id: "range-1", x: at(10_000) }, { id: "range-2", x: at(10_500) }, { id: "moment", x: at(40_000) }]);
    expect(groups.map((g) => g.ids)).toEqual([["range-1", "range-2"], ["moment"]]);
  });

  it("splits again when the lane gets wider", () => {
    const notes = [10_000, 11_200, 12_400];
    const narrow = clusterMarkers(notes.map((ms, i) => ({ id: `n${i}`, x: at(ms, 60_000, 390) })));
    const wide = clusterMarkers(notes.map((ms, i) => ({ id: `n${i}`, x: at(ms, 60_000, 1400) })));
    expect(narrow).toHaveLength(1);
    expect(wide).toHaveLength(3);
  });

  it("handles 60 notes: dense runs fold, spread notes stay single, nothing is lost", () => {
    const points = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, x: i < 20 ? 50 + i : 200 + (i - 20) * 30 }));
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
    const twenty = [{ id: "a", x: 100 }, { id: "b", x: 126 }];
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

/**
 * 2026-11-19 finishing pass (docs/BRAND-ROOMS-FEEDBACK.md §11.7): a crowded lane folds into evenly spaced
 * stretches, decided by measured px per note; a range draws its line only when selected or under the pointer,
 * and never while a new range is being drawn over the selected one.
 */
describe("how a lane folds when it is crowded", () => {
  const spread = (count: number, width: number) => Array.from({ length: count }, (_, i) => ({ id: `n${i}`, x: ((i + 0.5) / count) * width }));

  it("keeps one dot per note while there are 30px per note on a desk lane (40 on a phone)", () => {
    expect(planLane(spread(31, 930), 930, false).mode).toBe("dots");
    expect(planLane(spread(32, 930), 930, false).mode).toBe("stretches");
    expect(930 / 31).toBeGreaterThanOrEqual(DENSE_PX_PER_NOTE);
    expect(planLane(spread(8, 330), 330, true).mode).toBe("dots");
    expect(planLane(spread(9, 330), 330, true).mode).toBe("stretches");
    expect(330 / 9).toBeLessThan(TOUCH_DENSE_PX_PER_NOTE);
    // Nothing to fold before the lane is measured, or with one note.
    expect(planLane(spread(40, 0), 0, false).mode).toBe("dots");
    expect(planLane([{ id: "a", x: 10 }], 930, false).mode).toBe("dots");
  });

  it("folds a long run of close notes even when the lane as a whole has room (a pill would sit at one misleading spot)", () => {
    // 12 notes 10px apart (one chained pill 110px long) and nothing else on a 930px lane: 77px per note, but a run.
    const run = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, x: 100 + i * 10 }));
    expect(planLane(run, 930, false).mode).toBe("stretches");
    // A short run stays a pill.
    expect(planLane(run.slice(0, 5), 930, false)).toEqual({ mode: "dots", groups: [{ ids: ["r0", "r1", "r2", "r3", "r4"], x: 120 }] });
  });

  it("cuts the lane into stretches that tile it exactly, one stop per stretch with notes, never chained", () => {
    const groups = stretchMarkers(spread(60, 930), 930, STRETCH_PX);
    const size = 930 / Math.round(930 / STRETCH_PX);
    expect(groups.flatMap((g) => g.ids).sort()).toEqual(spread(60, 930).map((p) => p.id).sort());
    for (let i = 1; i < groups.length; i += 1) {
      // Neighbouring stops are a whole stretch apart (or more), so their targets never overlap.
      expect(groups[i]!.x - groups[i - 1]!.x).toBeGreaterThanOrEqual(size - 1e-6);
      expect(groups[i]!.from).toBeCloseTo(groups[i - 1]!.to + (groups[i]!.x - groups[i - 1]!.x - size), 6);
    }
    for (const g of groups) {
      expect(g.to - g.from).toBeCloseTo(size, 6);
      expect(g.x).toBeCloseTo((g.from + g.to) / 2, 6);
    }
    // Chaining at a gap wider than the spacing would have made one stop of all sixty; stretches never chain.
    expect(clusterMarkers(spread(60, 930), 16)).toHaveLength(1);
    expect(groups.length).toBeGreaterThan(20);
    // A phone: about six stretches, one per screen-sixth.
    expect(stretchMarkers(spread(30, 330), 330, TOUCH_STRETCH_PX)).toHaveLength(6);
  });

  it("draws a stretch taller for more notes", () => {
    expect([1, 2, 3, 4, 5, 12].map(stretchLevel)).toEqual([1, 2, 3, 3, 4, 4]);
  });
});

describe("which range lines the lane draws", () => {
  const rangeIds = ["r1", "r2", "r3"];
  it("draws none at rest: a range is its start dot", () => {
    expect([...rangeLinesShown({ rangeIds, activeId: null, lit: [null, null], drawing: false })]).toEqual([]);
    // A selected moment (not a range) draws no line either.
    expect([...rangeLinesShown({ rangeIds, activeId: "m1", lit: [], drawing: false })]).toEqual([]);
  });
  it("draws the selected range and any range under the pointer or keyboard", () => {
    expect([...rangeLinesShown({ rangeIds, activeId: "r1", lit: [], drawing: false })]).toEqual(["r1"]);
    expect([...rangeLinesShown({ rangeIds, activeId: "r1", lit: ["r2", null, "r3"], drawing: false })].sort()).toEqual(["r1", "r2", "r3"]);
  });
  it("hides the selected range's line while a new range is drawn over it, and brings it back after", () => {
    expect([...rangeLinesShown({ rangeIds, activeId: "r1", lit: [], drawing: true })]).toEqual([]);
    // Even with its row under the pointer; another hovered range still shows.
    expect([...rangeLinesShown({ rangeIds, activeId: "r1", lit: ["r1", "r2"], drawing: true })]).toEqual(["r2"]);
    expect([...rangeLinesShown({ rangeIds, activeId: "r1", lit: ["r1"], drawing: false })]).toEqual(["r1"]);
  });
});
