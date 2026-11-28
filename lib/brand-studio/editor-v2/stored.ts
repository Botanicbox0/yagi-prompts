/**
 * Editing studio v2, V1 — the bridge between the film the current editor stores and the frame model
 * (docs/BRAND-EDITING-STUDIO-V2.md §5.1.1, §11 V1).
 *
 * Both editors read and write the same browser key (`composeStorageKey`), holding a `ComposerProject`
 * that counts in seconds. The current editor rounds every trim to a tenth of a second on load and writes
 * the key back at once; it drops unknown keys on the project but keeps them on each clip, and its split
 * copies them onto both halves.
 *
 * So v2 keeps its exact frames in one block on each clip, `clip.frameV2`, together with a `mirror`: the
 * seconds the clip carried when v2 wrote it, after the current editor's own normalisation
 * (`normalizeClipBounds`, the real function). On the way back:
 *
 * - block present, written at the film's rate, and the mirror still equals the clip's seconds → the
 *   current editor did not touch this cut: use the block as it is (exact frames);
 * - otherwise the current editor changed the cut (or made it): rebuild it from its seconds to the
 *   nearest frame.
 *
 * v2 owns only the aspect and the list and order of cuts (per cut: trims, speed, volume, mute and the
 * block). Everything else in the stored film is carried over untouched, the captions included (V1 does
 * not edit captions, so they are written back exactly as stored). A visit to v2 that changes nothing
 * writes back exactly the seconds that were there. Pure: no DOM, no storage.
 */
