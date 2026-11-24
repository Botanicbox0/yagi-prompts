/**
 * Editing studio v2 — the timing an MP4 or MOV file states in its own boxes (ISO/IEC 14496-12; QuickTime
 * uses the same layout). Spec E, items C1 and B1.
 *
 * C1, frame facts: the footage's rate, its number of frames, whether they are evenly spaced and when the
 * first one is shown come from the video track's sample table (`stts` durations, `ctts` offsets, `mdhd`
 * time scale, the edit list; in a fragmented file the `tfdt` / `trun` of every fragment). Measuring by
 * playback (`requestVideoFrameCallback`) failed on production in a window covered by another window:
 * the page stays "visible" but the screen refreshes about once a second. Reading boxes does not depend
 * on the screen and finishes at once; playback measuring stays only for files this reader cannot read.
 *
 * B1, where each track starts: the movie time of the first frame shown and of the first sound sample
 * played, with the edit list applied (`elst`: empty edits, `media_time`, `mvhd` / `mdhd` time scales; the
 * first sample's composition offset; `tfdt` + the first `trun` sample in a fragmented file).
 *
 * Measured in Chromium (full build, 2026-11-21) on files ffmpeg 8.1 wrote with each layout
 * (scripts/editor-v2-sound-sync-check.py prints the table):
 *
 * - `requestVideoFrameCallback`'s `mediaTime` of the first frame is the container's movie time of the
 *   first frame shown, which is ffprobe's video `start_time`: 0 (plain; B-frames with an edit list),
 *   0.5 (picture behind a 0.5 s empty edit), 0.083333 (B-frames without an edit list, and ffmpeg's
 *   fragmented output, whose moov has no edit list). Chromium does not move a file's start to 0.
 * - `decodeAudioData`'s sample 0 is the movie time of the first sound sample KEPT by the edit list:
 *   samples before the edit's `media_time` are dropped (the AAC encoder delay ffmpeg marks with
 *   media_time 1024 is not in the buffer: a beep written at 1.000 s is at sample 48 004 of 168 000),
 *   an empty edit is NOT turned into silence (sample 0 is the edit's start: 0.478 s and 0.278 s for
 *   ffmpeg's "-output_ts_offset 0.5" and "-itsoffset 0.3" files, buffers 169 023 samples long, the
 *   encoder delay inside them), and without an edit list sample 0 is the first sample's own time. That
 *   moment is what `soundStartSec` gives, and it equals ffprobe's audio `start_time` on every file.
 *
 * So the sound for picture frame k (shown at `video.firstSec + k / fps`) is decoded sample
 * `(video.firstSec − sound.firstSec + k / fps) × rate`.
 *
 * What a later decoder path (`VideoDecoder` fed from the file, spec E addendum C2) would still need from
 * here and is not read yet: each sample's size and file offset (`stsz`, `stsc`, `stco` / `co64`; in
 * fragments the `trun` sizes and data offsets with the `tfhd` base), which samples are key frames (`stss`,
 * `trun` sample flags) and the codec configuration (`stsd`: `avcC` / `hvcC`).
 *
 * Pure: bytes in, an answer out. `gatherBoxes` takes any byte source, so the browser can fetch only the
 * boxes it needs with Range requests (components/brand-studio/editor-v2/footage-facts.ts).
 */
import { TOP_LEVEL, boxes, type Box } from './media-probe';

export interface VideoTiming {
  /** Movie time of the first frame shown, in seconds (the edit list applied; ffprobe's `start_time`). */
  firstSec: number;
  /** Frames shown: those inside the edit list. */
  frames: number;
  /** Frames per second, `fpsNum / fpsDen`: exact when the frames are evenly spaced (24000/1001 stays that). */
  fps: number;
  fpsNum: number;
  fpsDen: number;
  /** The frames are not evenly spaced (no rate fits their times, see `fitsRate`): the editor does not support such footage. */
  variable: boolean;
  /** The track's own time scale (`mdhd`). */
  timescale: number;
}

