/**
 * Editing studio v2 — parallel video overlay tracks (slice E-T, Batch T1).
 *
 * Implements the reference multi-track video movement behaviour on whole film frames:
 * - Main packed/magnetic video track (`sequence.clips`) + up to 3 live video overlay tracks above it
 *   (`sequence.overlayTracks`, ordered bottom-to-top: index 0 sits directly above main, highest index draws on top).
 * - Free-positioned overlay tracks (gaps allowed, no overlap inside one track, touching edges legal).
 * - Linkage (default ON): each overlay clip links to the main clip under its START via `{ clipId, sourceFrame }`,
 *   reconciled in one place (`withSequence` in `./model.ts`).
 * - Snapping (default ON): both edges of a moving/trimming clip snap to all other clip edges across all tracks
 *   and to the playhead within 10 px at the current zoom (`Shift` suspends).
 * - Provisional rules P1–P10 are each isolated in one named exported function so any rule can be flipped in one place.
 *
 * Pure: no DOM, no network, no storage.
 */
import { MAX_COMPOSE_OVERLAYS } from '@/lib/brand-studio/compose/timeline';
import {
  clipFrameAt,
  clipMaxFrames,
  mediaFramesOf,
  spansOf,
  totalFrames,
  type FrameClip,
  type FrameSequence,
  type FrameSpan,
  type SpeedCurve,
  type SpeedCurveRefusal,
  type SpeedPoint,
} from './frames';
import {
  clampSpeed,
  cloneSpeedCurve,
  curveEndMedia,
  curveRawDurationFrames,
  curveStartMedia,
  curveTotalFrames,
  curveTotalSpanMedia,
  gcdInt,
  isValidSpeedCurve,
  MAX_CURVE_TOTAL_POINTS,
  normalizeCurvePoints,
  splitWindowedCurve,
  toSpeedRational,
  trimWindowedCurveEdge,
} from './speed-curve';

/** Live video overlay tracks above the main track in T1 (decode load cap). */
export const MAX_OVERLAY_TRACKS = 3;
/** Shared cap with legacy overlays in `ComposerProject.overlays`. */
export const MAX_OVERLAY_CLIPS = MAX_COMPOSE_OVERLAYS;
/** Fixed overlay row height in T1 (no layout-store key; C5). */
export const OVERLAY_ROW_HEIGHT = 54;
/** Vertical gap between tracks (matches `LANE_GAP` in layout-model). */
export const TRACK_ROW_GAP = 4;
/** Pointer drag activation distance in pixels. */
export const DRAG_ACTIVATION_PX = 6;
/** Vertical hysteresis (px above main lane top edge) before a horizontal main reorder becomes a track lift (C2). */
export const TRACK_LIFT_HYSTERESIS_PX = 16;
/** Auto-snap engage threshold in pixels at current zoom (observed once, D5). */
export const SNAP_ENGAGE_PX = 2;
/** Auto-snap release threshold in pixels once snapped (hysteresis; observed once, D5). */
export const SNAP_RELEASE_PX = 6;

export interface TracksPrefs {
  /** Linkage master switch (observed ON by default, §1). */
  linkage: boolean;
  /** Linkage settings -> Overlay video kind (observed OFF by default, §1 / A1). */
  linkageOverlay: boolean;
  /** Auto snapping switch (observed ON by default, §1). */
  snap: boolean;
}

export function parseTracksPrefs(raw: unknown): TracksPrefs {
  const defaults = p10DefaultTrackToggles();
  if (!raw || typeof raw !== 'object') return defaults;
  const obj = raw as Record<string, unknown>;
  return {
    linkage: typeof obj.linkage === 'boolean' ? obj.linkage : defaults.linkage,
    linkageOverlay: typeof obj.linkageOverlay === 'boolean' ? obj.linkageOverlay : defaults.linkageOverlay,
    snap: typeof obj.snap === 'boolean' ? obj.snap : defaults.snap,
  };
}

export interface OverlayLink {
  /** Main-track cut id under this overlay clip's start. */
  clipId: string;
  /** Parent cut's integer source frame (`0..sourceFrames-1`) under this overlay clip's start. */
  sourceFrame: number;
}

