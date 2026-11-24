/**
 * Editing studio v2 — the frame time base (docs/BRAND-EDITING-STUDIO-V2.md §5.1, founder 2026-11-20:
 * "프레임 단위로 정밀하게 자를 수도 있어야 할 것 같은데").
 *
 * Every position in the editor is a whole frame at the film's frame rate: where a cut starts, how long
 * it is, where it was trimmed, where a caption sits, where the playhead is. Nothing here is a number of
 * seconds, so nothing can land between two frames.
 *
 * A cut's trim is kept on the film's frame grid (`inFrame`). Speed is a fraction (`speedNum/speedDen`)
 * with a whole-number `phase`, so a 0.5× or 1.5× cut can be split or trimmed at any frame and both
 * pieces still show exactly the pictures the uncut clip showed. Footage whose own rate differs from the
 * film's is conformed by sampling: each film frame shows the source frame on screen at that moment.
 *
 * Pure: no DOM, no network, no storage. The production model (`ComposerProject`) still counts in tenths
 * of a second; §11 of the document says how it moves here.
 */
import type { CaptionPosition, CaptionSize, ComposeAspect } from '@/lib/brand-studio/compose/timeline';

import {
  clampSpeed,
  curveEndMedia,
  curveMediaPosAt,
  curveRawDurationFrames,
  curveSpeedAtFrame,
  curveStartMedia,
  curveTotalFrames,
  curveTotalSpanMedia,
  gcdInt,
  isFlatCurve,
  isValidSpeedCurve,
  MAX_CURVE_TOTAL_POINTS,
  maxWindowedCurveFrames,
  normalizeCurvePoints,
  splitWindowedCurve,
  toSpeedRational,
  trimWindowedCurveEdge,
  type SpeedCurve,
  type SpeedPoint,
} from './speed-curve';

export type { SpeedCurve, SpeedPoint };

export interface FrameClip {
  id: string;
  label: string;
  srcUrl: string;
  thumbUrl: string | null;
  /** The footage's own frame rate, measured (lib/brand-studio/asset-fps.ts in the product). */
  sourceFps: number;
  /** How many frames the footage has. */
  sourceFrames: number;
  /** First frame shown, on the film's frame grid. */
  inFrame: number;
  /** `0..speedDen-1`: how far into the speed cycle the cut starts. `0` unless a retimed cut was cut. */
  phase: number;
  /** Length on the timeline. */
  frames: number;
  speedNum: number;
  speedDen: number;
  /** Unrounded original media span `{ num, den }` carried across speed changes so slider sweeps never drift. */
  mediaSpan?: { num: number; den: number };
  /** Optional per-cut variable speed curve across `[0, 1]` of this cut's footage span. Omitted when constant. */
  speedCurve?: SpeedCurve;
  /** `0..1` */
  volume: number;
  muted: boolean;
}

export interface FrameCaption {
  id: string;
  text: string;
  /** First frame the caption shows on. */
  start: number;
  /** One past the last frame it shows on. */
  end: number;
  position: CaptionPosition;
  size: CaptionSize;
}

export interface FrameSequence {
  fps: number;
  aspect: ComposeAspect;
  clips: FrameClip[];
  captions: FrameCaption[];
}

export interface FrameSpan {
  clip: FrameClip;
  index: number;
  start: number;
  /** One past the cut's last frame. */
  end: number;
  frames: number;
}

