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
import type { TimingAnswer } from './container';
import { frameStateAt, spansOf, totalFrames, type FrameClip, type FrameSequence } from './frames';
import { overlayFrames, type CutAnchor } from './cut-anchor';
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

/**
 * Where an asked-for picture of a source lies (spec E addendum C3). Production stopped a whole export on a
 * cut's last frame: the playback measurement had counted 98 pictures in a file that holds 97.
 *
 * - The file's own count is known (its sample table, lib/brand-studio/editor-v2/container.ts): a picture at
 *   or past that count is `past-end`.
 * - Known or not: a picture that could not be confirmed is `past-end` when the element has reached its
 *   end (`atEnd`: ended, or its current time at its length) and the last picture it showed lies more than
 *   half a frame before the one asked for (the file lists a picture the browser cannot show, review round 1
 *   of part E, item 8); anything else that could not be confirmed has `failed`.
 *
 * A `past-end` picture is filled with the source's last real one (and said after the export); a
 * `failed` one stops the export as before: a wrong or missing picture inside the footage is never filled.
 */
export type PicturePlace = 'inside' | 'past-end' | 'failed';

/** Up to this many filled frames in one cut are a quiet note after the export; more are a visible warning. */
export const LAST_FRAME_QUIET_MAX = 2;

/**
 * The note for each cut that had pictures filled, in the order the cuts came: counted per cut (two cuts
 * of one clip, or two clips with one name, stay apart), named by the clip.
 */
export function lastFrameWarnings(filled: ReadonlyMap<string, { clip: string; frames: number }>): Array<{ kind: 'lastFrame'; clip: string; frames: number }> {
  return [...filled.values()].map(({ clip, frames }) => ({ kind: 'lastFrame' as const, clip, frames }));
}

export function picturePlace(input: {
  sourceFrame: number;
  /** The file's own number of pictures, or `null` when it could not be read. */
  knownFrames: number | null;
  confirmed: boolean;
  /** Media time the asked-for picture would have. */
  expectedSec: number;
  /** Media time of the last picture the element showed while trying. */
  lastSeenSec: number | null;
  atEnd: boolean;
  frameSec: number;
}): PicturePlace {
  const { sourceFrame, knownFrames, confirmed, expectedSec, lastSeenSec, atEnd, frameSec } = input;
  if (knownFrames !== null && sourceFrame >= knownFrames) return 'past-end';
  if (confirmed) return 'inside';
  if (atEnd && lastSeenSec !== null && expectedSec > lastSeenSec + 0.5 * frameSec) return 'past-end';
  return 'failed';
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

/**
 * How far the picture starts after the sound in a cut's file (spec E, item B1), from its own boxes
 * (lib/brand-studio/editor-v2/container.ts): the first frame is shown at the picture track's start, and
 * decodeAudioData's sample 0 is the sound track's start (both measured in Chromium; the numbers are in
 * that file). So the sound for media time `m` after the first frame is decoded sample `(m + leadSec) × rate`.
 * `known: false` when the file could not be read: the sound is placed as if both started together, as
 * before, and the export says which cut's sound position could not be checked.
 */
export function soundLead(answer: TimingAnswer): { known: boolean; leadSec: number } {
  if (!answer.ok) return { known: false, leadSec: 0 };
  const { video, sound } = answer.timing;
  // A sound edit list the reader cannot follow: where the sound sits is not known.
  if (sound === 'unknown') return { known: false, leadSec: 0 };
  if (!video || !sound) return { known: true, leadSec: 0 };
  return { known: true, leadSec: video.firstSec - sound.firstSec };
}

/**
 * A cut's sound window read `leadSec` further into its decoded sound. Where that falls before the sound's
 * first sample (the sound starts after the picture), the head of the window is silent: the buffer starts
 * that many output samples later (at the cut's speed), from its first sample. `null` when nothing is left.
 */
export function placeSound(window: SoundWindow, leadSec: number, rate: number, sampleRate = EXPORT_SAMPLE_RATE): { startSample: number; endSample: number; offsetSec: number } | null {
  let offsetSec = window.sourceOffsetSec + (Number.isFinite(leadSec) ? leadSec : 0);
  let startSample = window.startSample;
  if (offsetSec < 0) {
    const skip = Math.ceil((-offsetSec * sampleRate) / rate - 1e-9);
    startSample += skip;
    offsetSec = Math.max(0, offsetSec + (skip / sampleRate) * rate);
  }
  if (startSample >= window.endSample) return null;
  return { startSample, endSample: window.endSample, offsetSec };
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

/**
 * Still-image overlays on film frame `frame`: from the frame their stored start lands on to the one their
 * end lands on, both included (the current exporter's `start ≤ t ≤ end`), each read at its offset into its
 * cut (`anchor`, spec E item A). The preview and the export both draw from here.
 */
export function imageOverlaysAt(extras: ComposerProject | null | undefined, frame: number, anchor: CutAnchor | null | undefined): ComposeOverlayClip[] {
  if (!extras || !anchor) return [];
  return (extras.overlays ?? []).filter((overlay) => {
    if (overlay.mediaKind !== 'image') return false;
    const { first, last } = overlayFrames(anchor, overlay);
    return frame >= first && frame <= last;
  });
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

/**
 * What the export reads whole into the page to mix the sound, each once, in order: the cuts that are
 * heard (a muted or silent cut is not read), then music and effects that are not silent.
 */
export function soundReads(sequence: FrameSequence, extras?: ComposerProject | null): string[] {
  const urls: string[] = [];
  const add = (url: string | null | undefined) => {
    if (url && !urls.includes(url)) urls.push(url);
  };
  for (const clip of sequence.clips) if (!clip.muted && clip.volume > 0) add(clip.srcUrl);
  if (extras?.bgm && extras.bgm.volume > 0) add(extras.bgm.srcUrl);
  for (const sfx of extras?.sfxClips ?? []) if (sfx.volume > 0) add(sfx.srcUrl);
  return urls;
}

/**
 * How much the export may read into one tab for sound, all sources together (review round 1, item 10).
 * Each source is read whole (then decoded), so a film of large sources can take the tab down. Measured on
 * the development workstation (Chromium, full build): one tab held 15.5 GiB of response bodies before
 * "Array buffer allocation failed". Customers' laptops share 8–16 GB with the whole browser, and the
 * same tab also holds the video decoders, the decoded sound and the file being written, so the limit is
 * 1 GiB: a sixteenth of that ceiling. Uploads are at most 50 MB per video (lib/brand-studio/contracts.ts),
 * so only a film of about twenty large, different sources reaches it.
 */
export const SOUND_BYTES_LIMIT = 1024 ** 3;

/** The sizes added up (unknown sizes are counted apart); `over` when they pass the limit. */
export function soundBytesCheck(sizes: ReadonlyArray<number | null>, limit = SOUND_BYTES_LIMIT): { total: number; unknown: number; over: boolean } {
  let total = 0;
  let unknown = 0;
  for (const size of sizes) {
    if (typeof size === 'number' && Number.isFinite(size) && size >= 0) total += size;
    else unknown += 1;
  }
  return { total, unknown, over: total > limit };
}

// ── Labels ─────────────────────────────────────────────────────────────────────────────────────

/** `twings-edit-2026-11-21.mp4` */
export function exportFilename(date: Date, extension = 'mp4'): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `twings-edit-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.${extension}`;
}

/** `1.2 GB` / `12.4 MB` / `840 KB` */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