import {
  COMPOSE_ASPECTS,
  MAX_COMPOSE_CLIPS,
  MAX_COMPOSE_OVERLAYS,
  clipPlaybackRate,
  emptyComposerProject,
  normalizeClipBounds,
  normalizeOverlayClip,
  parseStoredProject,
  serializeProjectForStorage,
  type ComposeAspect,
  type ComposeClip,
  type ComposeOverlayClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { captionsOnFrames, cutAnchor, storedOverlaySeconds, storedSecToFrame, type CutAnchor } from './cut-anchor';
import { DEFAULT_FILM_FPS, snapFilmFps, sourceFramesOf } from './fps';

export { captionsOnFrames } from './cut-anchor';
import { clipMaxFrames, mediaFramesOf, type FrameClip, type FrameSequence } from './frames';
import {
  MAX_OVERLAY_TRACKS,
  deriveOverlayStart,
  hasOwnedOverlays,
  overlayTracksOf,
  p1LinkTargetForStart,
  p6PruneEmptyOverlayTracks,
  p9DefaultOverlayFraming,
  type OverlayClip,
  type OverlayLink,
  type OverlayTrack,
} from './tracks';
import {
  cloneSpeedCurve,
  curveAverageSpeed,
  curveEndMedia,
  curveRawDurationFrames,
  curveStartMedia,
  curveTotalFrames,
  isFlatCurve,
  isValidSpeedCurve,
  type SpeedCurve,
} from './speed-curve';

/** The seconds a clip carried when v2 wrote its block, after the current editor's normalisation. */
export interface FrameV2Mirror {
  trimStartSec: number;
  trimEndSec: number;
  playbackRate: number;
}

/** v2's exact frame data for one cut, kept on the stored clip (`clip.frameV2`). */
export interface FrameV2Block {
  /** The film's rate when the block was written. */
  fps: number;
  inFrame: number;
  phase: number;
  frames: number;
  speedNum: number;
  speedDen: number;
  mediaSpan?: { num: number; den: number };
  speedCurve?: SpeedCurve;
  /** Always measured: a block is never written from a guessed rate (review round 1, item 3). */
  sourceFps: number;
  sourceFrames: number;
  /**
   * The file the block describes and the footage length the clip carried when it was written (review
   * round 1, item 4): the current editor's upscale gives a clip a new file and keeps its other fields.
   * A block whose file or length is not the clip's is not used.
   */
  srcUrl: string;
  durationSec: number;
  mirror: FrameV2Mirror;
  /**
   * The cuts this one was split or copied from in v2, nearest first (at most `MAX_LINEAGE`). The new
   * cut carries the parent's stored fields (its sound offset among them); this line lets a colour grade
   * the current editor scoped to the parent cover the pieces too (export-plan.ts `storedCutFor`).
   */
  from?: string[];
}

export type StoredClip = ComposeClip & { frameV2?: FrameV2Block };

/** The seconds an overlay carried when v2 wrote its block, after `normalizeOverlayClip`. */
export interface OverlayFrameV2Mirror {
  startSec: number;
  endSec: number;
}

/** v2's exact frame data for one video overlay clip, kept on `ComposerProject.overlays[].frameV2` (C3, C4). */
export interface OverlayFrameV2Block {
  fps: number;
  /** 0 = lowest overlay track directly above main; higher index draws on top. */
  trackIndex: number;
  trackId?: string;
  startFrame: number;
  link: OverlayLink | null;
  inFrame: number;
  phase: number;
  frames: number;
  speedNum: number;
  speedDen: number;
  mediaSpan?: { num: number; den: number };
  speedCurve?: SpeedCurve;
  sourceFps: number;
  sourceFrames: number;
  srcUrl: string;
  durationSec: number;
  volume: number;
  muted: boolean;
  from?: string[];
  mirror: OverlayFrameV2Mirror;
}

export type StoredOverlayClip = ComposeOverlayClip & { frameV2?: OverlayFrameV2Block };

/** The longest line of parents a cut keeps. */
export const MAX_LINEAGE = 32;

/** The cuts a stored clip was split or copied from in v2, nearest first; `[]` when it was not. */
export function lineageOf(clip: ComposeClip): string[] {
  const from = ((clip as StoredClip).frameV2 as { from?: unknown } | undefined)?.from;
  if (!Array.isArray(from)) return [];
  return from.filter((id): id is string => typeof id === 'string' && id !== '').slice(0, MAX_LINEAGE);
}

/**
 * The stored clip for a cut v2 makes from `parent` (a split's right half, a copy): every field the
 * parent carries, a new id, and the parent at the head of its line. Its frame data is written on save.
 */
export function inheritClip(parent: ComposeClip, id: string): ComposeClip {
  const block = (parent as StoredClip).frameV2;
  const from = [parent.id, ...lineageOf(parent)].slice(0, MAX_LINEAGE);
  return { ...parent, id, frameV2: { ...(block ?? {}), from } } as ComposeClip;
}

/** What the browser measured for one piece of footage. `null` when measuring failed. */
export interface MeasuredSource {
  fps: number;
  frames: number;
  /** Its frames are not evenly spaced (variable frame rate): shown, not supported (review round 1, item 10). */
  variable?: boolean;
  /** `frames` is the file's own count of pictures (its sample table), not a measurement by playback. */
  counted?: boolean;
}

export type MeasuredSources = Readonly<Record<string, MeasuredSource | null | undefined>>;

export interface StoredFilm {
  sequence: FrameSequence;
  /** Cuts read from their block unchanged. */
  exact: string[];
  /** Cuts rebuilt from seconds: made or changed in the current editor. */
  derived: string[];
  /**
   * Cuts whose block counted pictures the file does not have (an earlier playback measurement rounded a
   * 4.06 s, 97-picture file up to 98): their footage now has its real count, and a cut that ran into the
   * missing pictures ends at the real last one (spec E addendum C3). Written back corrected at the next save.
   */
  corrected: string[];
  /** Cuts whose footage rate is not known; the film's rate stands in, and they are measured again next time. */
  rateUnknown: string[];
  /** No cut's rate is known: the film runs at a stand-in rate and nothing frame-based may be stored. */
  tentative: boolean;
}

type FrameFields = Pick<FrameClip, 'inFrame' | 'phase' | 'frames' | 'speedNum' | 'speedDen' | 'speedCurve' | 'mediaSpan'>;
type SourceFields = Pick<FrameClip, 'sourceFps' | 'sourceFrames'>;

const isInt = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min;
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/**
 * The clip's block when it is well formed, else `null`. A block an earlier version wrote from a guessed
 * rate (`rateGuessed`) is not trusted: the cut is rebuilt from its seconds and measured again.
 */
export function frameBlockOf(clip: ComposeClip): FrameV2Block | null {
  const block = (clip as StoredClip).frameV2 as (Partial<FrameV2Block> & { rateGuessed?: unknown }) | undefined;
  if (!block || typeof block !== 'object' || block.rateGuessed !== undefined) return null;
  const { fps, inFrame, phase, frames, speedNum, speedDen, sourceFps, sourceFrames, mirror, speedCurve, mediaSpan } = block;
  // It describes this clip's file, at this length: anything else is other footage (review round 1, item 4).
  if (block.srcUrl !== clip.srcUrl || block.durationSec !== clip.durationSec) return null;
  if (!isInt(fps, 1) || !isInt(inFrame, 0) || !isInt(phase, 0) || !isInt(frames, 1) || !isInt(speedNum, 1) || !isInt(speedDen, 1)) return null;
  if (phase >= speedDen || !isNum(sourceFps) || sourceFps <= 0 || !isInt(sourceFrames, 1)) return null;
  if (!mirror || typeof mirror !== 'object' || !isNum(mirror.trimStartSec) || !isNum(mirror.trimEndSec) || !isNum(mirror.playbackRate)) return null;
  if (mediaSpan !== undefined && (!mediaSpan || typeof mediaSpan !== 'object' || !isInt(mediaSpan.num, 1) || !isInt(mediaSpan.den, 1))) {
    return null;
  }
  if (speedCurve !== undefined && !isValidSpeedCurve(speedCurve)) return null;
  return block as FrameV2Block;
}

/** Validated v2 overlay frame block, or `null` for legacy/still/malformed overlays (C3). */
export function overlayFrameBlockOf(overlay: ComposeOverlayClip): OverlayFrameV2Block | null {
  if (overlay.mediaKind !== 'video') return null;
  const block = (overlay as StoredOverlayClip).frameV2 as Partial<OverlayFrameV2Block> | undefined;
  if (!block || typeof block !== 'object') return null;
  const { fps, trackIndex, startFrame, inFrame, phase, frames, speedNum, speedDen, sourceFps, sourceFrames, durationSec, volume, muted, mirror, link, mediaSpan, speedCurve } = block;
  if (block.srcUrl !== overlay.srcUrl) return null;
  if (!isInt(fps, 1) || !isInt(trackIndex, 0) || !isInt(startFrame, 0)) return null;
  if (!isInt(inFrame, 0) || !isInt(phase, 0) || !isInt(frames, 1) || !isInt(speedNum, 1) || !isInt(speedDen, 1)) return null;
  if (phase >= speedDen || !isNum(sourceFps) || sourceFps <= 0 || !isInt(sourceFrames, 1)) return null;
  if (!isNum(durationSec) || durationSec <= 0 || !isNum(volume) || volume < 0 || volume > 1 || typeof muted !== 'boolean') return null;
  if (!mirror || typeof mirror !== 'object') return null;
  const { startSec: mStart, endSec: mEnd } = mirror as Partial<OverlayFrameV2Mirror>;
  if (!isNum(mStart) || !isNum(mEnd)) return null;
  if (link !== null && link !== undefined) {
    if (typeof link !== 'object' || typeof link.clipId !== 'string' || link.clipId === '' || !isInt(link.sourceFrame, 0)) return null;
  }
  if (mediaSpan !== undefined && (!mediaSpan || typeof mediaSpan !== 'object' || !isInt(mediaSpan.num, 1) || !isInt(mediaSpan.den, 1))) return null;
  if (speedCurve !== undefined && !isValidSpeedCurve(speedCurve)) {
    const { speedCurve: _droppedCurve, ...constantBlock } = block;
    return constantBlock as OverlayFrameV2Block;
  }
  return block as OverlayFrameV2Block;
}

/** True when a stored film contains at least one video overlay created by editor v2. */
export function hasStoredOwnedOverlays(project: Pick<ComposerProject, 'overlays'> | null | undefined): boolean {
  return (project?.overlays ?? []).some((overlay) => overlayFrameBlockOf(overlay) !== null);
}

/** Count of legacy (non-v2) overlays in a stored film (image overlays or old-editor video overlays; B3). */
export function legacyOverlayCountOf(project: Pick<ComposerProject, 'overlays'> | null | undefined): number {
  return (project?.overlays ?? []).filter((overlay) => overlayFrameBlockOf(overlay) === null).length;
}

function mirrorHolds(clip: ComposeClip, block: FrameV2Block): boolean {
  return (
    block.mirror.trimStartSec === clip.trimStartSec &&
    block.mirror.trimEndSec === clip.trimEndSec &&
    block.mirror.playbackRate === (clip.playbackRate ?? 1)
  );
}

/** The block, when the current editor has not touched the cut since v2 wrote it at this film rate. */
function exactBlock(clip: ComposeClip, fps: number): FrameV2Block | null {
  const block = frameBlockOf(clip);
  return block && block.fps === fps && mirrorHolds(clip, block) ? block : null;
}

/** v2 staleness check: returns the `FrameV2Block` only when it is valid and untouched by the legacy editor. */
export function currentFrameBlockOf(clip: ComposeClip, fps: number): FrameV2Block | null {
  return exactBlock(clip, fps);
}

/**
 * The film's rate, taken only from measured footage: the rate of the first cut that carries a block
 * (blocks are written only from measured rates); otherwise the measured rate of the first cut, in film
 * order, whose footage could be measured, brought onto a whole film rate; otherwise 30, tentatively.
 */
export function filmRateOf(project: Pick<ComposerProject, 'clips'>, measured: MeasuredSources = {}): { fps: number; tentative: boolean } {
  const clips = project.clips.slice(0, MAX_COMPOSE_CLIPS);
  for (const clip of clips) {
    const block = frameBlockOf(clip);
    if (block) return { fps: block.fps, tentative: false };
  }
  for (const clip of clips) {
    const rate = measured[clip.srcUrl]?.fps;
    if (rate) return { fps: snapFilmFps(rate), tentative: false };
  }
  return { fps: DEFAULT_FILM_FPS, tentative: true };
}

export function filmFpsOf(project: Pick<ComposerProject, 'clips'>, measured: MeasuredSources = {}): number {
  return filmRateOf(project, measured).fps;
}

/** The footage the browser must measure before this film can be opened on frames. */
export function sourcesToMeasure(project: Pick<ComposerProject, 'clips' | 'overlays'>): string[] {
  const clips = project.clips.slice(0, MAX_COMPOSE_CLIPS);
  const out: string[] = [];
  for (const clip of clips) {
    if (frameBlockOf(clip) || !clip.srcUrl || out.includes(clip.srcUrl)) continue;
    out.push(clip.srcUrl);
  }
  return out;
}

/** `round(rate × 100) / 100` as a reduced fraction. */
function speedFraction(rate: number): [number, number] {
  const hundredths = Math.max(1, Math.round(rate * 100));
  const divisor = gcd(hundredths, 100);
  return [hundredths / divisor, 100 / divisor];
}

/**
 * A cut kept inside its footage's real pictures: its start on the last one at the latest, its length up to
 * the last one. A cut that ran into pictures the file does not have gets shorter by exactly those frames.
 */
function withinFootage(clip: SourceFields & FrameFields, fps: number): SourceFields & FrameFields {
  const media = mediaFramesOf(clip, fps);
  if (clip.speedCurve) {
    const rawStart = curveStartMedia(clip.speedCurve);
    const rawEnd = curveEndMedia(clip.speedCurve);
    const winStart = Math.min(Math.max(0, rawStart), Math.max(0, media - 1e-4));
    const winEnd = Math.min(media, Math.max(winStart, rawEnd));
    const startMedia = Math.min(Math.max(0, clip.speedCurve.startMedia), Math.max(0, media - 1e-4));
    const spanMedia = Math.min(clip.speedCurve.spanMedia, Math.max(0, media - startMedia));

    const domainEnd = startMedia + spanMedia;
    const srcDomain =
      clip.speedCurve.sourceDomain &&
      clip.speedCurve.sourceDomain.startMedia >= 0 &&
      clip.speedCurve.sourceDomain.startMedia + clip.speedCurve.sourceDomain.spanMedia <= media + 1e-4 &&
      Math.abs(winStart - rawStart) <= 1e-6 &&
      Math.abs(winEnd - rawEnd) <= 1e-6
        ? clip.speedCurve.sourceDomain
        : undefined;
    const candidate: SpeedCurve = {
      startMedia,
      spanMedia,
      ...(srcDomain ? { sourceDomain: srcDomain } : {}),
      ...(Math.abs(winStart - startMedia) > 1e-9 ? { winStartMedia: winStart } : {}),
      ...(Math.abs(winEnd - domainEnd) > 1e-9 ? { winEndMedia: winEnd } : {}),
      points: clip.speedCurve.points,
    };

    const validCandidate = isValidSpeedCurve(candidate) && curveRawDurationFrames(candidate) >= 0.5 - 1e-6;
    if (rawStart >= media - 1e-4 || winEnd - winStart <= 1e-4 || spanMedia <= 1e-4 || !validCandidate) {
      const fallbackIn = Math.min(Math.max(0, Math.floor(rawStart + 1e-9)), Math.max(0, media - 1));
      const fallbackFrames = clamp(Math.round(rawEnd - rawStart), 1, Math.max(1, media - fallbackIn));
      return { sourceFps: clip.sourceFps, sourceFrames: clip.sourceFrames, inFrame: fallbackIn, phase: 0, frames: fallbackFrames, speedNum: 1, speedDen: 1 };
    }

    const clampedCurve = cloneSpeedCurve(candidate);
    if (curveRawDurationFrames(clampedCurve) < 0.5 - 1e-6) {
      const fallbackIn = Math.min(Math.max(0, Math.floor(rawStart + 1e-9)), Math.max(0, media - 1));
      const fallbackFrames = clamp(Math.round(rawEnd - rawStart), 1, Math.max(1, media - fallbackIn));
      return { sourceFps: clip.sourceFps, sourceFrames: clip.sourceFrames, inFrame: fallbackIn, phase: 0, frames: fallbackFrames, speedNum: 1, speedDen: 1 };
    }
    const inFrame = Math.min(Math.max(0, Math.floor(curveStartMedia(clampedCurve) + 1e-9)), Math.max(0, media - 1));
    const frames = clamp(curveTotalFrames(clampedCurve), 1, clipMaxFrames({ ...clip, inFrame, phase: 0, speedNum: 1, speedDen: 1, speedCurve: clampedCurve } as FrameClip, fps));
    return { sourceFps: clip.sourceFps, sourceFrames: clip.sourceFrames, inFrame, phase: 0, frames, speedNum: 1, speedDen: 1, speedCurve: clampedCurve };
  }
  const inFrame = Math.min(clip.inFrame, Math.max(0, media - 1));
  const phase = inFrame === clip.inFrame ? clip.phase : 0;
  const shape = { ...clip, inFrame, phase } as FrameClip;
  const { mediaSpan, ...rest } = clip;
  const maxAllowed = clipMaxFrames(shape, fps);
  const clampedFrames = Math.max(1, Math.min(clip.frames, maxAllowed));
  return {
    ...rest,
    inFrame,
    phase,
    frames: clampedFrames,
    ...(mediaSpan && mediaSpan.num / mediaSpan.den <= media + 1e-4 ? { mediaSpan } : {}),
  };
}

/** A cut rebuilt from the seconds the current editor keeps: every position to the nearest frame. */
export function deriveFrames(clip: ComposeClip, fps: number, source: SourceFields): FrameFields {
  const [speedNum, speedDen] = speedFraction(clipPlaybackRate(clip));
  const media = mediaFramesOf(source, fps);
  const inFrame = clamp(Math.round(clip.trimStartSec * fps), 0, Math.max(0, media - 1));
  const wanted = Math.max(1, Math.round(((clip.trimEndSec - clip.trimStartSec) / (speedNum / speedDen)) * fps));
  const shape = { ...source, inFrame, phase: 0, speedNum, speedDen } as FrameClip;
  return { inFrame, phase: 0, frames: Math.min(wanted, clipMaxFrames(shape, fps)), speedNum, speedDen };
}

/** Rates the old playback measurement wrote rounded (fps.ts SOURCE_RATES), as the fractions they stand for. */
const ROUNDED_RATES: ReadonlyArray<readonly [number, number]> = [[23.976, 24000 / 1001], [29.97, 30000 / 1001], [59.94, 60000 / 1001]];
const exactRate = (rate: number) => ROUNDED_RATES.find(([rounded]) => Math.abs(rate - rounded) < 1e-9)?.[1] ?? rate;

/** Two rates are one rate within a millionth (a block's rounded 23.976 is the file's 24000/1001). */
export function sameRate(a: number, b: number): boolean {
  const x = exactRate(a);
  const y = exactRate(b);
  return x > 0 && y > 0 && Math.abs(x - y) <= 1e-6 * Math.max(x, y);
}

type StoredKind = 'exact' | 'corrected' | 'derived';

/**
 * What a stored cut is on frames, given its footage's facts (`source`) — one rule for opening and for
 * writing, so a cut v2 did not touch is written back with exactly the seconds it had:
 *
 * - its block holds (written at this film rate, the current editor has not touched it) and counts the
 *   footage's pictures right → the block as it is (`exact`);
 * - the block holds but counted pictures the file does not have (an earlier playback measurement: 98 for a
 *   97-picture file), at the file's own rate → the block kept inside the real pictures (`corrected`): only
 *   end frames the file lacks are taken away, so the stored seconds stay what they were (review round 1 of
 *   part E, item 1);
 * - otherwise (no block, a changed cut, or a block whose rate is not the file's: review item 5) → rebuilt
 *   from the stored seconds with the footage's facts (`derived`).
 */
function framesOfStored(clip: ComposeClip, fps: number, source: SourceFields): { kind: StoredKind; frames: FrameFields } {
  const block = exactBlock(clip, fps);
  if (block) {
    const { inFrame, phase, frames, speedNum, speedDen, speedCurve, mediaSpan } = block;
    if (speedCurve) {
      const media = mediaFramesOf(source, fps);
      const startM = curveStartMedia(speedCurve);
      const endM = curveEndMedia(speedCurve);
      const expectedIn = Math.max(0, Math.floor(startM + 1e-9));
      const expectedFrames = curveTotalFrames(speedCurve);
      const validAgainstSource =
        source.sourceFrames === block.sourceFrames &&
        startM >= -1e-6 &&
        endM <= media + 1e-4 &&
        frames === expectedFrames &&
        inFrame === expectedIn &&
        curveRawDurationFrames(speedCurve) >= 0.5 - 1e-6;

      if (validAgainstSource) {
        return {
          kind: 'exact',
          frames: {
            inFrame,
            phase,
            frames,
            speedNum,
            speedDen,
            speedCurve: cloneSpeedCurve(speedCurve),
            ...(mediaSpan ? { mediaSpan: { ...mediaSpan } } : {}),
          },
        };
      }
      if (sameRate(source.sourceFps, block.sourceFps)) {
        const kept = withinFootage(
          {
            sourceFps: block.sourceFps,
            sourceFrames: source.sourceFrames,
            inFrame,
            phase: 0,
            frames,
            speedNum: 1,
            speedDen: 1,
            speedCurve,
          },
          fps,
        );
        return {
          kind: 'corrected',
          frames: {
            inFrame: kept.inFrame,
            phase: kept.phase,
            frames: kept.frames,
            speedNum: kept.speedNum,
            speedDen: kept.speedDen,
            ...(kept.speedCurve ? { speedCurve: cloneSpeedCurve(kept.speedCurve) } : {}),
          },
        };
      }
    } else {
      if (source.sourceFrames === block.sourceFrames) {
        return {
          kind: 'exact',
          frames: {
            inFrame,
            phase,
            frames,
            speedNum,
            speedDen,
            ...(mediaSpan ? { mediaSpan: { ...mediaSpan } } : {}),
          },
        };
      }
      if (sameRate(source.sourceFps, block.sourceFps)) {
        const kept = withinFootage(
          {
            sourceFps: block.sourceFps,
            sourceFrames: source.sourceFrames,
            inFrame,
            phase,
            frames,
            speedNum,
            speedDen,
            ...(mediaSpan ? { mediaSpan } : {}),
          },
          fps,
        );
        return {
          kind: 'corrected',
          frames: {
            inFrame: kept.inFrame,
            phase: kept.phase,
            frames: kept.frames,
            speedNum,
            speedDen,
            ...(kept.mediaSpan ? { mediaSpan: { ...kept.mediaSpan } } : {}),
          },
        };
      }
    }
  }
  return { kind: 'derived', frames: deriveFrames(clip, fps, source) };
}

function sourceOf(clip: ComposeClip, fps: number, measured: MeasuredSources): SourceFields & { guessed: boolean } {
  const seen = measured[clip.srcUrl];
  if (seen && isNum(seen.fps) && seen.fps > 0 && isInt(seen.frames, 1)) return { sourceFps: seen.fps, sourceFrames: seen.frames, guessed: false };
  const block = frameBlockOf(clip);
  if (block) return { sourceFps: block.sourceFps, sourceFrames: block.sourceFrames, guessed: false };
  return { sourceFps: fps, sourceFrames: sourceFramesOf(clip.durationSec, fps), guessed: true };
}

export interface FromStoredOptions {
  /** Load editor-created `overlays[].frameV2` into `sequence.overlayTracks` (default `true`). Pass `false` when tracks switch is closed. */
  loadOverlays?: boolean;
}

/** The stored film on frames. `measured` holds what the browser measured, by `srcUrl`. */
export function fromStored(project: ComposerProject, measured: MeasuredSources = {}, options: FromStoredOptions = {}): StoredFilm {
  const { fps, tentative } = filmRateOf(project, measured);
  const exact: string[] = [];
  const derived: string[] = [];
  const corrected: string[] = [];
  const rateUnknown: string[] = [];
  const clips = project.clips.slice(0, MAX_COMPOSE_CLIPS).map((stored): FrameClip => {
    const base = {
      id: stored.id,
      label: stored.label,
      srcUrl: stored.srcUrl,
      thumbUrl: stored.thumbUrl ?? null,
      volume: stored.volume,
      muted: stored.muted,
    };
    const block = exactBlock(stored, fps);
    if (block) {
      // The file's own count (read from its sample table when it is opened) is checked against the block's.
      const seen = measured[stored.srcUrl];
      const counted = seen?.counted && isInt(seen.frames, 1) && isNum(seen.fps) && seen.fps > 0 ? seen : null;
      const source: SourceFields =
        counted && counted.frames !== block.sourceFrames
          ? { sourceFps: sameRate(counted.fps, block.sourceFps) ? block.sourceFps : counted.fps, sourceFrames: counted.frames }
          : { sourceFps: block.sourceFps, sourceFrames: block.sourceFrames };
      const { kind, frames } = framesOfStored(stored, fps, source);
      (kind === 'exact' ? exact : kind === 'corrected' ? corrected : derived).push(stored.id);
      return { ...base, ...source, ...frames };
    }
    derived.push(stored.id);
    const { guessed, ...source } = sourceOf(stored, fps, measured);
    if (guessed) rateUnknown.push(stored.id);
    return { ...base, ...source, ...deriveFrames(stored, fps, source) };
  });
  const aspect: ComposeAspect = (COMPOSE_ASPECTS as readonly string[]).includes(project.aspect) ? project.aspect : '9:16';
  const mainOnly: FrameSequence = { fps, aspect, clips, captions: [] };
  const mainIds = new Set(clips.map((c) => c.id));

  const mainAnchor = cutAnchor(toStored(mainOnly, project, { writeOverlays: false }), mainOnly);

  // Load ONLY editor-created video overlays carrying a valid `frameV2` block (C3: legacy overlays stay hidden & untouched).
  let overlayTracks: OverlayTrack[] | undefined;
  if (options.loadOverlays !== false && project.overlays && project.overlays.length > 0) {
    const byTrackIndex = new Map<number, { id: string; clips: OverlayClip[] }>();
    for (const ov of project.overlays.slice(0, MAX_COMPOSE_OVERLAYS)) {
      const block = overlayFrameBlockOf(ov);
      if (!block) continue;
      const ovSec = storedOverlaySeconds(ov);
      const { startSec: mStart, endSec: mEnd } = block.mirror;
      const mirrorOk = block.fps === fps && mStart === ovSec.start && mEnd === ovSec.end;
      const seen = measured[ov.srcUrl];
      const counted = seen?.counted && isInt(seen.frames, 1) && isNum(seen.fps) && seen.fps > 0 ? seen : null;
      const source: SourceFields =
        counted && counted.frames !== block.sourceFrames
          ? { sourceFps: sameRate(counted.fps, block.sourceFps) ? block.sourceFps : counted.fps, sourceFrames: counted.frames }
          : { sourceFps: block.sourceFps, sourceFrames: block.sourceFrames };
      const clampedFields = withinFootage(
        {
          ...source,
          inFrame: block.inFrame,
          phase: block.phase,
          frames: block.frames,
          speedNum: block.speedNum,
          speedDen: block.speedDen,
          ...(block.mediaSpan ? { mediaSpan: { ...block.mediaSpan } } : {}),
          ...(block.speedCurve ? { speedCurve: cloneSpeedCurve(block.speedCurve) } : {}),
        },
        fps,
      );
      const startFrame = mirrorOk ? block.startFrame : storedSecToFrame(mainAnchor, ovSec.start);
      const rawLink = mirrorOk ? block.link : p1LinkTargetForStart(mainOnly, startFrame);
      const safeLink = rawLink && mainIds.has(rawLink.clipId) ? rawLink : p1LinkTargetForStart(mainOnly, startFrame);
      const overlayClip: OverlayClip = {
        id: ov.id,
        label: ov.label,
        srcUrl: ov.srcUrl,
        thumbUrl: ov.thumbUrl ?? null,
        sourceFps: clampedFields.sourceFps,
        sourceFrames: clampedFields.sourceFrames,
        inFrame: clampedFields.inFrame,
        phase: clampedFields.phase,
        frames: clampedFields.frames,
        speedNum: clampedFields.speedNum,
        speedDen: clampedFields.speedDen,
        ...(clampedFields.mediaSpan ? { mediaSpan: clampedFields.mediaSpan } : {}),
        ...(clampedFields.speedCurve ? { speedCurve: clampedFields.speedCurve } : {}),
        volume: block.volume,
        muted: block.muted,
        startFrame,
        link: safeLink,
      };
      const tIdx = clamp(block.trackIndex, 0, MAX_OVERLAY_TRACKS - 1);
      const entry = byTrackIndex.get(tIdx) ?? { id: block.trackId || `ov-${tIdx + 1}`, clips: [] };
      entry.clips.push(overlayClip);
      byTrackIndex.set(tIdx, entry);
    }
    if (byTrackIndex.size > 0) {
      const built = p6PruneEmptyOverlayTracks(
        [...byTrackIndex.entries()]
          .sort((a, b) => a[0] - b[0])
          .slice(0, MAX_OVERLAY_TRACKS)
          .map(([, entry]) => ({
            id: entry.id,
            clips: entry.clips.sort((a, b) => a.startFrame - b.startFrame),
          })),
      );
      if (built.length > 0) overlayTracks = built;
    }
  }

  // The stored captions on these cuts' frames, each at its offset into its cut (spec E, item A).
  const cuts: FrameSequence = overlayTracks ? { ...mainOnly, overlayTracks } : mainOnly;
  return { sequence: { ...cuts, captions: captionsOnFrames(project.captions, mainAnchor) }, exact, derived, corrected, rateUnknown, tentative };
}

export interface ToStoredOptions {
  /**
   * Stored clips v2 knows by id although the key may not hold them yet: what the bin made for a new
   * cut, or a copy of the cut a split or paste came from. Used only for ids `previous` does not have.
   */
  known?: Readonly<Record<string, ComposeClip>>;
  /** Footage (`srcUrl`) whose rate could not be measured: its cuts get no frame data, only seconds. */
  unmeasuredSources?: readonly string[];
  /** No cut's rate is measured, so the film's own rate is a stand-in: no cut gets frame data. */
  tentative?: boolean;
  /** When `false` (tracks switch closed), leave `previous.overlays` completely untouched. Defaults to `true`. */
  writeOverlays?: boolean;
}

/**
 * Whether the earlier editor plays this cut differently from this editor (audit B5). The seconds both editors read
 * carry the speed clamped to the earlier editor's 0.25–4, and a curve as its average speed (`secondsOf`). So it
 * differs for a constant speed below 0.25× or above 4× (another length there), and for a curve whose speed
 * changes inside the cut (played at one average speed there: other pictures at the same moment, and a length
 * rounded from that average). A curve held at one speed inside 0.25–4, which is what pressing "곡선" makes, reads
 * exactly the same and does not count (review item 5); held outside that range it does. Measured:
 * tests/brand-studio/editor-v2/old-editor-speed.test.ts. Exact on the speed's fraction: 0.25× and 4× themselves are
 * the earlier editor's own.
 */
export function speedTheOldEditorChanges(clip: Pick<FrameClip, 'speedNum' | 'speedDen' | 'speedCurve'>): boolean {
  if (clip.speedCurve) {
    const held = isFlatCurve(clip.speedCurve);
    return held === null || held < 0.25 || held > 4;
  }
  return clip.speedNum * 4 < clip.speedDen || clip.speedNum > clip.speedDen * 4;
}

/** The film has at least one such cut: the links to the earlier editor say so (audit B5). */
export function filmHasSpeedTheOldEditorChanges(sequence: Pick<FrameSequence, 'clips'>): boolean {
  return sequence.clips.some(speedTheOldEditorChanges);
}

/** The seconds a cut covers on its footage, on the film's frame grid. */
function secondsOf(clip: FrameClip, fps: number): Pick<ComposeClip, 'trimStartSec' | 'trimEndSec' | 'playbackRate'> {
  const rawRate = clip.speedCurve ? curveAverageSpeed(clip.speedCurve) : clip.speedNum / clip.speedDen;
  const legacyRate = Math.min(4, Math.max(0.25, Math.round(rawRate * 100) / 100));
  const playbackRate = Math.abs(legacyRate - 1) < 0.01 ? undefined : legacyRate;
  if (clip.speedCurve) {
    return {
      trimStartSec: curveStartMedia(clip.speedCurve) / fps,
      trimEndSec: curveEndMedia(clip.speedCurve) / fps,
      playbackRate,
    };
  }
  const startMedia = clip.inFrame + clip.phase / clip.speedDen;
  const endMedia = clip.mediaSpan
    ? startMedia + clip.mediaSpan.num / clip.mediaSpan.den
    : clip.inFrame + (clip.phase + clip.frames * clip.speedNum) / clip.speedDen;
  return {
    trimStartSec: startMedia / fps,
    trimEndSec: endMedia / fps,
    playbackRate,
  };
}

function samePointArrays(a: SpeedCurve['points'], b: SpeedCurve['points']): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      a[i]!.pos !== b[i]!.pos ||
      a[i]!.speed !== b[i]!.speed ||
      a[i]!.slope !== b[i]!.slope ||
      a[i]!.slopeRight !== b[i]!.slopeRight
    ) {
      return false;
    }
  }
  return true;
}

