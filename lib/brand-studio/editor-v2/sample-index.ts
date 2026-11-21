/**
 * Editing studio v2 — a source's pictures as the export's decoder path reads them (spec F, F1).
 *
 * The seek path shows picture k of a source by sending a hidden `<video>` to `firstSec + (k + ½) / fps`
 * and waiting for the screen to confirm it; in a covered or minimised window that waits for a screen that
 * does not draw. The decoder path feeds the file's own samples to `VideoDecoder` instead, so it needs to
 * know, for every picture, where its bytes are and what it takes to decode it. This is read here from the
 * same boxes as the frame facts (lib/brand-studio/editor-v2/container.ts, `readMovie`):
 *
 * - every sample in decode order: file offset, size, composition time, duration, sync or not;
 * - the pictures the edit list shows, in presentation order (`shownSamples`, the SAME rule the frame facts
 *   count with): picture k here is picture k of the seek path, which is what the proof checks;
 * - the codec and its configuration record for `VideoDecoder.configure`: `avc1` / `avc3` (`avcC`),
 *   `hvc1` / `hev1` (`hvcC`), `vp09` (`vpcC` version 1), `av01` (`av1C`); the codec string is built from
 *   the record (ISO/IEC 14496-15 Annex E for HEVC, the VP9 and AV1 codec-string rules for the others);
 * - what a raw decoder does not apply and a `<video>` does: the track's rotation (`tkhd` matrix: 0, 90,
 *   180 or 270 degrees clockwise), non-square pixels (`pasp`) and the colour description (`colr`).
 *
 * Anything else unusual (a mirrored or scaled matrix, a clean aperture that crops, more than one sample
 * description, two pictures at one time, a codec not listed) is a failure with its reason: the export takes
 * that source by seeking, as before.
 *
 * Pure: boxes in, an answer out.
 */
import { movieOf, readTiming, shownSamples, type FoundBoxes, type Track } from './container';
import { boxes, type Box } from './media-probe';

export type Rotation = 0 | 90 | 180 | 270;

export interface ColourDescription {
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: boolean;
}

export interface CodecConfig {
  /** The sample entry's four characters (`avc1`, `hvc1`, `vp09`, …). */
  entry: string;
  /** The WebCodecs codec string. */
  codec: string;
  /** The configuration record handed to the decoder as `description` (avcC / hvcC contents), or `null`. */
  description: Uint8Array | null;
  codedWidth: number;
  codedHeight: number;
  /** `pasp` horizontal and vertical spacing; `[1, 1]` for square pixels or no box. */
  pixelAspect: readonly [number, number];
  colour: ColourDescription | null;
}

export interface VideoIndex {
  config: CodecConfig;
  /** Clockwise, as the `<video>` element turns the picture. */
  rotation: Rotation;
  timescale: number;
  /** Per sample, in decode order. */
  offsets: number[];
  sizes: number[];
  /** Composition time, in track ticks. */
  cts: number[];
  durations: number[];
  sync: boolean[];
  /** Picture k (presentation order, inside the edit list) is sample `pictures[k]`. */
  pictures: number[];
  /** The sync samples, ascending. */
  syncs: number[];
  /** The frames are not evenly spaced (the frame facts' own verdict). */
  variable: boolean;
  /** Movie time of picture 0. */
  firstSec: number;
}

export type IndexFailure =
  | 'unreadable'
  | 'no-video'
  | 'not-located'
  | 'mixed-entries'
  | 'entry'
  | 'codec'
  | 'transform'
  | 'aperture'
  | 'times'
  | 'no-sync';

export type IndexAnswer = { ok: true; index: VideoIndex } | { ok: false; reason: IndexFailure };

// ── Bytes ──────────────────────────────────────────────────────────────────────────────────────

const type4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
const i32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const hex = (value: number) => value.toString(16).toUpperCase();
const pad2 = (value: number) => String(value).padStart(2, '0');

/** One step in the matrix (16.16 fixed point). */
const ONE = 0x10000;
/** `w` in the matrix (2.30 fixed point). */
const W_ONE = 0x40000000;

// ── The sample entry ───────────────────────────────────────────────────────────────────────────

/** A VisualSampleEntry's fields before its child boxes (ISO/IEC 14496-12 §12.1.3). */
const VISUAL_ENTRY_FIELDS = 78;

/** `avc1.PPCCLL` from an `avcC` record. */
export function avcCodec(entry: string, avcC: Uint8Array): string | null {
  if (avcC.length < 4 || avcC[0] !== 1) return null;
  const two = (value: number) => value.toString(16).padStart(2, '0');
  return `${entry}.${two(avcC[1]!)}${two(avcC[2]!)}${two(avcC[3]!)}`;
}