export interface SoundTiming {
  /** Movie time of the first sound sample played, in seconds: where `decodeAudioData`'s sample 0 belongs. */
  firstSec: number;
}

export interface FileTiming {
  video: VideoTiming | null;
  /**
   * `null`: the file has no sound track. `unknown`: it has one whose edit list the reader cannot follow
   * (review round 1 of part E, item 3): the picture facts still stand, where the sound sits is not known.
   */
  sound: SoundTiming | 'unknown' | null;
  fragmented: boolean;
}

/**
 * Why a file could not be read: not an MP4 / MOV; no `moov`; boxes cut off or inconsistent; an edit list
 * the export cannot follow (more than one piece of media, or a changed speed); too many fragments; too many
 * requests; a fragmented file too large to walk; more bytes than allowed from a server that sends the
 * whole file; or the file is not there at all (`gone`: the server answered 404 or 410, audit A4). `broken`
 * may pass on another try (a refused request or a network error lands there too), and so may `gone` (an
 * asset can come back); the others are the file's own and are remembered for the visit (footage-facts.ts).
 */
export type TimingFailure = 'not-mp4' | 'no-moov' | 'broken' | 'gone' | 'edits' | 'too-many-boxes' | 'too-many-requests' | 'fragmented-too-large' | 'too-large';

export type TimingAnswer = { ok: true; timing: FileTiming } | { ok: false; reason: TimingFailure };

export interface FoundBoxes {
  moov: Uint8Array;
  /** The fragments' `moof` boxes, in file order (none for an ordinary file). */
  moofs: Uint8Array[];
}

/** Any way of reading a file's bytes: `[start, start + length)`, fewer at the end of the file. */
export interface ByteSource {
  read(start: number, length: number): Promise<Uint8Array>;
  /** The file's whole length when known (a Range answer's total), else `null`. */
  size?(): number | null;
  /** Raises the most requests it may make (a fragmented file's own budget for its fragments, spec G B8). */
  allow?(requests: number): void;
}

/** A byte source that has made all the requests it may (ranged-source.ts `MAX_RANGE_REQUESTS`). */
export class ReadLimit extends Error {
  constructor() {
    super('too many requests for one file');
    this.name = 'ReadLimit';
  }
}

/**
 * A byte source that has received all the bytes it may without finding what was asked for (a server that
 * sends the whole file, ranged-source.ts `MAX_WHOLE_BYTES`; review round 2 of part E).
 */
export class ByteLimit extends Error {
  constructor() {
    super('too many bytes for one file');
    this.name = 'ByteLimit';
  }
}

/**
 * The most of a fragmented file read to walk its fragments: its fragments' `moof` boxes are spread over
 * the whole file, so the rest after the `moov` is fetched in one request and walked in memory, up to this
 * size; a larger one (or one whose size is not known) is measured by playback instead (review round 1 of
 * part E, item 10).
 */
export const MAX_FRAGMENTED_BYTES = 64 * 1024 * 1024;

/**
 * How far a picture's time may sit from where a rate puts it and still be on that rate: one tick of the
 * track's clock or one millisecond, whichever is more (clocks that cannot hold a rate round each frame's
 * time: 24 fps on a 1/1000 s clock is 41, 42, 42 ms …; the same footage remuxed onto a 1/16000 clock keeps
 * those milliseconds as 656 and 672 ticks). Review round 1 of part E, item 2.
 */
export const RATE_FIT_MS = 1;
/** The most top-level boxes the reader walks (a fragmented file has two per fragment). */
export const MAX_TOP_BOXES = 20_000;
/** The most samples one track may list before the file is treated as broken. */
const MAX_SAMPLES = 4_000_000;

// ── Bytes ──────────────────────────────────────────────────────────────────────────────────────

const type4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
const i32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const i64 = (b: Uint8Array, at: number) => {
  const high = i32(b, at);
  return high * 2 ** 32 + u32(b, at + 4);
};
const i16 = (b: Uint8Array, at: number) => ((b[at]! << 8) | b[at + 1]!) << 16 >> 16;

