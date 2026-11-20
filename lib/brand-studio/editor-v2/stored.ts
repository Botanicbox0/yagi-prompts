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
 * v2 owns only the aspect, the list and order of cuts (per cut: trims, speed, volume, mute and the
 * block) and the captions. Everything else in the stored film is carried over untouched. A visit to v2
 * that changes nothing writes back exactly the seconds that were there. Pure: no DOM, no storage.
 */
import {
  COMPOSE_ASPECTS,
  MAX_COMPOSE_CAPTIONS,
  MAX_COMPOSE_CLIPS,
  clipPlaybackRate,
  emptyComposerProject,
  normalizeClipBounds,
  parseStoredProject,
  serializeProjectForStorage,
  type CaptionPosition,
  type CaptionSize,
  type ComposeAspect,
  type ComposeCaption,
  type ComposeClip,
  type ComposerProject,
} from '@/lib/brand-studio/compose/timeline';
import { DEFAULT_FILM_FPS, snapFilmFps, sourceFramesOf } from './fps';
import { clipMaxFrames, mediaFramesOf, type FrameCaption, type FrameClip, type FrameSequence } from './frames';

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
  sourceFps: number;
  sourceFrames: number;
  /** The footage's rate could not be measured; `sourceFps` is the film's. */
  rateGuessed?: true;
  mirror: FrameV2Mirror;
  /**
   * The cuts this one was split or copied from in v2, nearest first (at most `MAX_LINEAGE`). The new
   * cut carries the parent's stored fields (its sound offset among them); this line lets a colour grade
   * the current editor scoped to the parent cover the pieces too (export-plan.ts `storedCutFor`).
   */
  from?: string[];
}

export type StoredClip = ComposeClip & { frameV2?: FrameV2Block };

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
}

export type MeasuredSources = Readonly<Record<string, MeasuredSource | null | undefined>>;

export interface StoredFilm {
  sequence: FrameSequence;
  /** Cuts read from their block unchanged. */
  exact: string[];
  /** Cuts rebuilt from seconds: made or changed in the current editor. */
  derived: string[];
  /** Cuts whose footage rate is not known; the film's rate stands in. */
  rateUnknown: string[];
}

type FrameFields = Pick<FrameClip, 'inFrame' | 'phase' | 'frames' | 'speedNum' | 'speedDen'>;
type SourceFields = Pick<FrameClip, 'sourceFps' | 'sourceFrames'>;