function sameCurve(a?: SpeedCurve, b?: SpeedCurve): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (
    a.startMedia !== b.startMedia ||
    a.spanMedia !== b.spanMedia ||
    curveStartMedia(a) !== curveStartMedia(b) ||
    curveEndMedia(a) !== curveEndMedia(b) ||
    !samePointArrays(a.points, b.points)
  ) {
    return false;
  }
  if ((a.sourceDomain === undefined) !== (b.sourceDomain === undefined)) return false;
  if (a.sourceDomain && b.sourceDomain) {
    if (
      a.sourceDomain.startMedia !== b.sourceDomain.startMedia ||
      a.sourceDomain.spanMedia !== b.sourceDomain.spanMedia ||
      !samePointArrays(a.sourceDomain.points, b.sourceDomain.points)
    ) {
      return false;
    }
  }
  return true;
}

function sameSpan(a?: { num: number; den: number }, b?: { num: number; den: number }): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.num === b.num && a.den === b.den;
}

const sameFrames = (a: FrameFields, b: FrameFields) =>
  a.inFrame === b.inFrame &&
  a.phase === b.phase &&
  a.frames === b.frames &&
  a.speedNum === b.speedNum &&
  a.speedDen === b.speedDen &&
  sameSpan(a.mediaSpan, b.mediaSpan) &&
  sameCurve(a.speedCurve, b.speedCurve);