class Broken extends Error {}

function need(box: Box, bytes: number) {
  if (box.body + bytes > box.end) throw new Broken();
}

function children(bytes: Uint8Array, box: Box): Box[] {
  const found = boxes(bytes, box.body, box.end);
  if (!found) throw new Broken();
  return found;
}

const child = (bytes: Uint8Array, box: Box | undefined, type: string): Box | undefined =>
  box ? children(bytes, box).find((entry) => entry.type === type) : undefined;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

// ── The movie ──────────────────────────────────────────────────────────────────────────────────

interface Edit {
  /** In the movie's time scale; `0` = to the end. */
  duration: number;
  /** In the track's time scale; `-1` = an empty edit. */
  mediaTime: number;
  rate: number;
}

interface Track {
  id: number;
  handler: string;
  timescale: number;
  edits: Edit[] | null;
  /** The sample table's time boxes (read only for the tracks the timing uses). */
  stts: Box | null;
  ctts: Box | null;
  /** Samples the sample table lists, counted without expanding them. */
  listed: number;
  /**
   * `expand`: every sample's decode time, duration and composition offset (the picture track);
   * `first`: only the first sample's composition time (the sound track); `skip`: nothing (every other track).
   * Review round 1 of part E, item 10: a moov with many tracks must not fill the tab's memory.
   */
  mode: 'expand' | 'first' | 'skip';
  /** Decode time, duration and composition offset of every sample, in decode order (`expand`). */
  dts: number[];
  durations: number[];
  offsets: number[];
  /** Composition time of the first sample, and whether any was seen (`first`). */
  first: number | null;
  /** Where the next fragment continues when it carries no `tfdt`. */
  next: number;
  /** `trex` default sample duration (fragmented files). */
  defaultDuration: number;
}

interface Movie {
  timescale: number;
  tracks: Track[];
  fragmented: boolean;
  video: Track | null;
  sound: Track | null;
}

/** What the last read expanded (for the tests that hold the memory bound). */
export const containerStats = { expandedSamples: 0 };

function readMoov(bytes: Uint8Array): Movie {
  const top = boxes(bytes, 0, bytes.length);
  const moov = top?.find((entry) => entry.type === 'moov');
  if (!moov) throw new Broken();
  const parts = children(bytes, moov);
  const mvhd = parts.find((entry) => entry.type === 'mvhd');
  if (!mvhd) throw new Broken();
  need(mvhd, 24);
  const timescale = bytes[mvhd.body] === 1 ? u32(bytes, mvhd.body + 20) : u32(bytes, mvhd.body + 12);
  if (timescale <= 0) throw new Broken();
  const tracks = parts.filter((entry) => entry.type === 'trak').map((trak) => readTrak(bytes, trak));
  const mvex = parts.find((entry) => entry.type === 'mvex');
  if (mvex) {
    for (const trex of children(bytes, mvex).filter((entry) => entry.type === 'trex')) {
      need(trex, 16);
      const track = tracks.find((entry) => entry.id === u32(bytes, trex.body + 4));
      if (track) track.defaultDuration = u32(bytes, trex.body + 12);
    }
  }
  // The tracks the timing uses: the first picture track and the first sound track with samples (in a
  // fragmented file the samples are in the fragments: the first of each kind).
  const pick = (handler: string) => tracks.find((track) => track.handler === handler && (track.listed > 0 || !!mvex)) ?? null;
  const video = pick('vide');
  const sound = pick('soun');
  if (video) {
    video.mode = 'expand';
    expandSampleTable(bytes, video);
  }
  if (sound) {
    sound.mode = 'first';
    if (sound.listed > 0) sound.first = firstComposition(bytes, sound);
  }
  return { timescale, tracks, fragmented: !!mvex, video, sound };
}