const isInt = (value: unknown, min: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min;
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** The clip's block when it is well formed, else `null`. */
export function frameBlockOf(clip: ComposeClip): FrameV2Block | null {
  const block = (clip as StoredClip).frameV2 as Partial<FrameV2Block> | undefined;
  if (!block || typeof block !== 'object') return null;
  const { fps, inFrame, phase, frames, speedNum, speedDen, sourceFps, sourceFrames, mirror } = block;
  if (!isInt(fps, 1) || !isInt(inFrame, 0) || !isInt(phase, 0) || !isInt(frames, 1) || !isInt(speedNum, 1) || !isInt(speedDen, 1)) return null;
  if (phase >= speedDen || !isNum(sourceFps) || sourceFps <= 0 || !isInt(sourceFrames, 1)) return null;
  if (!mirror || typeof mirror !== 'object' || !isNum(mirror.trimStartSec) || !isNum(mirror.trimEndSec) || !isNum(mirror.playbackRate)) return null;
  return block as FrameV2Block;
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

/**
 * The film's rate: the rate of the first cut that carries a block; otherwise the first cut's measured
 * rate brought onto a whole film rate; otherwise 30.
 */
export function filmFpsOf(project: Pick<ComposerProject, 'clips'>, measured: MeasuredSources = {}): number {
  const clips = project.clips.slice(0, MAX_COMPOSE_CLIPS);
  for (const clip of clips) {
    const block = frameBlockOf(clip);
    if (block) return block.fps;
  }
  const first = clips[0];
  const rate = first ? measured[first.srcUrl]?.fps : undefined;
  return rate ? snapFilmFps(rate) : DEFAULT_FILM_FPS;
}

/** The footage the browser must measure before this film can be opened on frames. */
export function sourcesToMeasure(project: Pick<ComposerProject, 'clips'>): string[] {
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

/** A cut rebuilt from the seconds the current editor keeps: every position to the nearest frame. */
export function deriveFrames(clip: ComposeClip, fps: number, source: SourceFields): FrameFields {
  const [speedNum, speedDen] = speedFraction(clipPlaybackRate(clip));
  const media = mediaFramesOf(source, fps);
  const inFrame = clamp(Math.round(clip.trimStartSec * fps), 0, Math.max(0, media - 1));
  const wanted = Math.max(1, Math.round(((clip.trimEndSec - clip.trimStartSec) / (speedNum / speedDen)) * fps));
  const shape = { ...source, inFrame, phase: 0, speedNum, speedDen } as FrameClip;
  return { inFrame, phase: 0, frames: Math.min(wanted, clipMaxFrames(shape, fps)), speedNum, speedDen };
}

function sourceOf(clip: ComposeClip, fps: number, measured: MeasuredSources): SourceFields & { guessed: boolean } {
  const seen = measured[clip.srcUrl];
  if (seen && isNum(seen.fps) && seen.fps > 0 && isInt(seen.frames, 1)) return { sourceFps: seen.fps, sourceFrames: seen.frames, guessed: false };
  const block = frameBlockOf(clip);
  if (block) return { sourceFps: block.sourceFps, sourceFrames: block.sourceFrames, guessed: block.rateGuessed === true };
  return { sourceFps: fps, sourceFrames: sourceFramesOf(clip.durationSec, fps), guessed: true };
}

const POSITIONS: readonly CaptionPosition[] = ['bottom', 'center', 'top'];
const SIZES: readonly CaptionSize[] = ['sm', 'md', 'lg'];

function captionFromStored(caption: ComposeCaption, fps: number): FrameCaption {
  const start = Math.max(0, Math.round(caption.startSec * fps));
  return {
    id: caption.id,
    text: caption.text,
    start,
    end: Math.max(start + 1, Math.round(caption.endSec * fps)),
    position: POSITIONS.includes(caption.position) ? caption.position : 'bottom',
    size: SIZES.includes(caption.size) ? caption.size : 'md',
  };
}

/** The stored film on frames. `measured` holds what the browser measured, by `srcUrl`. */
export function fromStored(project: ComposerProject, measured: MeasuredSources = {}): StoredFilm {
  const fps = filmFpsOf(project, measured);
  const exact: string[] = [];
  const derived: string[] = [];
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
      exact.push(stored.id);
      if (block.rateGuessed) rateUnknown.push(stored.id);
      const { inFrame, phase, frames, speedNum, speedDen, sourceFps, sourceFrames } = block;
      return { ...base, sourceFps, sourceFrames, inFrame, phase, frames, speedNum, speedDen };
    }
    derived.push(stored.id);
    const { guessed, ...source } = sourceOf(stored, fps, measured);
    if (guessed) rateUnknown.push(stored.id);
    return { ...base, ...source, ...deriveFrames(stored, fps, source) };
  });
  const aspect: ComposeAspect = (COMPOSE_ASPECTS as readonly string[]).includes(project.aspect) ? project.aspect : '9:16';
  const captions = project.captions.slice(0, MAX_COMPOSE_CAPTIONS).map((caption) => captionFromStored(caption, fps));
  return { sequence: { fps, aspect, clips, captions }, exact, derived, rateUnknown };
}

export interface ToStoredOptions {
  /**
   * Stored clips v2 knows by id although the key may not hold them yet: what the bin made for a new
   * cut, or a copy of the cut a split or paste came from. Used only for ids `previous` does not have.
   */
  known?: Readonly<Record<string, ComposeClip>>;
  /** Footage (`srcUrl`) whose rate could not be measured. */
  guessedSources?: readonly string[];
}

/** The seconds a cut covers on its footage, on the film's frame grid. */
function secondsOf(clip: FrameClip, fps: number): Pick<ComposeClip, 'trimStartSec' | 'trimEndSec' | 'playbackRate'> {
  const rate = clip.speedNum / clip.speedDen;
  return {
    trimStartSec: (clip.inFrame + clip.phase / clip.speedDen) / fps,
    trimEndSec: (clip.inFrame + (clip.phase + clip.frames * clip.speedNum) / clip.speedDen) / fps,
    playbackRate: rate === 1 ? undefined : rate,
  };
}