export interface OverlayFraming {
  fit: 'fit';
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export interface OverlayClip extends FrameClip {
  /** Timeline start frame (integer >= 0). Derived from `link` during main-track reconciliation when linked. */
  startFrame: number;
  /** Parent cut id + parent source frame under this clip's start, or `null` when past main end / unlinked. */
  link: OverlayLink | null;
}

export interface OverlayTrack {
  id: string;
  /** Sorted by `startFrame`, strictly non-overlapping half-open intervals `[startFrame, startFrame + frames)`. */
  clips: OverlayClip[];
}

export interface ActiveOverlayLayer {
  trackId: string;
  trackIndex: number;
  clip: OverlayClip;
  offset: number;
  start: number;
  mediaFrame: number;
  sourceFrame: number;
  seekSec: number;
}

export type TrackRefusal =
  | 'track_limit'
  | 'overlay_limit'
  | 'last_main_cut'
  | 'clip_limit'
  | 'below_main'
  | 'not_found'
  | 'invalid';

export interface TrackEditOutcome {
  seq: FrameSequence;
  ok: boolean;
  refused?: TrackRefusal;
  /** Pairs `[newClipId, parentClipId]` for metadata/lineage inheritance. */
  inherit?: ReadonlyArray<readonly [string, string]>;
}

const isWhole = (value: number) => Number.isInteger(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// ── Observed movement rules P1–P10 (each isolated in one named function) ───────────────────────

// observed (A1, A2, A3)
/** P1. An overlay clip is linked to the main clip under its START (never merely overlapped clips). */
export function p1LinkTargetForStart(seq: FrameSequence, startFrame: number): OverlayLink | null {
  const whole = Math.max(0, Math.round(startFrame));
  for (const span of spansOf(seq)) {
    if (whole >= span.start && whole < span.end) {
      const { sourceFrame } = clipFrameAt(span.clip, whole - span.start, seq.fps);
      return { clipId: span.clip.id, sourceFrame };
    }
  }
  return null;
}

// observed (A2, A5, A7, A8, A9, A10)
/**
 * P2. With linkage ON (and Overlay kind checked), when an earlier main clip is deleted, shortened,
 * lengthened, or inserted, every main clip after it moves and its linked overlays move with it by the same amount.
 */
export function p2PropagateLinkedShift(
  beforeSpan: FrameSpan,
  afterSpan: FrameSpan,
  prevStartFrame: number,
  sourceFrame: number,
  fps: number,
): number {
  const unchangedParentTiming =
    beforeSpan.clip.inFrame === afterSpan.clip.inFrame &&
    beforeSpan.clip.phase === afterSpan.clip.phase &&
    beforeSpan.clip.frames === afterSpan.clip.frames &&
    beforeSpan.clip.speedNum === afterSpan.clip.speedNum &&
    beforeSpan.clip.speedDen === afterSpan.clip.speedDen &&
    beforeSpan.clip.speedCurve === afterSpan.clip.speedCurve;
  if (unchangedParentTiming) {
    return Math.max(0, prevStartFrame + (afterSpan.start - beforeSpan.start));
  }
  const offset = findOffsetForSourceFrame(afterSpan.clip, sourceFrame, fps);
  return Math.max(0, afterSpan.start + offset);
}

// observed once (A10)
/**
 * P3. Trimming a main clip never deletes or cuts its linked overlay video:
 * - Left trim whose removed head covered the overlay's start: the overlay SLIDES to the parent clip's
 *   new start and keeps its full length (observed once in A10).
 * - Right trim or lifted parent: the overlay keeps its previous absolute start and re-links to whichever
 *   main clip is now under its start.
 */
export function p3HandleTrimmedLinkSource(
  afterSeq: FrameSequence,
  prevAbsoluteStart: number,
  trimmedParent?: { afterSpan: FrameSpan; prevSourceFrame: number; afterFirstSourceFrame: number } | null,
): { startFrame: number; link: OverlayLink | null } {
  if (trimmedParent && trimmedParent.prevSourceFrame < trimmedParent.afterFirstSourceFrame) {
    return {
      startFrame: Math.max(0, Math.round(trimmedParent.afterSpan.start)),
      link: {
        clipId: trimmedParent.afterSpan.clip.id,
        sourceFrame: trimmedParent.afterFirstSourceFrame,
      },
    };
  }
  const startFrame = Math.max(0, Math.round(prevAbsoluteStart));
  return { startFrame, link: p1LinkTargetForStart(afterSeq, startFrame) };
}

// observed (A11)
/**
 * P4. Splitting a main clip: linked overlays are never cut; each stays where it is and links to the
 * piece under its start (containing that source frame); deleting one piece deletes only overlays linked to THAT piece.
 */
export function p4ReassignLinkAfterSplit(
  afterSeq: FrameSequence,
  leftId: string,
  rightId: string,
  prevStartFrame: number,
  prevSourceFrame: number,
): OverlayLink | null {
  const spans = spansOf(afterSeq);
  const left = spans.find((s) => s.clip.id === leftId);
  const right = spans.find((s) => s.clip.id === rightId);
  const inPiece = (span: FrameSpan | undefined) => {
    if (!span || span.frames <= 0) return false;
    const first = clipFrameAt(span.clip, 0, afterSeq.fps).sourceFrame;
    const last = clipFrameAt(span.clip, span.frames - 1, afterSeq.fps).sourceFrame;
    return prevSourceFrame >= first && prevSourceFrame <= last;
  };
  const leftHas = inPiece(left);
  const rightHas = inPiece(right);
  if (left && right && leftHas && rightHas) {
    return prevStartFrame < right.start
      ? { clipId: left.clip.id, sourceFrame: prevSourceFrame }
      : { clipId: right.clip.id, sourceFrame: prevSourceFrame };
  }
  if (left && leftHas) return { clipId: left.clip.id, sourceFrame: prevSourceFrame };
  if (right && rightHas) return { clipId: right.clip.id, sourceFrame: prevSourceFrame };
  return p1LinkTargetForStart(afterSeq, prevStartFrame);
}

// observed (C4, C6)
/**
 * P5. A drop on an occupied span of an overlay video track goes to a NEW TRACK DIRECTLY ABOVE the
 * hovered track (never pushes, never overlaps, never below).
 */
export function p5ResolveOccupiedOverlayDrop(
  hoveredTrackIndex: number,
  effectiveTrackCount: number,
  maxTracks = MAX_OVERLAY_TRACKS,
): { ok: true; insertTrackIndex: number } | { ok: false; reason: 'track_limit' } {
  if (effectiveTrackCount >= maxTracks) {
    return { ok: false, reason: 'track_limit' };
  }
  return { ok: true, insertTrackIndex: clamp(hoveredTrackIndex + 1, 0, effectiveTrackCount) };
}

// observed (A5, A11, C11)
/** P6. An empty overlay track disappears at once after every command. */
export function p6PruneEmptyOverlayTracks(tracks: readonly OverlayTrack[]): OverlayTrack[] {
  return tracks.filter((track) => track.clips.length > 0);
}

// observed (B3, B4, B6, C10)
/**
 * P7.
 * - Main-track reorder (`draggedMainIndex !== null`): a neighbour swaps when the pointer crosses the
 *   midpoint that neighbour would have with the dragged clip removed and the track closed up (B4).
 * - Insert onto main (`draggedMainIndex === null`): picks the nearest cut boundary and pushes later clips right (B3, C10).
 */
export function p7MainTrackDropAndReorder(
  spans: readonly FrameSpan[],
  draggedMainIndex: number | null,
  pointerFrame: number,
): number {
  if (draggedMainIndex !== null) {
    let cursor = 0;
    let index = 0;
    for (const span of spans) {
      if (span.index === draggedMainIndex) continue;
      const closedMid = cursor + span.frames / 2;
      if (closedMid < pointerFrame) index += 1;
      cursor += span.frames;
    }
    return index;
  }
  if (spans.length === 0) return 0;
  let bestIndex = 0;
  let bestDist = Math.abs(pointerFrame - 0);
  for (let i = 0; i < spans.length; i += 1) {
    const boundary = spans[i]!.end;
    const dist = Math.abs(pointerFrame - boundary);
    if (dist < bestDist) {
      bestDist = dist;
      bestIndex = i + 1;
    }
  }
  return bestIndex;
}

export interface SnapInput {
  /** Proposed timeline start frame (when moving) or edge frame (when trimming). */
  frame: number;
  /** Length of moving clip in frames (pass `null` when trimming a single edge). */
  clipFrames: number | null;
  /** Candidate snap frames (clip edges across all tracks, playhead, and time 0). */
  targets: readonly number[];
  /** Current timeline zoom (pixels per frame). */
  pxPerFrame: number;
  /** Whether auto-snap toggle (N) is ON. */
  enabled: boolean;
  /** Previously snapped guide frame for release hysteresis (D5). */
  prevGuideFrame?: number | null;
  /** Optional override for engage threshold in px (defaults to `SNAP_ENGAGE_PX = 2`). */
  engagePx?: number;
  /** Optional override for release threshold in px (defaults to `SNAP_RELEASE_PX = 6`). */
  releasePx?: number;
}

export interface SnapResult {
  snappedFrame: number;
  guideFrame: number | null;
}

// observed (D1, D2, D3, D5 once, D6)
/**
 * P8. Both start and end edges of a dragged clip snap to clip edges on any track, the playhead, and time 0.
 * Engages at ≤ 2 px and holds until > 6 px away (hysteresis; observed once in D5).
 * No modifier key suspends snapping — the auto-snapping switch (N) is the control (D6).
 */
export function p8ComputeSnap(input: SnapInput): SnapResult {
  const base = Math.max(0, Math.round(input.frame));
  if (!input.enabled || input.pxPerFrame <= 0 || input.targets.length === 0) {
    return { snappedFrame: base, guideFrame: null };
  }
  const engagePx = input.engagePx ?? SNAP_ENGAGE_PX;
  const releasePx = Math.max(engagePx, input.releasePx ?? SNAP_RELEASE_PX);
  const edges: Array<{ edgeFrame: number; offsetToStart: number }> = [{ edgeFrame: base, offsetToStart: 0 }];
  if (input.clipFrames !== null && input.clipFrames > 0) {
    edges.push({ edgeFrame: base + input.clipFrames, offsetToStart: input.clipFrames });
  }

  // First check whether any target engages fresh within `engagePx` (nearest wins; start edge breaks ties).
  let bestFrame = base;
  let bestGuide: number | null = null;
  let bestPx = engagePx;
  for (const { edgeFrame, offsetToStart } of edges) {
    for (const rawTarget of input.targets) {
      const target = Math.round(rawTarget);
      const distPx = Math.abs(target - edgeFrame) * input.pxPerFrame;
      if (bestGuide === null ? distPx <= bestPx : distPx < bestPx) {
        const candidateStart = target - offsetToStart;
        if (candidateStart < 0) continue;
        bestPx = distPx;
        bestFrame = candidateStart;
        bestGuide = target;
      }
    }
  }
  if (bestGuide !== null) {
    return { snappedFrame: bestFrame, guideFrame: bestGuide };
  }

  // Otherwise, if already snapped to `prevGuideFrame`, hold while within `releasePx` (hysteresis, D5).
  if (input.prevGuideFrame !== null && input.prevGuideFrame !== undefined) {
    const heldTarget = Math.round(input.prevGuideFrame);
    const stillValid = input.targets.some((t) => Math.round(t) === heldTarget);
    if (stillValid) {
      let holdFrame: number | null = null;
      let holdDist = releasePx;
      for (const { edgeFrame, offsetToStart } of edges) {
        const distPx = Math.abs(heldTarget - edgeFrame) * input.pxPerFrame;
        if (holdFrame === null ? distPx <= holdDist : distPx < holdDist) {
          const candidateStart = heldTarget - offsetToStart;
          if (candidateStart < 0) continue;
          holdDist = distPx;
          holdFrame = candidateStart;
        }
      }
      if (holdFrame !== null) {
        return { snappedFrame: holdFrame, guideFrame: heldTarget };
      }
    }
  }

  return { snappedFrame: base, guideFrame: null };
}

// observed (F)
/** P9. A new overlay is drawn at 100% scale, centred, fitted inside the canvas (main shows around pillarbox/letterbox). */
export function p9DefaultOverlayFraming(): OverlayFraming {
  return { fit: 'fit', x: 0.5, y: 0.5, scale: 1, opacity: 1 };
}

// observed (§1, A1, A2)
/** P10. Default toggle states: linkage switch ON, Linkage settings -> Overlay OFF, auto snapping ON. */
export function p10DefaultTrackToggles(): TracksPrefs {
  return { linkage: true, linkageOverlay: false, snap: true };
}

// ── Queries & helpers ──────────────────────────────────────────────────────────────────────────

export const EMPTY_OVERLAY_TRACKS: readonly OverlayTrack[] = Object.freeze([]);

export function overlayTracksOf(seq: Pick<FrameSequence, 'overlayTracks'>): readonly OverlayTrack[] {
  return seq.overlayTracks && seq.overlayTracks.length > 0 ? seq.overlayTracks : EMPTY_OVERLAY_TRACKS;
}

export function allOverlayClips(seq: Pick<FrameSequence, 'overlayTracks'>): OverlayClip[] {
  if (!seq.overlayTracks || seq.overlayTracks.length === 0) return [];
  return seq.overlayTracks.flatMap((track) => track.clips);
}

export function hasOwnedOverlays(seq: Pick<FrameSequence, 'overlayTracks'>): boolean {
  if (!seq.overlayTracks || seq.overlayTracks.length === 0) return false;
  return seq.overlayTracks.some((track) => track.clips.length > 0);
}

export function overlayClipCount(seq: Pick<FrameSequence, 'overlayTracks'>): number {
  if (!seq.overlayTracks || seq.overlayTracks.length === 0) return 0;
  return seq.overlayTracks.reduce((sum, track) => sum + track.clips.length, 0);
}

/**
 * Full film length in frames (C8): max of main-track length (`totalFrames`) and the latest end frame
 * across all overlay tracks. Equals `totalFrames(seq)` when no overlay clips exist.
 */
export function filmFrames(seq: FrameSequence): number {
  const mainEnd = totalFrames(seq);
  if (!seq.overlayTracks || seq.overlayTracks.length === 0) return mainEnd;
  let end = mainEnd;
  for (const track of seq.overlayTracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.startFrame + clip.frames;
      if (clipEnd > end) end = clipEnd;
    }
  }
  return end;
}

/** Finds an overlay clip by id with its track index and clip index. */
export function findOverlayClip(
  seq: Pick<FrameSequence, 'overlayTracks'>,
  clipId: string,
): { track: OverlayTrack; trackIndex: number; clip: OverlayClip; clipIndex: number } | null {
  const tracks = overlayTracksOf(seq);
  for (let t = 0; t < tracks.length; t += 1) {
    const track = tracks[t]!;
    for (let c = 0; c < track.clips.length; c += 1) {
      const clip = track.clips[c]!;
      if (clip.id === clipId) return { track, trackIndex: t, clip, clipIndex: c };
    }
  }
  return null;
}

/** Active overlay layers at `frame`, in draw order (bottom-to-top: trackIndex 0 first, top track last). */
export function activeOverlaysAt(seq: FrameSequence, frame: number): ActiveOverlayLayer[] {
  const at = Math.max(0, Math.round(frame));
  const out: ActiveOverlayLayer[] = [];
  const tracks = overlayTracksOf(seq);
  for (let t = 0; t < tracks.length; t += 1) {
    const track = tracks[t]!;
    for (const clip of track.clips) {
      if (at >= clip.startFrame && at < clip.startFrame + clip.frames) {
        const offset = at - clip.startFrame;
        out.push({
          trackId: track.id,
          trackIndex: t,
          clip,
          offset,
          start: clip.startFrame,
          ...clipFrameAt(clip, offset, seq.fps),
        });
        break;
      }
    }
  }
  return out;
}

/** Whether a track has any overlay clip within `marginFrames` of `frame` (for C7 preview mounting). */
export function overlayTrackNearFrame(track: OverlayTrack, frame: number, marginFrames = 0): OverlayClip | null {
  const at = Math.max(0, Math.round(frame));
  for (const clip of track.clips) {
    if (at >= clip.startFrame && at < clip.startFrame + clip.frames) return clip;
  }
  if (marginFrames <= 0) return null;
  let nearest: OverlayClip | null = null;
  let bestDist = marginFrames + 1;
  for (const clip of track.clips) {
    const dist = at < clip.startFrame ? clip.startFrame - at : at - (clip.startFrame + clip.frames - 1);
    if (dist <= marginFrames && dist < bestDist) {
      bestDist = dist;
      nearest = clip;
    }
  }
  return nearest;
}

/** Half-open interval overlap check: touching edges (`aEnd === bStart`) are legal and NOT overlapping. */
export function spansOverlap(aStart: number, aFrames: number, bStart: number, bFrames: number): boolean {
  return aStart < bStart + bFrames && bStart < aStart + aFrames;
}

/** True if `[startFrame, startFrame + frames)` fits on `track` without overlapping any clip other than `ignoreClipId`. */
export function canPlaceOnOverlayTrack(
  track: OverlayTrack,
  startFrame: number,
  frames: number,
  ignoreClipId?: string,
): boolean {
  if (startFrame < 0 || frames < 1) return false;
  for (const other of track.clips) {
    if (other.id === ignoreClipId) continue;
    if (spansOverlap(startFrame, frames, other.startFrame, other.frames)) return false;
  }
  return true;
}

/** All snap target frames across every track (start + end of every clip except `excludeClipIds`), playhead, and time 0 (D1–D3). */
export function collectSnapTargets(
  seq: FrameSequence,
  playhead: number,
  options: {
    excludeClipIds?: readonly string[];
    mainSpansOverride?: readonly FrameSpan[];
    overlayTracksOverride?: readonly OverlayTrack[];
  } = {},
): number[] {
  const excluded = new Set(options.excludeClipIds ?? []);
  const targets = new Set<number>([0, Math.max(0, Math.round(playhead))]);
  const mainSpans = options.mainSpansOverride ?? spansOf(seq);
  for (const span of mainSpans) {
    if (excluded.has(span.clip.id)) continue;
    targets.add(span.start);
    targets.add(span.end);
  }
  const overlayTracks = options.overlayTracksOverride ?? overlayTracksOf(seq);
  for (const track of overlayTracks) {
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) continue;
      targets.add(clip.startFrame);
      targets.add(clip.startFrame + clip.frames);
    }
  }
  return [...targets].sort((a, b) => a - b);
}