const isWhole = (value: number) => Number.isInteger(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// ── Which picture ──────────────────────────────────────────────────────────────────────────────

/** The source frame on screen at film-grid frame `mediaFrame` (frame sampling, no blending). */
export function sourceFrameIndex(mediaFrame: number, fps: number, sourceFps: number): number {
  return Math.floor((mediaFrame * sourceFps) / fps + 1e-9);
}

/** Where to seek to show source frame `index`: its middle, so rounding cannot land on a neighbour. */
export function sourceSeekSec(index: number, sourceFps: number): number {
  return (index + 0.5) / sourceFps;
}

/** The footage's length on the film's frame grid. */
export function mediaFramesOf(clip: Pick<FrameClip, 'sourceFrames' | 'sourceFps'>, fps: number): number {
  return Math.max(1, Math.floor((clip.sourceFrames * fps) / clip.sourceFps + 1e-9));
}

/** The longest this cut can be from its in-point at its speed. */
export function clipMaxFrames(clip: FrameClip, fps: number): number {
  if (clip.speedCurve) {
    return maxWindowedCurveFrames(clip.speedCurve, mediaFramesOf(clip, fps));
  }
  const left = (mediaFramesOf(clip, fps) - clip.inFrame) * clip.speedDen - clip.phase;
  return Math.max(1, Math.ceil(left / clip.speedNum));
}

export function clipMediaPosAt(clip: FrameClip, offset: number): number {
  if (clip.speedCurve) return curveMediaPosAt(clip.speedCurve, offset);
  return clip.inFrame + (clip.phase + offset * clip.speedNum) / clip.speedDen;
}

export function clipSpeedAt(clip: FrameClip, offset: number): number {
  if (clip.speedCurve) return curveSpeedAtFrame(clip.speedCurve, offset);
  return clip.speedNum / clip.speedDen;
}

/** What the cut shows on its `offset`-th frame. */
export function clipFrameAt(clip: FrameClip, offset: number, fps: number): { mediaFrame: number; sourceFrame: number; seekSec: number } {
  let mediaFrame: number;
  if (clip.speedCurve) {
    const maxMediaFrame = Math.max(0, Math.floor(curveEndMedia(clip.speedCurve) - 1e-7));
    const flat = isFlatCurve(clip.speedCurve);
    if (flat !== null && Math.abs(flat - clampSpeed(flat)) < 1e-12) {
      const { num, den } = toSpeedRational(flat);
      const rawPos = curveStartMedia(clip.speedCurve) + (offset * num) / den;
      mediaFrame = clamp(Math.floor(rawPos + 1e-9), 0, maxMediaFrame);
    } else {
      mediaFrame = clamp(Math.floor(curveMediaPosAt(clip.speedCurve, offset) + 1e-9), 0, maxMediaFrame);
    }
  } else {
    mediaFrame = clip.inFrame + Math.floor((clip.phase + offset * clip.speedNum) / clip.speedDen);
  }
  const sourceFrame = clamp(sourceFrameIndex(mediaFrame, fps, clip.sourceFps), 0, Math.max(0, clip.sourceFrames - 1));
  return { mediaFrame, sourceFrame, seekSec: sourceSeekSec(sourceFrame, clip.sourceFps) };
}

export function spansOf(seq: FrameSequence): FrameSpan[] {
  let cursor = 0;
  return seq.clips.map((clip, index) => {
    const start = cursor;
    cursor += clip.frames;
    return { clip, index, start, end: cursor, frames: clip.frames };
  });
}

export function totalFrames(seq: FrameSequence): number {
  return seq.clips.reduce((sum, clip) => sum + clip.frames, 0);
}

export interface FrameState {
  frame: number;
  active: { clip: FrameClip; index: number; offset: number; start: number; mediaFrame: number; sourceFrame: number; seekSec: number } | null;
  captions: FrameCaption[];
}

/** The film at one frame. `frame` is brought onto a real frame of the film first. */
export function frameStateAt(seq: FrameSequence, frame: number): FrameState {
  const total = totalFrames(seq);
  const at = clamp(Math.round(frame), 0, Math.max(0, total - 1));
  let active: FrameState['active'] = null;
  for (const span of spansOf(seq)) {
    if (at >= span.start && at < span.end) {
      const offset = at - span.start;
      active = { clip: span.clip, index: span.index, offset, start: span.start, ...clipFrameAt(span.clip, offset, seq.fps) };
      break;
    }
  }
  const captions = seq.captions.filter((caption) => caption.text.trim() !== '' && at >= caption.start && at < caption.end);
  return { frame: at, active, captions };
}

/**
 * The captions the film can show: those that start before its end, cut off at the end. On the sample
 * film this is every caption (its operations fit them); on a real film the stored captions are kept
 * whole (v2 does not own them) and one past the end is hidden until the film is long enough again.
 */
export function visibleCaptions(seq: FrameSequence): FrameCaption[] {
  const total = totalFrames(seq);
  return seq.captions.filter((caption) => caption.start < total).map((caption) => (caption.end > total ? { ...caption, end: total } : caption));
}

// ── Operations: each returns the same sequence when it changes nothing ─────────────────────────

const withClips = (seq: FrameSequence, clips: FrameClip[]): FrameSequence => fitCaptions({ ...seq, clips });

function fitCaptions(seq: FrameSequence): FrameSequence {
  const total = totalFrames(seq);
  const captions = seq.captions
    .filter((caption) => caption.start < total)
    .map((caption) => (caption.end > total ? { ...caption, end: total } : caption));
  return captions.length === seq.captions.length && captions.every((caption, i) => caption === seq.captions[i]) ? seq : { ...seq, captions };
}

/** Moves a cut's position in its footage by `delta` timeline frames, carrying the speed cycle. */
function shifted(clip: FrameClip, delta: number): Pick<FrameClip, 'inFrame' | 'phase'> {
  const position = clip.inFrame * clip.speedDen + clip.phase + delta * clip.speedNum;
  return { inFrame: Math.floor(position / clip.speedDen), phase: ((position % clip.speedDen) + clip.speedDen) % clip.speedDen };
}

/**
 * Cuts the film at `frame`. The cut under it becomes two that meet there; the right one takes `newId`.
 * A frame on a cut boundary, outside the film or between frames changes nothing.
 */
export function splitAtFrame(seq: FrameSequence, frame: number, newId: string): FrameSequence {
  if (!isWhole(frame)) return seq;
  const span = spansOf(seq).find((entry) => frame > entry.start && frame < entry.end);
  if (!span) return seq;
  const offset = frame - span.start;
  const { mediaSpan: _dropSpan, ...cleanClip } = span.clip;
  let left: FrameClip;
  let right: FrameClip;
  if (cleanClip.speedCurve) {
    const split = splitWindowedCurve(cleanClip.speedCurve, offset);
    if (!split) return seq;
    const { left: leftCurve, right: rightCurve } = split;
    left = {
      ...cleanClip,
      inFrame: Math.max(0, Math.floor(curveStartMedia(leftCurve) + 1e-9)),
      frames: offset,
      speedCurve: leftCurve,
    };
    right = {
      ...cleanClip,
      id: newId,
      inFrame: Math.max(0, Math.floor(curveStartMedia(rightCurve) + 1e-9)),
      phase: 0,
      frames: cleanClip.frames - offset,
      speedNum: 1,
      speedDen: 1,
      speedCurve: rightCurve,
    };
  } else {
    left = { ...cleanClip, frames: offset };
    right = { ...cleanClip, id: newId, ...shifted(cleanClip, offset), frames: cleanClip.frames - offset };
  }
  const clips = [...seq.clips];
  clips.splice(span.index, 1, left, right);
  return { ...seq, clips };
}

/**
 * Drags one edge of a cut by `delta` timeline frames (positive is to the right). The edge stops at the
 * ends of the footage and never leaves the cut shorter than one frame. `applied` is how far it went.
 */
export function trimClipEdge(seq: FrameSequence, index: number, edge: 'start' | 'end', delta: number): { seq: FrameSequence; applied: number } {
  const clip = seq.clips[index];
  if (!clip) return { seq, applied: 0 };
  let applied = Math.round(delta);
  const { mediaSpan: _dropSpan, ...cleanClip } = clip;

  if (cleanClip.speedCurve) {
    const res = trimWindowedCurveEdge(cleanClip.speedCurve, edge, applied, mediaFramesOf(cleanClip, seq.fps));
    if (res.applied === 0) return { seq, applied: 0 };
    const next: FrameClip = {
      ...cleanClip,
      inFrame: Math.max(0, Math.floor(curveStartMedia(res.curve) + 1e-9)),
      phase: 0,
      frames: curveTotalFrames(res.curve),
      speedCurve: res.curve,
    };
    const clips = [...seq.clips];
    clips[index] = next;
    return { seq: withClips(seq, clips), applied: res.applied };
  }

  if (edge === 'start') {
    const back = Math.floor((cleanClip.inFrame * cleanClip.speedDen + cleanClip.phase) / cleanClip.speedNum);
    applied = clamp(applied, -back, cleanClip.frames - 1);
  } else {
    applied = clamp(applied, 1 - cleanClip.frames, clipMaxFrames(cleanClip, seq.fps) - cleanClip.frames);
  }
  if (applied === 0) return { seq, applied: 0 };
  const next: FrameClip =
    edge === 'start'
      ? { ...cleanClip, ...shifted(cleanClip, applied), frames: cleanClip.frames - applied }
      : { ...cleanClip, frames: cleanClip.frames + applied };
  const clips = [...seq.clips];
  clips[index] = next;
  return { seq: withClips(seq, clips), applied };
}

export function moveClip(seq: FrameSequence, from: number, to: number): FrameSequence {
  if (from < 0 || from >= seq.clips.length) return seq;
  const target = clamp(Math.round(to), 0, seq.clips.length - 1);
  if (target === from) return seq;
  const clips = [...seq.clips];
  const [moved] = clips.splice(from, 1);
  if (!moved) return seq;
  clips.splice(target, 0, moved);
  return { ...seq, clips };
}

/** Removes cuts by id. A film keeps at least one cut: removing all of them changes nothing. */
export function removeClips(seq: FrameSequence, ids: readonly string[]): FrameSequence {
  const clips = seq.clips.filter((clip) => !ids.includes(clip.id));
  if (clips.length === seq.clips.length || clips.length === 0) return seq;
  return withClips(seq, clips);
}

export function insertClips(seq: FrameSequence, atIndex: number, clips: readonly FrameClip[]): FrameSequence {
  if (clips.length === 0) return seq;
  const next = [...seq.clips];
  next.splice(clamp(Math.round(atIndex), 0, next.length), 0, ...clips);
  return { ...seq, clips: next };
}

/** Retimes a cut. It keeps showing the same stretch of footage, so its length on the timeline changes. */
export function setClipSpeed(seq: FrameSequence, index: number, speedNum: number, speedDen: number): FrameSequence {
  const clip = seq.clips[index];
  if (!clip || !isWhole(speedNum) || !isWhole(speedDen) || speedNum < 1 || speedDen < 1) return seq;
  if (!clip.speedCurve && clip.speedNum === speedNum && clip.speedDen === speedDen) return seq;

  const { speedCurve, mediaSpan: existingSpan, ...baseClip } = clip;
  let inFrame = baseClip.inFrame;
  let baseNum: number;
  let baseDen: number;

  if (speedCurve) {
    inFrame = clamp(Math.floor(curveStartMedia(speedCurve) + 1e-9), 0, Math.max(0, mediaFramesOf(baseClip, seq.fps) - 1));
    const winMatchesDomain =
      Math.abs(curveStartMedia(speedCurve) - speedCurve.startMedia) <= 1e-9 &&
      Math.abs(curveEndMedia(speedCurve) - (speedCurve.startMedia + speedCurve.spanMedia)) <= 1e-9;
    if (existingSpan && winMatchesDomain) {
      baseNum = existingSpan.num;
      baseDen = existingSpan.den;
    } else {
      const pct = Math.max(1, Math.round(curveTotalSpanMedia(speedCurve) * 100));
      const g = gcdInt(pct, 100);
      baseNum = pct / g;
      baseDen = 100 / g;
    }
  } else if (existingSpan) {
    baseNum = existingSpan.num;
    baseDen = existingSpan.den;
  } else {
    // Match main's rounded-up covered span on first speed change from legacy cuts without mediaSpan.
    const covered = Math.ceil((baseClip.phase + baseClip.frames * baseClip.speedNum) / baseClip.speedDen);
    baseNum = Math.max(1, covered);
    baseDen = 1;
  }

  const retimed: FrameClip = { ...baseClip, inFrame, phase: 0, speedNum, speedDen, frames: 1 };
  const maxAllowed = clipMaxFrames(retimed, seq.fps);
  const targetFrames = Math.round((baseNum * speedDen) / (baseDen * speedNum));
  retimed.frames = clamp(targetFrames, 1, maxAllowed);
  if (retimed.frames * speedNum * baseDen !== baseNum * speedDen || baseDen > 1) {
    retimed.mediaSpan = { num: baseNum, den: baseDen };
  }
  const clips = [...seq.clips];
  clips[index] = retimed;
  return withClips(seq, clips);
}

export function setClipConstantSpeed(seq: FrameSequence, index: number, speed: number): FrameSequence {
  const { num, den } = toSpeedRational(speed);
  return setClipSpeed(seq, index, num, den);
}

function sameSpeedPoints(a: readonly SpeedPoint[], b: readonly SpeedPoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const pa = a[i]!;
    const pb = b[i]!;
    if (
      Math.abs(pa.pos - pb.pos) > 1e-9 ||
      Math.abs(pa.speed - pb.speed) > 1e-9 ||
      (pa.slope === undefined) !== (pb.slope === undefined) ||
      (pa.slope !== undefined && Math.abs(pa.slope - pb.slope!) > 1e-9) ||
      (pa.slopeRight === undefined) !== (pb.slopeRight === undefined) ||
      (pa.slopeRight !== undefined && Math.abs(pa.slopeRight - pb.slopeRight!) > 1e-9)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Why a speed curve was not put on a cut (audit A2): `too_short`, it would make the cut shorter than one
 * frame; `point_limit`, it has more points than a curve may keep (`MAX_CURVE_TOTAL_POINTS`).
 */
export type SpeedCurveRefusal = 'too_short' | 'point_limit';

export function setClipSpeedCurve(seq: FrameSequence, index: number, points: readonly SpeedPoint[]): FrameSequence {
  return applyClipSpeedCurve(seq, index, points).seq;
}

/**
 * Puts a speed curve on a cut, and says why when it cannot: the film comes back unchanged with the reason,
 * so the editor can say it instead of leaving a button that seems to do nothing. A missing cut, or the curve
 * the cut already has, changes nothing and is not a refusal.
 */
export function applyClipSpeedCurve(
  seq: FrameSequence,
  index: number,
  points: readonly SpeedPoint[],
): { seq: FrameSequence; refused: SpeedCurveRefusal | null } {
  const unchanged = (refused: SpeedCurveRefusal | null = null) => ({ seq, refused });
  const clip = seq.clips[index];
  if (!clip) return unchanged();
  if (points.length > MAX_CURVE_TOTAL_POINTS) return unchanged('point_limit');
  const cleanPoints = normalizeCurvePoints(points);
  if (cleanPoints.length > MAX_CURVE_TOTAL_POINTS) return unchanged('point_limit');
  if (clip.speedCurve && sameSpeedPoints(cleanPoints, clip.speedCurve.points)) {
    return unchanged();
  }
  const media = mediaFramesOf(clip, seq.fps);
  const startMedia = clip.speedCurve ? curveStartMedia(clip.speedCurve) : clip.inFrame + clip.phase / clip.speedDen;
  const rawSpan = clip.speedCurve
    ? curveTotalSpanMedia(clip.speedCurve)
    : clip.mediaSpan
      ? clip.mediaSpan.num / clip.mediaSpan.den
      : (clip.frames * clip.speedNum) / clip.speedDen;
  const spanMedia = Math.min(rawSpan, Math.max(1e-6, media - startMedia));
  const nextCurve: SpeedCurve = { startMedia, spanMedia: Math.max(1e-6, spanMedia), points: cleanPoints };
  if (curveRawDurationFrames(nextCurve) < 1 - 1e-6) {
    return unchanged('too_short');
  }
  const inFrame = clamp(Math.floor(startMedia + 1e-9), 0, Math.max(0, media - 1));
  const retimed: FrameClip = {
    ...clip,
    inFrame,
    phase: 0,
    speedNum: 1,
    speedDen: 1,
    frames: curveTotalFrames(nextCurve),
    speedCurve: nextCurve,
  };
  const winMatchesDomain =
    !clip.speedCurve ||
    (Math.abs(curveStartMedia(clip.speedCurve) - clip.speedCurve.startMedia) <= 1e-9 &&
      Math.abs(curveEndMedia(clip.speedCurve) - (clip.speedCurve.startMedia + clip.speedCurve.spanMedia)) <= 1e-9);
  if (clip.mediaSpan && winMatchesDomain) {
    retimed.mediaSpan = clip.mediaSpan;
  } else {
    delete retimed.mediaSpan;
  }
  const clips = [...seq.clips];
  clips[index] = retimed;
  return { seq: withClips(seq, clips), refused: null };
}

export function resetClipSpeed(seq: FrameSequence, index: number): FrameSequence {
  return setClipConstantSpeed(seq, index, 1);
}

export function setClipAudio(seq: FrameSequence, index: number, volume: number, muted: boolean): FrameSequence {
  const clip = seq.clips[index];
  if (!clip) return seq;
  const next = { ...clip, volume: clamp(volume, 0, 1), muted };
  if (next.volume === clip.volume && next.muted === clip.muted) return seq;
  const clips = [...seq.clips];
  clips[index] = next;
  return { ...seq, clips };
}

export function setAspect(seq: FrameSequence, aspect: ComposeAspect): FrameSequence {
  return seq.aspect === aspect ? seq : { ...seq, aspect };
}

export const MAX_FRAME_CAPTIONS = 32;

export function addCaption(seq: FrameSequence, caption: FrameCaption): FrameSequence {
  const total = totalFrames(seq);
  const text = caption.text.trim().slice(0, 120);
  if (!text || total === 0 || seq.captions.length >= MAX_FRAME_CAPTIONS) return seq;
  const start = clamp(Math.round(caption.start), 0, total - 1);
  const end = clamp(Math.round(caption.end), start + 1, total);
  return { ...seq, captions: [...seq.captions, { ...caption, text, start, end }] };
}

export function updateCaption(seq: FrameSequence, id: string, change: Partial<Pick<FrameCaption, 'text' | 'position' | 'size'>>): FrameSequence {
  const target = seq.captions.find((caption) => caption.id === id);
  if (!target) return seq;
  const text = change.text === undefined ? target.text : change.text.trim().slice(0, 120);
  if (!text) return seq;
  const next = { ...target, ...change, text };
  if (next.text === target.text && next.position === target.position && next.size === target.size) return seq;
  return { ...seq, captions: seq.captions.map((caption) => (caption.id === id ? next : caption)) };
}

export function removeCaption(seq: FrameSequence, id: string | 'all'): FrameSequence {
  const captions = id === 'all' ? [] : seq.captions.filter((caption) => caption.id !== id);
  return captions.length === seq.captions.length ? seq : { ...seq, captions };
}

/** Everything in the sequence that is not a whole frame, out of range or out of order. Empty when sound. */
export function wholeFrameViolations(seq: FrameSequence): string[] {
  const out: string[] = [];
  if (!isWhole(seq.fps) || seq.fps < 1) out.push(`fps ${seq.fps}`);
  seq.clips.forEach((clip, index) => {
    for (const key of ['inFrame', 'phase', 'frames', 'speedNum', 'speedDen', 'sourceFrames'] as const) {
      if (!isWhole(clip[key])) out.push(`cut ${index + 1} ${key} ${clip[key]}`);
    }
    if (clip.frames < 1) out.push(`cut ${index + 1} is shorter than a frame`);
    if (clip.inFrame < 0) out.push(`cut ${index + 1} starts before its footage`);
    if (clip.speedNum < 1 || clip.speedDen < 1) out.push(`cut ${index + 1} speed ${clip.speedNum}/${clip.speedDen}`);
    if (clip.phase < 0 || clip.phase >= clip.speedDen) out.push(`cut ${index + 1} phase ${clip.phase}`);
    if (clip.speedCurve) {
      if (!isValidSpeedCurve(clip.speedCurve)) {
        out.push(`cut ${index + 1} speedCurve is invalid`);
      } else {
        if (curveStartMedia(clip.speedCurve) < -1e-6) {
          out.push(`cut ${index + 1} curve starts before its footage`);
        }
        if (isWhole(seq.fps) && curveEndMedia(clip.speedCurve) > mediaFramesOf(clip, seq.fps) + 1e-4) {
          out.push(`cut ${index + 1} curve runs past its footage`);
        }
        const expectedFrames = curveTotalFrames(clip.speedCurve);
        if (clip.frames !== expectedFrames) {
          out.push(`cut ${index + 1} frames ${clip.frames} mismatches curve length ${expectedFrames}`);
        }
      }
    }
    if (isWhole(seq.fps) && clip.frames > clipMaxFrames(clip, seq.fps)) out.push(`cut ${index + 1} runs past its footage`);
  });
  const total = totalFrames(seq);
  seq.captions.forEach((caption, index) => {
    if (!isWhole(caption.start) || !isWhole(caption.end)) out.push(`caption ${index + 1} ${caption.start}–${caption.end}`);
    if (caption.start < 0 || caption.end <= caption.start || caption.end > total) out.push(`caption ${index + 1} out of range`);
  });
  return out;
}

// ── Timecode, ruler, zoom, snapping ────────────────────────────────────────────────────────────

/** Minutes, seconds, frames: `0:05:12` is twelve frames into the sixth second. */
export function formatTimecode(frame: number, fps: number): string {
  const whole = Math.max(0, Math.round(frame));
  const seconds = Math.floor(whole / fps);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}:${String(whole % fps).padStart(2, '0')}`;
}

export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/** A frame at the deepest zoom is this wide. */
export const MAX_PX_PER_FRAME = 80;
/** From this width on, every frame gets its own picture in the filmstrip. */
export const FRAME_STRIP_PX = 48;
const LABEL_GAP_PX = 72;
const TICK_GAP_PX = 8;

function rulerSteps(fps: number): number[] {
  const within = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15].filter((step) => step < fps && fps % step === 0);
  const seconds = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * fps);
  return [...within, ...seconds];
}

export interface RulerTick {
  frame: number;
  /** `0:05` on a second, `6f` inside one, `null` for a bare tick. */
  label: string | null;
}

/** The ruler between two frames at a zoom: seconds when far out, frames ("2f 4f 6f") when close. */
export function rulerTicks(pxPerFrame: number, fps: number, fromFrame: number, toFrame: number): RulerTick[] {
  const steps = rulerSteps(fps);
  const labelStep = steps.find((step) => step * pxPerFrame >= LABEL_GAP_PX) ?? steps[steps.length - 1]!;
  const tickStep = steps.find((step) => step * pxPerFrame >= TICK_GAP_PX && labelStep % step === 0) ?? labelStep;
  const ticks: RulerTick[] = [];
  const first = Math.ceil(Math.max(0, fromFrame) / tickStep) * tickStep;
  for (let frame = first; frame <= toFrame; frame += tickStep) {
    let label: string | null = null;
    if (frame % labelStep === 0) {
      const seconds = Math.floor(frame / fps);
      label = frame % fps === 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : `${frame % fps}f`;
    }
    ticks.push({ frame, label });
  }
  return ticks;
}

/** Slider position `0..1` to a frame width, evenly in ratio between "the film fits" and the deepest zoom. */
export function sliderToPpf(t: number, fitPpf: number): number {
  const fit = Math.min(fitPpf, MAX_PX_PER_FRAME);
  return fit * (MAX_PX_PER_FRAME / fit) ** clamp(t, 0, 1);
}

export function ppfToSlider(pxPerFrame: number, fitPpf: number): number {
  const fit = Math.min(fitPpf, MAX_PX_PER_FRAME);
  if (fit >= MAX_PX_PER_FRAME) return 1;
  return clamp(Math.log(clamp(pxPerFrame, fit, MAX_PX_PER_FRAME) / fit) / Math.log(MAX_PX_PER_FRAME / fit), 0, 1);
}

/** The scroll position that keeps the frame under the pointer where it is across a zoom change. */
export function zoomScrollLeft(pxPerFrame: number, nextPxPerFrame: number, pointerX: number, scrollLeft: number): number {
  return Math.max(0, ((scrollLeft + pointerX) / pxPerFrame) * nextPxPerFrame - pointerX);
}

/** `frame`, or the nearest candidate when one is within `thresholdPx` on screen (the magnet). */
export function snapFrame(frame: number, candidates: readonly number[], pxPerFrame: number, thresholdPx: number): number {
  let best = frame;
  let bestGap = thresholdPx;
  for (const candidate of candidates) {
    const gap = Math.abs(candidate - frame) * pxPerFrame;
    if (gap <= bestGap) {
      best = candidate;
      bestGap = gap;
    }
  }
  return best;
}

/** The cut edge before or after a frame, for stepping from cut to cut. */
export function neighbourCut(seq: FrameSequence, frame: number, direction: -1 | 1): number {
  const edges = spansOf(seq).map((span) => span.start);
  const last = Math.max(0, totalFrames(seq) - 1);
  if (direction === 1) return edges.find((edge) => edge > frame) ?? last;
  return [...edges].reverse().find((edge) => edge < frame) ?? 0;
}