/** A stored clip for a cut that has no stored origin: the stream route names its footage. */
function freshClip(clip: FrameClip): ComposeClip {
  let kind: 'asset' | 'output' = 'asset';
  let id: string | null = null;
  try {
    const url = new URL(clip.srcUrl, 'https://studio.invalid');
    if (url.pathname === '/api/brand-studio/compose') {
      kind = url.searchParams.get('source') === 'output' ? 'output' : 'asset';
      id = url.searchParams.get('id');
    }
  } catch {
    // Not a URL we know: the clip keeps its address and nothing else.
  }
  return {
    id: clip.id,
    label: clip.label,
    sourceKind: kind,
    ...(id ? (kind === 'output' ? { outputId: id } : { assetId: id }) : {}),
    srcUrl: clip.srcUrl,
    thumbUrl: clip.thumbUrl,
    durationSec: Math.max(1, clip.sourceFrames / clip.sourceFps),
    trimStartSec: 0,
    trimEndSec: 0,
    volume: 1,
    muted: false,
  };
}

function storedClipOf(
  clip: FrameClip,
  fps: number,
  own: ComposeClip | undefined,
  template: ComposeClip | undefined,
  measuredRate: boolean,
  from: readonly string[],
): StoredClip {
  const frames: FrameFields = clip;
  const source: SourceFields = clip;
  // A cut v2 did not change keeps the exact seconds it had, so a visit moves nothing in the current editor;
  // that includes a cut whose block was only corrected to its footage's real pictures (framesOfStored).
  const expected = own ? framesOfStored(own, fps, source).frames : null;
  const unchanged = !!own && !!expected && sameFrames(expected, frames);
  const base: ComposeClip =
    own ?? (template ? { ...template, id: clip.id, label: clip.label, srcUrl: clip.srcUrl, thumbUrl: clip.thumbUrl } : freshClip(clip));
  const seconds = unchanged
    ? { trimStartSec: own!.trimStartSec, trimEndSec: own!.trimEndSec, playbackRate: own!.playbackRate }
    : secondsOf(clip, fps);
  // The block is v2's and is written fresh below; an old one (or a parent's line) is never carried over.
  const rest: StoredClip = { ...base };
  delete rest.frameV2;
  const written = normalizeClipBounds({ ...rest, ...seconds, volume: clip.volume, muted: clip.muted });
  // Frame data only from a measured rate: a cut whose rate is a stand-in keeps its seconds, is rebuilt
  // from them on every load and measured again (review round 1, item 3). Its line of parents stays.
  if (!measuredRate) return from.length > 0 ? ({ ...written, frameV2: { from: [...from] } } as StoredClip) : written;
  const block: FrameV2Block = {
    fps,
    inFrame: clip.inFrame,
    phase: clip.phase,
    frames: clip.frames,
    speedNum: clip.speedNum,
    speedDen: clip.speedDen,
    ...(clip.mediaSpan ? { mediaSpan: { ...clip.mediaSpan } } : {}),
    ...(clip.speedCurve ? { speedCurve: cloneSpeedCurve(clip.speedCurve) } : {}),
    sourceFps: clip.sourceFps,
    sourceFrames: clip.sourceFrames,
    srcUrl: written.srcUrl,
    durationSec: written.durationSec,
    mirror: { trimStartSec: written.trimStartSec, trimEndSec: written.trimEndSec, playbackRate: written.playbackRate ?? 1 },
    ...(from.length > 0 ? { from: [...from] } : {}),
  };
  return { ...written, frameV2: block };
}

