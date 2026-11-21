/**
 * Editing studio v2 — the frame-exact export, in the browser (docs/BRAND-EDITING-STUDIO-V2.md §5.1.5).
 *
 * Carries out `lib/brand-studio/editor-v2/export-plan.ts`: frame N of the file is the source frame the
 * timeline shows at N, at the film's own rate, and each cut's sound starts and stops on the matching
 * sample. Every picture is VERIFIED before it is drawn, on one of two paths per source (spec F):
 *
 * - the decoder path (./frame-decoder.ts): the source's own samples, read by range, fed to `VideoDecoder`;
 *   each picture is matched to the sample it was asked for by its timestamp. Nothing waits for the screen,
 *   so a covered, minimised or background window exports as fast as a front one;
 * - the seek path, for a source the decoder path cannot take (a container it cannot read, a codec the
 *   browser does not decode, an unusual transform) or that failed on it: the hidden `<video>` is sent to
 *   the middle of the source frame and `requestVideoFrameCallback` must report that very frame as presented.
 *
 * A frame that cannot be verified on either path stops the export with the film frame and the cut named;
 * nothing is skipped or guessed, and there is no real-time recording fallback (that path is what made the
 * old export drift).
 *
 * This file reads the film's own media over the network to decode their sound (its cuts, and the stored
 * film's music and effects) and refuses any other address (tests/brand-studio/editor-v2/
 * export-film-network.test.ts); the pictures' byte ranges are read through ./footage-facts.ts.
 */
