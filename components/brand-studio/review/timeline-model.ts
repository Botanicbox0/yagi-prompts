/**
 * The review timeline's rules, apart from the screen (docs/BRAND-ROOMS-FEEDBACK.md §11).
 *
 * Principles the timeline follows, written here so the next change keeps them:
 *   · markers on the timeline are quiet; a note's content appears on hover, focus or tap. Numbers live only in
 *     the notes list;
 *   · one timeline (a scrub bar with a thin marker lane under it), not three stacked rows;
 *   · at rest a range is only its start dot; its line shows for the selected note or the one under the
 *     pointer, and never under a range being drawn (2026-11-19);
 *   · density degrades gracefully: when the lane holds more notes than it has room for, it folds into evenly
 *     spaced stretches drawn as a quiet strip, and the detail opens on hover, focus or tap (2026-11-19);
 *   · the accent marks only what is being added right now (a range or a moment being drawn); the selected note
 *     is primary ink (docs/design/TASTE.md 18).
 */
import type { ReviewThread } from "@/lib/brand-studio/review-contracts";
import { exactRate } from "@/lib/brand-studio/review-frames";

/**
 * Markers whose centres are closer than this (px, at the lane's current width) become one count pill. It equals
 * a marker's 24px target (2026-11-19; it was 14px), so two targets never overlap and a click near a dot's edge
 * never opens its neighbour.
 */
export const CLUSTER_GAP_PX = 24;
/**
 * On a phone a marker's target is 28px; two dots closer than that would put half of one dot under its
 * neighbour's target, so a tap could open the wrong note. There they fold at the target's width instead.
 */
export const TOUCH_CLUSTER_GAP_PX = 28;

/**
 * What a press on a marker does. A mouse click or the keyboard picks the note (the film goes there and the
 * list selects it). A finger has no hover, so its first tap only shows the card, the way a pointer resting on
 * the dot would; a second tap on the same dot, while its card shows, picks it. On a phone picking scrolls the
 * page to the list, which would take the card away with it.
 */
export function markerPress(input: { touch: boolean; keyboard: boolean; cardShowing: boolean }): "card" | "select" {
  if (input.touch && !input.keyboard && !input.cardShowing) return "card";
  return "select";
}

export function clusterGap(width: number, narrow: boolean): number {
  if (!width) return 0;
  return narrow ? TOUCH_CLUSTER_GAP_PX : CLUSTER_GAP_PX;
}

export interface LanePoint {
  id: string;
  /** The marker's centre on the lane, px from its left edge. */
  x: number;
}

export interface LaneGroup {
  /** Members in time order. One member: a plain marker. */
  ids: string[];
  /** Where the marker or the pill sits: the member's x, or the middle of the first and last member. */
  x: number;
}

/**
 * Markers to draw: neighbours closer than `gap` px chain into one group (a pill with a count), everything
 * else stays a single marker. Input order does not matter; output is in lane order.
 */
export function clusterMarkers(points: readonly LanePoint[], gap = CLUSTER_GAP_PX): LaneGroup[] {
  const sorted = [...points].filter((p) => Number.isFinite(p.x)).sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  const groups: LaneGroup[] = [];
  let run: LanePoint[] = [];
  const flush = () => {
    if (!run.length) return;
    groups.push({ ids: run.map((p) => p.id), x: run.length === 1 ? run[0]!.x : (run[0]!.x + run[run.length - 1]!.x) / 2 });
    run = [];
  };
  for (const point of sorted) {
    const last = run[run.length - 1];
    if (last && point.x - last.x >= gap) flush();
    run.push(point);
  }
  flush();
  return groups;
}

/**
 * Below this many px per note the lane is too crowded for one dot per note and folds into stretches. A desk
 * lane of about 930px keeps single dots up to about 31 notes; a phone lane (about 330px) folds past 8.
 */
export const DENSE_PX_PER_NOTE = 30;
export const TOUCH_DENSE_PX_PER_NOTE = 40;
/**
 * One stretch's target width once the lane folds: about 31 on a 930px desk lane, about 6 on a phone (one per
 * screen-sixth, each a 28px target well apart from the next).
 */
export const STRETCH_PX = 30;
export const TOUCH_STRETCH_PX = 56;

export type LaneMode = "dots" | "stretches";

export interface LaneStretch extends LaneGroup {
  /** The stretch's edges on the lane, px. */
  from: number;
  to: number;
}

export interface LanePlan {
  mode: LaneMode;
  /** Dots: single markers and count pills. Stretches: evenly spaced `LaneStretch`es (only the ones with notes). */
  groups: LaneGroup[];
}

/**
 * The lane cut into equal stretches about `target` px wide that tile it exactly; every stretch that holds a
 * note becomes one stop at its middle. Unlike `clusterMarkers` this never chains: a stop stands for at most one
 * stretch, and neighbouring stops are always a whole stretch apart.
 */
