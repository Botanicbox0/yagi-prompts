/**
 * Editing studio v2 — a source's pictures as the export's decoder path reads them (spec F, F1).
 *
 * The seek path shows picture k of a source by sending a hidden `<video>` to `firstSec + (k + ½) / fps`
 * and waiting for the screen to confirm it; in a covered or minimised window that waits for a screen that
 * does not draw. The decoder path feeds the file's own samples to `VideoDecoder` instead, so it needs to
 * know, for every picture, where its bytes are and what it takes to decode it. That is read here, from the
 * picture track's boxes (ISO/IEC 14496-12; QuickTime uses the same layout):
 *
 * - every sample in decode order: file offset and size (`stsz` / `stz2`, `stsc`, `stco` / `co64`; in a
 *   fragmented file the `trun` sizes and data offsets from the `tfhd` base: an explicit base, the `moof`
 *   itself, or where the previous `traf`'s data ended), composition time (`stts`, `ctts` v0/v1; `tfdt`,
 *   `trun`), duration, and whether it is a sync sample (`stss`; the `trun` / `tfhd` / `trex` sample flags);
 * - the pictures the edit list shows, in presentation order: empty edits, then one piece of media at normal
 *   speed, and the samples whose composition time lies inside it. Picture k here must be picture k of the
 *   frame facts (lib/brand-studio/editor-v2/container.ts, which the timeline and the seek path number by):
 *   the index is refused whenever its count differs from theirs, so the two paths can never number apart;
 * - the codec and its configuration record for `VideoDecoder.configure`: `avc1` / `avc3` (`avcC`),
 *   `hvc1` / `hev1` (`hvcC`, codec string by ISO/IEC 14496-15 Annex E), `vp09` (`vpcC` version 1),
 *   `av01` (`av1C`);
 * - what a raw decoder does not apply and a `<video>` does: the track's rotation (`tkhd` matrix: 0, 90, 180
 *   or 270 degrees clockwise), non-square pixels (`pasp`), and the colour description (`colr`).
 *
 * Anything else unusual (a mirrored or scaled matrix, a clean aperture that crops, more than one sample
 * description, two samples at one time, an edit list it cannot follow, a codec not listed) is a failure
 * with its reason: the export then takes that source by seeking, as before.
 *
 * Pure: bytes in, an answer out. The browser reads the boxes with Range requests
 * (components/brand-studio/editor-v2/footage-facts.ts, `readPictureIndex`).
 */
import { readTiming, type ByteSource } from './container';
import { TOP_LEVEL, boxes, soundTrackOf, type Box, type SoundTrack } from './media-probe';

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
  /**
   * The profile the configuration record states: `avcC` profile_idc (100 High …), `hvcC` general_profile_idc
   * (1 Main, 2 Main 10, 4 range extensions), `vpcC` and `av1C` profile; `null` when not read.
   */
  profile: number | null;
  /** Luma bit depth from the configuration record; `null` when the record does not say (taken as not 8). */
  bitDepth: number | null;
  /**
   * The chroma format (0 monochrome, 1 4:2:0, 2 4:2:2, 3 4:4:4) the configuration record or the H.264 sequence
   * parameter set states (`avcChroma`, `hvcC` chromaFormat); `null` when not read (spec H, F7).
   */
  chroma: number | null;
  /** The `avcC` constraint flags byte (constraint_set0 is 0x80, constraint_set1 0x40); `null` for other codecs. */
  constraintFlags: number | null;
  /**
   * Plain SDR by what the file states (`colr`, or `vpcC` for VP9): BT.709 / BT.601 / unspecified primaries and
   * matrix, BT.709 / BT.601 / unspecified transfer, and no ICC profile; no statement at all counts as SDR.
   * The decoder path's colour rule was measured on such footage only (spec F review 1, item 1).
   */
  sdr: boolean;
}

/** Primaries and matrix taken as SDR: 1 BT.709, 5 BT.470BG, 6 SMPTE 170M, 2 unspecified. */
const SDR_PRIMARIES_MATRIX = new Set([1, 2, 5, 6]);
/**
 * Transfer taken as SDR: 1 BT.709 and 6 SMPTE 170M (both measured, 2026-11-21: the `<video>` drew them as the
 * decoder path does), 2 unspecified. Not 13 (sRGB), 16 (PQ), 18 (HLG) or anything else: not measured.
 */
const SDR_TRANSFER = new Set([1, 2, 6]);