import { corsMediaUrl } from '@/lib/brand-studio/cors-media-url';
import { applyProjectColorGradeFrame, drawCaptionsOverlay } from '@/lib/brand-studio/compose/export-client';
import { muxAvc1ToMp4, type EncodedAudioSample, type EncodedVideoSample } from '@/lib/brand-studio/compose/mp4-muxer';
import { COMPOSE_DIMENSIONS, type ComposeOverlayClip, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import {
  EXPORT_SAMPLE_RATE,
  SOUND_BYTES_LIMIT,
  audioPlan,
  captionsAt,
  exportFilename,
  frameDurationUs,
  imageOverlaysAt,
  isKeyFrame,
  notIncluded,
  lastFrameWarnings,
  noteFilled,
  picturePlace,
  placeSound,
  soundBytesCheck,
  soundLead,
  soundReads,
  soundShiftSec,
  soundSourceUrls,
  soundWindow,
  storedCutFor,
  timestampUs,
  videoPlan,
  type AudioPlan,
  type FilledCuts,
  type LastFrameWarning,
  type NotIncludedKey,
  type PlannedFrame,
} from '@/lib/brand-studio/editor-v2/export-plan';
import { cutAnchor, effectStartSec, type CutAnchor } from '@/lib/brand-studio/editor-v2/cut-anchor';
import { choosePath, codecMeasured, colourAdmitted, cutRatesMatch, decodeGroups, pictureFor, pictureTimes, type ExportPath, type ExportPathOverride } from '@/lib/brand-studio/editor-v2/decode-plan';
import { CURRENT_EXPORT_BACKGROUND, currentExportFrame } from '@/lib/brand-studio/editor-v2/framing';
import { totalFrames, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { timingOfFile } from '@/lib/brand-studio/editor-v2/container';
import { soundTrackOf } from '@/lib/brand-studio/editor-v2/media-probe';
import { DEFAULT_REFRAME, type Reframe } from '@/lib/brand-studio/editor-v2/model';
import { sampleBytes } from '@/lib/brand-studio/editor-v2/sample-bytes';
import type { Rotation, VideoIndex } from '@/lib/brand-studio/editor-v2/sample-index';
import { SHARED_WAIT_MS, waitShared } from '@/lib/brand-studio/editor-v2/watched-read';
import { CodecReclaimed, ReclaimedTooOften, isReclaim, runWithRestarts, whenVisible } from '@/lib/brand-studio/editor-v2/export-run';
import { PicturePaths, type DecoderSession, type SourcePath } from '@/lib/brand-studio/editor-v2/picture-paths';
import { footageBytes, readFootage, readPictureIndex } from './footage-facts';
import { PictureDecoder, decoderConfig, decoderSupports } from './frame-decoder';
import { screenTimer } from './screen-refresh';

export interface ExportProgress {
  phase: 'video' | 'audio' | 'writing';
  done: number;
  total: number;
  /** Which path is making the pictures right now (the sheet's slow-window line depends on it). */
  path?: ExportPath;
  /**
   * Times the export started again because the browser took its encoder back while the page was hidden
   * (spec G, A2); present from the first restart on. The count goes back to 0 on a restart.
   */
  restarts?: number;
}

export type { SourcePath } from '@/lib/brand-studio/editor-v2/picture-paths';

export interface ExportFilmOptions {
  sequence: FrameSequence;
  /**
   * The stored film in real mode, as these cuts would store it (`storedFilmView`; captions are taken from
   * `sequence`); `null` for the sample film. Its effects and still overlays are read at their offsets into
   * their cuts (`cutAnchor`, spec E item A).
   */
  extras?: ComposerProject | null;
  /** Per-cut framing, as the preview draws it (the sample film). */
  reframe?: Readonly<Record<string, Reframe>>;
  /**
   * `current`: every picture framed by the current exporter's rule (lib/brand-studio/editor-v2/framing.ts),
   * as the preview shows it on a real film; `reframe` (default): the sample film's own framing control.
   */
  framing?: 'reframe' | 'current';
  /** Draw the captions into the picture (`false` when the person wants them only as a file). */
  burnCaptions?: boolean;
  /** The developer's override for the proof (`?exportPath=`, lib/brand-studio/editor-v2/decode-plan.ts). */
  path?: ExportPathOverride;
  onProgress?: (progress: ExportProgress) => void;
  signal?: AbortSignal;
}

export interface ExportFilmResult {
  blob: Blob;
  mime: 'video/mp4';
  filename: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSec: number;
  elapsedMs: number;
  /** What the stored film carries that is not in this file (declared before export by the sheet too). */
  notIncluded: NotIncludedKey[];
  /** Things the file lacks that the person should hear about (a sound track that could not be read). */
  warnings: ExportWarning[];
  /** Which path made each source's pictures, in the order the film first uses them. */
  paths: SourcePath[];
  /** Times it started again after the browser took an encoder back (spec G, A2). */
  restarts: number;
}

/**
 * What the file lacks or repeats that the person should hear about: a cut whose footage HAS a sound track
 * the browser could not decode (its sound is not in the file); a cut whose sound is in the file but whose
 * file's timing could not be read, so its sound may sit off its picture (spec E, item B1); a cut that asked for pictures past its
 * footage's last one, filled with that last picture (spec E addendum C3; `frames` of them).
 */
export type ExportWarning = { kind: 'sound'; clip: string } | { kind: 'soundPosition'; clip: string } | LastFrameWarning;

export type ExportStopReason = 'empty' | 'unsupported' | 'load' | 'frame' | 'encode' | 'sound' | 'memory' | 'cancelled';

/** Why an export stopped. `frame` (film frame) and `clip` (cut label) say where, when it was a picture. */
export class ExportStop extends Error {
  readonly reason: ExportStopReason;
  readonly frame: number | null;
  readonly clip: string | null;
  /** For `memory`: how many bytes the film's sound sources add up to. */
  readonly bytes: number | null;
  constructor(reason: ExportStopReason, message: string, where: { frame?: number; clip?: string; bytes?: number } = {}) {
    super(message);
    this.name = 'ExportStop';
    this.reason = reason;
    this.frame = where.frame ?? null;
    this.clip = where.clip ?? null;
    this.bytes = where.bytes ?? null;
  }
}

const VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 128_000;
const AUDIO_CONFIG = { codec: 'mp4a.40.2', sampleRate: EXPORT_SAMPLE_RATE, numberOfChannels: 2, bitrate: AUDIO_BITRATE } as const;
/** High, Main, Baseline (level 4.0 holds 1080p up to 30 fps; 4.2 is tried first above that). */
const AVC_CANDIDATES = ['avc1.640028', 'avc1.4d0028', 'avc1.42E028', 'avc1.42001f'];
const AVC_CANDIDATES_HIGH_RATE = ['avc1.64002a', 'avc1.4d002a', 'avc1.42E02a'];
/**
 * How long a picture may take to be confirmed, in screen time (./screen-refresh.ts): real time on a live
 * screen, about ten times longer in a window covered by another one, which draws about once a second
 * (spec E addendum, C2). The confirmation itself stays as strict: the very frame must be on the element.
 */
const FRAME_CONFIRM_MS = 4000;
const FRAME_ATTEMPTS = 3;
const LOAD_MS = 30_000;
const BACKGROUND = '#000';

// ── Waiting that only counts while the page is on screen ──────────────────────────────────────

/**
 * A timer that does not run while the tab is hidden: a person switching tabs does not fail the export.
 * For loading files (network), which a covered window does not slow; waiting for a picture counts
 * screen time instead (`screenTimer`).
 */
function visibleTimer(limitMs: number, onExpire: () => void): () => void {
  let spent = 0;
  let last = performance.now();
  const id = window.setInterval(() => {
    const now = performance.now();
    if (!document.hidden) spent += now - last;
    last = now;
    if (spent > limitMs) {
      window.clearInterval(id);
      onExpire();
    }
  }, 100);
  return () => window.clearInterval(id);
}

const cancelled = () => new ExportStop('cancelled', 'export cancelled');

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw cancelled();
}

// ── Sources: one hidden <video> per footage, every picture confirmed ───────────────────────────

interface Source {
  url: string;
  video: HTMLVideoElement;
  fps: number;
  /** Presentation time of the footage's first frame, measured once. */
  firstSec: number;
  /** The source frame the element is confirmed to be showing, or `null` when unknown. */
  shown: number | null;
  /** The file's own number of pictures (its sample table), or `null` when it could not be read. */
  frames: number | null;
}

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback(callback: (now: number, metadata: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback(handle: number): void;
};

export function canConfirmFrames(): boolean {
  return typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
}

/** Everything the export needs exists in this browser (desktop Chrome and Edge are the target). */
export function browserCanExport(): boolean {
  return (
    canConfirmFrames() &&
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioData !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

/**
 * Seeks and waits until BOTH the seek has finished and a presented frame passes `accept`. Callbacks for
 * other frames are ignored (the next one is asked for). `ok: false` after the limit, with the last
 * presented time seen.
 */
function seekAndConfirm(
  video: HTMLVideoElement,
  targetSec: number,
  accept: (mediaTime: number) => boolean,
  signal?: AbortSignal,
): Promise<{ ok: boolean; last: number | null }> {
  const v = video as VideoFrameCallbackVideo;
  return new Promise((resolve, reject) => {
    let done = false;
    let seeked = false;
    let matched = false;
    let last: number | null = null;
    let handle = 0;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      stopTimer();
      v.cancelVideoFrameCallback(handle);
      video.removeEventListener('seeked', onSeeked);
      signal?.removeEventListener('abort', onAbort);
      resolve({ ok, last });
    };
    const onAbort = () => {
      if (done) return;
      done = true;
      stopTimer();
      v.cancelVideoFrameCallback(handle);
      video.removeEventListener('seeked', onSeeked);
      reject(cancelled());
    };
    const onSeeked = () => {
      seeked = true;
      if (matched) finish(true);
    };
    const onFrame = (_now: number, metadata: { mediaTime: number }) => {
      if (done) return;
      last = metadata.mediaTime;
      if (accept(metadata.mediaTime)) {
        matched = true;
        if (seeked) finish(true);
        else handle = v.requestVideoFrameCallback(onFrame);
      } else {
        matched = false;
        handle = v.requestVideoFrameCallback(onFrame);
      }
    };
    const stopTimer = screenTimer(FRAME_CONFIRM_MS, () => finish(false));
    video.addEventListener('seeked', onSeeked);
    signal?.addEventListener('abort', onAbort, { once: true });
    handle = v.requestVideoFrameCallback(onFrame);
    try {
      video.currentTime = targetSec;
    } catch {
      finish(false);
    }
  });
}

async function openSource(url: string, fps: number, label: string, host: HTMLElement, signal?: AbortSignal): Promise<Source> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.tabIndex = -1;
  video.setAttribute('aria-hidden', 'true');
  video.style.cssText = 'width:64px;height:36px;display:block';
  host.appendChild(video);
  await new Promise<void>((resolve, reject) => {
    const stop = visibleTimer(LOAD_MS, () => fail(new ExportStop('load', `footage did not load: ${label}`, { clip: label })));
    const clear = () => {
      stop();
      video.removeEventListener('loadeddata', ready);
      video.removeEventListener('error', broken);
      signal?.removeEventListener('abort', aborted);
    };
    const fail = (error: Error) => {
      clear();
      reject(error);
    };
    const ready = () => {
      clear();
      resolve();
    };
    const broken = () => fail(new ExportStop('load', `footage failed to load: ${label}`, { clip: label }));
    const aborted = () => fail(cancelled());
    video.addEventListener('loadeddata', ready);
    video.addEventListener('error', broken);
    signal?.addEventListener('abort', aborted, { once: true });
    // Frames are drawn to a canvas and read: its own cache entry on the media domain (see corsMediaUrl).
    video.src = corsMediaUrl(url);
    video.load();
  });
  // The first frame's presentation time: most files start at 0, some do not.
  const first = await seekAndConfirm(video, 0.5 / fps, () => true, signal);
  if (!first.ok || first.last === null) throw new ExportStop('frame', `first frame of ${label} could not be confirmed`, { frame: 0, clip: label });
  const read = await waitShared(readFootage(url).catch(() => null), signal, SHARED_WAIT_MS, null, cancelled);
  const frames = read?.answer.ok && read.answer.timing.video ? read.answer.timing.video.frames : null;
  return { url, video, fps, firstSec: first.last, shown: 0, frames };
}

/**
 * Puts source frame `sourceFrame` on the element and confirms it. A picture past the footage's last one
 * (`picturePlace`, lib/brand-studio/editor-v2/export-plan.ts) is the last one instead: answers `true`
 * when it filled. Anything else that cannot be confirmed stops the export naming the frame.
 */
async function present(source: Source, sourceFrame: number, filmFrame: number, label: string, signal?: AbortSignal): Promise<boolean> {
  const frameSec = 1 / source.fps;
  const stop = (seen: number | null) =>
    new ExportStop('frame', `film frame ${filmFrame}: source frame ${sourceFrame} of "${label}" could not be confirmed (saw ${seen === null ? 'nothing' : `media time ${seen.toFixed(4)}s`})`, {
      frame: filmFrame,
      clip: label,
    });
  // Past the file's own count: its last picture instead.
  const target = source.frames !== null ? Math.min(sourceFrame, source.frames - 1) : sourceFrame;
  const result = await confirmPicture(source, target, signal);
  if (result.ok) return target !== sourceFrame;
  // Not confirmed: past the end only when the element has reached its end showing an earlier picture
  // (the file may list a picture the browser cannot show, review round 1 of part E, item 8).
  const video = source.video;
  const atEnd = video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.5 * frameSec);
  const expectedSec = source.firstSec + target * frameSec;
  const place = picturePlace({ sourceFrame: target, knownFrames: source.frames, confirmed: false, expectedSec, lastSeenSec: result.last, atEnd, frameSec });
  if (place === 'past-end' && result.last !== null) {
    // Filled with the last picture the element really showed.
    const lastShown = Math.max(0, Math.round((result.last - source.firstSec) * source.fps));
    if (lastShown < target && (await confirmPicture(source, lastShown, signal)).ok) return true;
  }
  throw stop(result.last);
}

/** Puts source frame `sourceFrame` on the element and confirms it is that very frame (a few tries). */
async function confirmPicture(source: Source, sourceFrame: number, signal?: AbortSignal): Promise<{ ok: boolean; last: number | null }> {
  if (source.shown === sourceFrame) return { ok: true, last: null };
  const frameSec = 1 / source.fps;
  const expected = source.firstSec + sourceFrame * frameSec;
  const target = expected + 0.5 * frameSec;
  const accept = (mediaTime: number) => Math.abs(mediaTime - expected) < 0.5 * frameSec;
  let last: number | null = null;
  for (let attempt = 0; attempt < FRAME_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      // Force a fresh decode: go to a neighbouring frame first, then back.
      const neighbour = sourceFrame > 0 ? target - frameSec : target + frameSec;
      await seekAndConfirm(source.video, neighbour, () => true, signal);
    }
    const result = await seekAndConfirm(source.video, target, accept, signal);
    if (result.ok) {
      source.shown = sourceFrame;
      return { ok: true, last: result.last };
    }
    last = result.last;
    source.shown = null;
  }
  return { ok: false, last };
}