const sameFrames = (a: FrameFields, b: FrameFields) =>
  a.inFrame === b.inFrame && a.phase === b.phase && a.frames === b.frames && a.speedNum === b.speedNum && a.speedDen === b.speedDen;

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
  guessed: boolean,
  from: readonly string[],
): StoredClip {
  const frames: FrameFields = clip;
  const source: SourceFields = clip;
  // A cut v2 did not change keeps the exact seconds it had, so a visit moves nothing in the current editor.
  const expected = own ? (exactBlock(own, fps) ?? deriveFrames(own, fps, source)) : null;
  const unchanged = !!own && !!expected && sameFrames(expected, frames);
  const base: ComposeClip =
    own ?? (template ? { ...template, id: clip.id, label: clip.label, srcUrl: clip.srcUrl, thumbUrl: clip.thumbUrl } : freshClip(clip));
  const seconds = unchanged
    ? { trimStartSec: own!.trimStartSec, trimEndSec: own!.trimEndSec, playbackRate: own!.playbackRate }
    : secondsOf(clip, fps);
  const written = normalizeClipBounds({ ...base, ...seconds, volume: clip.volume, muted: clip.muted });
  const block: FrameV2Block = {
    fps,
    inFrame: clip.inFrame,
    phase: clip.phase,
    frames: clip.frames,
    speedNum: clip.speedNum,
    speedDen: clip.speedDen,
    sourceFps: clip.sourceFps,
    sourceFrames: clip.sourceFrames,
    ...(guessed ? { rateGuessed: true as const } : {}),
    mirror: { trimStartSec: written.trimStartSec, trimEndSec: written.trimEndSec, playbackRate: written.playbackRate ?? 1 },
    ...(from.length > 0 ? { from: [...from] } : {}),
  };
  return { ...written, frameV2: block };
}

function storedCaptionOf(caption: FrameCaption, fps: number, own: ComposeCaption | undefined): ComposeCaption {
  const fields = { id: caption.id, text: caption.text, position: caption.position, size: caption.size };
  if (own) {
    // Keep the seconds the current editor had wherever they still land on the same frames.
    const kept = { ...own, ...fields };
    const back = captionFromStored(kept, fps);
    if (back.start === caption.start && back.end === caption.end && back.position === own.position && back.size === own.size) return kept;
  }
  return { ...(own ?? {}), ...fields, startSec: caption.start / fps, endSec: caption.end / fps };
}

/**
 * The frame sequence written onto `previous`: v2's cuts and captions, everything else as it was.
 * A cut whose id `previous` has keeps every field v2 does not own; a new cut (a split's right half, a
 * paste, a cut from the bin) takes them from `known`, else from the first stored cut of the same footage
 * (the current editor's own split copies them onto both halves too), else from its footage alone.
 * The line of parents (`frameV2.from`) comes only from the cut itself or from `known`, never from
 * another cut of the same footage.
 */
export function toStored(sequence: FrameSequence, previous: ComposerProject, options: ToStoredOptions = {}): ComposerProject {
  const fps = sequence.fps;
  const byId = new Map(previous.clips.map((clip) => [clip.id, clip]));
  const guessed = new Set(options.guessedSources ?? []);
  const clips = sequence.clips.slice(0, MAX_COMPOSE_CLIPS).map((clip) => {
    const own = byId.get(clip.id);
    const known = own ? undefined : options.known?.[clip.id];
    const template = own ? undefined : (known ?? previous.clips.find((stored) => stored.srcUrl === clip.srcUrl));
    const from = own ? lineageOf(own) : known ? lineageOf(known) : [];
    return storedClipOf(clip, fps, own, template, guessed.has(clip.srcUrl), from);
  });
  const captionsById = new Map(previous.captions.map((caption) => [caption.id, caption]));
  const captions = sequence.captions.slice(0, MAX_COMPOSE_CAPTIONS).map((caption) => storedCaptionOf(caption, fps, captionsById.get(caption.id)));
  return { ...previous, version: 1, aspect: sequence.aspect, clips, captions };
}

/**
 * Read, merge, write: v2's part of the film put onto whatever the key holds now (the sound studio and
 * the current editor write it too), in the current editor's own storage format.
 */
export function mergeFilmText(currentText: string | null, sequence: FrameSequence, options: ToStoredOptions = {}): string {
  const current = parseStoredProject(currentText) ?? emptyComposerProject(sequence.aspect);
  return serializeProjectForStorage(toStored(sequence, current, options));
}