/** First offset `0..clip.frames-1` whose `sourceFrame >= targetSourceFrame`. */
export function findOffsetForSourceFrame(clip: FrameClip, targetSourceFrame: number, fps: number): number {
  let lo = 0;
  let hi = Math.max(0, clip.frames - 1);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (clipFrameAt(clip, mid, fps).sourceFrame < targetSourceFrame) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clipContainsSourceFrame(clip: FrameClip, sourceFrame: number, fps: number): boolean {
  if (clip.frames <= 0) return false;
  const first = clipFrameAt(clip, 0, fps).sourceFrame;
  const last = clipFrameAt(clip, clip.frames - 1, fps).sourceFrame;
  return sourceFrame >= first && sourceFrame <= last;
}

/** Derives an overlay clip's integer timeline start from its link (or falls back to stored `startFrame`). */
export function deriveOverlayStart(seq: FrameSequence, clip: OverlayClip): number {
  if (!clip.link) return Math.max(0, Math.round(clip.startFrame));
  const span = spansOf(seq).find((s) => s.clip.id === clip.link!.clipId);
  if (!span) return Math.max(0, Math.round(clip.startFrame));
  if (
    clip.startFrame >= span.start &&
    clip.startFrame < span.end &&
    clipFrameAt(span.clip, clip.startFrame - span.start, seq.fps).sourceFrame === clip.link.sourceFrame
  ) {
    return clip.startFrame;
  }
  if (!clipContainsSourceFrame(span.clip, clip.link.sourceFrame, seq.fps)) {
    return Math.max(0, Math.round(clip.startFrame));
  }
  return span.start + findOffsetForSourceFrame(span.clip, clip.link.sourceFrame, seq.fps);
}

function withOverlayTracks(seq: FrameSequence, tracks: OverlayTrack[]): FrameSequence {
  const cleaned = p6PruneEmptyOverlayTracks(
    tracks.map((track) => ({
      ...track,
      clips: [...track.clips].sort((a, b) => a.startFrame - b.startFrame),
    })),
  );
  if (cleaned.length === 0) {
    if (!seq.overlayTracks || seq.overlayTracks.length === 0) return seq;
    const { overlayTracks: _dropped, ...rest } = seq;
    return rest;
  }
  return { ...seq, overlayTracks: cleaned };
}

function nextTrackId(existing: readonly OverlayTrack[]): string {
  const used = new Set(existing.map((t) => t.id));
  for (let i = 1; i <= 99; i += 1) {
    const id = `ov-${i}`;
    if (!used.has(id)) return id;
  }
  return `ov-${Date.now().toString(36)}`;
}

// ── Single-place linkage reconciliation (C1) ───────────────────────────────────────────────────

export interface ReconcileResult {
  sequence: FrameSequence;
  movedCount: number;
  deletedCount: number;
}

/**
 * Reconciles every overlay clip against a main-track change (`before` → `after`).
 * Called from ONE place: `withSequence` (`lib/brand-studio/editor-v2/model.ts`), and also
 * used by chat proposal preview/diff so proposal cards report exact moved/deleted counts.
 *
 * Guarantees (C1):
 * - Every surviving overlay clip has an integer `startFrame >= 0`.
 * - No overlay clip ever links to a missing main cut ID.
 * - No two overlay clips on the same track ever overlap.
 * - Empty overlay tracks are pruned immediately (P6).
 */
export function reconcileLinkedOverlays(
  before: FrameSequence,
  after: FrameSequence,
  linkageOn: boolean,
  inherit: ReadonlyArray<readonly [string, string]> = [],
  liftedClipIds: ReadonlySet<string> = new Set(),
): ReconcileResult {
  const sourceTracks = after.overlayTracks;
  if (!sourceTracks || sourceTracks.length === 0) {
    return { sequence: after, movedCount: 0, deletedCount: 0 };
  }

  const beforeSpans = spansOf(before);
  const afterSpans = spansOf(after);
  const beforeById = new Map(beforeSpans.map((s) => [s.clip.id, s]));
  const afterById = new Map(afterSpans.map((s) => [s.clip.id, s]));

  // Map split parent -> newly created right piece(s) from `inherit` only (no id-suffix guessing).
  const splitChildrenOf = new Map<string, string[]>();
  for (const [childId, parentId] of inherit) {
    if (afterById.has(childId) && beforeById.has(parentId)) {
      const list = splitChildrenOf.get(parentId) ?? [];
      list.push(childId);
      splitChildrenOf.set(parentId, list);
    }
  }

  const mainChanged = before.clips !== after.clips;
  let movedCount = 0;
  let deletedCount = 0;
  let anyChanged = false;

  const placedTracks: OverlayTrack[] = sourceTracks.map((t) => ({ id: t.id, clips: [] }));
  const deferredCollisions: Array<{ preferredTrackIndex: number; clip: OverlayClip }> = [];

  for (let t = 0; t < sourceTracks.length; t += 1) {
    const track = sourceTracks[t]!;
    for (const clip of track.clips) {
      // Clips just lifted in this exact command already carry their post-close startFrame and link.
      if (liftedClipIds.has(clip.id)) {
        const normalizedLink = clip.link && afterById.has(clip.link.clipId) ? clip.link : p1LinkTargetForStart(after, clip.startFrame);
        const normalized: OverlayClip =
          normalizedLink === clip.link ? clip : { ...clip, link: normalizedLink };
        if (normalized !== clip) anyChanged = true;
        placedTracks[t]!.clips.push(normalized);
        continue;
      }

      let nextStart = Math.max(0, Math.round(clip.startFrame));
      let nextLink: OverlayLink | null = clip.link;

      if (!mainChanged) {
        // Main didn't change: only guard against stale/dangling links.
        if (nextLink && !afterById.has(nextLink.clipId)) {
          nextLink = p1LinkTargetForStart(after, nextStart);
          anyChanged = true;
        }
      } else if (!linkageOn) {
        // Linkage OFF (Rows 4 & 9): overlay stays at its absolute time; refresh link without moving so no dangling id exists.
        const refreshed = p1LinkTargetForStart(after, nextStart);
        if (
          (refreshed?.clipId ?? null) !== (nextLink?.clipId ?? null) ||
          (refreshed?.sourceFrame ?? null) !== (nextLink?.sourceFrame ?? null)
        ) {
          nextLink = refreshed;
          anyChanged = true;
        }
      } else if (!nextLink) {
        // Unlinked overlay (e.g., previously past main end): stays put, link if main now reaches under its start.
        const refreshed = p1LinkTargetForStart(after, nextStart);
        if (refreshed) {
          nextLink = refreshed;
          anyChanged = true;
        }
      } else {
        const parentId = nextLink.clipId;
        const parentBefore = beforeById.get(parentId);
        const parentAfter = afterById.get(parentId);
        const splitChildren = splitChildrenOf.get(parentId) ?? [];

        if (!parentAfter && splitChildren.length === 0) {
          // Parent cut left main track.
          if (liftedClipIds.has(parentId)) {
            // Parent was lifted onto an overlay track (not deleted): keep absolute time & re-link (P3).
            const fallback = p3HandleTrimmedLinkSource(after, nextStart);
            nextStart = fallback.startFrame;
            nextLink = fallback.link;
            anyChanged = true;
          } else {
            // Row 3: parent main cut was deleted with linkage ON -> delete linked overlay!
            deletedCount += 1;
            anyChanged = true;
            continue;
          }
        } else if (splitChildren.length > 0) {
          // P4: parent was split into left (`parentId`) and right (`splitChildren[0]`) — or multi-split pieces.
          const candidateIds = [parentId, ...splitChildren].filter((id) => afterById.has(id));
          if (candidateIds.length === 0) {
            deletedCount += 1;
            anyChanged = true;
            continue;
          }
          if (candidateIds.length === 2 && afterById.has(parentId)) {
            const reassigned = p4ReassignLinkAfterSplit(after, parentId, splitChildren[0]!, nextStart, nextLink.sourceFrame);
            if (!reassigned) {
              const fallback = p3HandleTrimmedLinkSource(after, nextStart);
              nextStart = fallback.startFrame;
              nextLink = fallback.link;
              anyChanged = true;
            } else {
              const pieceSpan = afterById.get(reassigned.clipId);
              if (pieceSpan && parentBefore) {
                const movedDelta =
                  afterById.get(parentId)!.start - parentBefore.start;
                if (movedDelta !== 0) {
                  nextStart = Math.max(0, nextStart + movedDelta);
                }
              }
              nextLink = reassigned;
              anyChanged = true;
            }
          } else {
            // Multi-split or left piece removed after split (e.g., chat split+delete-piece):
            // Find whichever surviving piece contains `nextLink.sourceFrame`.
            const owner = candidateIds
              .map((id) => afterById.get(id)!)
              .find((span) => clipContainsSourceFrame(span.clip, nextLink!.sourceFrame, after.fps));
            if (!owner) {
              // The piece containing this overlay's linked source frame was removed.
              deletedCount += 1;
              anyChanged = true;
              continue;
            }
            nextStart = owner.start + findOffsetForSourceFrame(owner.clip, nextLink.sourceFrame, after.fps);
            nextLink = { clipId: owner.clip.id, sourceFrame: nextLink.sourceFrame };
            anyChanged = true;
          }
        } else if (parentAfter) {
          if (!clipContainsSourceFrame(parentAfter.clip, nextLink.sourceFrame, after.fps)) {
            // P3 (A10 observed once): left-trimmed head slides overlay to parent's new start (keeping length);
            // right-trimmed tail keeps previous absolute time and re-links to whichever main clip is now under start.
            const afterFirstSourceFrame = clipFrameAt(parentAfter.clip, 0, after.fps).sourceFrame;
            const fallback = p3HandleTrimmedLinkSource(after, nextStart, {
              afterSpan: parentAfter,
              prevSourceFrame: nextLink.sourceFrame,
              afterFirstSourceFrame,
            });
            nextStart = fallback.startFrame;
            nextLink = fallback.link;
            anyChanged = true;
          } else if (parentBefore) {
            // P2: parent exists before and after and still contains `sourceFrame`.
            nextStart = p2PropagateLinkedShift(parentBefore, parentAfter, nextStart, nextLink.sourceFrame, after.fps);
            // Refresh link sourceFrame in case parent speed/trim shifted slightly.
            const exactSrc = clipFrameAt(parentAfter.clip, clamp(nextStart - parentAfter.start, 0, parentAfter.frames - 1), after.fps).sourceFrame;
            if (exactSrc !== nextLink.sourceFrame) {
              nextLink = { clipId: parentAfter.clip.id, sourceFrame: exactSrc };
            }
          } else {
            nextStart = parentAfter.start + findOffsetForSourceFrame(parentAfter.clip, nextLink.sourceFrame, after.fps);
          }
        }
      }

      if (nextStart !== clip.startFrame) {
        movedCount += 1;
        anyChanged = true;
      }

      const updated: OverlayClip =
        nextStart === clip.startFrame &&
        (nextLink?.clipId ?? null) === (clip.link?.clipId ?? null) &&
        (nextLink?.sourceFrame ?? null) === (clip.link?.sourceFrame ?? null)
          ? clip
          : { ...clip, startFrame: nextStart, link: nextLink };

      if (canPlaceOnOverlayTrack(placedTracks[t]!, updated.startFrame, updated.frames)) {
        placedTracks[t]!.clips.push(updated);
      } else {
        deferredCollisions.push({ preferredTrackIndex: t, clip: updated });
        anyChanged = true;
      }
    }
  }

  // Resolve any collision created by a main-track move without ever dropping clips or allowing overlap.
  for (const { preferredTrackIndex, clip } of deferredCollisions) {
    let placed = false;
    // Try another existing track at the exact resolved start.
    for (let t = 0; t < placedTracks.length; t += 1) {
      if (t === preferredTrackIndex) continue;
      if (canPlaceOnOverlayTrack(placedTracks[t]!, clip.startFrame, clip.frames)) {
        placedTracks[t]!.clips.push(clip);
        placed = true;
        break;
      }
    }
    if (!placed && p6PruneEmptyOverlayTracks(placedTracks).length < MAX_OVERLAY_TRACKS) {
      const created: OverlayTrack = { id: nextTrackId(placedTracks), clips: [clip] };
      placedTracks.splice(Math.min(preferredTrackIndex + 1, placedTracks.length), 0, created);
      placed = true;
    }
    if (!placed) {
      // All tracks occupied at that span: place immediately after the blocking clip on preferred track.
      const target = placedTracks[preferredTrackIndex]!;
      const sorted = [...target.clips].sort((a, b) => a.startFrame - b.startFrame);
      let candidate = clip.startFrame;
      for (const other of sorted) {
        if (spansOverlap(candidate, clip.frames, other.startFrame, other.frames)) {
          candidate = other.startFrame + other.frames;
        }
      }
      target.clips.push({
        ...clip,
        startFrame: candidate,
        link: p1LinkTargetForStart(after, candidate),
      });
    }
  }

  const pruned = p6PruneEmptyOverlayTracks(placedTracks);
  if (!anyChanged && pruned.length === sourceTracks.length) {
    return { sequence: after, movedCount: 0, deletedCount: 0 };
  }
  return {
    sequence: withOverlayTracks(after, pruned),
    movedCount,
    deletedCount,
  };
}

// ── Track placement & drop-zone computation (UI + pure tests) ──────────────────────────────────

export interface TrackRowRect {
  kind: 'overlay' | 'main';
  /** Index in `sequence.overlayTracks` when `kind === 'overlay'` (0 = lowest above main). */
  trackIndex?: number;
  top: number;
  bottom: number;
}

export type DropTarget =
  | { kind: 'main-track'; insertIndex: number; isReorder: boolean }
  | { kind: 'overlay-row'; trackIndex: number; startFrame: number }
  | { kind: 'new-track'; insertTrackIndex: number; startFrame: number; lineY: number }
  | { kind: 'refused'; reason: 'track_limit' | 'last_main_cut' | 'below_main' };

export interface ComputeDropTargetInput {
  sequence: FrameSequence;
  /** Which clip is being dragged: main index OR overlay clip id. */
  source: { kind: 'main'; index: number } | { kind: 'overlay'; clipId: string; trackIndex: number };
  /** Pointer Y in client coordinates. */
  clientY: number;
  /** Proposed timeline start frame (after snapping). */
  dropFrame: number;
  /** Raw pointer frame for overlay -> main insertion boundary selection (S2; defaults to `dropFrame`). */
  pointerFrame?: number;
  /** Whether linked overlays move when closing the main-track gap on lift (S1; defaults to `false`). */
  linkage?: boolean;
  /** Visual track rows sorted top-to-bottom (`overlay[top..0]`, then `main`). */
  rows: readonly TrackRowRect[];
  /** Main lane bounding top/bottom (for hysteresis when lifting from main). */
  mainRow: { top: number; bottom: number };
}

/**
 * Preview of overlay track positions after closing the gap left by lifting `seq.clips[mainIndex]` (S1).
 * Uses `liftedClipIds` so overlays previously linked to the lifted cut stay at their time (P3) while
 * overlays linked to subsequent cuts shift left when `linkageOn` is true.
 */
export function tracksAfterClosingMain(
  seq: FrameSequence,
  mainIndex: number,
  linkageOn: boolean,
): { closedMainSeq: FrameSequence; tracks: readonly OverlayTrack[] } {
  const lifted = seq.clips[mainIndex];
  const nextClips = seq.clips.filter((_, i) => i !== mainIndex);
  const closedMainSeq: FrameSequence = { ...seq, clips: nextClips };
  if (!lifted || overlayTracksOf(seq).length === 0) {
    return { closedMainSeq, tracks: overlayTracksOf(seq) };
  }
  const reconciled = reconcileLinkedOverlays(seq, closedMainSeq, linkageOn, [], new Set([lifted.id])).sequence;
  return { closedMainSeq, tracks: overlayTracksOf(reconciled) };
}

/**
 * Pure pointer-Y + frame -> drop target decision (Spec §2, §12 rows 18–23, §13).
 * - Horizontal drop line is drawn ONLY when `result.kind === 'new-track'`.
 * - Otherwise the ghost sits inside the target row (`overlay-row` or `main-track`).
 * - Video dropped anywhere below the main track is refused (`below_main`, W4).
 */
export function computeDropTarget(input: ComputeDropTargetInput): DropTarget {
  const { sequence, source, clientY, rows, mainRow } = input;
  const rawTracks = overlayTracksOf(sequence);
  const startFrame = Math.max(0, Math.round(input.dropFrame));
  const pointerFrame = Math.max(0, Math.round(input.pointerFrame ?? startFrame));

  const draggedClip: FrameClip | undefined =
    source.kind === 'main'
      ? sequence.clips[source.index]
      : rawTracks[source.trackIndex]?.clips.find((c) => c.id === source.clipId);
  if (!draggedClip) {
    return { kind: 'main-track', insertIndex: 0, isReorder: false };
  }

  // Main clip stays in horizontal reorder within the vertical tolerance band (16px above or below main; C2 + S4).
  // Only refuse main cuts dragged clearly past the bottom tolerance (or overlay sources dropped below main, W4).
  if (source.kind === 'main') {
    if (clientY >= mainRow.top - TRACK_LIFT_HYSTERESIS_PX && clientY <= mainRow.bottom + TRACK_LIFT_HYSTERESIS_PX) {
      const insertIndex = p7MainTrackDropAndReorder(spansOf(sequence), source.index, pointerFrame);
      return { kind: 'main-track', insertIndex, isReorder: true };
    }
    if (clientY > mainRow.bottom + TRACK_LIFT_HYSTERESIS_PX) {
      return { kind: 'refused', reason: 'below_main' };
    }
    if (sequence.clips.length <= 1) {
      return { kind: 'refused', reason: 'last_main_cut' };
    }
  }

  // W4: overlay video dropped anywhere below the main track (e.g., caption lane) is refused.
  if (clientY > mainRow.bottom) {
    return { kind: 'refused', reason: 'below_main' };
  }

  // Overlay dragged onto the main track row: insert at the boundary the pointer picks (S2, observed rule 8).
  if (clientY >= mainRow.top) {
    const insertIndex = p7MainTrackDropAndReorder(spansOf(sequence), null, pointerFrame);
    return { kind: 'main-track', insertIndex, isReorder: false };
  }

  // S1: when lifting a main cut, check free space against overlay positions AFTER closing the main gap.
  const tracks =
    source.kind === 'main'
      ? tracksAfterClosingMain(sequence, source.index, Boolean(input.linkage)).tracks
      : rawTracks;

  // Effective track count accounts for P6 pruning when the dragged clip is the sole clip on its overlay track.
  const sourceTrackAlone =
    source.kind === 'overlay' && (tracks[source.trackIndex]?.clips.length ?? 0) <= 1;
  const effectiveTrackCount = sourceTrackAlone ? Math.max(0, tracks.length - 1) : tracks.length;

  const overlayRowsTopToBottom = rows.filter((r): r is TrackRowRect & { kind: 'overlay'; trackIndex: number } => r.kind === 'overlay' && r.trackIndex !== undefined);

  // No existing overlay rows: pointer above main creates track 0.
  if (overlayRowsTopToBottom.length === 0) {
    if (effectiveTrackCount >= MAX_OVERLAY_TRACKS) {
      return { kind: 'refused', reason: 'track_limit' };
    }
    return { kind: 'new-track', insertTrackIndex: 0, startFrame, lineY: mainRow.top };
  }

  const topRow = overlayRowsTopToBottom[0]!;
  // Pointer in blank area above the highest overlay track -> new track at top.
  if (clientY < topRow.top) {
    if (effectiveTrackCount >= MAX_OVERLAY_TRACKS) {
      return { kind: 'refused', reason: 'track_limit' };
    }
    return { kind: 'new-track', insertTrackIndex: tracks.length, startFrame, lineY: topRow.top };
  }

  // Walk overlay rows top-to-bottom: check inside row vs gap below row.
  for (let i = 0; i < overlayRowsTopToBottom.length; i += 1) {
    const row = overlayRowsTopToBottom[i]!;
    if (clientY >= row.top && clientY <= row.bottom) {
      const track = tracks[row.trackIndex];
      const ignoreId = source.kind === 'overlay' ? source.clipId : undefined;
      if (track && canPlaceOnOverlayTrack(track, startFrame, draggedClip.frames, ignoreId)) {
        return { kind: 'overlay-row', trackIndex: row.trackIndex, startFrame };
      }
      const decision = p5ResolveOccupiedOverlayDrop(row.trackIndex, effectiveTrackCount, MAX_OVERLAY_TRACKS);
      if (!decision.ok) {
        return { kind: 'refused', reason: decision.reason };
      }
      // C4: occupied overlay video span ALWAYS goes to a new track directly ABOVE the hovered row.
      return {
        kind: 'new-track',
        insertTrackIndex: row.trackIndex + 1,
        startFrame,
        lineY: row.top,
      };
    }

    // Check gap between this overlay row and the next row (either lower overlay row or main).
    const nextRowTop = i + 1 < overlayRowsTopToBottom.length ? overlayRowsTopToBottom[i + 1]!.top : mainRow.top;
    if (clientY > row.bottom && clientY < nextRowTop) {
      if (effectiveTrackCount >= MAX_OVERLAY_TRACKS) {
        return { kind: 'refused', reason: 'track_limit' };
      }
      return {
        kind: 'new-track',
        insertTrackIndex: row.trackIndex,
        startFrame,
        lineY: (row.bottom + nextRowTop) / 2,
      };
    }
  }

  // Fallback directly above main.
  if (effectiveTrackCount >= MAX_OVERLAY_TRACKS) {
    return { kind: 'refused', reason: 'track_limit' };
  }
  return { kind: 'new-track', insertTrackIndex: 0, startFrame, lineY: mainRow.top };
}

// ── Track & overlay clip commands ──────────────────────────────────────────────────────────────

function toOverlayClip(clip: FrameClip, startFrame: number, link: OverlayLink | null): OverlayClip {
  const { startFrame: _s, link: _l, ...frameClip } = clip as OverlayClip;
  return {
    ...frameClip,
    startFrame: Math.max(0, Math.round(startFrame)),
    link,
  };
}

function toMainClip(clip: OverlayClip): FrameClip {
  const { startFrame: _s, link: _l, ...frameClip } = clip;
  return frameClip;
}

export interface TrackLiftOptions {
  /** Whether linked overlays move when closing the main-track gap (S1; defaults to `false`). */
  linkage?: boolean;
  /** Remaining owned-overlay slots after accounting for legacy stored overlays (B3; defaults to `MAX_OVERLAY_CLIPS`). */
  maxOwnedOverlays?: number;
}

/**
 * Lifts a main-track cut onto an overlay track (existing row or newly created track).
 * C2: closes the main-track gap first; `dropFrame` is measured on the closed main track;
 * refuses lifting the last remaining main cut.
 * S1: checks free space against overlay positions AFTER closing the gap (without double-shifting
 * existing overlay clips, which `withSequence` reconciles once on commit).
 * B3: counts total stored overlays (`maxOwnedOverlays`) so saving can never silently drop clips.
 */
export function liftMainCutToOverlay(
  seq: FrameSequence,
  mainIndex: number,
  target: { kind: 'overlay-row'; trackIndex: number } | { kind: 'new-track'; insertTrackIndex: number },
  dropFrame: number,
  options: TrackLiftOptions = {},
): TrackEditOutcome {
  if (mainIndex < 0 || mainIndex >= seq.clips.length) return { seq, ok: false, refused: 'not_found' };
  if (seq.clips.length <= 1) return { seq, ok: false, refused: 'last_main_cut' };
  const maxOwned = options.maxOwnedOverlays ?? MAX_OVERLAY_CLIPS;
  if (overlayClipCount(seq) >= maxOwned) return { seq, ok: false, refused: 'overlay_limit' };

  const tracks = overlayTracksOf(seq).map((t) => ({ ...t, clips: [...t.clips] }));
  const lifted = seq.clips[mainIndex]!;
  const startFrame = Math.max(0, Math.round(dropFrame));

  // Close the gap on main FIRST (C2) and inspect post-close overlay positions for occupancy (S1).
  const { closedMainSeq, tracks: adjustedTracks } = tracksAfterClosingMain(seq, mainIndex, Boolean(options.linkage));
  const link = p1LinkTargetForStart(closedMainSeq, startFrame);
  const overlayClip = toOverlayClip(lifted, startFrame, link);

  if (target.kind === 'overlay-row') {
    const adjustedDest = adjustedTracks[target.trackIndex];
    const rawDest = adjustedDest ? tracks.find((t) => t.id === adjustedDest.id) : tracks[target.trackIndex];
    if (!adjustedDest || !rawDest || !canPlaceOnOverlayTrack(adjustedDest, startFrame, overlayClip.frames)) {
      // Fallback via P5 (new track directly above hovered) if occupied in post-close layout.
      const decision = p5ResolveOccupiedOverlayDrop(
        clamp(target.trackIndex, 0, Math.max(0, tracks.length - 1)),
        tracks.length,
        MAX_OVERLAY_TRACKS,
      );
      if (!decision.ok) return { seq, ok: false, refused: decision.reason };
      tracks.splice(decision.insertTrackIndex, 0, { id: nextTrackId(tracks), clips: [overlayClip] });
    } else {
      rawDest.clips.push(overlayClip);
    }
  } else {
    if (tracks.length >= MAX_OVERLAY_TRACKS) return { seq, ok: false, refused: 'track_limit' };
    const insertAt = clamp(target.insertTrackIndex, 0, tracks.length);
    tracks.splice(insertAt, 0, { id: nextTrackId(tracks), clips: [overlayClip] });
  }

  return { seq: withOverlayTracks(closedMainSeq, tracks), ok: true };
}

/**
 * Drops an overlay clip back onto the main track at `insertIndex` (packed/magnetic).
 * Empty source overlay track disappears immediately (P6).
 */
export function dropOverlayToMain(
  seq: FrameSequence,
  clipId: string,
  insertIndex: number,
  maxMainClips = 24,
): TrackEditOutcome {
  const found = findOverlayClip(seq, clipId);
  if (!found) return { seq, ok: false, refused: 'not_found' };
  if (seq.clips.length >= maxMainClips) return { seq, ok: false, refused: 'clip_limit' };

  const tracks = overlayTracksOf(seq).map((t, idx) =>
    idx === found.trackIndex ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t,
  );
  const nextClips = [...seq.clips];
  nextClips.splice(clamp(Math.round(insertIndex), 0, nextClips.length), 0, toMainClip(found.clip));
  return { seq: withOverlayTracks({ ...seq, clips: nextClips }, tracks), ok: true };
}

/**
 * Moves an overlay clip to a new start frame and/or track (existing row or newly created track).
 * Re-links to the main clip under its new start (P1). Prunes empty overlay tracks (P6).
 * One-way: never touches the main track.
 */
export function moveOverlayClip(
  seq: FrameSequence,
  clipId: string,
  target: { kind: 'overlay-row'; trackIndex: number } | { kind: 'new-track'; insertTrackIndex: number },
  startFrame: number,
): TrackEditOutcome {
  const found = findOverlayClip(seq, clipId);
  if (!found) return { seq, ok: false, refused: 'not_found' };

  const wholeStart = Math.max(0, Math.round(startFrame));
  const rawTracks = overlayTracksOf(seq).map((t) => ({ ...t, clips: [...t.clips] }));
  const sourceAlone = rawTracks[found.trackIndex]!.clips.length <= 1;
  const effectiveTrackCount = sourceAlone ? Math.max(0, rawTracks.length - 1) : rawTracks.length;

  const moved: OverlayClip = {
    ...found.clip,
    startFrame: wholeStart,
    link: p1LinkTargetForStart(seq, wholeStart),
  };

  // Remove from source first.
  rawTracks[found.trackIndex]!.clips = rawTracks[found.trackIndex]!.clips.filter((c) => c.id !== clipId);

  if (target.kind === 'overlay-row') {
    const dest = rawTracks[target.trackIndex];
    if (!dest) return { seq, ok: false, refused: 'not_found' };
    if (!canPlaceOnOverlayTrack(dest, wholeStart, moved.frames)) {
      const decision = p5ResolveOccupiedOverlayDrop(target.trackIndex, effectiveTrackCount, MAX_OVERLAY_TRACKS);
      if (!decision.ok) return { seq, ok: false, refused: decision.reason };
      rawTracks.splice(target.trackIndex + 1, 0, { id: nextTrackId(rawTracks), clips: [moved] });
    } else {
      dest.clips.push(moved);
    }
  } else {
    if (effectiveTrackCount >= MAX_OVERLAY_TRACKS) return { seq, ok: false, refused: 'track_limit' };
    const insertAt = clamp(target.insertTrackIndex, 0, rawTracks.length);
    rawTracks.splice(insertAt, 0, { id: nextTrackId(rawTracks), clips: [moved] });
  }

  return { seq: withOverlayTracks(seq, rawTracks), ok: true };
}

/**
 * Returns `true` when `위 트랙으로` (`moveClipUpOneTrack`) can move `clipId` to a higher track (W10):
 * - Main clip: >1 main clips, under shared overlay cap, and either track 0 has free space (post-close) or room for a new track (< MAX_OVERLAY_TRACKS).
 * - Overlay clip on track `k`: either a track above exists (with free space or room to insert above under cap),
 *   OR it sits on the top track alongside another clip with room for a new track above (< MAX_OVERLAY_TRACKS).
 *   A lone clip already on the top track cannot move higher because creating a track above would immediately prune its empty row (P6).
 */
export function canMoveClipUpOneTrack(
  seq: FrameSequence,
  clipId: string,
  options: TrackLiftOptions = {},
): boolean {
  const mainIndex = seq.clips.findIndex((c) => c.id === clipId);
  if (mainIndex >= 0) {
    if (seq.clips.length <= 1) return false;
    const maxOwned = options.maxOwnedOverlays ?? MAX_OVERLAY_CLIPS;
    if (overlayClipCount(seq) >= maxOwned) return false;
    const spans = spansOf(seq);
    const prevSpan = spans[mainIndex]!;
    const closedMainEnd = totalFrames(seq) - prevSpan.frames;
    const dropFrame = Math.min(prevSpan.start, closedMainEnd);
    const { tracks } = tracksAfterClosingMain(seq, mainIndex, Boolean(options.linkage));
    if (tracks.length > 0 && canPlaceOnOverlayTrack(tracks[0]!, dropFrame, prevSpan.frames)) return true;
    return tracks.length < MAX_OVERLAY_TRACKS;
  }

  const found = findOverlayClip(seq, clipId);
  if (!found) return false;
  const tracks = overlayTracksOf(seq);
  const sourceAlone = tracks[found.trackIndex]!.clips.length <= 1;
  const effectiveTrackCount = sourceAlone ? Math.max(0, tracks.length - 1) : tracks.length;
  const nextIndex = found.trackIndex + 1;
  if (nextIndex < tracks.length) {
    if (canPlaceOnOverlayTrack(tracks[nextIndex]!, found.clip.startFrame, found.clip.frames)) return true;
    return effectiveTrackCount < MAX_OVERLAY_TRACKS;
  }
  return !sourceAlone && tracks.length < MAX_OVERLAY_TRACKS;
}

/**
 * Moves a selected clip up one track (`위 트랙으로`) without dragging:
 * - Main clip -> lifts onto overlay track 0 (if free at post-close position) else new track above.
 * - Overlay clip on track `k` -> moves to track `k + 1` (if exists & free) else creates track above (up to cap 3).
 */
export function moveClipUpOneTrack(
  seq: FrameSequence,
  clipId: string,
  options: TrackLiftOptions = {},
): TrackEditOutcome {
  const mainIndex = seq.clips.findIndex((c) => c.id === clipId);
  if (mainIndex >= 0) {
    if (seq.clips.length <= 1) return { seq, ok: false, refused: 'last_main_cut' };
    const maxOwned = options.maxOwnedOverlays ?? MAX_OVERLAY_CLIPS;
    if (overlayClipCount(seq) >= maxOwned) return { seq, ok: false, refused: 'overlay_limit' };
    const spans = spansOf(seq);
    const prevSpan = spans[mainIndex]!;
    // C2: close gap first; place at same frame clamped to closed timeline (at least `prevSpan.start` works as free position).
    const closedMainEnd = totalFrames(seq) - prevSpan.frames;
    const dropFrame = Math.min(prevSpan.start, closedMainEnd);
    const { tracks } = tracksAfterClosingMain(seq, mainIndex, Boolean(options.linkage));
    if (tracks.length > 0 && canPlaceOnOverlayTrack(tracks[0]!, dropFrame, prevSpan.frames)) {
      return liftMainCutToOverlay(seq, mainIndex, { kind: 'overlay-row', trackIndex: 0 }, dropFrame, options);
    }
    return liftMainCutToOverlay(seq, mainIndex, { kind: 'new-track', insertTrackIndex: 0 }, dropFrame, options);
  }

  const found = findOverlayClip(seq, clipId);
  if (!found) return { seq, ok: false, refused: 'not_found' };
  const tracks = overlayTracksOf(seq);
  const sourceAlone = tracks[found.trackIndex]!.clips.length <= 1;
  const nextIndex = found.trackIndex + 1;
  if (nextIndex < tracks.length) {
    if (canPlaceOnOverlayTrack(tracks[nextIndex]!, found.clip.startFrame, found.clip.frames)) {
      return moveOverlayClip(seq, clipId, { kind: 'overlay-row', trackIndex: nextIndex }, found.clip.startFrame);
    }
    return moveOverlayClip(seq, clipId, { kind: 'new-track', insertTrackIndex: nextIndex }, found.clip.startFrame);
  }
  if (sourceAlone) {
    return { seq, ok: false, refused: tracks.length >= MAX_OVERLAY_TRACKS ? 'track_limit' : 'invalid' };
  }
  return moveOverlayClip(seq, clipId, { kind: 'new-track', insertTrackIndex: tracks.length }, found.clip.startFrame);
}

/**
 * Moves a selected clip down one track (`아래 트랙으로`) without dragging:
 * - Overlay clip on track `0` -> drops onto main track at nearest cut boundary (P7).
 * - Overlay clip on track `k > 0` -> moves to track `k - 1` (if free) else new track between `k-1` and `k`.
 * - Main clip -> no-op (video can never go below main).
 */
export function moveClipDownOneTrack(seq: FrameSequence, clipId: string, maxMainClips = 24): TrackEditOutcome {
  const found = findOverlayClip(seq, clipId);
  if (!found) return { seq, ok: false, refused: 'not_found' };
  if (found.trackIndex === 0) {
    const insertIndex = p7MainTrackDropAndReorder(spansOf(seq), null, found.clip.startFrame);
    return dropOverlayToMain(seq, clipId, insertIndex, maxMainClips);
  }
  const tracks = overlayTracksOf(seq);
  const lowerIndex = found.trackIndex - 1;
  if (canPlaceOnOverlayTrack(tracks[lowerIndex]!, found.clip.startFrame, found.clip.frames)) {
    return moveOverlayClip(seq, clipId, { kind: 'overlay-row', trackIndex: lowerIndex }, found.clip.startFrame);
  }
  return moveOverlayClip(seq, clipId, { kind: 'new-track', insertTrackIndex: lowerIndex }, found.clip.startFrame);
}

/** Moves a clip's media position by `delta` timeline frames, carrying the speed cycle. */
function shiftedMedia(clip: FrameClip, delta: number): Pick<FrameClip, 'inFrame' | 'phase'> {
  const position = clip.inFrame * clip.speedDen + clip.phase + delta * clip.speedNum;
  return { inFrame: Math.floor(position / clip.speedDen), phase: ((position % clip.speedDen) + clip.speedDen) % clip.speedDen };
}

/**
 * Trims one edge of an overlay clip by `delta` timeline frames.
 * Bounded by: neighbours on its track (no overlap; touching edges legal), source footage length,
 * timeline start >= 0, and minimum length 1 frame. Never ripples other clips on its track.
 */
export function trimOverlayEdge(
  seq: FrameSequence,
  clipId: string,
  edge: 'start' | 'end',
  delta: number,
): { seq: FrameSequence; applied: number } {
  const found = findOverlayClip(seq, clipId);
  if (!found) return { seq, applied: 0 };
  const { track, trackIndex, clip, clipIndex } = found;
  let applied = Math.round(delta);
  if (applied === 0) return { seq, applied: 0 };

  const prevNeighbourEnd = clipIndex > 0 ? track.clips[clipIndex - 1]!.startFrame + track.clips[clipIndex - 1]!.frames : 0;
  const nextNeighbourStart = clipIndex + 1 < track.clips.length ? track.clips[clipIndex + 1]!.startFrame : Infinity;

  const { mediaSpan: _dropSpan, ...cleanClip } = clip;

  if (cleanClip.speedCurve) {
    // Clamp wanted delta to neighbour bounds first.
    let bounded = applied;
    if (edge === 'start') {
      const minDelta = prevNeighbourEnd - clip.startFrame;
      bounded = clamp(bounded, minDelta, clip.frames - 1);
    } else {
      const maxDelta = Number.isFinite(nextNeighbourStart) ? nextNeighbourStart - (clip.startFrame + clip.frames) : Infinity;
      bounded = clamp(bounded, 1 - clip.frames, maxDelta);
    }
    const res = trimWindowedCurveEdge(cleanClip.speedCurve, edge, bounded, mediaFramesOf(cleanClip, seq.fps));
    if (res.applied === 0) return { seq, applied: 0 };
    const nextStart = edge === 'start' ? clip.startFrame + res.applied : clip.startFrame;
    const nextClip: OverlayClip = {
      ...cleanClip,
      startFrame: nextStart,
      link: p1LinkTargetForStart(seq, nextStart),
      inFrame: Math.max(0, Math.floor(curveStartMedia(res.curve) + 1e-9)),
      phase: 0,
      frames: curveTotalFrames(res.curve),
      speedCurve: res.curve,
    };
    const tracks = overlayTracksOf(seq).map((t, idx) =>
      idx === trackIndex ? { ...t, clips: t.clips.map((c, ci) => (ci === clipIndex ? nextClip : c)) } : t,
    );
    return { seq: withOverlayTracks(seq, tracks), applied: res.applied };
  }

  if (edge === 'start') {
    const sourceBack = Math.floor((cleanClip.inFrame * cleanClip.speedDen + cleanClip.phase) / cleanClip.speedNum);
    const trackBack = clip.startFrame - prevNeighbourEnd;
    const maxBack = Math.min(sourceBack, trackBack);
    applied = clamp(applied, -maxBack, cleanClip.frames - 1);
  } else {
    const sourceForward = clipMaxFrames(cleanClip, seq.fps) - cleanClip.frames;
    const trackForward = Number.isFinite(nextNeighbourStart) ? nextNeighbourStart - (clip.startFrame + clip.frames) : Infinity;
    const maxForward = Math.min(sourceForward, trackForward);
    applied = clamp(applied, 1 - cleanClip.frames, maxForward);
  }

  if (applied === 0) return { seq, applied: 0 };
  const nextStart = edge === 'start' ? clip.startFrame + applied : clip.startFrame;
  const nextClip: OverlayClip =
    edge === 'start'
      ? {
          ...cleanClip,
          startFrame: nextStart,
          link: p1LinkTargetForStart(seq, nextStart),
          ...shiftedMedia(cleanClip, applied),
          frames: cleanClip.frames - applied,
        }
      : { ...cleanClip, frames: cleanClip.frames + applied };

  const tracks = overlayTracksOf(seq).map((t, idx) =>
    idx === trackIndex ? { ...t, clips: t.clips.map((c, ci) => (ci === clipIndex ? nextClip : c)) } : t,
  );
  return { seq: withOverlayTracks(seq, tracks), applied };
}

/** Splits one overlay clip at `frame`. Right piece takes `newId` and sits at `frame`. */
export function splitOverlayAtFrame(
  seq: FrameSequence,
  clipId: string,
  frame: number,
  newId: string,
  maxOwnedOverlays = MAX_OVERLAY_CLIPS,
): TrackEditOutcome {
  if (!isWhole(frame)) return { seq, ok: false, refused: 'invalid' };
  const found = findOverlayClip(seq, clipId);
  if (!found) return { seq, ok: false, refused: 'not_found' };
  if (overlayClipCount(seq) >= maxOwnedOverlays) return { seq, ok: false, refused: 'overlay_limit' };

  const { trackIndex, clip, clipIndex } = found;
  if (frame <= clip.startFrame || frame >= clip.startFrame + clip.frames) {
    return { seq, ok: false, refused: 'invalid' };
  }
  const offset = frame - clip.startFrame;
  const { mediaSpan: _dropSpan, ...cleanClip } = clip;
  let left: OverlayClip;
  let right: OverlayClip;

  if (cleanClip.speedCurve) {
    const split = splitWindowedCurve(cleanClip.speedCurve, offset);
    if (!split) return { seq, ok: false, refused: 'invalid' };
    left = {
      ...cleanClip,
      inFrame: Math.max(0, Math.floor(curveStartMedia(split.left) + 1e-9)),
      frames: offset,
      speedCurve: split.left,
    };
    right = {
      ...cleanClip,
      id: newId,
      startFrame: frame,
      link: p1LinkTargetForStart(seq, frame),
      inFrame: Math.max(0, Math.floor(curveStartMedia(split.right) + 1e-9)),
      phase: 0,
      frames: cleanClip.frames - offset,
      speedNum: 1,
      speedDen: 1,
      speedCurve: split.right,
    };
  } else {
    left = { ...cleanClip, frames: offset };
    right = {
      ...cleanClip,
      id: newId,
      startFrame: frame,
      link: p1LinkTargetForStart(seq, frame),
      ...shiftedMedia(cleanClip, offset),
      frames: cleanClip.frames - offset,
    };
  }

  const tracks = overlayTracksOf(seq).map((t, idx) => {
    if (idx !== trackIndex) return t;
    const clips = [...t.clips];
    clips.splice(clipIndex, 1, left, right);
    return { ...t, clips };
  });
  return { seq: withOverlayTracks(seq, tracks), ok: true, inherit: [[newId, clip.id]] };
}

/**
 * Splits EVERY track (main + every overlay track) that has a clip spanning `frame` (strictly inside).
 * Returns `{ seq, ok, inherit }` where `inherit` lists every `[rightId, leftId]` pair created.
 */
export function splitAllTracksAtFrame(
  seq: FrameSequence,
  frame: number,
  makeId: () => string,
  maxMainClips = 24,
  maxOwnedOverlays = MAX_OVERLAY_CLIPS,
): TrackEditOutcome {
  if (!isWhole(frame)) return { seq, ok: false, refused: 'invalid' };
  let working = seq;
  const inherit: Array<readonly [string, string]> = [];
  let didSplit = false;

  // 1. Main track
  const mainSpan = spansOf(working).find((s) => frame > s.start && frame < s.end);
  if (mainSpan && working.clips.length < maxMainClips) {
    const newMainId = makeId();
    const offset = frame - mainSpan.start;
    const { mediaSpan: _dropSpan, ...clean } = mainSpan.clip;
    let left: FrameClip | null = null;
    let right: FrameClip | null = null;
    if (clean.speedCurve) {
      const split = splitWindowedCurve(clean.speedCurve, offset);
      if (split) {
        left = { ...clean, inFrame: Math.max(0, Math.floor(curveStartMedia(split.left) + 1e-9)), frames: offset, speedCurve: split.left };
        right = {
          ...clean,
          id: newMainId,
          inFrame: Math.max(0, Math.floor(curveStartMedia(split.right) + 1e-9)),
          phase: 0,
          frames: clean.frames - offset,
          speedNum: 1,
          speedDen: 1,
          speedCurve: split.right,
        };
      }
    } else {
      left = { ...clean, frames: offset };
      right = { ...clean, id: newMainId, ...shiftedMedia(clean, offset), frames: clean.frames - offset };
    }
    if (left && right) {
      const clips = [...working.clips];
      clips.splice(mainSpan.index, 1, left, right);
      working = { ...working, clips };
      inherit.push([newMainId, mainSpan.clip.id]);
      didSplit = true;
    }
  }

  // 2. Every overlay track
  const overlayIdsToSplit = overlayTracksOf(working)
    .flatMap((t) => t.clips)
    .filter((c) => frame > c.startFrame && frame < c.startFrame + c.frames)
    .map((c) => c.id);

  let overlayLimitHit = false;
  for (const ovId of overlayIdsToSplit) {
    if (overlayClipCount(working) >= maxOwnedOverlays) {
      overlayLimitHit = true;
      break;
    }
    const res = splitOverlayAtFrame(working, ovId, frame, makeId(), maxOwnedOverlays);
    if (res.ok) {
      working = res.seq;
      if (res.inherit) inherit.push(...res.inherit);
      didSplit = true;
    } else if (res.refused === 'overlay_limit') {
      overlayLimitHit = true;
    }
  }

  if (!didSplit) return { seq, ok: false, refused: overlayLimitHit ? 'overlay_limit' : 'invalid' };
  return { seq: working, ok: true, inherit };
}

/**
 * Removes overlay clips by id. No ripple: other clips on that track keep their exact startFrame.
 * Empty overlay tracks disappear immediately (P6). One-way: never touches the main track.
 */
export function removeOverlayClips(seq: FrameSequence, ids: readonly string[]): FrameSequence {
  const tracks = overlayTracksOf(seq);
  if (tracks.length === 0 || ids.length === 0) return seq;
  const idSet = new Set(ids);
  let removed = false;
  const next = tracks.map((track) => {
    const kept = track.clips.filter((c) => {
      if (idSet.has(c.id)) {
        removed = true;
        return false;
      }
      return true;
    });
    return kept.length === track.clips.length ? track : { ...track, clips: kept };
  });
  return removed ? withOverlayTracks(seq, next) : seq;
}

/** Sets an overlay clip's constant speed (clamped so it never overlaps the next clip on its track). */
export function setOverlaySpeed(
  seq: FrameSequence,
  clipId: string,
  speedNum: number,
  speedDen: number,
): FrameSequence {
  const found = findOverlayClip(seq, clipId);
  if (!found || !isWhole(speedNum) || !isWhole(speedDen) || speedNum < 1 || speedDen < 1) return seq;
  const { track, trackIndex, clip, clipIndex } = found;
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
    const covered = Math.ceil((baseClip.phase + baseClip.frames * baseClip.speedNum) / baseClip.speedDen);
    baseNum = Math.max(1, covered);
    baseDen = 1;
  }

  const nextNeighbourStart = clipIndex + 1 < track.clips.length ? track.clips[clipIndex + 1]!.startFrame : Infinity;
  const trackMaxFrames = Number.isFinite(nextNeighbourStart) ? Math.max(1, nextNeighbourStart - clip.startFrame) : Infinity;

  const retimed: OverlayClip = { ...baseClip, inFrame, phase: 0, speedNum, speedDen, frames: 1 };
  const maxAllowed = Math.min(clipMaxFrames(retimed, seq.fps), trackMaxFrames);
  const targetFrames = Math.round((baseNum * speedDen) / (baseDen * speedNum));
  retimed.frames = clamp(targetFrames, 1, maxAllowed);
  if (retimed.frames * speedNum * baseDen !== baseNum * speedDen || baseDen > 1) {
    retimed.mediaSpan = { num: baseNum, den: baseDen };
  }

  const tracks = overlayTracksOf(seq).map((t, idx) =>
    idx === trackIndex ? { ...t, clips: t.clips.map((c, ci) => (ci === clipIndex ? retimed : c)) } : t,
  );
  return withOverlayTracks(seq, tracks);
}