const sdrCodes = (primaries: number, transfer: number, matrix: number) =>
  SDR_PRIMARIES_MATRIX.has(primaries) && SDR_TRANSFER.has(transfer) && SDR_PRIMARIES_MATRIX.has(matrix);

/**
 * The luma bit depth an `avcC` record states: its High-profile tail (after the parameter sets) carries
 * `bit_depth_luma_minus8`. Without a tail, the profiles that allow more than 8 bits (High 10, High 4:2:2,
 * High 4:4:4, CAVLC 4:4:4) are not known; every other profile is 8 bits.
 */
export function avcBitDepth(avcC: Uint8Array): number | null {
  if (avcC.length < 6) return null;
  const profile = avcC[1]!;
  let at = 5;
  const parameterSets = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      if (at + 2 > avcC.length) return false;
      at += 2 + u16(avcC, at);
    }
    return at <= avcC.length;
  };
  if (!parameterSets(avcC[at++]! & 0x1f) || at >= avcC.length) return [110, 122, 244, 44].includes(profile) ? null : 8;
  if (!parameterSets(avcC[at++]!)) return [110, 122, 244, 44].includes(profile) ? null : 8;
  if (at + 2 <= avcC.length) return (avcC[at + 1]! & 0x07) + 8;
  return [110, 122, 244, 44].includes(profile) ? null : 8;
}

/** H.264 profiles whose sequence parameter set carries chroma_format_idc (ITU-T H.264 §7.3.2.1.1). */
const AVC_CHROMA_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

/**
 * chroma_format_idc from an H.264 sequence parameter set NAL unit (header byte included): emulation prevention
 * bytes are taken out, then profile_idc, the constraint byte, level_idc and seq_parameter_set_id are passed.
 * Profiles that do not carry it are 4:2:0 by the standard. `null` when the unit is too short to say.
 */
export function spsChroma(nal: Uint8Array): number | null {
  const bytes: number[] = [];
  for (let i = 1, zeros = 0; i < nal.length; i += 1) {
    const value = nal[i]!;
    if (zeros >= 2 && value === 3) {
      zeros = 0;
      continue;
    }
    zeros = value === 0 ? zeros + 1 : 0;
    bytes.push(value);
  }
  if (bytes.length < 4) return null;
  if (!AVC_CHROMA_PROFILES.has(bytes[0]!)) return 1;
  let bit = 24;
  const readBit = () => {
    if (bit >= bytes.length * 8) return null;
    const value = (bytes[bit >> 3]! >> (7 - (bit & 7))) & 1;
    bit += 1;
    return value;
  };
  const ue = () => {
    let zeros = 0;
    for (;;) {
      const next = readBit();
      if (next === null || zeros > 31) return null;
      if (next === 1) break;
      zeros += 1;
    }
    let value = 0;
    for (let i = 0; i < zeros; i += 1) {
      const next = readBit();
      if (next === null) return null;
      value = value * 2 + next;
    }
    return 2 ** zeros - 1 + value;
  };
  if (ue() === null) return null;
  const chroma = ue();
  return chroma !== null && chroma <= 3 ? chroma : null;
}

/**
 * The chroma format an `avcC` record says: profiles without chroma_format_idc are 4:2:0; for the others, the
 * High-profile tail after the parameter sets (reserved bits all set, then chroma_format), else the first
 * sequence parameter set. `null` when none of them can be read.
 */
export function avcChroma(avcC: Uint8Array): number | null {
  if (avcC.length < 6) return null;
  if (!AVC_CHROMA_PROFILES.has(avcC[1]!)) return 1;
  let at = 5;
  let firstSps: Uint8Array | null = null;
  const spsCount = avcC[at++]! & 0x1f;
  for (let i = 0; i < spsCount; i += 1) {
    if (at + 2 > avcC.length) return null;
    const length = u16(avcC, at);
    if (at + 2 + length > avcC.length) return null;
    if (!firstSps) firstSps = avcC.subarray(at + 2, at + 2 + length);
    at += 2 + length;
  }
  const fromSps = () => (firstSps ? spsChroma(firstSps) : null);
  if (at >= avcC.length) return fromSps();
  const ppsCount = avcC[at++]!;
  for (let i = 0; i < ppsCount; i += 1) {
    if (at + 2 > avcC.length) return fromSps();
    at += 2 + u16(avcC, at);
  }
  if (at < avcC.length && (avcC[at]! & 0xfc) === 0xfc) return avcC[at]! & 0x03;
  return fromSps();
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
  /** Whether the file has a sound track (`no`: the export need not read it for sound). */
  sound: SoundTrack;
}

