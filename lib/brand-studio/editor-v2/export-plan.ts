/**
 * Editing studio v2 — the frame-exact export plan (docs/BRAND-EDITING-STUDIO-V2.md §5.1.5, §6.4).
 *
 * The file the export writes is fixed here before a single picture is drawn: which source frame every
 * film frame shows, when each frame starts in the file, and on which sample each cut's sound starts and
 * stops. Everything comes from the same frame model the timeline runs on (`frameStateAt`), at the film's
 * own frame rate, so frame N of the file is the frame the timeline shows at N.
 *
 * Pure: no DOM, no network, no storage. `components/brand-studio/editor-v2/export-film.ts` carries it
 * out in the browser.
 */
import type { ComposeCaption, ComposeClip, ComposeOverlayClip, ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { frameStateAt, spansOf, totalFrames, type FrameClip, type FrameSequence } from './frames';
import { isNeutral, type EditorDoc } from './model';
import { lineageOf } from './stored';

/** Sound is mixed and written at this rate. */
export const EXPORT_SAMPLE_RATE = 48_000;
/** The muxer's fixed video time scale (lib/brand-studio/compose/mp4-muxer.ts). */
export const MUX_TIMESCALE = 90_000;

// ── Pictures ───────────────────────────────────────────────────────────────────────────────────

export interface PlannedFrame {
  /** Film frame. */
  frame: number;
  clipId: string;
  srcUrl: string;
  /** The source frame this film frame shows. */
  sourceFrame: number;
  /** The middle of that source frame, in seconds of its footage (before any first-frame offset). */
  seekSec: number;
  sourceFps: number;
}

/** Every frame of the film, in order: what it shows, straight from `frameStateAt`. */
export function videoPlan(sequence: FrameSequence): PlannedFrame[] {
  const total = totalFrames(sequence);
  const plan: PlannedFrame[] = [];
  for (let frame = 0; frame < total; frame += 1) {
    const active = frameStateAt(sequence, frame).active;
    if (!active) throw new Error(`film frame ${frame} has no cut`);
    plan.push({
      frame,
      clipId: active.clip.id,
      srcUrl: active.clip.srcUrl,
      sourceFrame: active.sourceFrame,
      seekSec: active.seekSec,
      sourceFps: active.clip.sourceFps,
    });
  }
  return plan;
}

/** When film frame `index` starts in the file, in microseconds. */
export function timestampUs(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps);
}

/** How long film frame `index` lasts: the gap to the next timestamp, so the durations add up exactly. */
export function frameDurationUs(index: number, fps: number): number {
  return timestampUs(index + 1, fps) - timestampUs(index, fps);
}

/** What the muxer turns a frame duration into (its own rounding, mirrored here so a test can hold it). */
export function muxTicks(durationUs: number): number {
  return Math.max(1, Math.round((durationUs / 1_000_000) * MUX_TIMESCALE));
}

/** A key frame every second of film. */
export function isKeyFrame(index: number, fps: number): boolean {
  return index % Math.max(1, Math.round(fps)) === 0;
}

// ── Sound ──────────────────────────────────────────────────────────────────────────────────────

export interface AudioSegment {
  clipId: string;
  srcUrl: string;
  /** First output sample of the cut: `round(startFrame × sampleRate / fps)`. */
  startSample: number;
  /** Up to the next cut's first sample: the cuts tile the film's sound with no gap and no overlap. */
  sampleCount: number;
  /** Media time of the cut's first frame, on the film's frame grid: `(inFrame + phase / speedDen) / fps`. */
  sourceOffsetSec: number;
  /** `speedNum / speedDen`. */
  rate: number;
  /** `0` when muted. */
  gain: number;
}

export interface AudioPlan {
  sampleRate: number;
  /** `ceil(totalFrames × sampleRate / fps)`. */
  totalSamples: number;
  segments: AudioSegment[];
}

export function filmSampleCount(sequence: FrameSequence, sampleRate = EXPORT_SAMPLE_RATE): number {
  return Math.ceil((totalFrames(sequence) * sampleRate) / sequence.fps - 1e-9);
}