export function setOverlayConstantSpeed(seq: FrameSequence, clipId: string, speed: number): FrameSequence {
  const { num, den } = toSpeedRational(clampSpeed(speed));
  return setOverlaySpeed(seq, clipId, num, den);
}

export function applyOverlaySpeedCurve(
  seq: FrameSequence,
  clipId: string,
  points: readonly SpeedPoint[],
): { seq: FrameSequence; refused: SpeedCurveRefusal | null } {
  const found = findOverlayClip(seq, clipId);
  if (!found) return { seq, refused: null };
  if (points.length > MAX_CURVE_TOTAL_POINTS) return { seq, refused: 'point_limit' };
  const cleanPoints = normalizeCurvePoints(points);
  if (cleanPoints.length > MAX_CURVE_TOTAL_POINTS) return { seq, refused: 'point_limit' };

  const { track, trackIndex, clip, clipIndex } = found;
  const media = mediaFramesOf(clip, seq.fps);
  const startMedia = clip.speedCurve ? curveStartMedia(clip.speedCurve) : clip.inFrame + clip.phase / clip.speedDen;
  const rawSpan = clip.speedCurve
    ? curveTotalSpanMedia(clip.speedCurve)
    : clip.mediaSpan
      ? clip.mediaSpan.num / clip.mediaSpan.den
      : (clip.frames * clip.speedNum) / clip.speedDen;
  const spanMedia = Math.min(rawSpan, Math.max(1e-6, media - startMedia));
  const nextCurve: SpeedCurve = { startMedia, spanMedia: Math.max(1e-6, spanMedia), points: cleanPoints };
  if (curveRawDurationFrames(nextCurve) < 1 - 1e-6) return { seq, refused: 'too_short' };

  const nextNeighbourStart = clipIndex + 1 < track.clips.length ? track.clips[clipIndex + 1]!.startFrame : Infinity;
  const nextFrames = curveTotalFrames(nextCurve);
  if (clip.startFrame + nextFrames > nextNeighbourStart) {
    // Clamp curve by trimming end to neighbour boundary so overlay never overlaps.
    const trimDelta = nextNeighbourStart - (clip.startFrame + nextFrames);
    const trimmed = trimWindowedCurveEdge(nextCurve, 'end', trimDelta, media);
    const finalCurve = trimmed.curve;
    const finalFrames = curveTotalFrames(finalCurve);
    if (finalFrames < 1 || clip.startFrame + finalFrames > nextNeighbourStart) return { seq, refused: 'too_short' };
    const retimed: OverlayClip = {
      ...clip,
      inFrame: clamp(Math.floor(curveStartMedia(finalCurve) + 1e-9), 0, Math.max(0, media - 1)),
      phase: 0,
      speedNum: 1,
      speedDen: 1,
      frames: finalFrames,
      speedCurve: cloneSpeedCurve(finalCurve),
    };
    delete retimed.mediaSpan;
    const tracks = overlayTracksOf(seq).map((t, idx) =>
      idx === trackIndex ? { ...t, clips: t.clips.map((c, ci) => (ci === clipIndex ? retimed : c)) } : t,
    );
    return { seq: withOverlayTracks(seq, tracks), refused: null };
  }

  const retimed: OverlayClip = {
    ...clip,
    inFrame: clamp(Math.floor(startMedia + 1e-9), 0, Math.max(0, media - 1)),
    phase: 0,
    speedNum: 1,
    speedDen: 1,
    frames: nextFrames,
    speedCurve: cloneSpeedCurve(nextCurve),
  };
  const winMatchesDomain =
    !clip.speedCurve ||
    (Math.abs(curveStartMedia(clip.speedCurve) - clip.speedCurve.startMedia) <= 1e-9 &&
      Math.abs(curveEndMedia(clip.speedCurve) - (clip.speedCurve.startMedia + clip.speedCurve.spanMedia)) <= 1e-9);
  if (clip.mediaSpan && winMatchesDomain) retimed.mediaSpan = clip.mediaSpan;
  else delete retimed.mediaSpan;

  const tracks = overlayTracksOf(seq).map((t, idx) =>
    idx === trackIndex ? { ...t, clips: t.clips.map((c, ci) => (ci === clipIndex ? retimed : c)) } : t,
  );
  return { seq: withOverlayTracks(seq, tracks), refused: null };
}

