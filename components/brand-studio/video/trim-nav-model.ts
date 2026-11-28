/**
 * Pure client-side scene navigation & playhead math for `ClipTrimModal` (VM-2 Batch T).
 * Zero DOM, zero server calls.
 */
import type { FilmShot } from "@/lib/brand-studio/contracts";
import { clampTrimRange } from "./workspace-model";

export const TRIM_STRIP_COUNT = 16;
export const TRIM_FRAME_FPS = 24;
export const TRIM_FRAME_STEP_SECONDS = 1 / TRIM_FRAME_FPS;
export const TRIM_TEN_FRAMES_SECONDS = 10 / TRIM_FRAME_FPS;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Evenly spaced seek timestamps across `[0, total]` for the browser thumbnail strip. */
export function stripTimestamps(total: number, count = TRIM_STRIP_COUNT): number[] {
  const dur = Number.isFinite(total) && total > 0 ? total : 1;
  const n = Math.max(1, Math.round(count));
  const maxSeek = Math.max(0.05, dur - 0.05);
  return Array.from({ length: n }, (_, i) => {
    const raw = ((i + 0.5) / n) * dur;
    return Math.min(maxSeek, Math.max(0.05, raw));
  });
}

/** Fixed step size (2–10s) used when no cached film reading (`shots`) exists for the clip. */
export function fixedSceneStep(total: number): number {
  const dur = Number.isFinite(total) && total > 0 ? total : 10;
  return Math.max(2, Math.min(10, Math.round(dur / 10)));
}

/** Sorted interior scene boundary times (`0 < t < total`) extracted from an existing `FilmSheet.shots`. */
export function sceneBoundaries(
  shots: readonly Pick<FilmShot, "start" | "end">[] | null | undefined,
  total: number,
): number[] {
  if (!shots || shots.length < 2 || !Number.isFinite(total) || total <= 0) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const shot of shots) {
    const t = round1(shot.start);
    if (!Number.isFinite(t) || t <= 0.05 || t >= total - 0.05) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/** Computes the next playhead target for Previous/Next scene (↑/↓). */
export function sceneJumpTarget(
  current: number,
  shots: readonly Pick<FilmShot, "start" | "end">[] | null | undefined,
  total: number,
  dir: "prev" | "next",
): { target: number; usedShots: boolean; stepSeconds: number } {
  const dur = Number.isFinite(total) && total > 0 ? total : 0.5;
  const cur = Math.max(0, Math.min(dur, Number.isFinite(current) ? current : 0));
  const boundaries = sceneBoundaries(shots, dur);
  const stepSeconds = fixedSceneStep(dur);

  if (boundaries.length > 0) {
    const allStops = [0, ...boundaries, dur];
    if (dir === "prev") {
      // 0.3s hysteresis so repeated prev presses walk backward cleanly even during playback.
      for (let i = allStops.length - 1; i >= 0; i -= 1) {
        if (allStops[i]! < cur - 0.3) {
          return { target: allStops[i]!, usedShots: true, stepSeconds };
        }
      }
      return { target: 0, usedShots: true, stepSeconds };
    }
    for (let i = 0; i < allStops.length; i += 1) {
      if (allStops[i]! > cur + 0.05) {
        return { target: allStops[i]!, usedShots: true, stepSeconds };
      }
    }
    return { target: dur, usedShots: true, stepSeconds };
  }

  const next = dir === "prev" ? Math.max(0, cur - stepSeconds) : Math.min(dur, cur + stepSeconds);
  return { target: round1(next), usedShots: false, stepSeconds };
}

/**
 * Sets `start` (I) or `end` (O) to the playhead, keeping `minSeconds..maxSeconds` via `clampTrimRange`.
 * When moving one handle forces the other handle to shift to stay inside `[minSeconds, maxSeconds]`,
 * returns `movedOther: "start" | "end"` so the modal can report it in one short line.
 */
export function applyPlayheadBound(
  range: { start: number; end: number; duration: number },
  playhead: number,
  side: "start" | "end",
  total: number,
  minSeconds = 4,
  maxSeconds = 30,
): { range: { start: number; end: number; duration: number }; movedOther: "start" | "end" | null } {
  const dur = Math.max(0.1, Number.isFinite(total) && total > 0 ? total : minSeconds);
  const clampedHead = Math.max(0, Math.min(dur, Number.isFinite(playhead) ? playhead : 0));
  const preferredSpan = Math.min(maxSeconds, Math.max(minSeconds, range.end - range.start));

  if (side === "start") {
    const startTarget = Math.min(Math.max(0, dur - minSeconds), clampedHead);
    const keepEnd = range.end >= startTarget + minSeconds - 0.05 && range.end <= startTarget + maxSeconds + 0.05;
    const endTarget = keepEnd ? range.end : Math.min(dur, startTarget + preferredSpan);
    const next = clampTrimRange(startTarget, endTarget, dur, minSeconds, maxSeconds, "end");
    const movedOther = Math.abs(next.end - range.end) > 0.05 ? "end" : null;
    return { range: next, movedOther };
  }

  const endTarget = Math.max(Math.min(dur, minSeconds), clampedHead);
  const keepStart = range.start <= endTarget - minSeconds + 0.05 && range.start >= endTarget - maxSeconds - 0.05;
  const startTarget = keepStart ? range.start : Math.max(0, endTarget - preferredSpan);
  const next = clampTrimRange(startTarget, endTarget, dur, minSeconds, maxSeconds, "start");
  const movedOther = Math.abs(next.start - range.start) > 0.05 ? "start" : null;
  return { range: next, movedOther };
}