// ── Drawing ────────────────────────────────────────────────────────────────────────────────────

/**
 * One picture to draw: a `<video>` showing it (the seek path: the element has already turned it and sized
 * it for its pixel shape) or a decoded frame (the decoder path: `displayWidth/Height` carry the pixel
 * shape, `rotation` is the turn the file asks for, which the drawing applies as the element would).
 */
export interface Picture {
  image: CanvasImageSource;
  /** Display size before the turn. */
  width: number;
  height: number;
  rotation: Rotation;
}

export const videoPicture = (video: HTMLVideoElement): Picture => ({ image: video, width: video.videoWidth, height: video.videoHeight, rotation: 0 });

/** The picture's size as shown: width and height swap for a quarter turn. */
export function shownSize(picture: Pick<Picture, 'width' | 'height' | 'rotation'>): { width: number; height: number } {
  const quarter = picture.rotation === 90 || picture.rotation === 270;
  return quarter ? { width: picture.height, height: picture.width } : { width: picture.width, height: picture.height };
}

/** Draws the picture turned as the file asks, filling the rectangle `x, y, w, h` (in shown orientation). */
function drawTurned(ctx: CanvasRenderingContext2D, picture: Picture, x: number, y: number, w: number, h: number) {
  if (picture.rotation === 0) {
    ctx.drawImage(picture.image, x, y, w, h);
    return;
  }
  const quarter = picture.rotation === 90 || picture.rotation === 270;
  const dw = quarter ? h : w;
  const dh = quarter ? w : h;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  // Canvas angles turn clockwise (y points down), as the file's matrix does.
  ctx.rotate((picture.rotation * Math.PI) / 180);
  ctx.drawImage(picture.image, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

/** Draws like the preview's `<video>`: `object-fit` cover or contain, `object-position: x% 50%`. */
export function drawFramed(ctx: CanvasRenderingContext2D, picture: Picture, width: number, height: number, reframe: Reframe): void {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  const { width: vw, height: vh } = shownSize(picture);
  if (vw <= 0 || vh <= 0) return;
  const scale = reframe.fit === 'fill' ? Math.max(width / vw, height / vh) : Math.min(width / vw, height / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  const x = Math.min(100, Math.max(0, reframe.x)) / 100;
  drawTurned(ctx, picture, (width - dw) * x, (height - dh) * 0.5, dw, dh);
}

/** Draws by the current exporter's framing rule (real film): the same rectangle the v2 preview shows. */
export function drawCurrentFraming(ctx: CanvasRenderingContext2D, picture: Picture, width: number, height: number): void {
  ctx.fillStyle = CURRENT_EXPORT_BACKGROUND;
  ctx.fillRect(0, 0, width, height);
  const shown = shownSize(picture);
  const framed = currentExportFrame(shown.width, shown.height, width, height);
  drawTurned(ctx, picture, framed.x, framed.y, framed.width, framed.height);
}

/** The current exporter's overlay drawing, for still images (centre at `x,y`, width `scale` of the frame). */
function drawImageOverlays(ctx: CanvasRenderingContext2D, overlays: readonly ComposeOverlayClip[], images: ReadonlyMap<string, HTMLImageElement>, width: number, height: number) {
  for (const overlay of overlays) {
    const image = images.get(overlay.id);
    if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0) continue;
    const drawW = Math.max(8, Math.round(width * overlay.scale));
    const drawH = Math.max(8, Math.round((drawW * image.naturalHeight) / image.naturalWidth));
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, overlay.opacity));
    ctx.drawImage(image, Math.round(overlay.x * width - drawW / 2), Math.round(overlay.y * height - drawH / 2), drawW, drawH);
    ctx.restore();
  }
}

