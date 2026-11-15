/**
 * Marks on a clip ("point at what to fix", docs/BRAND-STUDIO-V6-PLAN.md §4.5) as pure data: where the picture
 * sits inside the `<video>` box, pin or box from a pointer gesture, the ①②③ digits in the request text,
 * and what is sent. No DOM here; the layer (`revise-mark-layer.tsx`) and the frame grabber
 * (`revise-mark-frame.ts`) use these.
 */
import { STUDIO_REVISE_MARKS_MAX, STUDIO_SHOT_LIMITS, type ReviseMark } from "@/lib/brand-studio/contracts";

/** A mark in the form: geometry in picture fractions, the clip time, and what reading it said. */
export interface MarkState {
  key: string;
  time: number;
  x: number;
  y: number;
  /** Box only (with `h`); `x`/`y` are then its top-left corner. A pin has neither: `x`/`y` is its centre. */
  w?: number;
  h?: number;
  label: string | null;
  what: string | null;
  /** True while `revise.mark` is reading it. */
  reading: boolean;
}

export type MarkGeometry = Pick<MarkState, "time" | "x" | "y" | "w" | "h">;

export const MARKS_MAX = STUDIO_REVISE_MARKS_MAX;
/** A drag longer than this (CSS px) is a box; anything shorter is a click, so a pin. */
export const DRAG_THRESHOLD_PX = 6;
/** Smallest box side, as a fraction of the picture (the contract's minimum). */
export const BOX_MIN = 0.02;
/** A mark is drawn on the video while the clip is this close to its time (seconds). */
export const VISIBLE_WINDOW_S = 0.15;
/**
 * Height of the native controls strip left free under the layer (CSS px). Chrome's controls on a clip of
 * viewer size are about 71 px tall (the button row sits above the timeline), measured with a real mouse:
 * at 48 px a click on the play button placed a mark instead of playing.
 */
export const CONTROLS_STRIP_PX = 76;