function readTrak(bytes: Uint8Array, trak: Box): Track {
  const parts = children(bytes, trak);
  const tkhd = parts.find((entry) => entry.type === 'tkhd');
  const mdia = parts.find((entry) => entry.type === 'mdia');
  if (!tkhd || !mdia) throw new Broken();
  need(tkhd, 24);
  const id = bytes[tkhd.body] === 1 ? u32(bytes, tkhd.body + 20) : u32(bytes, tkhd.body + 12);
  const mdhd = child(bytes, mdia, 'mdhd');
  const hdlr = child(bytes, mdia, 'hdlr');
  if (!mdhd || !hdlr) throw new Broken();
  need(mdhd, 24);
  need(hdlr, 12);
  const timescale = bytes[mdhd.body] === 1 ? u32(bytes, mdhd.body + 20) : u32(bytes, mdhd.body + 12);
  if (timescale <= 0) throw new Broken();
  const stbl = child(bytes, child(bytes, mdia, 'minf'), 'stbl');
  const tables = stbl ? children(bytes, stbl) : [];
  const stts = tables.find((entry) => entry.type === 'stts') ?? null;
  const ctts = tables.find((entry) => entry.type === 'ctts') ?? null;
  let listed = 0;
  if (stts) {
    need(stts, 8);
    const runs = u32(bytes, stts.body + 4);
    need(stts, 8 + runs * 8);
    for (let i = 0, at = stts.body + 8; i < runs; i += 1, at += 8) listed += u32(bytes, at);
  }
  return {
    id,
    handler: type4(bytes, hdlr.body + 8),
    timescale,
    edits: readEdits(bytes, parts.find((entry) => entry.type === 'edts')),
    stts,
    ctts,
    listed,
    mode: 'skip',
    dts: [],
    durations: [],
    offsets: [],
    first: null,
    next: 0,
    defaultDuration: 0,
  };
}

function readEdits(bytes: Uint8Array, edts: Box | undefined): Edit[] | null {
  const elst = child(bytes, edts, 'elst');
  if (!elst) return null;
  need(elst, 8);
  const wide = bytes[elst.body] === 1;
  const count = u32(bytes, elst.body + 4);
  const row = wide ? 20 : 12;
  need(elst, 8 + count * row);
  const edits: Edit[] = [];
  for (let i = 0, at = elst.body + 8; i < count; i += 1, at += row) {
    const duration = wide ? u64(bytes, at) : u32(bytes, at);
    const mediaTime = wide ? i64(bytes, at + 8) : i32(bytes, at + 4);
    const rateAt = at + (wide ? 16 : 8);
    edits.push({ duration, mediaTime, rate: i16(bytes, rateAt) + i16(bytes, rateAt + 2) / 65536 });
  }
  return edits;
}

/** A composition offset as written: version 1 is signed; version 0 too when only that makes sense. */
function cttsOffset(bytes: Uint8Array, ctts: Box, at: number): number {
  const raw = u32(bytes, at);
  return bytes[ctts.body] === 1 || raw > 0x7fffffff ? i32(bytes, at) : raw;
}

/** The first sample's composition time from the sample table, without expanding it (decode time 0). */
function firstComposition(bytes: Uint8Array, track: Track): number {
  const ctts = track.ctts;
  if (!ctts) return 0;
  need(ctts, 8);
  return u32(bytes, ctts.body + 4) > 0 && ctts.body + 16 <= ctts.end ? cttsOffset(bytes, ctts, ctts.body + 12) : 0;
}