export type IndexFailure =
  | 'unreadable'
  | 'no-video'
  | 'not-located'
  | 'mixed-entries'
  | 'edits'
  | 'entry'
  | 'codec'
  | 'transform'
  | 'aperture'
  | 'times'
  | 'no-sync'
  | 'disagrees'
  /** A refused request or a network error: not the file's answer, read again (spec G, B9). */
  | 'network';

export type IndexAnswer = { ok: true; index: VideoIndex } | { ok: false; reason: IndexFailure };

/** The boxes the index is read from: the `moov`, and every `moof` with where it starts in the file. */
export interface IndexBoxes {
  moov: Uint8Array;
  moofs: Array<{ bytes: Uint8Array; at: number }>;
}

// ── Bytes ──────────────────────────────────────────────────────────────────────────────────────

const type4 = (b: Uint8Array, at: number) => String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);
const u16 = (b: Uint8Array, at: number) => (b[at]! << 8) | b[at + 1]!;
const u32 = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
const i32 = (b: Uint8Array, at: number) => u32(b, at) | 0;
const u64 = (b: Uint8Array, at: number) => u32(b, at) * 2 ** 32 + u32(b, at + 4);
const i64 = (b: Uint8Array, at: number) => i32(b, at) * 2 ** 32 + u32(b, at + 4);
const i16 = (b: Uint8Array, at: number) => (((b[at]! << 8) | b[at + 1]!) << 16) >> 16;
const hex = (value: number) => value.toString(16).toUpperCase();
const pad2 = (value: number) => String(value).padStart(2, '0');

class Broken extends Error {}

function need(box: Box, bytes: number) {
  if (box.body + bytes > box.end) throw new Broken();
}

function kids(bytes: Uint8Array, box: Box): Box[] {
  const found = boxes(bytes, box.body, box.end);
  if (!found) throw new Broken();
  return found;
}

const kid = (bytes: Uint8Array, box: Box | undefined, type: string): Box | undefined => (box ? kids(bytes, box).find((entry) => entry.type === type) : undefined);

/** One step in the matrix (16.16 fixed point). */
const ONE = 0x10000;
/** `w` in the matrix (2.30 fixed point). */
const W_ONE = 0x40000000;
/** The most samples a track may list; the most top-level boxes walked (a fragmented file has two per fragment). */
const MAX_SAMPLES = 4_000_000;
export const MAX_INDEX_BOXES = 20_000;
/**
 * The requests a fragmented file may use to walk its fragments (spec G, B8): each fragment whose data is larger
 * than a read (64 KiB) costs one, so about 60 fragments: a minute at a fragment a second, two at ffmpeg's
 * fragment per key frame every 2 s. A plain file keeps ranged-source.ts `MAX_RANGE_REQUESTS` (8). Past the
 * budget the index is `unreadable` and the source is seeked.
 */
export const FRAGMENTED_INDEX_REQUESTS = 64;

// ── Finding the boxes ──────────────────────────────────────────────────────────────────────────

/**
 * Walks the file's top-level boxes, reading only their headers, the `moov` and (in a fragmented file) every
 * `moof` with its place: media is stepped over by its size. An ordinary file is done once its `moov` is read.
 */
export async function gatherIndexBoxes(source: ByteSource, maxBoxes = MAX_INDEX_BOXES): Promise<IndexBoxes | { failure: 'not-mp4' | 'no-moov' | 'broken' | 'too-many-boxes' }> {
  let at = 0;
  let moov: Uint8Array | null = null;
  let fragmented = false;
  const moofs: IndexBoxes['moofs'] = [];
  for (let count = 0; ; count += 1) {
    if (count >= maxBoxes) return { failure: 'too-many-boxes' };
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
      if (type === 'moov' || type === 'moof') return { failure: 'broken' };
      break;
    }
    if (size < header) return { failure: 'broken' };
    if (type === 'moov' || type === 'moof') {
      const box = await source.read(at, size);
      if (box.length < size) return { failure: 'broken' };
      if (type === 'moov') {
        moov = box;
        const top = boxes(box, 0, box.length)?.[0];
        fragmented = !!top && !!boxes(box, top.body, top.end)?.some((entry) => entry.type === 'mvex');
        if (!fragmented) break;
        source.allow?.(FRAGMENTED_INDEX_REQUESTS);
      } else {
        moofs.push({ bytes: box, at });
      }
    }
    at += size;
  }
  return moov ? { moov, moofs } : { failure: 'no-moov' };
}

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
  return [`${entry}.${space}${profile}`, hex(reversed), `${tier}${hvcC[12]!}`, ...constraints.map(hex)].join('.');
}

