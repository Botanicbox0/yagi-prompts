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
 * For the export's decoder path (spec F, lib/brand-studio/editor-v2/sample-index.ts) the same walk also
 * keeps where every sample's bytes are and whether it is a sync sample: `stsz` / `stz2`, `stsc`,
 * `stco` / `co64`, `stss`; in fragments the `trun` sizes, data offsets (with the `tfhd` base: an explicit
 * base, the `moof` itself, or the previous fragment's data end) and sample flags (`trun`, `tfhd`, `trex`).
 * A table that cannot be followed there only marks the track `located: false` (the export then seeks): it
 * never changes the timing answer.
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
  /** The frames are not evenly spaced (see `EVEN_TOLERANCE`): the editor does not support such footage. */
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
  sound: SoundTiming | null;
  fragmented: boolean;
}

/**
 * Why a file could not be read: not an MP4 / MOV; no `moov`; boxes cut off or inconsistent; an edit list
 * the export cannot follow (more than one piece of media, or a changed speed); too many fragments.
 */
export type TimingFailure = 'not-mp4' | 'no-moov' | 'broken' | 'edits' | 'too-many-boxes';

export type TimingAnswer = { ok: true; timing: FileTiming } | { ok: false; reason: TimingFailure };

export interface FoundBoxes {
  moov: Uint8Array;
  /** The fragments' `moof` boxes, in file order (none for an ordinary file). */
  moofs: Uint8Array[];
  /** Where each `moof` starts in the file (the base its sample data offsets count from). */
  moofAt?: number[];
}

/** Any way of reading a file's bytes: `[start, start + length)`, fewer at the end of the file. */
export interface ByteSource {
  read(start: number, length: number): Promise<Uint8Array>;
}

/**
 * A frame duration within one tick of the clock, or within this share of the usual duration, is the
 * usual duration: clocks that cannot hold the rate exactly round each frame's time (29.97 fps on a
 * 1/1000 s clock is 33, 33, 34 ms …). Anything further apart (1/24 s next to 1/30 s, a missing frame)
 * is not evenly spaced. The last frame's duration is not looked at: muxers often write it short.
 */
export const EVEN_TOLERANCE = 0.001;
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

export interface Track {
  id: number;
  handler: string;
  timescale: number;
  edits: Edit[] | null;
  /** Decode time, duration and composition offset of every sample, in decode order. */
  dts: number[];
  durations: number[];
  offsets: number[];
  /** Where the next fragment continues when it carries no `tfdt`. */
  next: number;
  /** `trex` default sample duration (fragmented files). */
  defaultDuration: number;
  /** `trex` default sample size and flags (fragmented files). */
  defaultSize: number;
  defaultFlags: number;
  /**
   * Every sample's place in the file, its size and whether it is a sync sample (decode order, like `dts`).
   * `located: false` when a table could not be followed: the timing still holds, the bytes cannot be found.
   */
  located: boolean;
  fileOffsets: number[];
  sizes: number[];
  sync: boolean[];
  /** More than one sample description is used: the decoder would need re-configuring mid-track. */
  mixedEntries: boolean;
  /** The `stsd` box (its first entry configures a decoder), and the `tkhd` display matrix. */
  stsd: Uint8Array | null;
  /** `a b u c d v x y w` as stored (16.16 fixed point for a b c d x y, 2.30 for u v w). */
  matrix: number[] | null;
}

export interface Movie {
  timescale: number;
  tracks: Track[];
  fragmented: boolean;
}

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
      if (!track) continue;
      track.defaultDuration = u32(bytes, trex.body + 12);
      if (trex.body + 24 <= trex.end) {
        track.defaultSize = u32(bytes, trex.body + 16);
        track.defaultFlags = u32(bytes, trex.body + 20);
      }
    }
  }
  return { timescale, tracks, fragmented: !!mvex };
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
  const track: Track = {
    id,
    handler: type4(bytes, hdlr.body + 8),
    timescale,
    edits: readEdits(bytes, parts.find((entry) => entry.type === 'edts')),
    dts: [],
    durations: [],
    offsets: [],
    next: 0,
    defaultDuration: 0,
    defaultSize: 0,
    defaultFlags: 0,
    located: true,
    fileOffsets: [],
    sizes: [],
    sync: [],
    mixedEntries: false,
    stsd: null,
    matrix: readMatrix(bytes, tkhd),
  };
  const stbl = child(bytes, child(bytes, mdia, 'minf'), 'stbl');
  if (stbl) {
    readSampleTable(bytes, stbl, track);
    const stsd = children(bytes, stbl).find((entry) => entry.type === 'stsd');
    // The box's contents: version and flags, the entry count, then the sample entries.
    track.stsd = stsd ? bytes.subarray(stsd.body, stsd.end) : null;
    try {
      locateSamples(bytes, stbl, track);
    } catch (error) {
      if (!(error instanceof Broken || error instanceof RangeError)) throw error;
      track.located = false;
    }
  }
  return track;
}