/**
 * The frame sequence written onto `previous`: v2's cuts, everything else as it was.
 * A cut whose id `previous` has keeps every field v2 does not own; a new cut (a split's right half, a
 * paste, a cut from the bin) takes them from `known`, else from the first stored cut of the same footage
 * (the current editor's own split copies them onto both halves too), else from its footage alone.
 * The line of parents (`frameV2.from`) comes only from the cut itself or from `known`, never from
 * another cut of the same footage.
 *
 * Captions are not v2's in V1 (its captions workspace is locked): `previous.captions` is written back as
 * it is, the same list, whatever the cuts look like now. A film that got shorter than a caption hides
 * the caption on screen; storage keeps it (review round 1, item 1). `sequence.captions` is never read.
 */
function storedOverlayOf(
  clip: OverlayClip,
  trackIndex: number,
  trackId: string,
  sequence: FrameSequence,
  previousOverlay: ComposeOverlayClip | undefined,
  previousMainClip: ComposeClip | undefined,
  knownClip: ComposeClip | undefined,
): StoredOverlayClip {
  const fps = sequence.fps;
  const resolvedStart = deriveOverlayStart(sequence, clip);
  const framing = p9DefaultOverlayFraming();
  const originClip = previousMainClip ?? knownClip;
  const fallbackMeta = freshClip(clip);
  const sourceKind: 'asset' | 'output' | 'local' =
    previousOverlay?.sourceKind ?? originClip?.sourceKind ?? fallbackMeta.sourceKind;
  const assetId = previousOverlay?.assetId ?? originClip?.assetId ?? fallbackMeta.assetId;
  const outputId = previousOverlay?.outputId ?? originClip?.outputId ?? fallbackMeta.outputId;
  const durationSec =
    (previousOverlay && overlayFrameBlockOf(previousOverlay)?.durationSec) ??
    originClip?.durationSec ??
    Math.max(1, clip.sourceFrames / clip.sourceFps);
  const prevFrom = previousOverlay
    ? (overlayFrameBlockOf(previousOverlay)?.from ?? [])
    : originClip
      ? lineageOf(originClip)
      : [];

  // C4: rewrite `startSec`/`endSec` from the resolved start on every save, then record post-normalisation mirror.
  const raw: ComposeOverlayClip = {
    id: clip.id,
    label: clip.label,
    sourceKind,
    ...(assetId ? { assetId } : {}),
    ...(outputId ? { outputId } : {}),
    srcUrl: clip.srcUrl,
    ...(clip.thumbUrl !== undefined ? { thumbUrl: clip.thumbUrl } : {}),
    mediaKind: 'video',
    startSec: resolvedStart / fps,
    endSec: (resolvedStart + clip.frames) / fps,
    x: previousOverlay ? previousOverlay.x : framing.x,
    y: previousOverlay ? previousOverlay.y : framing.y,
    scale: previousOverlay ? previousOverlay.scale : framing.scale,
    opacity: previousOverlay ? previousOverlay.opacity : framing.opacity,
  };
  const written = normalizeOverlayClip(raw);
  const writtenSec = storedOverlaySeconds(written);
  const block: OverlayFrameV2Block = {
    fps,
    trackIndex,
    trackId,
    startFrame: resolvedStart,
    link: clip.link ? { clipId: clip.link.clipId, sourceFrame: clip.link.sourceFrame } : null,
    inFrame: clip.inFrame,
    phase: clip.phase,
    frames: clip.frames,
    speedNum: clip.speedNum,
    speedDen: clip.speedDen,
    ...(clip.mediaSpan ? { mediaSpan: { ...clip.mediaSpan } } : {}),
    ...(clip.speedCurve ? { speedCurve: cloneSpeedCurve(clip.speedCurve) } : {}),
    sourceFps: clip.sourceFps,
    sourceFrames: clip.sourceFrames,
    srcUrl: written.srcUrl,
    durationSec,
    volume: clip.volume,
    muted: clip.muted,
    ...(prevFrom.length > 0 ? { from: [...prevFrom] } : {}),
    mirror: { startSec: writtenSec.start, endSec: writtenSec.end },
  };
  return { ...written, frameV2: block };
}