function loadImage(url: string, label: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const stop = visibleTimer(LOAD_MS, () => reject(new ExportStop('load', `overlay did not load: ${label}`, { clip: label })));
    const aborted = () => {
      stop();
      reject(cancelled());
    };
    image.onload = () => {
      stop();
      signal?.removeEventListener('abort', aborted);
      resolve(image);
    };
    image.onerror = () => {
      stop();
      signal?.removeEventListener('abort', aborted);
      reject(new ExportStop('load', `overlay failed to load: ${label}`, { clip: label }));
    };
    signal?.addEventListener('abort', aborted, { once: true });
    image.src = corsMediaUrl(url);
  });
}

// ── Video encoding ─────────────────────────────────────────────────────────────────────────────

async function pickAvcCodec(width: number, height: number, fps: number): Promise<string | null> {
  const candidates = fps > 30 ? [...AVC_CANDIDATES_HIGH_RATE, ...AVC_CANDIDATES] : AVC_CANDIDATES;
  for (const codec of candidates) {
    try {
      const check = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: VIDEO_BITRATE, framerate: fps, avc: { format: 'avc' } });
      if (check.supported) return codec;
    } catch {
      // Next profile.
    }
  }
  return null;
}

function descriptionBytes(description: AllowSharedBufferSource | undefined): Uint8Array | null {
  if (!description) return null;
  if (description instanceof ArrayBuffer) return new Uint8Array(description.slice(0));
  if (ArrayBuffer.isView(description)) return new Uint8Array(description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength));
  return null;
}

/**
 * Resolves when the encoder takes the next frame from its queue. The `dequeue` event is what ends the wait;
 * the timer is only a guard against a missed event (in a hidden tab timers run at most once a second, so
 * the event, not the timer, must set the pace: spec F, F4).
 */