/** Each cut's sound: where it sits in the file, to the sample, and where it is read from. */
export function audioPlan(sequence: FrameSequence, sampleRate = EXPORT_SAMPLE_RATE): AudioPlan {
  const totalSamples = filmSampleCount(sequence, sampleRate);
  const spans = spansOf(sequence);
  const starts = spans.map((span) => Math.min(totalSamples, Math.round((span.start * sampleRate) / sequence.fps)));
  const segments = spans.map((span, index): AudioSegment => {
    const { clip } = span;
    const next = index + 1 < spans.length ? starts[index + 1]! : totalSamples;
    return {
      clipId: clip.id,
      srcUrl: clip.srcUrl,
      startSample: starts[index]!,
      sampleCount: next - starts[index]!,
      sourceOffsetSec: (clip.inFrame + clip.phase / clip.speedDen) / sequence.fps,
      rate: clip.speedNum / clip.speedDen,
      gain: clip.muted ? 0 : clip.volume,
    };
  });
  return { sampleRate, totalSamples, segments };
}

export interface SoundWindow {
  /** First and one-past-last output sample the cut's sound covers. */
  startSample: number;
  endSample: number;
  /** Where in the source the first covered sample is read, in seconds of source. */
  sourceOffsetSec: number;
}

/**
 * The output samples one cut's sound covers. `shiftSec` is a stored per-clip sound offset (the current
 * editor's `audioOffsetSec`): the whole window moves by it, rounded to a whole sample, the way the
 * current exporter moves it. What falls before the film's start is cut from the head (the read point
 * moves on by the cut's speed); what falls past the end is cut from the tail. `null` when nothing is left.
 */
export function soundWindow(segment: AudioSegment, totalSamples: number, sampleRate = EXPORT_SAMPLE_RATE, shiftSec = 0): SoundWindow | null {
  const shift = Number.isFinite(shiftSec) ? Math.round(shiftSec * sampleRate) : 0;
  let startSample = segment.startSample + shift;
  let endSample = segment.startSample + segment.sampleCount + shift;
  let sourceOffsetSec = segment.sourceOffsetSec;
  if (startSample < 0) {
    sourceOffsetSec += (-startSample / sampleRate) * segment.rate;
    startSample = 0;
  }
  endSample = Math.min(endSample, totalSamples);
  if (endSample <= startSample) return null;
  return { startSample, endSample, sourceOffsetSec };
}

// ── What the film carries besides cuts ─────────────────────────────────────────────────────────

/** The captions on film frame `frame`, in the shape the current exporter draws (frames become seconds). */
export function captionsAt(sequence: FrameSequence, frame: number): ComposeCaption[] {
  return frameStateAt(sequence, frame).captions.map((caption) => ({
    id: caption.id,
    text: caption.text,
    startSec: caption.start / sequence.fps,
    endSec: caption.end / sequence.fps,
    position: caption.position,
    size: caption.size,
  }));
}

type CutView = Pick<FrameClip, 'id' | 'label' | 'srcUrl' | 'sourceFrames' | 'sourceFps' | 'volume' | 'muted'>;

/**
 * The stored film's clip a cut is graded as, with its place in the stored film (the current editor's
 * colour grade is scoped by clip id, or by place when it has no id). A cut v2 split or copied from
 * another stays inside a grade scoped to that parent: its line (`frameV2.from`, stored.ts) names the
 * parent, and the clip is handed to the grade under the parent's id. A cut the stored film does not
 * hold is a stand-in at its place in the film.
 */
export function storedCutFor(extras: ComposerProject, cut: CutView, sequenceIndex: number): { clip: ComposeClip; index: number } {
  const index = extras.clips.findIndex((clip) => clip.id === cut.id);
  if (index < 0) {
    const seconds = cut.sourceFrames / cut.sourceFps;
    return {
      clip: { id: cut.id, label: cut.label, sourceKind: 'asset', srcUrl: cut.srcUrl, durationSec: seconds, trimStartSec: 0, trimEndSec: seconds, volume: cut.volume, muted: cut.muted },
      index: sequenceIndex,
    };
  }
  const clip = extras.clips[index]!;
  const gradedId = extras.colorGrade?.clipId;
  if (gradedId && clip.id !== gradedId && lineageOf(clip).includes(gradedId)) return { clip: { ...clip, id: gradedId }, index };
  return { clip, index };
}