function expandSampleTable(bytes: Uint8Array, track: Track) {
  const { stts, ctts } = track;
  if (!stts) return;
  if (track.listed > MAX_SAMPLES) throw new Broken();
  const runs = u32(bytes, stts.body + 4);
  let dt = 0;
  for (let i = 0, at = stts.body + 8; i < runs; i += 1, at += 8) {
    const count = u32(bytes, at);
    const delta = u32(bytes, at + 4);
    for (let k = 0; k < count; k += 1) {
      track.dts.push(dt);
      track.durations.push(delta);
      track.offsets.push(0);
      dt += delta;
    }
  }
  track.next = dt;
  if (!ctts) return;
  need(ctts, 8);
  const cttsRuns = u32(bytes, ctts.body + 4);
  need(ctts, 8 + cttsRuns * 8);
  let index = 0;
  for (let i = 0, at = ctts.body + 8; i < cttsRuns; i += 1, at += 8) {
    const count = u32(bytes, at);
    // Version 0 is unsigned by the standard, but writers put negative values there too: read as signed
    // when the value only makes sense that way (more than half the 32-bit range).
    const offset = cttsOffset(bytes, ctts, at + 4);
    for (let k = 0; k < count && index < track.offsets.length; k += 1, index += 1) track.offsets[index] = offset;
  }
}

/** One fragment's samples, added to the tracks the timing uses (the sound track: its first sample only). */
function readMoof(bytes: Uint8Array, movie: Movie) {
  const top = boxes(bytes, 0, bytes.length);
  const moof = top?.find((entry) => entry.type === 'moof');
  if (!moof) throw new Broken();
  for (const traf of children(bytes, moof).filter((entry) => entry.type === 'traf')) {
    const parts = children(bytes, traf);
    const tfhd = parts.find((entry) => entry.type === 'tfhd');
    if (!tfhd) throw new Broken();
    need(tfhd, 8);
    const flags = u32(bytes, tfhd.body) & 0xffffff;
    const track = movie.tracks.find((entry) => entry.id === u32(bytes, tfhd.body + 4));
    if (!track || track.mode === 'skip' || (track.mode === 'first' && track.first !== null)) continue;
    let at = tfhd.body + 8;
    if (flags & 0x01) at += 8;
    if (flags & 0x02) at += 4;
    let defaultDuration = track.defaultDuration;
    if (flags & 0x08) {
      if (at + 4 > tfhd.end) throw new Broken();
      defaultDuration = u32(bytes, at);
    }
    const tfdt = parts.find((entry) => entry.type === 'tfdt');
    let dt = track.next;
    if (tfdt) {
      need(tfdt, 8);
      dt = bytes[tfdt.body] === 1 ? (need(tfdt, 12), u64(bytes, tfdt.body + 4)) : u32(bytes, tfdt.body + 4);
    }
    for (const trun of parts.filter((entry) => entry.type === 'trun')) {
      need(trun, 8);
      const signed = bytes[trun.body] === 1;
      const runFlags = u32(bytes, trun.body) & 0xffffff;
      const count = u32(bytes, trun.body + 4);
      let pos = trun.body + 8 + (runFlags & 0x01 ? 4 : 0) + (runFlags & 0x04 ? 4 : 0);
      const row = (runFlags & 0x100 ? 4 : 0) + (runFlags & 0x200 ? 4 : 0) + (runFlags & 0x400 ? 4 : 0) + (runFlags & 0x800 ? 4 : 0);
      if (pos + count * row > trun.end || track.durations.length + count > MAX_SAMPLES) throw new Broken();
      for (let k = 0; k < count; k += 1) {
        let duration = defaultDuration;
        let offset = 0;
        if (runFlags & 0x100) {
          duration = u32(bytes, pos);
          pos += 4;
        }
        if (runFlags & 0x200) pos += 4;
        if (runFlags & 0x400) pos += 4;
        if (runFlags & 0x800) {
          // As `cttsOffset`: version 0 read signed when only that makes sense (spec G, B4).
          const raw = u32(bytes, pos);
          offset = signed || raw > 0x7fffffff ? i32(bytes, pos) : raw;
          pos += 4;
        }
        if (track.mode === 'first') {
          if (track.first === null) track.first = dt + offset;
        } else {
          track.dts.push(dt);
          track.durations.push(duration);
          track.offsets.push(offset);
        }
        dt += duration;
      }
    }
    track.next = dt;
  }
}

