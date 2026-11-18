/**
 * Frames on the review stage (docs/BRAND-ROOMS-FEEDBACK.md §11): the film's real frame rate, the frame on
 * screen at a moment, one-frame steps, the `m:ss:ff` timecode and the range loop's boundary. Pure; the
 * server probe (lib/brand-studio/files.ts) and the player (components/brand-studio/review/stage.tsx) share it.
 *
 * Notes stay stored in whole milliseconds. A frame's start in milliseconds is rounded UP, so the frame read
 * back from a stored time is always the frame that was on screen (`frameAt(frameStartMs(n)) === n`).
 */

/** The rates a probe or an estimate snaps to when it is within 0.5 % of one. */
export const COMMON_FRAME_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60] as const;
const SNAP_TOLERANCE = 0.005;
export const FPS_MIN = 1;
export const FPS_MAX = 240;
/** Used for stepping when the rate is neither stored nor estimated yet. */
export const FALLBACK_FPS = 24;

/** The NTSC rates as stored (three decimals) and as they really are. */
const EXACT: ReadonlyMap<number, number> = new Map([
  [23.976, 24_000 / 1001],
  [29.97, 30_000 / 1001],
  [59.94, 60_000 / 1001],
]);

/** The rate the arithmetic uses: 23.976 means 24000/1001. Anything else is taken as it is. */
export function exactRate(fps: number): number {
  return EXACT.get(Math.round(fps * 1000) / 1000) ?? fps;
}

/**
 * A measured rate to the value we keep: the nearest common rate when within 0.5 % of one, else three decimals, and
 * null outside 1–240 or when it is not a number.
 */
export function snapFps(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;
  // 23.976 and 24 (and 29.97 and 30, 59.94 and 60) are 0.1 % apart: the nearest one wins.
  let nearest: number | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const rate of COMMON_FRAME_RATES) {
    const off = Math.abs(raw - exactRate(rate)) / exactRate(rate);
    if (off <= SNAP_TOLERANCE && off < distance) {
      nearest = rate;
      distance = off;
    }
  }
  if (nearest != null) return nearest;
  const rounded = Math.round(raw * 1000) / 1000;
  return rounded >= FPS_MIN && rounded <= FPS_MAX ? rounded : null;
}

/**
 * The browser's estimate when nothing was stored: the median of the gaps between presented frames'
 * media times (seconds), snapped. Needs `minSamples` usable gaps; gaps of 0, negative (a seek) or longer
 * than a fifth of a second (a stall) are not used.
 */
export function estimateFps(gaps: readonly number[], minSamples = 8): number | null {
  const usable = gaps.filter((g) => Number.isFinite(g) && g > 0 && g <= 0.2).sort((a, b) => a - b);
  if (usable.length < minSamples) return null;
  const mid = usable.length >> 1;
  const median = usable.length % 2 ? usable[mid]! : (usable[mid - 1]! + usable[mid]!) / 2;
  return snapFps(1 / median);
}

/** The frame on screen at `ms` (frames count from 0). */
export function frameAt(ms: number, fps: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(0, Math.floor((ms * exactRate(fps)) / 1000 + 1e-6));
}

/** Where frame `frame` starts, in whole milliseconds (rounded up, so it reads back as the same frame). */
export function frameStartMs(frame: number, fps: number): number {
  if (frame <= 0) return 0;
  return Math.ceil((frame * 1000) / exactRate(fps) - 1e-6);
}

/** The start of the frame on screen at `ms`: what a note made at `ms` stores. */
export function snapToFrameMs(ms: number, fps: number): number {
  return frameStartMs(frameAt(ms, fps), fps);
}

/** The last frame of a film `durationMs` long (null when the length is not known). */
export function lastFrame(durationMs: number, fps: number): number | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  return Math.max(0, Math.ceil((durationMs * exactRate(fps)) / 1000 - 1e-6) - 1);
}

/** The frame one step from the one on screen, kept inside the film. */
export function stepFrame(ms: number, fps: number, direction: -1 | 1, durationMs = 0): number {
  const next = frameAt(ms, fps) + direction;
  const last = lastFrame(durationMs, fps);
  return Math.max(0, last == null ? next : Math.min(last, next));
}