export function setOverlayAudio(seq: FrameSequence, clipId: string, volume: number, muted: boolean): FrameSequence {
  const found = findOverlayClip(seq, clipId);
  if (!found) return seq;
  const { trackIndex, clip, clipIndex } = found;
  const nextVol = clamp(volume, 0, 1);
  if (nextVol === clip.volume && muted === clip.muted) return seq;
  const tracks = overlayTracksOf(seq).map((t, idx) =>
    idx === trackIndex ? { ...t, clips: t.clips.map((c, ci) => (ci === clipIndex ? { ...c, volume: nextVol, muted } : c)) } : t,
  );
  return withOverlayTracks(seq, tracks);
}

/** Validates overlay track invariants (called by `wholeFrameViolations`). */
export function overlayTrackViolations(seq: FrameSequence): string[] {
  const out: string[] = [];
  const tracks = overlayTracksOf(seq);
  const mainIds = new Set(seq.clips.map((c) => c.id));
  const seenIds = new Set<string>(mainIds);
  if (tracks.length > MAX_OVERLAY_TRACKS) out.push(`overlay track count ${tracks.length} exceeds ${MAX_OVERLAY_TRACKS}`);
  tracks.forEach((track, tIdx) => {
    if (track.clips.length === 0) out.push(`overlay track ${tIdx + 1} is empty`);
    let prevEnd = 0;
    track.clips.forEach((clip, cIdx) => {
      if (seenIds.has(clip.id)) out.push(`duplicate clip id ${clip.id}`);
      seenIds.add(clip.id);
      for (const key of ['startFrame', 'inFrame', 'phase', 'frames', 'speedNum', 'speedDen', 'sourceFrames'] as const) {
        if (!isWhole(clip[key])) out.push(`overlay ${tIdx + 1}.${cIdx + 1} ${key} ${clip[key]}`);
      }
      if (clip.startFrame < 0) out.push(`overlay ${tIdx + 1}.${cIdx + 1} starts before 0`);
      if (clip.frames < 1) out.push(`overlay ${tIdx + 1}.${cIdx + 1} is shorter than a frame`);
      if (clip.inFrame < 0) out.push(`overlay ${tIdx + 1}.${cIdx + 1} starts before its footage`);
      if (clip.speedNum < 1 || clip.speedDen < 1) out.push(`overlay ${tIdx + 1}.${cIdx + 1} speed ${clip.speedNum}/${clip.speedDen}`);
      if (clip.phase < 0 || clip.phase >= clip.speedDen) out.push(`overlay ${tIdx + 1}.${cIdx + 1} phase ${clip.phase}`);
      if (cIdx > 0 && clip.startFrame < prevEnd) out.push(`overlay ${tIdx + 1}.${cIdx + 1} overlaps previous clip`);
      prevEnd = clip.startFrame + clip.frames;
      if (clip.link) {
        if (!mainIds.has(clip.link.clipId)) out.push(`overlay ${tIdx + 1}.${cIdx + 1} links to missing main cut ${clip.link.clipId}`);
        if (!isWhole(clip.link.sourceFrame) || clip.link.sourceFrame < 0) out.push(`overlay ${tIdx + 1}.${cIdx + 1} invalid link sourceFrame ${clip.link.sourceFrame}`);
      }
      if (clip.speedCurve) {
        if (!isValidSpeedCurve(clip.speedCurve)) out.push(`overlay ${tIdx + 1}.${cIdx + 1} speedCurve is invalid`);
        else if (clip.frames !== curveTotalFrames(clip.speedCurve)) {
          out.push(`overlay ${tIdx + 1}.${cIdx + 1} frames mismatches curve`);
        }
      }
      if (isWhole(seq.fps) && clip.frames > clipMaxFrames(clip, seq.fps)) {
        out.push(`overlay ${tIdx + 1}.${cIdx + 1} runs past its footage`);
      }
    });
  });
  return out;
}