/** `vp09.PP.LL.DD.CC.cp.tc.mc.FF` from a `vpcC` record (version 1). */
export function vp9Codec(vpcC: Uint8Array): string | null {
  if (vpcC.length < 12 || vpcC[0] !== 1) return null;
  const packed = vpcC[6]!;
  return ['vp09', pad2(vpcC[4]!), pad2(vpcC[5]!), pad2(packed >> 4), pad2((packed >> 1) & 0x07), pad2(vpcC[7]!), pad2(vpcC[8]!), pad2(vpcC[9]!), pad2(packed & 1)].join('.');
}

/** `av01.P.LLT.DD` from an `av1C` record. */
export function av1Codec(av1C: Uint8Array): string | null {
  if (av1C.length < 4 || av1C[0] !== 0x81) return null;
  const high = (av1C[2]! >> 6) & 1;
  const twelve = (av1C[2]! >> 5) & 1;
  const depth = high ? (twelve ? 12 : 10) : 8;
  return `av01.${av1C[1]! >> 5}.${pad2(av1C[1]! & 0x1f)}${av1C[2]! >> 7 ? 'H' : 'M'}.${pad2(depth)}`;
}

type EntryAnswer = { ok: true; config: CodecConfig } | { ok: false; reason: 'entry' | 'codec' | 'aperture' };

/** The first sample entry of an `stsd` box's contents (version and flags, entry count, entries). */
export function readSampleEntry(stsd: Uint8Array | null): EntryAnswer {
  if (!stsd || stsd.length < 16 || u32(stsd, 4) < 1) return { ok: false, reason: 'entry' };
  const entry = boxes(stsd, 8, stsd.length)?.[0];
  if (!entry || entry.end - entry.body < VISUAL_ENTRY_FIELDS) return { ok: false, reason: 'entry' };
  const width = u16(stsd, entry.body + 24);
  const height = u16(stsd, entry.body + 26);
  const children = boxes(stsd, entry.body + VISUAL_ENTRY_FIELDS, entry.end);
  if (!children || width === 0 || height === 0) return { ok: false, reason: 'entry' };
  const body = (box: Box | undefined) => (box ? stsd.subarray(box.body, box.end) : null);
  const find = (type: string) => children.find((child) => child.type === type);

  let codec: string | null = null;
  let description: Uint8Array | null = null;
  let bitDepth: number | null = null;
  let profile: number | null = null;
  let chroma: number | null = null;
  let constraintFlags: number | null = null;
  let sdr = true;
  if (entry.type === 'avc1' || entry.type === 'avc3') {
    const avcC = body(find('avcC'));
    codec = avcC ? avcCodec(entry.type, avcC) : null;
    description = avcC ? avcC.slice() : null;
    bitDepth = avcC ? avcBitDepth(avcC) : null;
    profile = avcC && avcC.length >= 2 ? avcC[1]! : null;
    constraintFlags = avcC && avcC.length >= 3 ? avcC[2]! : null;
    chroma = avcC ? avcChroma(avcC) : null;
  } else if (entry.type === 'hvc1' || entry.type === 'hev1') {
    const hvcC = body(find('hvcC'));
    codec = hvcC ? hevcCodec(entry.type, hvcC) : null;
    description = hvcC ? hvcC.slice() : null;
    profile = hvcC && hvcC.length >= 2 ? hvcC[1]! & 0x1f : null;
    // bitDepthLumaMinus8 and bitDepthChromaMinus8: the low three bits of bytes 17 and 18.
    if (hvcC && hvcC.length >= 19) bitDepth = Math.max((hvcC[17]! & 0x07) + 8, (hvcC[18]! & 0x07) + 8);
    // chromaFormat: the low two bits of byte 16.
    if (hvcC && hvcC.length >= 17) chroma = hvcC[16]! & 0x03;
  } else if (entry.type === 'vp09') {
    const vpcC = body(find('vpcC'));
    codec = vpcC ? vp9Codec(vpcC) : null;
    if (vpcC && vpcC.length >= 10 && vpcC[0] === 1) {
      profile = vpcC[4]!;
      bitDepth = vpcC[6]! >> 4;
      sdr = sdrCodes(vpcC[7]!, vpcC[8]!, vpcC[9]!);
    }
  } else if (entry.type === 'av01') {
    const av1C = body(find('av1C'));
    codec = av1C ? av1Codec(av1C) : null;
    if (av1C && av1C.length >= 3) {
      profile = av1C[1]! >> 5;
      bitDepth = (av1C[2]! >> 6) & 1 ? ((av1C[2]! >> 5) & 1 ? 12 : 10) : 8;
    }
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
  for (const colr of children.filter((child) => child.type === 'colr')) {
    const data = body(colr)!;
    const kind = data.length >= 4 ? type4(data, 0) : '';
    // An ICC profile describes colour the decoder path has not been measured on.
    if (kind === 'prof' || kind === 'rICC') sdr = false;
    if (!colour && ((kind === 'nclx' && data.length >= 11) || (kind === 'nclc' && data.length >= 10))) {
      colour = { primaries: u16(data, 4), transfer: u16(data, 6), matrix: u16(data, 8), fullRange: kind === 'nclx' ? (data[10]! & 0x80) !== 0 : false };
      if (!sdrCodes(colour.primaries, colour.transfer, colour.matrix)) sdr = false;
    }
  }
  return { ok: true, config: { entry: entry.type, codec, description, codedWidth: width, codedHeight: height, pixelAspect, colour, profile, bitDepth, chroma, constraintFlags, sdr } };
}

// ── The display matrix ─────────────────────────────────────────────────────────────────────────

/**
 * The rotation a `tkhd` matrix asks for, clockwise, or `null` for anything a `<video>` would draw
 * differently from a plain turn (a mirror, a scale, a shear, perspective). `x` / `y` only move the turned
 * picture back into view. `a b c d = 0 1 −1 0` is a phone's portrait clip: turn 90° clockwise.
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

// ── The picture track ──────────────────────────────────────────────────────────────────────────

interface Edit {
  /** In the movie's time scale; `0` = to the end. */
  duration: number;
  /** In the track's time scale; `-1` = an empty edit. */
  mediaTime: number;
  rate: number;
}