/**
 * A cut's stored sound offset (the current editor's `audioOffsetSec`): a piece v2 split or copied from
 * another carries the parent's, because the stored-film bridge copies it onto the new clip.
 */
export function soundShiftSec(extras: ComposerProject | null | undefined, clipId: string): number {
  const offset = extras?.clips.find((clip) => clip.id === clipId)?.audioOffsetSec;
  return typeof offset === 'number' && Number.isFinite(offset) ? offset : 0;
}

/** Still-image overlays on film frame `frame`, by the current exporter's rule (`start ≤ t ≤ end`). */
export function imageOverlaysAt(extras: ComposerProject | null | undefined, frame: number, fps: number): ComposeOverlayClip[] {
  const t = frame / fps;
  return (extras?.overlays ?? []).filter((overlay) => overlay.mediaKind === 'image' && t >= overlay.startSec && t <= overlay.endSec);
}

/** Things a person may have set that this export does not put in the file. The sheet names them first. */
export const NOT_INCLUDED_KEYS = ['looks', 'titles', 'music', 'soundFixes', 'captionLook', 'videoOverlays', 'transitions'] as const;
export type NotIncludedKey = (typeof NOT_INCLUDED_KEYS)[number];

export type ExportDocView = Pick<EditorDoc, 'looks' | 'titles' | 'music' | 'sound' | 'captionSettings'>;

export function notIncluded(input: { sequence: FrameSequence; doc?: ExportDocView | null; extras?: ComposerProject | null }): NotIncludedKey[] {
  const { sequence, doc, extras } = input;
  const out = new Set<NotIncludedKey>();
  if (doc) {
    if (Object.values(doc.looks).some((look) => look.strength > 0 && !isNeutral(look.detail))) out.add('looks');
    if (doc.titles.some((title) => title.text.trim() !== '')) out.add('titles');
    if (doc.music) out.add('music');
    if (doc.sound.speechClear || doc.sound.duck || doc.sound.loudness || doc.sound.fades) out.add('soundFixes');
    if (burnsCaptions(doc) && sequence.captions.some((caption) => caption.text.trim() !== '')) out.add('captionLook');
  }
  if (extras) {
    if ((extras.overlays ?? []).some((overlay) => overlay.mediaKind === 'video')) out.add('videoOverlays');
    if (extras.clips.some((clip) => clip.transitionIn && clip.transitionIn !== 'none')) out.add('transitions');
  }
  return NOT_INCLUDED_KEYS.filter((key) => out.has(key));
}

/** Captions go into the picture unless the person asked for them as a separate file only. */
export function burnsCaptions(doc: Pick<EditorDoc, 'captionSettings'> | null | undefined): boolean {
  return !doc || doc.captionSettings.output !== 'file';
}

/** Captions also go out as a `.srt` file. */
export function writesCaptionFile(doc: Pick<EditorDoc, 'captionSettings'> | null | undefined, sequence: FrameSequence): boolean {
  return !!doc && doc.captionSettings.output !== 'burn' && sequence.captions.some((caption) => caption.text.trim() !== '');
}

// ── Network ────────────────────────────────────────────────────────────────────────────────────

/**
 * The only addresses the export may read sound from: the film's own media (its cuts, and the stored
 * film's music and effects). Anything else is refused before a request is made.
 */
export function soundSourceUrls(sequence: FrameSequence, extras?: ComposerProject | null): Set<string> {
  const urls = new Set<string>();
  for (const clip of sequence.clips) if (clip.srcUrl) urls.add(clip.srcUrl);
  if (extras?.bgm?.srcUrl) urls.add(extras.bgm.srcUrl);
  for (const sfx of extras?.sfxClips ?? []) if (sfx.srcUrl) urls.add(sfx.srcUrl);
  return urls;
}

// ── Labels ─────────────────────────────────────────────────────────────────────────────────────

/** `twings-edit-2026-11-21.mp4` */
export function exportFilename(date: Date, extension = 'mp4'): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `twings-edit-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${extension}`;
}

/** `12.4 MB` / `840 KB` */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