/** The `tkhd` display matrix (nine numbers as stored), or `null` when the box is too short to hold it. */
function readMatrix(bytes: Uint8Array, tkhd: Box): number[] | null {
  // version 0: 4 + 20 bytes before reserved(8), layer, group, volume, reserved; version 1: 4 + 32.
  const at = tkhd.body + (bytes[tkhd.body] === 1 ? 52 : 40);
  if (at + 36 > tkhd.end) return null;
  return Array.from({ length: 9 }, (_, i) => i32(bytes, at + i * 4));
}

/**
 * Where every sample of an ordinary (non-fragmented) table is: `stsz` / `stz2` sizes, `stsc` samples per
 * chunk, `stco` / `co64` chunk offsets, `stss` sync samples (none listed = every sample is one).
 */
function locateSamples(bytes: Uint8Array, stbl: Box, track: Track) {
  const parts = children(bytes, stbl);
  const count = track.dts.length;
  if (count === 0) return;
  const stsz = parts.find((entry) => entry.type === 'stsz');
  const stz2 = parts.find((entry) => entry.type === 'stz2');
  const sizes: number[] = [];
  if (stsz) {
    need(stsz, 12);
    const fixed = u32(bytes, stsz.body + 4);
    const n = u32(bytes, stsz.body + 8);
    if (n !== count) throw new Broken();
    if (fixed > 0) for (let i = 0; i < n; i += 1) sizes.push(fixed);
    else {
      need(stsz, 12 + n * 4);
      for (let i = 0; i < n; i += 1) sizes.push(u32(bytes, stsz.body + 12 + i * 4));
    }
  } else if (stz2) {
    need(stz2, 12);
    const field = bytes[stz2.body + 7]!;
    const n = u32(bytes, stz2.body + 8);
    if (n !== count || ![4, 8, 16].includes(field)) throw new Broken();
    need(stz2, 12 + Math.ceil((n * field) / 8));
    for (let i = 0; i < n; i += 1) {
      const at = stz2.body + 12;
      if (field === 16) sizes.push((bytes[at + i * 2]! << 8) | bytes[at + i * 2 + 1]!);
      else if (field === 8) sizes.push(bytes[at + i]!);
      else sizes.push(i % 2 === 0 ? bytes[at + (i >> 1)]! >> 4 : bytes[at + (i >> 1)]! & 0x0f);
    }
  } else throw new Broken();

  const stco = parts.find((entry) => entry.type === 'stco');
  const co64 = parts.find((entry) => entry.type === 'co64');
  const chunks: number[] = [];
  if (stco) {
    need(stco, 8);
    const n = u32(bytes, stco.body + 4);
    need(stco, 8 + n * 4);
    for (let i = 0; i < n; i += 1) chunks.push(u32(bytes, stco.body + 8 + i * 4));
  } else if (co64) {
    need(co64, 8);
    const n = u32(bytes, co64.body + 4);
    need(co64, 8 + n * 8);
    for (let i = 0; i < n; i += 1) chunks.push(u64(bytes, co64.body + 8 + i * 8));
  } else throw new Broken();

  const stsc = parts.find((entry) => entry.type === 'stsc');
  if (!stsc) throw new Broken();
  need(stsc, 8);
  const rows = u32(bytes, stsc.body + 4);
  need(stsc, 8 + rows * 12);
  if (rows === 0) throw new Broken();
  const offsets: number[] = [];
  let sample = 0;
  const descriptions = new Set<number>();
  for (let r = 0; r < rows && sample < count; r += 1) {
    const at = stsc.body + 8 + r * 12;
    const firstChunk = u32(bytes, at);
    const perChunk = u32(bytes, at + 4);
    descriptions.add(u32(bytes, at + 8));
    const lastChunk = r + 1 < rows ? u32(bytes, at + 12) - 1 : chunks.length;
    if (firstChunk < 1 || lastChunk > chunks.length || perChunk < 1) throw new Broken();
    for (let c = firstChunk; c <= lastChunk && sample < count; c += 1) {
      let at2 = chunks[c - 1]!;
      for (let k = 0; k < perChunk && sample < count; k += 1) {
        offsets.push(at2);
        at2 += sizes[sample]!;
        sample += 1;
      }
    }
  }
  if (sample !== count) throw new Broken();

  const stss = parts.find((entry) => entry.type === 'stss');
  const sync = new Array<boolean>(count).fill(!stss);
  if (stss) {
    need(stss, 8);
    const n = u32(bytes, stss.body + 4);
    need(stss, 8 + n * 4);
    for (let i = 0; i < n; i += 1) {
      const number = u32(bytes, stss.body + 8 + i * 4);
      if (number < 1 || number > count) throw new Broken();
      sync[number - 1] = true;
    }
  }
  track.fileOffsets = offsets;
  track.sizes = sizes;
  track.sync = sync;
  track.mixedEntries = descriptions.size > 1;
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

function readSampleTable(bytes: Uint8Array, stbl: Box, track: Track) {
  const parts = children(bytes, stbl);
  const stts = parts.find((entry) => entry.type === 'stts');
  if (!stts) return;
  need(stts, 8);
  const runs = u32(bytes, stts.body + 4);
  need(stts, 8 + runs * 8);
  let dt = 0;
  for (let i = 0, at = stts.body + 8; i < runs; i += 1, at += 8) {
    const count = u32(bytes, at);
    const delta = u32(bytes, at + 4);
    if (track.durations.length + count > MAX_SAMPLES) throw new Broken();
    for (let k = 0; k < count; k += 1) {
      track.dts.push(dt);
      track.durations.push(delta);
      track.offsets.push(0);
      dt += delta;
    }
  }
  track.next = dt;
  const ctts = parts.find((entry) => entry.type === 'ctts');
  if (!ctts) return;
  need(ctts, 8);
  const signed = bytes[ctts.body] === 1;
  const cttsRuns = u32(bytes, ctts.body + 4);
  need(ctts, 8 + cttsRuns * 8);
  let index = 0;
  for (let i = 0, at = ctts.body + 8; i < cttsRuns; i += 1, at += 8) {
    const count = u32(bytes, at);
    // Version 0 is unsigned by the standard, but writers put negative values there too: read as signed
    // when the value only makes sense that way (more than half the 32-bit range).
    const raw = u32(bytes, at + 4);
    const offset = signed || raw > 0x7fffffff ? i32(bytes, at + 4) : raw;
    for (let k = 0; k < count && index < track.offsets.length; k += 1, index += 1) track.offsets[index] = offset;
  }
}

/** A sample whose flags say `sample_is_non_sync_sample` (ISO/IEC 14496-12 §8.8.3.1) is not a sync sample. */
const syncFromFlags = (flags: number) => (flags & 0x00010000) === 0;

/**
 * One fragment's samples, appended to their tracks. `moofAt` is where the `moof` starts in the file: the
 * sample data offsets count from it (`default-base-is-moof`, or no base given for the first `traf`), from
 * an explicit `base_data_offset`, or from where the previous `traf`'s data ended. `null` when not known:
 * the timing is read and the samples are not located.
 */
function readMoof(bytes: Uint8Array, movie: Movie, moofAt: number | null) {
  const top = boxes(bytes, 0, bytes.length);
  const moof = top?.find((entry) => entry.type === 'moof');
  if (!moof) throw new Broken();
  let previousEnd: number | null = moofAt;
  for (const traf of children(bytes, moof).filter((entry) => entry.type === 'traf')) {
    const parts = children(bytes, traf);
    const tfhd = parts.find((entry) => entry.type === 'tfhd');
    if (!tfhd) throw new Broken();
    need(tfhd, 8);
    const flags = u32(bytes, tfhd.body) & 0xffffff;
    const track = movie.tracks.find((entry) => entry.id === u32(bytes, tfhd.body + 4));
    if (!track) continue;
    let at = tfhd.body + 8;
    let base: number | null = flags & 0x020000 ? moofAt : previousEnd;
    if (flags & 0x01) {
      if (at + 8 > tfhd.end) throw new Broken();
      base = u64(bytes, at);
      at += 8;
    }
    if (flags & 0x02) at += 4;
    let defaultDuration = track.defaultDuration;
    if (flags & 0x08) {
      if (at + 4 > tfhd.end) throw new Broken();
      defaultDuration = u32(bytes, at);
      at += 4;
    }
    let defaultSize = track.defaultSize;
    if (flags & 0x10) {
      if (at + 4 > tfhd.end) throw new Broken();
      defaultSize = u32(bytes, at);
      at += 4;
    }
    let defaultFlags = track.defaultFlags;
    if (flags & 0x20) {
      if (at + 4 > tfhd.end) throw new Broken();
      defaultFlags = u32(bytes, at);
    }
    const tfdt = parts.find((entry) => entry.type === 'tfdt');
    let dt = track.next;
    if (tfdt) {
      need(tfdt, 8);
      dt = bytes[tfdt.body] === 1 ? (need(tfdt, 12), u64(bytes, tfdt.body + 4)) : u32(bytes, tfdt.body + 4);
    }
    // Where the next run's data starts when its trun gives no data offset.
    let dataAt: number | null = base;
    for (const trun of parts.filter((entry) => entry.type === 'trun')) {
      need(trun, 8);
      const signed = bytes[trun.body] === 1;
      const runFlags = u32(bytes, trun.body) & 0xffffff;
      const count = u32(bytes, trun.body + 4);
      let pos = trun.body + 8;
      if (runFlags & 0x01) {
        need(trun, 12);
        dataAt = base === null ? null : base + i32(bytes, pos);
        pos += 4;
      }
      let firstFlags: number | null = null;
      if (runFlags & 0x04) {
        if (pos + 4 > trun.end) throw new Broken();
        firstFlags = u32(bytes, pos);
        pos += 4;
      }
      const row = (runFlags & 0x100 ? 4 : 0) + (runFlags & 0x200 ? 4 : 0) + (runFlags & 0x400 ? 4 : 0) + (runFlags & 0x800 ? 4 : 0);
      if (pos + count * row > trun.end || track.durations.length + count > MAX_SAMPLES) throw new Broken();
      for (let k = 0; k < count; k += 1) {
        let duration = defaultDuration;
        let size = defaultSize;
        let sampleFlags = k === 0 && firstFlags !== null ? firstFlags : defaultFlags;
        let offset = 0;
        if (runFlags & 0x100) {
          duration = u32(bytes, pos);
          pos += 4;
        }
        if (runFlags & 0x200) {
          size = u32(bytes, pos);
          pos += 4;
        }
        if (runFlags & 0x400) {
          sampleFlags = u32(bytes, pos);
          pos += 4;
        }
        if (runFlags & 0x800) {
          offset = signed ? i32(bytes, pos) : u32(bytes, pos);
          pos += 4;
        }
        track.dts.push(dt);
        track.durations.push(duration);
        track.offsets.push(offset);
        dt += duration;
        if (dataAt === null || size <= 0) track.located = false;
        track.fileOffsets.push(dataAt ?? -1);
        track.sizes.push(size);
        track.sync.push(syncFromFlags(sampleFlags));
        if (dataAt !== null) dataAt += size;
      }
    }
    previousEnd = dataAt;
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
 * The samples the edit list shows, in decode order (those whose composition time lies inside the edit),
 * and the movie time of the first one. ONE rule for the frame facts (`videoTiming`) and for the export's
 * decoder path (lib/brand-studio/editor-v2/sample-index.ts): picture k of a source is the k-th of these in
 * presentation order in both, which is what the seek path's `firstSec + k / fps` shows.
 */
export function shownSamples(track: Track, movieTimescale: number): { shown: number[]; firstSec: number } | 'edits' {
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
  return { shown, firstSec: firstShownAt(window, track, first) };
}

function videoTiming(track: Track, movieTimescale: number): VideoTiming | 'edits' {
  const seen = shownSamples(track, movieTimescale);
  if (seen === 'edits') return 'edits';
  const { shown, firstSec } = seen;
  const durations = shown.map((i) => track.durations[i]!);
  const body = durations.length > 1 ? durations.slice(0, -1) : durations;
  const sorted = [...body].sort((a, b) => a - b);
  const usual = sorted[Math.floor(sorted.length / 2)]!;
  const tolerance = Math.max(1, usual * EVEN_TOLERANCE);
  const even = usual > 0 && body.every((d) => Math.abs(d - usual) <= tolerance);
  let num: number;
  let den: number;
  if (even && body.every((d) => d === usual)) {
    [num, den] = fraction(track.timescale, usual);
  } else if (even) {
    // A clock that rounds each frame: the rate over the frames, brought onto the rate it almost surely is.
    const average = (body.length * track.timescale) / body.reduce((a, b) => a + b, 0);
    const near = RATES.find(([n, d]) => Math.abs(average - n / d) / (n / d) < 0.001);
    [num, den] = near ? [near[0], near[1]] : fraction(body.length * track.timescale, body.reduce((a, b) => a + b, 0));
  } else {
    [num, den] = fraction(durations.length * track.timescale, durations.reduce((a, b) => a + b, 0));
  }
  if (!(num > 0 && den > 0)) return 'edits';
  return { firstSec, frames: shown.length, fps: num / den, fpsNum: num, fpsDen: den, variable: !even, timescale: track.timescale };
}

function soundTiming(track: Track, movieTimescale: number): SoundTiming | 'edits' {
  const window = windowOf(track, movieTimescale);
  if (!window) return 'edits';
  // Samples before the edit's media time are dropped; an empty edit is not turned into silence.
  return { firstSec: firstShownAt(window, track, track.dts[0]! + track.offsets[0]!) };
}

/**
 * The movie from its `moov` and fragments: every track's samples in decode order, with their timing and
 * (where the tables allow) their place in the file. Throws `Broken` / `RangeError` on bytes it cannot read.
 */
export function readMovie(found: FoundBoxes): Movie {
  const movie = readMoov(found.moov);
  found.moofs.forEach((moof, i) => readMoof(moof, movie, found.moofAt?.[i] ?? null));
  return movie;
}

/** `readMovie`, or `null` for a file it cannot read. */
export function movieOf(found: FoundBoxes): Movie | null {
  try {
    return readMovie(found);
  } catch (error) {
    if (error instanceof Broken || error instanceof RangeError) return null;
    throw error;
  }
}

/** The timing of a file from its `moov` (and its fragments). */
export function readTiming(found: FoundBoxes): TimingAnswer {
  try {
    const movie = readMovie(found);
    const video = movie.tracks.find((track) => track.handler === 'vide' && track.dts.length > 0);
    const sound = movie.tracks.find((track) => track.handler === 'soun' && track.dts.length > 0);
    const videoAnswer = video ? videoTiming(video, movie.timescale) : null;
    const soundAnswer = sound ? soundTiming(sound, movie.timescale) : null;
    if (videoAnswer === 'edits' || soundAnswer === 'edits') return { ok: false, reason: 'edits' };
    if (movie.fragmented && !video && !sound) return { ok: false, reason: 'broken' };
    return { ok: true, timing: { video: videoAnswer, sound: soundAnswer, fragmented: movie.fragmented } };
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

/**
 * Walks the file's top-level boxes, reading only their headers and the boxes the timing lives in: the
 * `moov` (wherever it is: a media box is stepped over by its size) and, in a fragmented file, every
 * `moof`. An ordinary file is done as soon as its `moov` is read.
 */
export async function gatherBoxes(source: ByteSource): Promise<FoundBoxes | { failure: TimingFailure }> {
  let at = 0;
  let moov: Uint8Array | null = null;
  const moofs: Uint8Array[] = [];
  const moofAt: number[] = [];
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
      } else {
        moofs.push(box);
        moofAt.push(at);
      }
    }
    at += size;
  }
  return moov ? { moov, moofs, moofAt } : { failure: 'no-moov' };
}

/** The timing of a file that is in memory whole (the export reads each cut's file for its sound). */
export async function timingOfFile(bytes: Uint8Array): Promise<TimingAnswer> {
  const found = await gatherBoxes({ read: async (start, length) => bytes.subarray(start, Math.min(bytes.length, start + length)) });
  return 'failure' in found ? { ok: false, reason: found.failure } : readTiming(found);
}