/** `hvc1.1.6.L93.B0` from an `hvcC` record (ISO/IEC 14496-15 Annex E). */
export function hevcCodec(entry: string, hvcC: Uint8Array): string | null {
  if (hvcC.length < 13) return null;
  const head = hvcC[1]!;
  const space = ['', 'A', 'B', 'C'][head >> 6]!;
  const tier = (head >> 5) & 1 ? 'H' : 'L';
  const profile = head & 0x1f;
  const flags = u32(hvcC, 2);
  // The compatibility flags in reverse bit order, as hexadecimal without leading zeros.
  let reversed = 0;
  for (let bit = 0; bit < 32; bit += 1) reversed = ((reversed << 1) | ((flags >>> bit) & 1)) >>> 0;
  const constraints = Array.from(hvcC.subarray(6, 12));
  while (constraints.length > 0 && constraints[constraints.length - 1] === 0) constraints.pop();
  const level = hvcC[12]!;
  return [`${entry}.${space}${profile}`, hex(reversed), `${tier}${level}`, ...constraints.map(hex)].join('.');
}

/** `vp09.PP.LL.DD.CC.cp.tc.mc.FF` from a `vpcC` record (version 1). */
export function vp9Codec(vpcC: Uint8Array): string | null {
  if (vpcC.length < 12 || vpcC[0] !== 1) return null;
  const profile = vpcC[4]!;
  const level = vpcC[5]!;
  const packed = vpcC[6]!;
  const depth = packed >> 4;
  const chroma = (packed >> 1) & 0x07;
  const full = packed & 1;
  return ['vp09', pad2(profile), pad2(level), pad2(depth), pad2(chroma), pad2(vpcC[7]!), pad2(vpcC[8]!), pad2(vpcC[9]!), pad2(full)].join('.');
}

/** `av01.P.LLT.DD` from an `av1C` record. */
export function av1Codec(av1C: Uint8Array): string | null {
  if (av1C.length < 4 || av1C[0] !== 0x81) return null;
  const profile = av1C[1]! >> 5;
  const level = av1C[1]! & 0x1f;
  const tier = av1C[2]! >> 7 ? 'H' : 'M';
  const high = (av1C[2]! >> 6) & 1;
  const twelve = (av1C[2]! >> 5) & 1;
  const depth = high ? (twelve ? 12 : 10) : 8;
  return `av01.${profile}.${pad2(level)}${tier}.${pad2(depth)}`;
}

function sampleEntry(stsd: Uint8Array): { type: string; body: number; end: number; bytes: Uint8Array } | null {
  // version and flags, entry count, then the first entry.
  if (stsd.length < 16 || u32(stsd, 4) < 1) return null;
  const found = boxes(stsd, 8, stsd.length);
  const entry = found?.[0];
  return entry ? { type: entry.type, body: entry.body, end: entry.end, bytes: stsd } : null;
}

type EntryAnswer = { ok: true; config: CodecConfig } | { ok: false; reason: 'entry' | 'codec' | 'aperture' };

export function readSampleEntry(stsd: Uint8Array | null): EntryAnswer {
  const entry = stsd ? sampleEntry(stsd) : null;
  if (!entry || entry.end - entry.body < VISUAL_ENTRY_FIELDS) return { ok: false, reason: 'entry' };
  const { bytes } = entry;
  const width = u16(bytes, entry.body + 24);
  const height = u16(bytes, entry.body + 26);
  const kids = boxes(bytes, entry.body + VISUAL_ENTRY_FIELDS, entry.end);
  if (!kids || width === 0 || height === 0) return { ok: false, reason: 'entry' };
  const body = (box: Box | undefined) => (box ? bytes.subarray(box.body, box.end) : null);
  const find = (type: string) => kids.find((kid) => kid.type === type);

  let codec: string | null = null;
  let description: Uint8Array | null = null;
  if (entry.type === 'avc1' || entry.type === 'avc3') {
    const avcC = body(find('avcC'));
    codec = avcC ? avcCodec(entry.type, avcC) : null;
    description = avcC ? avcC.slice() : null;
  } else if (entry.type === 'hvc1' || entry.type === 'hev1') {
    const hvcC = body(find('hvcC'));
    codec = hvcC ? hevcCodec(entry.type, hvcC) : null;
    description = hvcC ? hvcC.slice() : null;
  } else if (entry.type === 'vp09') {
    const vpcC = body(find('vpcC'));
    codec = vpcC ? vp9Codec(vpcC) : null;
  } else if (entry.type === 'av01') {
    const av1C = body(find('av1C'));
    codec = av1C ? av1Codec(av1C) : null;
  }
  if (!codec) return { ok: false, reason: 'codec' };

  let pixelAspect: readonly [number, number] = [1, 1];
  const pasp = body(find('pasp'));
  if (pasp && pasp.length >= 8) {
    const h = u32(pasp, 0);
    const v = u32(pasp, 4);
    if (h > 0 && v > 0 && h !== v) pixelAspect = [h, v];
  }

  // A clean aperture that keeps the whole picture is no crop; any other is not followed here.
  const clap = body(find('clap'));
  if (clap) {
    if (clap.length < 32) return { ok: false, reason: 'aperture' };
    const ratio = (at: number) => {
      const den = u32(clap, at + 4);
      return den === 0 ? NaN : i32(clap, at) / den;
    };
    if (ratio(0) !== width || ratio(8) !== height || ratio(16) !== 0 || ratio(24) !== 0) return { ok: false, reason: 'aperture' };
  }

  let colour: ColourDescription | null = null;
  for (const colr of kids.filter((kid) => kid.type === 'colr')) {
    const data = body(colr)!;
    const kind = data.length >= 4 ? type4(data, 0) : '';
    if ((kind === 'nclx' && data.length >= 11) || (kind === 'nclc' && data.length >= 10)) {
      colour = { primaries: u16(data, 4), transfer: u16(data, 6), matrix: u16(data, 8), fullRange: kind === 'nclx' ? (data[10]! & 0x80) !== 0 : false };
      break;
    }
  }
  return { ok: true, config: { entry: entry.type, codec, description, codedWidth: width, codedHeight: height, pixelAspect, colour } };
}