interface PictureTrack {
  id: number;
  timescale: number;
  edits: Edit[] | null;
  matrix: number[] | null;
  stsd: Uint8Array | null;
  mixedEntries: boolean;
  located: boolean;
  /** Per sample, decode order. */
  dts: number[];
  durations: number[];
  offsets: number[];
  fileOffsets: number[];
  sizes: number[];
  sync: boolean[];
  /** Where the next fragment continues without a `tfdt`; the `trex` defaults. */
  next: number;
  defaults: TrackDefaults;
}

/** A track's `trex` defaults for its fragments' samples. */
interface TrackDefaults {
  duration: number;
  size: number;
  flags: number;
}

const NO_DEFAULTS: TrackDefaults = { duration: 0, size: 0, flags: 0 };

function readEdits(bytes: Uint8Array, edts: Box | undefined): Edit[] | null {
  const elst = kid(bytes, edts, 'elst');
  if (!elst) return null;
  need(elst, 8);
  const wide = bytes[elst.body] === 1;
  const count = u32(bytes, elst.body + 4);
  const row = wide ? 20 : 12;
  need(elst, 8 + count * row);
  const edits: Edit[] = [];
  for (let i = 0, at = elst.body + 8; i < count; i += 1, at += row) {
    const rateAt = at + (wide ? 16 : 8);
    edits.push({ duration: wide ? u64(bytes, at) : u32(bytes, at), mediaTime: wide ? i64(bytes, at + 8) : i32(bytes, at + 4), rate: i16(bytes, rateAt) + i16(bytes, rateAt + 2) / 65536 });
  }
  return edits;
}

/** Decode times, durations and composition offsets (`stts`, `ctts`). */
function readTimes(bytes: Uint8Array, parts: Box[], track: PictureTrack) {
  const stts = parts.find((entry) => entry.type === 'stts');
  if (!stts) return;
  need(stts, 8);
  const runs = u32(bytes, stts.body + 4);
  need(stts, 8 + runs * 8);
  let dt = 0;
  for (let i = 0, at = stts.body + 8; i < runs; i += 1, at += 8) {
    const count = u32(bytes, at);
    const delta = u32(bytes, at + 4);
    if (track.dts.length + count > MAX_SAMPLES) throw new Broken();
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
    // Version 0 is unsigned by the standard, but writers put negative values there too.
    const raw = u32(bytes, at + 4);
    const offset = signed || raw > 0x7fffffff ? i32(bytes, at + 4) : raw;
    for (let k = 0; k < count && index < track.offsets.length; k += 1, index += 1) track.offsets[index] = offset;
  }
}