function dequeued(encoder: VideoEncoder | AudioEncoder): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 1000);
    encoder.addEventListener(
      'dequeue',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

// ── Sound ──────────────────────────────────────────────────────────────────────────────────────

/** The audio graph calls the cut scheduling needs (an `OfflineAudioContext` in the browser, a fake in tests). */
export type SoundGraph = Pick<BaseAudioContext, 'createBufferSource' | 'createGain' | 'destination'>;

/**
 * Places every cut's sound in the mix: a buffer source at the cut's speed, started on the cut's first
 * sample and stopped before the next cut's first sample, read from the cut's first frame, `leadSecOf` its
 * file further on (the picture track's start minus the sound track's, `soundLead`). Returns how many cuts
 * were placed.
 */
export function scheduleCutSound(
  graph: SoundGraph,
  plan: AudioPlan,
  buffers: ReadonlyMap<string, AudioBuffer | null>,
  shiftSecOf: (clipId: string) => number = () => 0,
  leadSecOf: (srcUrl: string) => number = () => 0,
): number {
  let placed = 0;
  for (const segment of plan.segments) {
    if (segment.gain <= 0) continue;
    const buffer = buffers.get(segment.srcUrl);
    if (!buffer) continue;
    const window = soundWindow(segment, plan.totalSamples, plan.sampleRate, shiftSecOf(segment.clipId));
    // Read where the file's own timing puts the sound under this picture (spec E, item B1).
    const span = window ? placeSound(window, leadSecOf(segment.srcUrl), segment.rate, plan.sampleRate) : null;
    if (!span) continue;
    const source = graph.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = segment.rate;
    const gain = graph.createGain();
    gain.gain.value = segment.gain;
    source.connect(gain);
    gain.connect(graph.destination);
    source.start(span.startSample / plan.sampleRate, span.offsetSec);
    // Half a sample before the boundary: the next cut's first sample is never this cut's.
    source.stop((span.endSample - 0.5) / plan.sampleRate);
    placed += 1;
  }
  return placed;
}

/**
 * Reads one of the film's own media files, or asks only its size (`HEAD`). Any other address is refused
 * before a request is made.
 */
function mediaReader(allowed: ReadonlySet<string>, signal?: AbortSignal) {
  const request = async (url: string, method: 'GET' | 'HEAD'): Promise<Response> => {
    if (!allowed.has(url)) throw new ExportStop('sound', `refused to read a file that is not part of the film: ${url}`);
    let response: Response;
    try {
      response = await fetch(corsMediaUrl(url), { method, credentials: 'same-origin', signal });
    } catch (error) {
      if (signal?.aborted) throw cancelled();
      throw new ExportStop('sound', `could not read ${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) throw new ExportStop('sound', `could not read ${url}: HTTP ${response.status}`);
    return response;
  };
  return {
    read: async (url: string): Promise<ArrayBuffer> => (await request(url, 'GET')).arrayBuffer(),
    /** The file's length from its headers; `null` when the server does not say (or will not answer `HEAD`). */
    size: async (url: string): Promise<number | null> => {
      try {
        const length = Number((await request(url, 'HEAD')).headers.get('content-length'));
        return Number.isFinite(length) && length > 0 ? length : null;
      } catch (error) {
        if (signal?.aborted) throw cancelled();
        if (error instanceof ExportStop && error.message.startsWith('refused')) throw error;
        return null;
      }
    },
  };
}

type MediaReader = ReturnType<typeof mediaReader>;

async function mixSound(
  sequence: FrameSequence,
  extras: ComposerProject | null,
  anchor: CutAnchor | null,
  reader: MediaReader,
  signal: AbortSignal | undefined,
  progress: (done: number, total: number) => void,
  noSoundTrack: ReadonlySet<string> = new Set(),
): Promise<{ rendered: AudioBuffer; warnings: ExportWarning[] }> {
  const plan = audioPlan(sequence, EXPORT_SAMPLE_RATE);
  const totalSec = plan.totalSamples / plan.sampleRate;
  const context = new OfflineAudioContext(2, Math.max(1, plan.totalSamples), plan.sampleRate);
  const read = reader.read;
  const warnings: ExportWarning[] = [];
  const labelOf = (url: string) => sequence.clips.find((clip) => clip.srcUrl === url)?.label ?? url;
  // A cut whose file's own boxes say it has no sound track is silent: it is not read whole (spec F, F2).
  const cutUrls = [...new Set(plan.segments.filter((s) => s.gain > 0 && !noSoundTrack.has(s.srcUrl)).map((s) => s.srcUrl))];
  const bgm = extras?.bgm && extras.bgm.volume > 0 && extras.bgm.srcUrl ? extras.bgm : null;
  const sfx = (extras?.sfxClips ?? []).filter((clip) => clip.volume > 0 && clip.srcUrl);
  const steps = cutUrls.length + (bgm ? 1 : 0) + sfx.length + 2;
  let step = 0;
  progress(step, steps);

  // A cut's footage without a sound track decodes to nothing and is simply silent. Footage that HAS a
  // sound track the browser cannot decode (or that cannot be told) is silent too, and said so after export.
  const buffers = new Map<string, AudioBuffer | null>();
  const leads = new Map<string, number>();
  for (const url of cutUrls) {
    throwIfAborted(signal);
    const bytes = await read(url);
    // Inspected before decoding: decoding hands the bytes over.
    const view = new Uint8Array(bytes);
    const track = soundTrackOf(view);
    const lead = soundLead(await timingOfFile(view));
    const decoded = await context.decodeAudioData(bytes).catch(() => null);
    if (!decoded && track !== 'no') warnings.push({ kind: 'sound', clip: labelOf(url) });
    // Its sound is in the file but where it sits under the picture could not be read (WebM, a broken file).
    else if (decoded && !lead.known) warnings.push({ kind: 'soundPosition', clip: labelOf(url) });
    leads.set(url, lead.leadSec);
    buffers.set(url, decoded);
    progress((step += 1), steps);
  }
  // Music and effects are sound files: one that cannot be decoded stops the export.
  const decodeSoundFile = async (url: string, label: string) => {
    const bytes = await read(url);
    try {
      return await context.decodeAudioData(bytes);
    } catch {
      throw new ExportStop('sound', `could not decode ${label}`, { clip: label });
    }
  };

  scheduleCutSound(context, plan, buffers, (clipId) => soundShiftSec(extras, clipId), (url) => leads.get(url) ?? 0);

  // Music and effects, by the current exporter's rules: music loops from its in-point for the whole film.
  if (bgm) {
    throwIfAborted(signal);
    const buffer = await decodeSoundFile(bgm.srcUrl, bgm.label);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = bgm.trimStartSec;
    source.loopEnd = buffer.duration;
    const gain = context.createGain();
    gain.gain.value = bgm.volume;
    source.connect(gain).connect(context.destination);
    source.start(0, bgm.trimStartSec, totalSec);
    progress((step += 1), steps);
  }
  for (const effect of sfx) {
    throwIfAborted(signal);
    const buffer = await decodeSoundFile(effect.srcUrl, effect.label);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = effect.volume;
    source.connect(gain).connect(context.destination);
    // At its exact offset into its cut, as the current editor placed it (spec E, item A); its own length.
    source.start(anchor ? effectStartSec(anchor, effect) : 0, 0, Math.min(buffer.duration, effect.durationSec));
    progress((step += 1), steps);
  }

  throwIfAborted(signal);
  const rendered = await context.startRendering();
  progress((step += 1), steps);
  return { rendered, warnings };
}

async function encodeAac(rendered: AudioBuffer, signal?: AbortSignal): Promise<{ sampleRate: number; channelCount: number; samples: EncodedAudioSample[]; audioSpecificConfig: Uint8Array | null }> {
  const samples: EncodedAudioSample[] = [];
  let config: Uint8Array | null = null;
  let failure: unknown = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({ data, sampleCount: 1024 });
      if (!config) config = descriptionBytes(meta?.decoderConfig?.description);
    },
    error: (error) => {
      failure = error;
    },
  });
  /** Taken back by the browser (`CodecReclaimed`: the sound is encoded again, spec G A2), or failed. */
  const stopped = (): Error | null => (failure ? (isReclaim(failure) ? new CodecReclaimed('audio') : new ExportStop('sound', `sound could not be written: ${describe(failure)}`)) : null);
  try {
    encoder.configure(AUDIO_CONFIG);
    const left = rendered.getChannelData(0);
    const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
    for (let offset = 0; offset < rendered.length; offset += 1024) {
      throwIfAborted(signal);
      const gone = stopped();
      if (gone) throw gone;
      const frames = Math.min(1024, rendered.length - offset);
      const planar = new Float32Array(frames * 2);
      planar.set(left.subarray(offset, offset + frames), 0);
      planar.set(right.subarray(offset, offset + frames), frames);
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate: rendered.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: Math.round((offset / rendered.sampleRate) * 1_000_000),
        data: planar,
      });
      try {
        encoder.encode(data);
      } catch (error) {
        throw stopped() ?? new ExportStop('sound', `sound could not be written: ${describe(error)}`);
      } finally {
        data.close();
      }
      if (encoder.encodeQueueSize > 64) await dequeued(encoder);
    }
    try {
      await encoder.flush();
    } catch (error) {
      throw stopped() ?? new ExportStop('sound', `sound could not be written: ${describe(error)}`);
    }
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  const gone = stopped();
  if (gone) throw gone;
  if (samples.length === 0) throw new ExportStop('sound', 'sound could not be written: no output');
  return { sampleRate: rendered.sampleRate, channelCount: 2, samples, audioSpecificConfig: config };
}

// ── Pictures: one path per source, verified either way ─────────────────────────────────────────


/** Hands the main thread back after this much drawing, through a message (not a timer: timers throttle). */
const YIELD_EVERY_MS = 12;

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/**
 * Which path a source takes (lib/brand-studio/editor-v2/decode-plan.ts `choosePath`), in ONE place for the
 * export and the sheet: its frame facts read, its index read, a colour it was measured on, every cut at the file's own
 * rate, and its codec decoded by this browser. `cutRates`: the `sourceFps` of every cut on it.
 */
type SourceChoice = { path: 'seek'; reason: string } | { path: 'decoder'; index: VideoIndex; config: VideoDecoderConfig };

async function sourceChoice(srcUrl: string, override: ExportPathOverride, cutRates: readonly number[], signal?: AbortSignal): Promise<SourceChoice> {
  const hasDecoder = typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';
  const seek = (input: Partial<Parameters<typeof choosePath>[0]>) =>
    ({ path: 'seek' as const, reason: choosePath({ override, hasDecoder, indexFailure: null, configSupported: null, ...input }).reason ?? 'seek' });
  if (override === 'seek' || !hasDecoder) return seek({});
  // In the export, the shared reads are waited for until cancel or a limit, never aborted (spec G, B1); the
  // sheet's question (`plannedPath`) waits as before.
  const shared = <T,>(work: Promise<T>): Promise<T | 'timeout'> => (signal ? waitShared(work, signal, SHARED_WAIT_MS, 'timeout' as const, cancelled) : work);
  // The clip's frame facts first: when they could not be read the editor numbered it by playback.
  const facts = await shared(readFootage(srcUrl).catch(() => null));
  if (facts === 'timeout') return seek({ factsFailure: 'timeout' });
  const factsFailure = !facts ? 'unreadable' : facts.answer.ok ? null : facts.answer.reason;
  if (factsFailure || !facts?.answer.ok || !facts.answer.timing.video) return seek({ factsFailure: factsFailure ?? 'no-video' });
  const answer = await shared(readPictureIndex(srcUrl).catch(() => ({ ok: false as const, reason: 'unreadable' as const })));
  if (answer === 'timeout') return seek({ indexFailure: 'timeout' });
  if (!answer.ok) return seek({ indexFailure: answer.reason });
  // H.264 and HEVC only: the decoder path was not measured on other codecs (spec G, B3).
  if (!codecMeasured(answer.index.config.entry)) return seek({ codecMeasured: false });
  const plainColour = colourAdmitted(answer.index.config);
  const rateMatches = cutRatesMatch(cutRates, { fps: facts.answer.timing.video.fps, variable: answer.index.variable });
  if (!plainColour || !rateMatches) return seek({ plainColour, rateMatches });
  const config = decoderConfig(answer.index);
  const supported = await decoderSupports(config);
  const choice = choosePath({ override, hasDecoder, indexFailure: null, plainColour, rateMatches, configSupported: supported });
  if (choice.path === 'seek') return { path: 'seek', reason: choice.reason ?? 'seek' };
  return { path: 'decoder', index: answer.index, config };
}

/**
 * The decoder session of a source on the decoder path (`sourceChoice`), as lib/brand-studio/editor-v2/
 * picture-paths.ts uses it; otherwise the reason it is seeked.
 */
function decoderSession(srcUrl: string, plan: readonly PlannedFrame[], fps: number, choice: SourceChoice): DecoderSession<Picture> | { reason: string } {
  if (choice.path === 'seek') return { reason: choice.reason };
  const { index, config } = choice;
  const times = pictureTimes(index);
  const requests = plan.filter((entry) => entry.srcUrl === srcUrl).map((entry) => ({ frame: entry.frame, srcUrl, ...pictureFor(entry, fps, times) }));
  const groups = decodeGroups(requests);
  /** Film frame → its group, the picture it shows, and whether that is past the footage's end. */
  const at = new Map<number, { group: number; picture: number; past: boolean }>();
  let group = 0;
  for (const request of requests) {
    while (groups[group]!.last < request.frame) group += 1;
    at.set(request.frame, { group, picture: request.picture, past: request.past });
  }
  const bytes = sampleBytes(footageBytes(srcUrl));
  const session = new PictureDecoder(index, bytes, config);
  return {
    async picture(frame, signal) {
      const where = at.get(frame)!;
      const image = await session.picture(where.group, groups[where.group]!.pictures, where.picture, signal);
      return { picture: { image, width: image.displayWidth, height: image.displayHeight, rotation: index.rotation }, past: where.past };
    },
    suspend: () => session.suspend(),
    get live() {
      return session.live;
    },
    close: () => session.close(),
    stats() {
      const read = bytes.stats();
      const decoded = session.stats();
      return { bytesRead: read.received, fileBytes: read.fileSize, requests: read.requests, reopened: decoded.reopened, reclaimed: decoded.reclaimed };
    },
  };
}

/**
 * The path a source will be exported on, asked before export (the sheet's line about uneven footage
 * depends on it): its boxes read (cached, shared with the export) and its codec asked of the decoder.
 */
export async function plannedPath(srcUrl: string, override: ExportPathOverride, cutRates: readonly number[]): Promise<ExportPath> {
  return (await sourceChoice(srcUrl, override, cutRates)).path;
}

// ── The export ─────────────────────────────────────────────────────────────────────────────────

/** An error's message, for the console. */
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Reclaimed after the last restart: the export stops as an encoding failure that says so (spec G, A2). */
function givenUp(error: unknown): never {
  if (error instanceof ReclaimedTooOften) throw new ExportStop('encode', error.message);
  throw error;
}

export async function exportFilm(options: ExportFilmOptions): Promise<ExportFilmResult> {
  const { sequence, extras = null, reframe = {}, framing = 'reframe', burnCaptions = true, path: override = null, onProgress, signal } = options;
  const started = performance.now();
  const frames = totalFrames(sequence);
  if (frames === 0 || sequence.clips.length === 0) throw new ExportStop('empty', 'the film has no frames');
  if (!canConfirmFrames()) throw new ExportStop('unsupported', 'this browser cannot confirm video frames (requestVideoFrameCallback)');
  if (!browserCanExport()) throw new ExportStop('unsupported', 'this browser has no video or audio encoder');
  const fps = sequence.fps;
  const anchor = extras ? cutAnchor(extras, sequence) : null;
  const { width, height } = COMPOSE_DIMENSIONS[sequence.aspect];
  const codec = await pickAvcCodec(width, height, fps);
  if (!codec) throw new ExportStop('unsupported', `no H.264 encoder for ${width}×${height} at ${fps} fps`);
  const audioSupport = await AudioEncoder.isConfigSupported(AUDIO_CONFIG).catch(() => null);
  if (!audioSupport?.supported) throw new ExportStop('unsupported', 'this browser cannot write the sound track');

  // Cut files whose own boxes have no sound track at all (media-probe's `soundTrackOf`: `no`, never
  // `unknown`) are silent and never read whole (spec F, F2). Their picture index is read here once, for both.
  const cutUrls = [...new Set(sequence.clips.map((clip) => clip.srcUrl))];
  // Waited for until cancel or a limit, never aborted: the editor shares these reads (spec G, B1).
  const indexes = override === 'seek' ? [] : await Promise.all(cutUrls.map((url) => waitShared(readPictureIndex(url).catch(() => null), signal, SHARED_WAIT_MS, null, cancelled)));
  const noSoundTrack = new Set(cutUrls.filter((_, i) => {
    const answer = indexes[i];
    return !!answer?.ok && answer.index.sound === 'no';
  }));
  // Everything the sound mix reads whole into this tab, added up before the first frame: above the limit
  // the export does not start (review round 1, item 10).
  const reader = mediaReader(soundSourceUrls(sequence, extras), signal);
  const weight = soundBytesCheck(await Promise.all(soundReads(sequence, extras, noSoundTrack).map((url) => reader.size(url))));
  if (weight.over) throw new ExportStop('memory', `the film's sound sources add up to ${weight.total} bytes (limit ${SOUND_BYTES_LIMIT})`, { bytes: weight.total });

  const plan = videoPlan(sequence);
  // Which path each source takes, settled before the encoder exists: these reads wait on the network, and an
  // encoder left idle long enough in a hidden page is taken back by the browser (spec G, A1/A4).
  const choices = new Map(
    await Promise.all(
      cutUrls.map(async (url) => [url, await sourceChoice(url, override, plan.filter((entry) => entry.srcUrl === url).map((entry) => entry.sourceFps), signal)] as const),
    ),
  );
  if (document.fonts?.ready) await document.fonts.ready;
  const overlayImages = new Map<string, HTMLImageElement>();
  for (const overlay of (extras?.overlays ?? []).filter((o) => o.mediaKind === 'image')) {
    overlayImages.set(overlay.id, await loadImage(overlay.srcUrl, overlay.label, signal));
  }

  // The browser takes back an encoder that sat idle about 90 s in a hidden page (spec G, A1): the attempt then
  // starts again from frame 0 once the page is on screen again, at most MAX_RESTARTS times (A2). The sheet's
  // count goes back to 0 and it says why (`restarts` in every progress report after the first restart).
  let restarts = 0;
  const report = (progress: ExportProgress) => onProgress?.(restarts > 0 ? { ...progress, restarts } : progress);
  const restarted = (phase: ExportProgress['phase'], total: number) => () => {
    restarts += 1;
    report({ phase, done: 0, total });
  };
  const waitVisible = () => whenVisible(document, signal, cancelled);
  const pass: VideoPass = { sequence, extras, reframe, framing, burnCaptions, override, signal, plan, choices, codec, width, height, fps, anchor, overlayImages, report };
  const video = await runWithRestarts(() => videoPass(pass), waitVisible, { onRestart: restarted('video', frames) }).catch(givenUp);

  const { rendered, warnings } = await mixSound(sequence, extras, anchor, reader, signal, (done, total) => report({ phase: 'audio', done, total }), noSoundTrack);
  // The rendered sound is still in hand: only its encoding starts again (spec G, A2).
  const audio = await runWithRestarts(() => encodeAac(rendered, signal), waitVisible, { onRestart: restarted('audio', 1) }).catch(givenUp);

  throwIfAborted(signal);
  report({ phase: 'writing', done: 0, total: 1 });
  const bytes = muxAvc1ToMp4({ width, height, fps, videoSamples: video.result.samples, avcDecoderConfigRecord: video.result.avcConfig, audio: audio.result });
  report({ phase: 'writing', done: 1, total: 1 });
  return {
    blob: new Blob([bytes.buffer as ArrayBuffer], { type: 'video/mp4' }),
    mime: 'video/mp4',
    filename: exportFilename(new Date()),
    width,
    height,
    fps,
    frames,
    durationSec: frames / fps,
    elapsedMs: Math.round(performance.now() - started),
    notIncluded: notIncluded({ sequence, extras }),
    warnings: [...lastFrameWarnings(video.result.filled), ...warnings],
    paths: video.result.paths,
    restarts,
  };
}

interface VideoPass {
  sequence: FrameSequence;
  extras: ComposerProject | null;
  reframe: Readonly<Record<string, Reframe>>;
  framing: 'reframe' | 'current';
  burnCaptions: boolean;
  override: ExportPathOverride;
  signal: AbortSignal | undefined;
  plan: readonly PlannedFrame[];
  choices: ReadonlyMap<string, SourceChoice>;
  codec: string;
  width: number;
  height: number;
  fps: number;
  anchor: CutAnchor | null;
  overlayImages: ReadonlyMap<string, HTMLImageElement>;
  report: (progress: ExportProgress) => void;
}

/**
 * Every picture of the film, drawn and encoded once, from frame 0: one attempt. Everything it opens (sources,
 * decoders, the hidden host, the encoder) is let go when it ends, however it ends. An encoder the browser took
 * back ends it with `CodecReclaimed` (the export starts it again); that is checked after each picture arrives
 * and before `encode()`, so no raw "closed codec" error escapes.
 */
async function videoPass(pass: VideoPass): Promise<{ samples: EncodedVideoSample[]; avcConfig: Uint8Array | null; paths: SourcePath[]; filled: FilledCuts }> {
  const { sequence, extras, reframe, framing, burnCaptions, override, signal, plan, choices, codec, width, height, fps, anchor, overlayImages, report } = pass;
  const frames = plan.length;
  const labels = new Map(sequence.clips.map((clip) => [clip.id, clip.label] as const));
  const indexOf = new Map(sequence.clips.map((clip, index) => [clip.id, index] as const));
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:64px;height:36px;overflow:hidden;pointer-events:none';
  document.body.appendChild(host);
  const seekSources = new Map<string, Source>();
  /** Pictures asked for past a footage's last one, filled with it, by cut id (named by its clip). */
  const filled: FilledCuts = new Map();
  let encoder: VideoEncoder | null = null;
  let pathNow: ExportPath | undefined;
  let lastYield = performance.now();
  const releaseVideo = (source: Source) => {
    source.video.pause();
    source.video.removeAttribute('src');
    source.video.load();
  };
  // Which path makes each picture; a decoder failure hands the rest of that source to seeking; a source lets go
  // of everything after its last film frame; at most four decoders open (spec G, B2).
  const paths = new PicturePaths<Picture, PlannedFrame>(plan, {
    decoder: (srcUrl, label) => {
      const opened = decoderSession(srcUrl, plan, fps, choices.get(srcUrl)!);
      if ('reason' in opened && override === 'decoder') throw new ExportStop('unsupported', `"${label}" cannot be decoded (${opened.reason}) and the decoder path was required`, { clip: label });
      return opened;
    },
    seek: async (entry, label) => {
      if (pathNow !== 'seek') report({ phase: 'video', done: entry.frame, total: frames, path: 'seek' });
      let source = seekSources.get(entry.srcUrl);
      if (!source) {
        source = await openSource(entry.srcUrl, entry.sourceFps, label, host, signal);
        seekSources.set(entry.srcUrl, source);
      }
      // Consecutive frames on the same source frame (a slowed cut) reuse the picture: no second seek.
      const past = await present(source, entry.sourceFrame, entry.frame, label, signal);
      return { picture: videoPicture(source.video), past };
    },
    releaseSeek: (srcUrl) => {
      const source = seekSources.get(srcUrl);
      if (!source) return;
      releaseVideo(source);
      seekSources.delete(srcUrl);
    },
    required:
      override === 'decoder'
        ? (entry, label, message) => new ExportStop('frame', `film frame ${entry.frame}: the decoder could not give its picture of "${label}" (${message})`, { frame: entry.frame, clip: label })
        : undefined,
    cancelled: () => !!signal?.aborted,
    left: (label, message) => console.warn('[editor export] decoder path left for seeking', label, message),
  });

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const graded = !!extras?.colorGrade;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: graded });
    if (!ctx) throw new ExportStop('unsupported', 'no canvas');
    ctx.imageSmoothingQuality = 'high';

    const samples: EncodedVideoSample[] = [];
    const stamps: number[] = [];
    let avcConfig: Uint8Array | null = null;
    let failure: unknown = null;
    const made = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        const index = samples.length;
        samples.push({ data, isKeyFrame: chunk.type === 'key', durationUs: frameDurationUs(index, fps) });
        stamps.push(chunk.timestamp);
        if (!avcConfig) avcConfig = descriptionBytes(meta?.decoderConfig?.description);
      },
      error: (error) => {
        failure = error;
      },
    });
    encoder = made;
    made.configure({ codec, width, height, bitrate: VIDEO_BITRATE, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' });
    /** The encoder takes no more frames: the browser took it back (`CodecReclaimed`: started again), or it failed. */
    const stopped = (frame: number): Error | null => {
      if (failure) return isReclaim(failure) ? new CodecReclaimed('video') : new ExportStop('encode', `the video encoder stopped at film frame ${frame}: ${describe(failure)}`, { frame });
      if (made.state === 'closed') return new ExportStop('encode', `the video encoder was closed at film frame ${frame}`, { frame });
      return null;
    };

    for (const entry of plan) {
      throwIfAborted(signal);
      const before = stopped(entry.frame);
      if (before) throw before;
      const label = labels.get(entry.clipId) ?? entry.clipId;
      const shown = await paths.picture(entry, label, signal).catch((error: unknown) => {
        throwIfAborted(signal);
        throw error;
      });
      pathNow = shown.path;
      // The picture may have taken long (the seek path in a hidden window): the encoder is asked again (spec G, A2).
      const after = stopped(entry.frame);
      if (after) throw after;
      // Filled frames are counted the same way on both paths: per cut, frames and the distinct pictures asked for.
      if (shown.past) noteFilled(filled, entry.clipId, label, entry.sourceFrame);
      if (framing === 'current') drawCurrentFraming(ctx, shown.picture, width, height);
      else drawFramed(ctx, shown.picture, width, height, reframe[entry.clipId] ?? DEFAULT_REFRAME);
      if (graded && extras) {
        const index = indexOf.get(entry.clipId) ?? 0;
        applyProjectColorGradeFrame(ctx, width, height, extras, storedCutFor(extras, sequence.clips[index]!, index));
      }
      drawImageOverlays(ctx, imageOverlaysAt(extras, entry.frame, anchor), overlayImages, width, height);
      if (burnCaptions) drawCaptionsOverlay(ctx, captionsAt(sequence, entry.frame), width, height);

      const frame = new VideoFrame(canvas, { timestamp: timestampUs(entry.frame, fps), duration: frameDurationUs(entry.frame, fps) });
      // Closed whatever encode() does: a frame left to the garbage collector is a warning (spec G, A0).
      try {
        made.encode(frame, { keyFrame: isKeyFrame(entry.frame, fps) });
      } catch (error) {
        throw stopped(entry.frame) ?? new ExportStop('encode', `the video encoder refused film frame ${entry.frame}: ${describe(error)}`, { frame: entry.frame });
      } finally {
        frame.close();
      }
      // A source whose last film frame this was lets go of its decoder, frame and bytes now (spec G, B2).
      paths.done(entry.frame);
      while (made.encodeQueueSize > 6 && !stopped(entry.frame)) await dequeued(made);
      report({ phase: 'video', done: entry.frame + 1, total: frames, path: shown.path });
      if (performance.now() - lastYield > YIELD_EVERY_MS) {
        await yieldToPage();
        lastYield = performance.now();
      }
    }
    try {
      await made.flush();
    } catch (error) {
      throw stopped(frames) ?? new ExportStop('encode', `the video encoder failed: ${describe(error)}`);
    }
    const ended = stopped(frames);
    if (ended) throw ended;
    if (samples.length !== frames) throw new ExportStop('encode', `the encoder returned ${samples.length} frames for ${frames}`);
    const misplaced = stamps.findIndex((stamp, index) => stamp !== timestampUs(index, fps));
    if (misplaced >= 0) throw new ExportStop('encode', `encoded frame ${misplaced} carries the wrong time`, { frame: misplaced });
    return { samples, avcConfig, paths: paths.paths(), filled };
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
    paths.closeAll();
    for (const source of seekSources.values()) releaseVideo(source);
    host.remove();
  }
}
