/**
 * The review timeline's rules, apart from the screen (docs/BRAND-ROOMS-FEEDBACK.md §11).
 *
 * Principles the timeline follows, written here so the next change keeps them:
 *   · markers on the timeline are quiet; a note's content appears on hover, focus or tap. Numbers live only in
 *     the notes list;
 *   · one timeline (a scrub bar with a thin marker lane under it), not three stacked rows;
 *   · the accent marks exactly one thing at a time: the selected note (and a range being drawn).
 */
import type { ReviewThread } from "@/lib/brand-studio/review-contracts";
import { exactRate } from "@/lib/brand-studio/review-frames";

/** Markers whose centres are closer than this (px, at the lane's current width) become one count pill. */
export const CLUSTER_GAP_PX = 14;
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