export function toStored(sequence: FrameSequence, previous: ComposerProject, options: ToStoredOptions = {}): ComposerProject {
  const fps = sequence.fps;
  const byId = new Map(previous.clips.map((clip) => [clip.id, clip]));
  const prevOverlayById = new Map((previous.overlays ?? []).map((ov) => [ov.id, ov]));
  const unmeasured = new Set(options.unmeasuredSources ?? []);
  const clips = sequence.clips.slice(0, MAX_COMPOSE_CLIPS).map((clip) => {
    const own = byId.get(clip.id);
    const known = own ? undefined : options.known?.[clip.id];
    const template = own ? undefined : (known ?? previous.clips.find((stored) => stored.srcUrl === clip.srcUrl));
    const from = own ? lineageOf(own) : known ? lineageOf(known) : [];
    return storedClipOf(clip, fps, own, template, !options.tentative && !unmeasured.has(clip.srcUrl), from);
  });

  // Main-track-only byte-identical guarantee (C3, C6): touch `overlays` ONLY when tracks are written and
  // either the sequence currently has owned overlays or `previous` previously held owned overlays.
  const hasSeqOverlays = hasOwnedOverlays(sequence);
  const hadOwnedOverlays = (previous.overlays ?? []).some((ov) => overlayFrameBlockOf(ov) !== null);
  if (options.writeOverlays === false || (!hasSeqOverlays && !hadOwnedOverlays)) {
    return { ...previous, version: 1, aspect: sequence.aspect, clips, captions: previous.captions };
  }

  // B3: preserve original overlay ORDER (legacy and existing owned overlays stay in their original slots;
  // newly created owned overlays are appended in track/time order). Never slice silently — add/lift/split
  // enforce `legacyOverlayCount + ownedCount <= MAX_COMPOSE_OVERLAYS` up front.
  const ownedList: StoredOverlayClip[] = [];
  const ownedById = new Map<string, StoredOverlayClip>();
  overlayTracksOf(sequence).forEach((track, trackIndex) => {
    for (const clip of track.clips) {
      const stored = storedOverlayOf(
        clip,
        trackIndex,
        track.id,
        sequence,
        prevOverlayById.get(clip.id),
        byId.get(clip.id),
        options.known?.[clip.id],
      );
      ownedList.push(stored);
      ownedById.set(stored.id, stored);
    }
  });
  const combined: ComposeOverlayClip[] = [];
  const emittedOwnedIds = new Set<string>();
  for (const existing of previous.overlays ?? []) {
    if (overlayFrameBlockOf(existing) === null) {
      combined.push(existing);
    } else {
      const updated = ownedById.get(existing.id);
      if (updated) {
        combined.push(updated);
        emittedOwnedIds.add(updated.id);
      }
    }
  }
  for (const owned of ownedList) {
    if (!emittedOwnedIds.has(owned.id)) {
      combined.push(owned);
    }
  }
  if (combined.length === 0) {
    const { overlays: _dropped, ...rest } = previous;
    return { ...rest, version: 1, aspect: sequence.aspect, clips, captions: previous.captions };
  }
  return { ...previous, version: 1, aspect: sequence.aspect, clips, captions: previous.captions, overlays: combined };
}