export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Size {
  left: number;
  top: number;
}
export interface Point {
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/**
 * The picture inside a `<video>` content box (object-fit: contain, the default): letterboxed top and
 * bottom when the clip is wider than the box, pillarboxed left and right when it is taller. Before the
 * clip's own size is known the whole box counts as picture.
 */
export function pictureRect(box: Size, media: Size | null): Rect {
  if (!media || media.width <= 0 || media.height <= 0 || box.width <= 0 || box.height <= 0) return { left: 0, top: 0, width: Math.max(0, box.width), height: Math.max(0, box.height) };
  const scale = Math.min(box.width / media.width, box.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

/**
 * How much of the picture's bottom the layer leaves free so the native controls (the bottom `strip` px
 * of the video box) stay usable. Never more than 40 % of the picture.
 */
export function controlsInset(picture: Rect, boxHeight: number, strip = CONTROLS_STRIP_PX): number {
  const overlap = picture.top + picture.height - (boxHeight - strip);
  return clamp(overlap, 0, picture.height * 0.4);
}

/** A point in px from the picture's top-left corner as picture fractions, kept inside the picture. */
export function toFraction(point: Point, picture: Size): Point {
  if (picture.width <= 0 || picture.height <= 0) return { x: 0.5, y: 0.5 };
  return { x: clamp(point.x / picture.width, 0, 1), y: clamp(point.y / picture.height, 0, 1) };
}

/** Is this gesture (px, from the picture's corner) a drag rather than a click? */
export function isDrag(start: Point, end: Point, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) > threshold;
}

/** A box from two picture fractions: at least `BOX_MIN` per side, inside the picture. */
export function boxFrom(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  const w = Math.min(1, Math.max(BOX_MIN, Math.abs(b.x - a.x)));
  const h = Math.min(1, Math.max(BOX_MIN, Math.abs(b.y - a.y)));
  return { x: clamp(Math.min(a.x, b.x), 0, 1 - w), y: clamp(Math.min(a.y, b.y), 0, 1 - h), w, h };
}

/** The mark a pointer gesture places: a pin at the press for a click, a box for a drag. Points in px from the picture's corner. */
export function markFromGesture(start: Point, end: Point, picture: Size, time: number): MarkGeometry {
  const a = toFraction(start, picture);
  if (!isDrag(start, end)) return { time, x: a.x, y: a.y };
  return { time, ...boxFrom(a, toFraction(end, picture)) };
}

/** Moves a mark by fractions of the picture (keyboard), keeping it inside. */
export function nudge<M extends MarkGeometry>(mark: M, dx: number, dy: number): M {
  if (mark.w !== undefined && mark.h !== undefined) return { ...mark, x: clamp(mark.x + dx, 0, 1 - mark.w), y: clamp(mark.y + dy, 0, 1 - mark.h) };
  return { ...mark, x: clamp(mark.x + dx, 0, 1), y: clamp(mark.y + dy, 0, 1) };
}

export const isBox = (mark: MarkGeometry) => mark.w !== undefined && mark.h !== undefined;

/** Drawn on the video only while the clip is at the mark's moment. */
export function visibleAt(mark: Pick<MarkState, "time">, time: number, window = VISIBLE_WINDOW_S): boolean {
  return Math.abs(time - mark.time) <= window + 1e-6;
}

/** `0:02`, `1:05`: the clip time as the chip shows it. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** ① for 1, ② for 2 … (mark n in the request text). */
export function circled(n: number): string {
  return String.fromCharCode(0x2460 + n - 1);
}

const DIGITS = /[①-⑨]/g;

/**
 * The text with mark `n`'s digit and a space inserted at `caret` (at the end when the caret is unknown).
 * A space goes before it too when it would otherwise stick to a word. Returns the caret after the insert.
 */
export function insertDigit(text: string, caret: number | null, n: number): { text: string; caret: number } {
  const at = caret === null ? text.length : clamp(Math.round(caret), 0, text.length);
  const before = text.slice(0, at);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const insert = `${lead}${circled(n)} `;
  return { text: before + insert + text.slice(at), caret: at + insert.length };
}

/**
 * The text without mark `n`'s digit (and the space that went with it), the later digits renumbered so the
 * marks stay 1..n.
 */
export function removeDigit(text: string, n: number): string {
  const digit = circled(n);
  const at = text.indexOf(digit);
  let out = text;
  if (at >= 0) {
    const after = text[at + 1];
    const before = text[at - 1];
    if (after === " ") out = text.slice(0, at) + text.slice(at + 2);
    else if (before === " ") out = text.slice(0, at - 1) + text.slice(at + 1);
    else out = text.slice(0, at) + text.slice(at + 1);
  }
  return out.replace(DIGITS, (d) => {
    const k = d.charCodeAt(0) - 0x2460 + 1;
    return k > n ? circled(k - 1) : d;
  });
}

/** Pixel geometry of a mark drawn on a frame of `width`×`height` (the frame grabber strokes it). */
export function markPixels(mark: MarkGeometry, width: number, height: number) {
  if (isBox(mark)) return { kind: "box" as const, x: mark.x * width, y: mark.y * height, w: mark.w! * width, h: mark.h! * height };
  return { kind: "pin" as const, cx: mark.x * width, cy: mark.y * height, r: Math.max(6, 0.03 * Math.max(width, height)) };
}

/** Frame size for `revise.mark`: the long side at most `max` px, never upscaled. */
export function frameSize(media: Size, max = 768): Size {
  const scale = Math.min(1, max / Math.max(media.width, media.height, 1));
  return { width: Math.max(1, Math.round(media.width * scale)), height: Math.max(1, Math.round(media.height * scale)) };
}

const down4 = (v: number) => Math.floor(v * 10_000) / 10_000;

/** Geometry as the contract takes it: 4 decimals, a box kept inside the picture after rounding. */
export function wireGeometry(mark: MarkGeometry): Pick<ReviseMark, "time" | "x" | "y" | "w" | "h"> {
  const time = Math.round(clamp(mark.time, 0, STUDIO_SHOT_LIMITS.secondsMax) * 1000) / 1000;
  if (!isBox(mark)) return { time, x: down4(clamp(mark.x, 0, 1)), y: down4(clamp(mark.y, 0, 1)) };
  const w = Math.max(BOX_MIN, down4(clamp(mark.w!, BOX_MIN, 1)));
  const h = Math.max(BOX_MIN, down4(clamp(mark.h!, BOX_MIN, 1)));
  return { time, x: down4(clamp(mark.x, 0, 1 - w)), y: down4(clamp(mark.y, 0, 1 - h)), w, h };
}

/** The marks as they travel with `revise.plan` and the created version, in mark order. */
export function toWireMarks(marks: readonly MarkState[]): ReviseMark[] {
  return marks.slice(0, MARKS_MAX).map((mark) => {
    const label = mark.label?.trim().slice(0, 60);
    const what = mark.what?.trim().slice(0, 240);
    return { ...wireGeometry(mark), ...(label ? { label } : {}), ...(what ? { what } : {}) };
  });
}

/** What a chip says after its digit: the label once known, else the time. */
export function chipText(mark: { time: number; label?: string | null }): string {
  return mark.label?.trim() || formatTime(mark.time);
}