// ── Timing ─────────────────────────────────────────────────────────────────────────────────────

interface Window {
  /** Seconds of empty edits before the media starts. */
  emptySec: number;
  /** The media time the edit starts at (track ticks); -Infinity without an edit list. */
  from: number;
  /** One past the last media time shown (track ticks). */
  to: number;
}

/** What the edit list shows of the track: empty edits, then at most one piece of media at normal speed. */
function windowOf(track: Track, movieTimescale: number): Window | null {
  if (!track.edits || track.edits.length === 0) return { emptySec: 0, from: -Infinity, to: Infinity };
  let empty = 0;
  let i = 0;
  while (i < track.edits.length && track.edits[i]!.mediaTime === -1) empty += track.edits[i++]!.duration;
  const rest = track.edits.slice(i);
  if (rest.length !== 1 || rest[0]!.rate !== 1) return null;
  const edit = rest[0]!;
  const to = edit.duration > 0 ? edit.mediaTime + (edit.duration * track.timescale) / movieTimescale : Infinity;
  return { emptySec: empty / movieTimescale, from: edit.mediaTime, to };
}

/**
 * Movie time of the first sample shown, in seconds. Without an edit list: the sample's own composition
 * time. With one: the edit's start, wherever inside the first kept sample the edit's media time falls.
 * Measured (Chromium and ffmpeg alike): an edit list starting at media time 3686 of a 512-tick-per-frame
 * track shows frame 8 (composition time 4096) from movie time 0, not from 0.0334 s, and ffprobe's
 * start_time is 0; sound kept after an encoder delay starts at the edit's start too.
 */
function firstShownAt(window: Window, track: Track, composition: number): number {
  return Number.isFinite(window.from) ? window.emptySec : composition / track.timescale;
}

const RATES: ReadonlyArray<readonly [number, number]> = [
  [24000, 1001], [30000, 1001], [48000, 1001], [60000, 1001], [120000, 1001],
  [24, 1], [25, 1], [30, 1], [48, 1], [50, 1], [60, 1], [90, 1], [100, 1], [120, 1],
];

function fraction(num: number, den: number): [number, number] {
  const divisor = gcd(Math.round(num), Math.round(den)) || 1;
  return [Math.round(num) / divisor, Math.round(den) / divisor];
}

/**
 * How far, at most, the pictures shown at `times` (sorted, track ticks) sit from where `num/den` fps puts
 * them, counted from the first.
 */
function worstDeviation(times: readonly number[], timescale: number, num: number, den: number): number {
  const period = (timescale * den) / num;
  let worst = 0;
  for (let k = 0; k < times.length; k += 1) worst = Math.max(worst, Math.abs(times[k]! - (times[0]! + k * period)));
  return worst;
}

/**
 * The footage's rate from its pictures' presentation times, whatever its clock (review round 1 of part E,
 * item 2). A rate fits when every picture sits within `RATE_FIT_MS` (or one tick) of where it puts it.
 * Candidates: every standard rate (the fit itself rules out the wrong ones: over a few frames a clock
 * rounding to the millisecond can move the average by more than 0.1 %); the fitting one with the smallest worst
 * deviation wins, a tie going to the one nearest the average (a true 24 fps file on a millisecond clock is
 * 24, never 23.976; over a dozen frames the two cannot be told apart, and the closer fit is taken). Only
 * when no standard rate fits, the average itself is tried. Nothing fits: not evenly spaced.
 */
function rateOfTimes(times: readonly number[], timescale: number): { num: number; den: number } | null {
  const n = times.length;
  const span = times[n - 1]! - times[0]!;
  if (n < 2 || span <= 0) return null;
  const average = ((n - 1) * timescale) / span;
  const tolerance = Math.max(1, timescale * (RATE_FIT_MS / 1000)) + 1e-9;
  let best: { num: number; den: number; worst: number } | null = null;
  for (const [num, den] of RATES) {
    const worst = worstDeviation(times, timescale, num, den);
    if (worst > tolerance) continue;
    const closer = !best || worst < best.worst - 1e-9 || (Math.abs(worst - best.worst) <= 1e-9 && Math.abs(num / den - average) < Math.abs(best.num / best.den - average));
    if (closer) best = { num, den, worst };
  }
  if (best) return { num: best.num, den: best.den };
  const [num, den] = fraction((n - 1) * timescale, span);
  return worstDeviation(times, timescale, num, den) <= tolerance ? { num, den } : null;
}