/** The stored film as the cuts on screen would store it, and what v2 shows of it. */
export interface StoredFilmView {
  /** `toStored` of the cuts onto the stored film: the seconds the current editor would read now. */
  film: ComposerProject;
  /** How the stored film's timed things (captions, effects, still overlays) land on these cuts' frames. */
  anchor: CutAnchor;
  /** The cuts with the stored captions on their frames. */
  sequence: FrameSequence;
}

/**
 * The one reading of a real film that the preview, the lists and the export all use (spec E, item A):
 * the cuts on screen put onto the stored film, and its captions, effects and still overlays read through
 * the cut anchor (lib/brand-studio/editor-v2/cut-anchor.ts). Nothing stored changes.
 */
export function storedFilmView(sequence: FrameSequence, previous: ComposerProject, options: ToStoredOptions = {}): StoredFilmView {
  const film = toStored(sequence, previous, options);
  const anchor = cutAnchor(film, sequence);
  return { film, anchor, sequence: { ...sequence, captions: captionsOnFrames(film.captions, anchor) } };
}

/**
 * What v2 owns of a stored film, as one string: the aspect and, per cut in order, its id, footage,
 * trims, speed, volume, mute and frame data. Two texts with the same signature hold the same cuts, so a
 * write by another screen that keeps it (a caption, music, the current editor reloading the film) did
 * not overwrite v2's work (lib/brand-studio/editor-v2/film-session.ts). A missing or unreadable film
 * is an empty one.
 */