/** Where each sample of an ordinary table is: sizes, samples per chunk, chunk offsets, sync samples. */
function readPlaces(bytes: Uint8Array, parts: Box[], track: PictureTrack) {
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
    const at = stz2.body + 12;
    for (let i = 0; i < n; i += 1) {
      if (field === 16) sizes.push(u16(bytes, at + i * 2));
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
  const places: number[] = [];
  const descriptions = new Set<number>();
  let sample = 0;
  for (let r = 0; r < rows && sample < count; r += 1) {
    const at = stsc.body + 8 + r * 12;
    const firstChunk = u32(bytes, at);
    const perChunk = u32(bytes, at + 4);
    descriptions.add(u32(bytes, at + 8));
    const lastChunk = r + 1 < rows ? u32(bytes, at + 12) - 1 : chunks.length;
    if (firstChunk < 1 || lastChunk > chunks.length || perChunk < 1) throw new Broken();
    for (let c = firstChunk; c <= lastChunk && sample < count; c += 1) {
      let place = chunks[c - 1]!;
      for (let k = 0; k < perChunk && sample < count; k += 1) {
        places.push(place);
        place += sizes[sample]!;
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
  track.fileOffsets = places;
  track.sizes = sizes;
  track.sync = sync;
  // A chunk that points at another sample description than the one entry (spec G, B6: one rule, below).
  if ([...descriptions].some((description) => description !== 1)) track.mixedEntries = true;
}

function readPictureTrack(moov: Uint8Array): { timescale: number; track: PictureTrack | null; trex: Map<number, TrackDefaults> } {
  const top = boxes(moov, 0, moov.length)?.find((entry) => entry.type === 'moov');
  if (!top) throw new Broken();
  const parts = kids(moov, top);
  const mvhd = parts.find((entry) => entry.type === 'mvhd');
  if (!mvhd) throw new Broken();
  need(mvhd, 24);
  const timescale = moov[mvhd.body] === 1 ? u32(moov, mvhd.body + 20) : u32(moov, mvhd.body + 12);
  if (timescale <= 0) throw new Broken();
  let track: PictureTrack | null = null;
  for (const trak of parts.filter((entry) => entry.type === 'trak')) {
    const trakParts = kids(moov, trak);
    const tkhd = trakParts.find((entry) => entry.type === 'tkhd');
    const mdia = trakParts.find((entry) => entry.type === 'mdia');
    const hdlr = kid(moov, mdia, 'hdlr');
    const mdhd = kid(moov, mdia, 'mdhd');
    if (!tkhd || !mdia || !hdlr || !mdhd) throw new Broken();
    need(hdlr, 12);
    if (type4(moov, hdlr.body + 8) !== 'vide') continue;
    need(tkhd, 24);
    need(mdhd, 24);
    const trackTimescale = moov[mdhd.body] === 1 ? u32(moov, mdhd.body + 20) : u32(moov, mdhd.body + 12);
    if (trackTimescale <= 0) throw new Broken();
    // version 0: 4 + 20 bytes, then reserved, layer, group, volume, reserved (16), then the matrix; version 1: 4 + 32.
    const matrixAt = tkhd.body + (moov[tkhd.body] === 1 ? 52 : 40);
    const candidate: PictureTrack = {
      id: moov[tkhd.body] === 1 ? u32(moov, tkhd.body + 20) : u32(moov, tkhd.body + 12),
      timescale: trackTimescale,
      edits: readEdits(moov, trakParts.find((entry) => entry.type === 'edts')),
      matrix: matrixAt + 36 <= tkhd.end ? Array.from({ length: 9 }, (_, i) => i32(moov, matrixAt + i * 4)) : null,
      stsd: null,
      mixedEntries: false,
      located: true,
      dts: [],
      durations: [],
      offsets: [],
      fileOffsets: [],
      sizes: [],
      sync: [],
      next: 0,
      defaults: NO_DEFAULTS,
    };
    const stbl = kid(moov, kid(moov, mdia, 'minf'), 'stbl');
    if (stbl) {
      const tables = kids(moov, stbl);
      const stsd = tables.find((entry) => entry.type === 'stsd');
      candidate.stsd = stsd ? moov.subarray(stsd.body, stsd.end) : null;
      // One rule for plain and fragmented files (spec G, B6): the picture track has exactly one sample entry.
      // A fragment may point at any entry (tfhd), and the decoder is configured from the first one only.
      if (candidate.stsd && candidate.stsd.length >= 8 && u32(candidate.stsd, 4) !== 1) candidate.mixedEntries = true;
      readTimes(moov, tables, candidate);
      try {
        readPlaces(moov, tables, candidate);
      } catch (error) {
        if (!(error instanceof Broken || error instanceof RangeError)) throw error;
        candidate.located = false;
      }
    }
    track = candidate;
    break;
  }
  // Every track's own defaults: another track's fragment before the picture track's is measured by ITS
  // defaults, or the picture samples after it would be placed wrong (spec G, B5).
  const trex = new Map<number, TrackDefaults>();
  const mvex = parts.find((entry) => entry.type === 'mvex');
  if (mvex) {
    for (const box of kids(moov, mvex).filter((entry) => entry.type === 'trex')) {
      need(box, 24);
      trex.set(u32(moov, box.body + 4), { duration: u32(moov, box.body + 12), size: u32(moov, box.body + 16), flags: u32(moov, box.body + 20) });
    }
  }
  if (track) track.defaults = trex.get(track.id) ?? NO_DEFAULTS;
  return { timescale, track, trex };
}

/** A sample whose flags say `sample_is_non_sync_sample` (ISO/IEC 14496-12 §8.8.3.1) is not a sync sample. */
const syncFromFlags = (flags: number) => (flags & 0x00010000) === 0;

/** One fragment's samples of the picture track, appended with their places in the file. */
function readFragment(bytes: Uint8Array, moofAt: number, track: PictureTrack, trex: ReadonlyMap<number, TrackDefaults>) {
  const moof = boxes(bytes, 0, bytes.length)?.find((entry) => entry.type === 'moof');
  if (!moof) throw new Broken();
  let previousEnd: number = moofAt;
  for (const traf of kids(bytes, moof).filter((entry) => entry.type === 'traf')) {
    const parts = kids(bytes, traf);
    const tfhd = parts.find((entry) => entry.type === 'tfhd');
    if (!tfhd) throw new Broken();
    need(tfhd, 8);
    const flags = u32(bytes, tfhd.body) & 0xffffff;
    const id = u32(bytes, tfhd.body + 4);
    const mine = id === track.id;
    const defaults = mine ? track.defaults : (trex.get(id) ?? NO_DEFAULTS);
    let at = tfhd.body + 8;
    let base = flags & 0x020000 ? moofAt : previousEnd;
    const field = () => {
      if (at + 4 > tfhd.end) throw new Broken();
      const value = u32(bytes, at);
      at += 4;
      return value;
    };
    if (flags & 0x01) {
      if (at + 8 > tfhd.end) throw new Broken();
      base = u64(bytes, at);
      at += 8;
    }
    if (flags & 0x02) field();
    const duration = flags & 0x08 ? field() : defaults.duration;
    const size = flags & 0x10 ? field() : defaults.size;
    const defaultFlags = flags & 0x20 ? field() : defaults.flags;
    const tfdt = parts.find((entry) => entry.type === 'tfdt');
    let dt = track.next;
    if (tfdt) {
      need(tfdt, 8);
      dt = bytes[tfdt.body] === 1 ? (need(tfdt, 12), u64(bytes, tfdt.body + 4)) : u32(bytes, tfdt.body + 4);
    }
    let dataAt = base;
    for (const trun of parts.filter((entry) => entry.type === 'trun')) {
      need(trun, 8);
      const signed = bytes[trun.body] === 1;
      const runFlags = u32(bytes, trun.body) & 0xffffff;
      const count = u32(bytes, trun.body + 4);
      let pos = trun.body + 8;
      if (runFlags & 0x01) {
        need(trun, 12);
        dataAt = base + i32(bytes, pos);
        pos += 4;
      }
      let firstFlags: number | null = null;
      if (runFlags & 0x04) {
        if (pos + 4 > trun.end) throw new Broken();
        firstFlags = u32(bytes, pos);
        pos += 4;
      }
      const row = (runFlags & 0x100 ? 4 : 0) + (runFlags & 0x200 ? 4 : 0) + (runFlags & 0x400 ? 4 : 0) + (runFlags & 0x800 ? 4 : 0);
      if (pos + count * row > trun.end || track.dts.length + count > MAX_SAMPLES) throw new Broken();
      for (let k = 0; k < count; k += 1) {
        let sampleDuration = duration;
        let sampleSize = size;
        let sampleFlags = k === 0 && firstFlags !== null ? firstFlags : defaultFlags;
        let offset = 0;
        if (runFlags & 0x100) {
          sampleDuration = u32(bytes, pos);
          pos += 4;
        }
        if (runFlags & 0x200) {
          sampleSize = u32(bytes, pos);
          pos += 4;
        }
        if (runFlags & 0x400) {
          sampleFlags = u32(bytes, pos);
          pos += 4;
        }
        if (runFlags & 0x800) {
          // Version 0 is unsigned by the standard, but writers put negative values there too: the ctts rule
          // (signed when only that makes sense, more than half the 32-bit range; spec G, B4).
          const raw = u32(bytes, pos);
          offset = signed || raw > 0x7fffffff ? i32(bytes, pos) : raw;
          pos += 4;
        }
        if (mine) {
          track.dts.push(dt);
          track.durations.push(sampleDuration);
          track.offsets.push(offset);
          track.fileOffsets.push(dataAt);
          track.sizes.push(sampleSize);
          track.sync.push(syncFromFlags(sampleFlags));
          if (sampleSize <= 0) track.located = false;
          dt += sampleDuration;
        }
        dataAt += sampleSize;
      }
    }
    previousEnd = dataAt;
    if (mine) track.next = dt;
  }
}

/**
 * The samples the edit list shows: empty edits, then at most one piece of media at normal speed; a sample
 * is shown when its composition time lies inside that piece (the frame facts' rule). `null` for an edit list
 * the export cannot follow.
 */
function shown(track: PictureTrack, movieTimescale: number, cts: readonly number[]): number[] | null {
  let from = -Infinity;
  let to = Infinity;
  if (track.edits && track.edits.length > 0) {
    let i = 0;
    while (i < track.edits.length && track.edits[i]!.mediaTime === -1) i += 1;
    const rest = track.edits.slice(i);
    if (rest.length !== 1 || rest[0]!.rate !== 1) return null;
    const edit = rest[0]!;
    from = edit.mediaTime;
    to = edit.duration > 0 ? edit.mediaTime + (edit.duration * track.timescale) / movieTimescale : Infinity;
  }
  const out: number[] = [];
  cts.forEach((time, i) => {
    if (time >= from && time < to) out.push(i);
  });
  return out;
}

// ── The index ──────────────────────────────────────────────────────────────────────────────────

/** A sample's composition time in whole microseconds: the timestamp it carries into and out of the decoder. */
export function stampUs(cts: number, timescale: number): number {
  return Math.round((cts * 1_000_000) / timescale);
}

export function readSampleIndex(found: IndexBoxes): IndexAnswer {
  let movieTimescale: number;
  let track: PictureTrack | null;
  try {
    let trex: Map<number, TrackDefaults>;
    ({ timescale: movieTimescale, track, trex } = readPictureTrack(found.moov));
    if (track) for (const moof of found.moofs) readFragment(moof.bytes, moof.at, track, trex);
  } catch (error) {
    if (error instanceof Broken || error instanceof RangeError) return { ok: false, reason: 'unreadable' };
    throw error;
  }
  if (!track || track.dts.length === 0) return { ok: false, reason: 'no-video' };
  // The frame facts read the same boxes: the index is only used where it counts the pictures as they do.
  const facts = readTiming({ moov: found.moov, moofs: found.moofs.map((moof) => moof.bytes) });
  if (!facts.ok || !facts.timing.video) return { ok: false, reason: 'unreadable' };
  if (!track.located || track.fileOffsets.length !== track.dts.length) return { ok: false, reason: 'not-located' };
  if (track.mixedEntries) return { ok: false, reason: 'mixed-entries' };
  const entry = readSampleEntry(track.stsd);
  if (!entry.ok) return { ok: false, reason: entry.reason };
  const rotation = rotationOf(track.matrix);
  if (rotation === null) return { ok: false, reason: 'transform' };
  const cts = track.dts.map((dts, i) => dts + track!.offsets[i]!);
  const inside = shown(track, movieTimescale, cts);
  if (!inside || inside.length === 0) return { ok: false, reason: 'edits' };
  if (inside.length !== facts.timing.video.frames) return { ok: false, reason: 'disagrees' };
  const pictures = [...inside].sort((x, y) => cts[x]! - cts[y]! || x - y);
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
      variable: facts.timing.video.variable,
      sound: soundTrackOf(found.moov),
    },
  };
}