function videoTiming(track: Track, movieTimescale: number): VideoTiming | 'edits' {
  const window = windowOf(track, movieTimescale);
  if (!window) return 'edits';
  const shown: number[] = [];
  for (let i = 0; i < track.dts.length; i += 1) {
    const composition = track.dts[i]! + track.offsets[i]!;
    if (composition >= window.from && composition < window.to) shown.push(i);
  }
  if (shown.length === 0) return 'edits';
  let first = Infinity;
  for (const i of shown) first = Math.min(first, track.dts[i]! + track.offsets[i]!);
  const durations = shown.map((i) => track.durations[i]!);
  // The last picture's duration is not looked at: muxers often write it short.
  const body = durations.length > 1 ? durations.slice(0, -1) : durations;
  let num: number;
  let den: number;
  let even = true;
  if (body[0]! > 0 && body.every((d) => d === body[0])) {
    // Every picture lasts the same: the exact fraction (24000/1001 stays that).
    [num, den] = fraction(track.timescale, body[0]!);
  } else {
    const times = shown.map((i) => track.dts[i]! + track.offsets[i]!).sort((a, b) => a - b);
    const fit = rateOfTimes(times, track.timescale);
    if (fit) {
      ({ num, den } = fit);
    } else {
      even = false;
      [num, den] = fraction(durations.length * track.timescale, durations.reduce((a, b) => a + b, 0));
    }
  }
  if (!(num > 0 && den > 0)) return 'edits';
  return { firstSec: firstShownAt(window, track, first), frames: shown.length, fps: num / den, fpsNum: num, fpsDen: den, variable: !even, timescale: track.timescale };
}

function soundTiming(track: Track, movieTimescale: number): SoundTiming | 'edits' {
  const window = windowOf(track, movieTimescale);
  if (!window) return 'edits';
  // Samples before the edit's media time are dropped; an empty edit is not turned into silence.
  return { firstSec: firstShownAt(window, track, track.first ?? 0) };
}

/** The timing of a file from its `moov` (and its fragments). */
export function readTiming(found: FoundBoxes): TimingAnswer {
  try {
    containerStats.expandedSamples = 0;
    const movie = readMoov(found.moov);
    for (const moof of found.moofs) readMoof(moof, movie);
    const video = movie.video && movie.video.dts.length > 0 ? movie.video : null;
    const sound = movie.sound && movie.sound.first !== null ? movie.sound : null;
    containerStats.expandedSamples = movie.video?.dts.length ?? 0;
    const videoAnswer = video ? videoTiming(video, movie.timescale) : null;
    const soundAnswer = sound ? soundTiming(sound, movie.timescale) : null;
    // A picture edit list it cannot follow makes frame numbering unsafe: the whole answer fails. A sound
    // one only leaves the sound's start unknown.
    if (videoAnswer === 'edits') return { ok: false, reason: 'edits' };
    if (movie.fragmented && !video && !sound) return { ok: false, reason: 'broken' };
    return { ok: true, timing: { video: videoAnswer, sound: soundAnswer === 'edits' ? 'unknown' : soundAnswer, fragmented: movie.fragmented } };
  } catch (error) {
    if (error instanceof Broken || error instanceof RangeError) return { ok: false, reason: 'broken' };
    throw error;
  }
}

// ── Finding the boxes ──────────────────────────────────────────────────────────────────────────