/**
 * Where to put the player to show frame `frame`, in seconds: the frame's start plus a small bias (5 % of a
 * frame, at least 0.6 ms, at most a quarter frame), so container timestamps rounded to the millisecond or
 * a decoder's own rounding still land on that frame and not the one before it.
 */
export function frameSeekSeconds(frame: number, fps: number): number {
  const duration = 1 / exactRate(fps);
  const bias = Math.min(duration / 4, Math.max(duration * 0.05, 0.0006));
  return Math.max(0, frame) * duration + bias;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * `m:ss:ff`: the real minutes and seconds of the frame's start and the frame's number within that second
 * (two digits, three from 100 fps). At 23.976 a second holds 23 or 24 frames; the clock never drifts from
 * the film's own time, so the same `?t=` and the same duration read the same everywhere.
 */
export function formatFrameTimecode(ms: number | null | undefined, fps: number): string {
  const { clock, frames } = frameTimecodeParts(ms, fps);
  return `${clock}${frames}`;
}

/**
 * The same timecode in two parts, so a screen can set the frame apart from the clock: `0:08` and `:00`
 * (an 8-second mark, not 8 minutes). Text outputs keep `formatFrameTimecode`.
 */
export function frameTimecodeParts(ms: number | null | undefined, fps: number): { clock: string; frames: string } {
  const rate = exactRate(fps);
  const frame = frameAt(Number(ms ?? 0), fps);
  const second = Math.floor(frame / rate + 1e-9);
  const firstOfSecond = Math.ceil(second * rate - 1e-6);
  const ff = Math.max(0, frame - firstOfSecond);
  const h = Math.floor(second / 3600);
  const m = Math.floor((second % 3600) / 60);
  const s = second % 60;
  const clock = h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${m}:${pad(s, 2)}`;
  return { clock, frames: `:${pad(ff, fps >= 100 ? 3 : 2)}` };
}

/** A film's length that ends on (or within one frame of) a whole second: shown as `m:ss` alone. */
export function endsOnWholeSecond(ms: number, fps: number): boolean {
  return Math.abs(ms / 1000 - Math.round(ms / 1000)) * exactRate(fps) <= 1;
}

/** `m:ss:ff` (or `h:mm:ss:ff`) back to the start of that frame in milliseconds; null when it is not one. */
export function parseFrameTimecode(text: string, fps: number): number | null {
  const hit = /^(?:(\d+):)?(\d+):([0-5]\d):(\d{2,3})$/.exec(text.trim());
  if (!hit) return null;
  const h = hit[1] ? Number(hit[1]) : 0;
  const m = Number(hit[2]);
  const s = Number(hit[3]);
  const ff = Number(hit[4]);
  if (hit[1] && m > 59) return null;
  const rate = exactRate(fps);
  const second = h * 3600 + m * 60 + s;
  const frame = Math.ceil(second * rate - 1e-6) + ff;
  // A frame number past the end of its second is not a timecode this format ever writes.
  if (frame >= Math.ceil((second + 1) * rate - 1e-6)) return null;
  return frameStartMs(frame, fps);
}

/* ------------------------------------------------------------------ the range loop */

export interface LoopRange {
  startMs: number;
  endMs: number;
}

/**
 * While a range loops, where the playhead goes next: back to the start once it reaches the end (the end
 * is exclusive) or when it is found before the start; null while it is inside. With a rate, "reaches the
 * end" means the end's own frame is on screen.
 */
export function loopTarget(currentMs: number, range: LoopRange | null, fps: number | null = null): number | null {
  if (!range || !(range.endMs > range.startMs)) return null;
  const atEnd = fps ? frameAt(currentMs, fps) >= frameAt(range.endMs, fps) : currentMs >= range.endMs - 1;
  const before = currentMs < range.startMs - 1;
  return atEnd || before ? range.startMs : null;
}

/** A range as a loop key: the same range keeps looping across re-renders, another one ends it. */
export function loopKeyOf(source: 'note' | 'mark', id: string | null, range: LoopRange | null): string | null {
  if (!range || !(range.endMs > range.startMs)) return null;
  return `${source}:${id ?? ''}:${Math.round(range.startMs)}-${Math.round(range.endMs)}`;
}