export function stretchMarkers(points: readonly LanePoint[], width: number, target: number): LaneStretch[] {
  if (!(width > 0)) return [];
  const count = Math.max(1, Math.round(width / Math.max(1, target)));
  const size = width / count;
  const buckets = new Map<number, LanePoint[]>();
  const sorted = [...points].filter((p) => Number.isFinite(p.x)).sort((a, b) => a.x - b.x || a.id.localeCompare(b.id));
  for (const point of sorted) {
    const index = Math.min(count - 1, Math.max(0, Math.floor(point.x / size)));
    const list = buckets.get(index) ?? [];
    list.push(point);
    buckets.set(index, list);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, members]) => ({ ids: members.map((m) => m.id), x: (index + 0.5) * size, from: index * size, to: (index + 1) * size }));
}

/**
 * How the lane draws its notes. One dot per note (and a count pill where dots touch) while there is room;
 * stretches once there is less than `DENSE_PX_PER_NOTE` per note, or once a pill would stand for more than two
 * stretches' worth of lane (a long run of close notes would otherwise sit at one misleading spot).
 */
export function planLane(points: readonly LanePoint[], width: number, narrow: boolean): LanePlan {
  const valid = points.filter((p) => Number.isFinite(p.x));
  const fine = clusterMarkers(valid, clusterGap(width, narrow));
  if (!(width > 0) || valid.length < 2) return { mode: "dots", groups: fine };
  const stretchPx = narrow ? TOUCH_STRETCH_PX : STRETCH_PX;
  const crowded = width / valid.length < (narrow ? TOUCH_DENSE_PX_PER_NOTE : DENSE_PX_PER_NOTE);
  const xOf = new Map(valid.map((p) => [p.id, p.x]));
  const sprawling = fine.some((g) => g.ids.length > 1 && (xOf.get(g.ids[g.ids.length - 1]!) ?? 0) - (xOf.get(g.ids[0]!) ?? 0) > 2 * stretchPx);
  if (!crowded && !sprawling) return { mode: "dots", groups: fine };
  return { mode: "stretches", groups: stretchMarkers(valid, width, stretchPx) };
}

/** A stretch's height step (1–4) for how many notes it holds: one, two, three or four, five or more. */
export function stretchLevel(count: number): 1 | 2 | 3 | 4 {
  if (count <= 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

/**
 * Which range notes draw their line on the lane. At rest none: a range is its start dot. The selected note's
 * line shows, except while a new range is being drawn (the two would lie on top of each other; the selected
 * dot stays); a note under the pointer or keyboard (on the lane, its card, or its row in the list) shows its line.
 */
export function rangeLinesShown(input: {
  rangeIds: Iterable<string>;
  activeId: string | null;
  lit: ReadonlyArray<string | null | undefined>;
  drawing: boolean;
}): Set<string> {
  const ranges = new Set(input.rangeIds);
  const shown = new Set<string>();
  if (input.activeId && !input.drawing && ranges.has(input.activeId)) shown.add(input.activeId);
  for (const id of input.lit) if (id && ranges.has(id) && !(input.drawing && id === input.activeId)) shown.add(id);
  return shown;
}

/** A marker's centre at `ms` on a lane `width` px wide for a film `durationMs` long. */
export function laneX(ms: number, durationMs: number, width: number): number {
  if (!(durationMs > 0) || !(width > 0)) return 0;
  return Math.min(width, Math.max(0, (ms / durationMs) * width));
}

/**
 * The playhead is on this note: within one frame of a moment, or inside a range (end exclusive). Without a
 * rate a frame is taken as 1/24 s.
 */
export function playheadOn(note: { atMs: number | null; endMs?: number | null }, currentMs: number, fps: number | null): boolean {
  if (note.atMs == null) return false;
  if (note.endMs != null && note.endMs > note.atMs) return currentMs >= note.atMs && currentMs < note.endMs;
  const frame = 1000 / exactRate(fps ?? 24);
  return Math.abs(currentMs - note.atMs) <= frame;
}

/** What a marker is, for its look: who wrote it (the YAGI team draws a ring), team-only, resolved. */
export type MarkerKind = "brand" | "studio" | "team-only";

export function markerKind(thread: Pick<ReviewThread, "root">, teamView: boolean): MarkerKind {
  if (teamView && thread.root.team) return "team-only";
  return thread.root.authorRole === "studio" && !thread.root.guest ? "studio" : "brand";
}

/** The next stop for ←/→/Home/End among `count` lane stops (roving focus), or null for another key. */
export function nextStop(count: number, current: number, key: string): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
      return Math.min(count - 1, current + 1);
    case "ArrowLeft":
      return Math.max(0, current - 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** The first `words` words of a note, for a marker's spoken name and a cluster row. */
export function firstWords(text: string, words = 8): string {
  const parts = text.replace(/\s+/g, " ").trim().split(" ");
  return parts.length > words ? `${parts.slice(0, words).join(" ")}…` : parts.join(" ");
}