function hasMvex(moov: Uint8Array): boolean {
  const top = boxes(moov, 0, moov.length);
  const box = top?.find((entry) => entry.type === 'moov');
  return !!box && !!boxes(moov, box.body, box.end)?.some((entry) => entry.type === 'mvex');
}

/** The `moof` boxes in `bytes` (the part of the file after its `moov`, read whole). */
function moofsIn(bytes: Uint8Array): Uint8Array[] | null {
  const out: Uint8Array[] = [];
  let at = 0;
  for (let count = 0; at + 8 <= bytes.length; count += 1) {
    if (count >= MAX_TOP_BOXES) return null;
    let size = u32(bytes, at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > bytes.length) return null;
      size = u64(bytes, at + 8);
      header = 16;
    } else if (size === 0) {
      size = bytes.length - at;
    }
    if (size < header) return null;
    if (type4(bytes, at + 4) === 'moof') {
      if (at + size > bytes.length) return null;
      out.push(bytes.subarray(at, at + size));
    }
    at += size;
  }
  return out;
}

/**
 * Walks the file's top-level boxes, reading only their headers and the boxes the timing lives in: the
 * `moov` (wherever it is: a media box is stepped over by its size). An ordinary file is done as soon as its
 * `moov` is read. A fragmented one has its `moof` boxes spread over the file: the rest after the `moov`
 * is read in one piece, when its size is known and at most `fragmentedLimit`, and walked in memory.
 */
export async function gatherBoxes(source: ByteSource, fragmentedLimit = MAX_FRAGMENTED_BYTES): Promise<FoundBoxes | { failure: TimingFailure }> {
  try {
    return await walkTopLevel(source, fragmentedLimit);
  } catch (error) {
    if (error instanceof ReadLimit) return { failure: 'too-many-requests' };
    if (error instanceof ByteLimit) return { failure: 'too-large' };
    throw error;
  }
}

async function walkTopLevel(source: ByteSource, fragmentedLimit: number): Promise<FoundBoxes | { failure: TimingFailure }> {
  let at = 0;
  let moov: Uint8Array | null = null;
  const moofs: Uint8Array[] = [];
  for (let count = 0; ; count += 1) {
    if (count >= MAX_TOP_BOXES) return { failure: 'too-many-boxes' };
    const head = await source.read(at, 16);
    if (head.length < 8) break;
    let size = u32(head, 0);
    const type = type4(head, 4);
    let header = 8;
    if (count === 0 && !TOP_LEVEL.has(type)) return { failure: 'not-mp4' };
    if (size === 1) {
      if (head.length < 16) return { failure: 'broken' };
      size = u64(head, 8);
      header = 16;
    } else if (size === 0) {
      // To the end of the file: only a media box is written that way.
      if (type === 'moov' || type === 'moof') return { failure: 'broken' };
      break;
    }
    if (size < header) return { failure: 'broken' };
    if (type === 'moov' || type === 'moof') {
      const box = await source.read(at, size);
      if (box.length < size) return { failure: 'broken' };
      if (type === 'moov') {
        moov = box;
        if (!hasMvex(box)) break;
        // Fragmented: the rest of the file in one read, walked here.
        const total = source.size?.() ?? null;
        const rest = at + size;
        if (total === null || total > fragmentedLimit) return { failure: 'fragmented-too-large' };
        const found = rest < total ? moofsIn(await source.read(rest, total - rest)) : [];
        if (!found) return { failure: 'broken' };
        moofs.push(...found);
        break;
      } else {
        moofs.push(box);
      }
    }
    at += size;
  }
  return moov ? { moov, moofs } : { failure: 'no-moov' };
}

/** The timing of a file that is in memory whole (the export reads each cut's file for its sound). */
export async function timingOfFile(bytes: Uint8Array): Promise<TimingAnswer> {
  const found = await gatherBoxes({ read: async (start, length) => bytes.subarray(start, Math.min(bytes.length, start + length)), size: () => bytes.length }, Infinity);
  return 'failure' in found ? { ok: false, reason: found.failure } : readTiming(found);
}