export function ownedSignature(text: string | null | undefined): string {
  const project = parseStoredProject(text ?? null);
  if (!project || project.clips.length === 0) return JSON.stringify(['', []]);
  const clips = project.clips
    .slice(0, MAX_COMPOSE_CLIPS)
    .map((clip) => [clip.id, clip.srcUrl, clip.trimStartSec, clip.trimEndSec, clip.playbackRate ?? 1, clip.volume, clip.muted, (clip as StoredClip).frameV2 ?? null]);
  // C10: include owned video overlays (carrying `frameV2`) so stale tabs overwriting/stripping upper tracks are detected,
  // while leaving main-only and legacy-overlay films with the exact prior 2-element signature.
  const ownedOverlays = (project.overlays ?? [])
    .slice(0, MAX_COMPOSE_OVERLAYS)
    .filter((ov) => overlayFrameBlockOf(ov) !== null)
    .map((ov) => {
      const sec = storedOverlaySeconds(ov);
      return [ov.id, ov.srcUrl, sec.start, sec.end, overlayFrameBlockOf(ov)];
    });
  return ownedOverlays.length > 0 ? JSON.stringify([project.aspect, clips, ownedOverlays]) : JSON.stringify([project.aspect, clips]);
}

/**
 * Read, merge, write: v2's part of the film put onto whatever the key holds now (the sound studio and
 * the current editor write it too), in the current editor's own storage format.
 */
export function mergeFilmText(currentText: string | null, sequence: FrameSequence, options: ToStoredOptions = {}): string {
  const current = parseStoredProject(currentText) ?? emptyComposerProject(sequence.aspect);
  return serializeProjectForStorage(toStored(sequence, current, options));
}