// ── The display matrix ─────────────────────────────────────────────────────────────────────────

/**
 * The rotation a `tkhd` matrix asks for, clockwise, or `null` for anything a `<video>` would draw
 * differently from a plain turn (a mirror, a scale, a shear, perspective). `x` / `y` only move the turned
 * picture back into view. `[0, 1, 0, -1, 0, 0, …]` is a phone's portrait clip: turn 90° clockwise.
 */
export function rotationOf(matrix: readonly number[] | null): Rotation | null {
  if (!matrix) return 0;
  const [a, b, u, c, d, v, , , w] = matrix as [number, number, number, number, number, number, number, number, number];
  if (u !== 0 || v !== 0 || w !== W_ONE) return null;
  if (a === ONE && b === 0 && c === 0 && d === ONE) return 0;
  if (a === 0 && b === ONE && c === -ONE && d === 0) return 90;
  if (a === -ONE && b === 0 && c === 0 && d === -ONE) return 180;
  if (a === 0 && b === -ONE && c === ONE && d === 0) return 270;
  return null;
}

// ── The index ──────────────────────────────────────────────────────────────────────────────────

/** A sample's composition time in whole microseconds: the timestamp it carries into and out of the decoder. */
export function stampUs(cts: number, timescale: number): number {
  return Math.round((cts * 1_000_000) / timescale);
}

export function readSampleIndex(found: FoundBoxes): IndexAnswer {
  const timing = readTiming(found);
  if (!timing.ok) return { ok: false, reason: 'unreadable' };
  const video = timing.timing.video;
  const movie = movieOf(found);
  if (!movie) return { ok: false, reason: 'unreadable' };
  const track: Track | undefined = movie.tracks.find((entry) => entry.handler === 'vide' && entry.dts.length > 0);
  if (!video || !track) return { ok: false, reason: 'no-video' };
  if (!track.located || track.fileOffsets.length !== track.dts.length) return { ok: false, reason: 'not-located' };
  if (track.mixedEntries) return { ok: false, reason: 'mixed-entries' };
  const entry = readSampleEntry(track.stsd);
  if (!entry.ok) return { ok: false, reason: entry.reason };
  const rotation = rotationOf(track.matrix);
  if (rotation === null) return { ok: false, reason: 'transform' };
  const seen = shownSamples(track, movie.timescale);
  if (seen === 'edits') return { ok: false, reason: 'unreadable' };

  const cts = track.dts.map((dts, i) => dts + track.offsets[i]!);
  const pictures = [...seen.shown].sort((x, y) => cts[x]! - cts[y]! || x - y);
  // Every sample's timestamp is its own: the decoder's output is matched back to a picture by it.
  const stamps = new Set<number>();
  for (const time of cts) {
    const stamp = stampUs(time, track.timescale);
    if (stamps.has(stamp)) return { ok: false, reason: 'times' };
    stamps.add(stamp);
  }
  const syncs: number[] = [];
  track.sync.forEach((sync, i) => {
    if (sync) syncs.push(i);
  });
  if (syncs.length === 0) return { ok: false, reason: 'no-sync' };
  return {
    ok: true,
    index: {
      config: entry.config,
      rotation,
      timescale: track.timescale,
      offsets: track.fileOffsets,
      sizes: track.sizes,
      cts,
      durations: track.durations,
      sync: track.sync,
      pictures,
      syncs,
      variable: video.variable,
      firstSec: seen.firstSec,
    },
  };
}
