/**
 * Editing studio v2 — what the decoder path feeds the decoder for the pictures a film needs (spec F, F3).
 *
 * The export plan (export-plan.ts) says which source frame every film frame shows. Here that becomes, per
 * source: which picture of the file it is, which samples must be decoded to get it (from a sync sample,
 * in decode order) and which byte ranges hold them. Pure: numbers in, numbers out; the browser part is
 * components/brand-studio/editor-v2/frame-decoder.ts.
 */

import { sameRate } from './stored';

// ── Which picture ──────────────────────────────────────────────────────────────────────────────

/** What the picture rule needs to know of a source. */
export interface PictureTimes {
  /** Pictures inside the edit list. */
  frames: number;
  /** The frames are not evenly spaced (the container's own verdict). */
  variable: boolean;
  /** Track ticks per second. */
  timescale: number;
  /** Presentation time of picture k, in ticks after picture 0 (ascending). */
  relTicks: readonly number[];
  /** Where the last picture ends, in ticks after picture 0. */
  endTicks: number;
}

/**
 * The picture of a source that film frame shows: ONE rule for the decoder path.
 *
 * - Evenly spaced footage: picture `sourceFrame`, the k-th picture in presentation order after the edit
 *   list: exactly the number the timeline and the seek path use (frames.ts, `clipFrameAt`).
 * - Footage whose frames are not evenly spaced: by time. The film frame's moment on the cut's own clock is
 *   `mediaFrame / fps` after the source's first picture (frames.ts puts the cut's in-point and speed into
 *   `mediaFrame`, the film-grid frame of the footage), and the picture is the one whose presentation span
 *   `[relTicks[k], relTicks[k + 1])` holds that moment: the picture a player shows then. On evenly spaced
 *   timestamps this gives the very same number as the first rule (tested): `floor(mediaFrame × rate / fps)`.
 *
 * The moment is the START of the film frame, not its middle: frames.ts samples each film frame at its start
 * (`sourceFrameIndex`), and the middle would move pictures on cuts with a speed or a different rate.
 *
 * `past`: the asked-for picture is past the footage's last one (spec E addendum C3): the last one is shown
 * and the export says so.
 */
export function pictureFor(entry: { sourceFrame: number; mediaFrame: number }, fps: number, times: PictureTimes): { picture: number; past: boolean } {
  const last = Math.max(0, times.frames - 1);
  if (!times.variable) {
    if (entry.sourceFrame > last) return { picture: last, past: true };
    return { picture: Math.max(0, entry.sourceFrame), past: false };
  }
  const at = (Math.max(0, entry.mediaFrame) * times.timescale) / fps;
  // A microsecond of tolerance: a moment that lands on a picture's start by arithmetic belongs to it.
  const moment = at + 1e-6 * times.timescale;
  if (moment >= times.endTicks) return { picture: last, past: true };
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times.relTicks[mid]! <= moment) lo = mid;
    else hi = mid - 1;
  }
  return { picture: lo, past: false };
}

/** The picture rule's times from a sample index (sample-index.ts). */
export function pictureTimes(index: { pictures: readonly number[]; cts: readonly number[]; durations: readonly number[]; timescale: number; variable: boolean }): PictureTimes {
  const first = index.cts[index.pictures[0]!] ?? 0;
  const relTicks = index.pictures.map((sample) => index.cts[sample]! - first);
  const lastSample = index.pictures[index.pictures.length - 1];
  const endTicks = lastSample === undefined ? 0 : index.cts[lastSample]! - first + index.durations[lastSample]!;
  return { frames: index.pictures.length, variable: index.variable, timescale: index.timescale, relTicks, endTicks };
}

// ── Which film frames are decoded together ──────────────────────────────────────────────────────

export interface PictureRequest {
  /** Film frame. */
  frame: number;
  srcUrl: string;
  picture: number;
}

export interface DecodeGroup {
  srcUrl: string;
  /** First and last film frame. */
  first: number;
  last: number;
  /** The pictures it shows, ascending, each once. */
  pictures: number[];
}

/**
 * Runs of consecutive film frames on one source whose pictures never go back: one decoding pass each.
 * A cut that comes back to an earlier part of its footage (a reordered piece, a copy) starts a new one.
 */
export function decodeGroups(requests: readonly PictureRequest[]): DecodeGroup[] {
  const groups: DecodeGroup[] = [];
  let current: DecodeGroup | null = null;
  let previous: PictureRequest | null = null;
  for (const request of requests) {
    const continues = current && previous && previous.srcUrl === request.srcUrl && request.frame === previous.frame + 1 && request.picture >= previous.picture;
    if (!continues) {
      current = { srcUrl: request.srcUrl, first: request.frame, last: request.frame, pictures: [request.picture] };
      groups.push(current);
    } else {
      current!.last = request.frame;
      if (request.picture !== previous!.picture) current!.pictures.push(request.picture);
    }
    previous = request;
  }
  return groups;
}

// ── Which samples ──────────────────────────────────────────────────────────────────────────────

/** What the sample rule needs to know of a source (sample-index.ts `VideoIndex` is one). */
export interface SampleOrder {
  /** Picture k is sample `pictures[k]` (decode order). */
  pictures: readonly number[];
  /** Composition time of each sample. */
  cts: readonly number[];
  /** Sync samples, ascending. */
  syncs: readonly number[];
}

export interface DecodeSegment {
  /** First sample fed (a sync sample) and the last, in decode order. */
  from: number;
  to: number;
  /** The wanted pictures it yields, ascending. */
  pictures: number[];
}

/** Skipping fewer samples than this is not worth restarting the decoder at the next sync sample. */
export const JUMP_MIN_SAMPLES = 8;

/**
 * Where decoding for picture `picture` can start: the last sync sample at or before its sample in decode
 * order whose own picture is not after it. A picture shown before the sync sample it follows in decode
 * order (a leading picture of an open group) may refer to the group before: start one group earlier.
 * `null` when no sync sample comes before it.
 */
export function syncStart(order: SampleOrder, picture: number): number | null {
  const sample = order.pictures[picture];
  if (sample === undefined) return null;
  const time = order.cts[sample]!;
  let lo = 0;
  let hi = order.syncs.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (order.syncs[mid]! <= sample) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  while (at >= 0 && order.cts[order.syncs[at]!]! > time) at -= 1;
  return at >= 0 ? order.syncs[at]! : null;
}

/**
 * The samples to feed for a group's pictures (ascending), as segments that each start on a sync sample.
 * Decoding runs on from one wanted picture to the next while that is cheaper than restarting; when a
 * whole stretch with a sync sample of its own lies between them (a fast cut), it restarts there. `null`
 * when a picture has no sync sample before it (the source is then taken by seeking).
 */
export function decodeSegments(order: SampleOrder, pictures: readonly number[]): DecodeSegment[] | null {
  const segments: DecodeSegment[] = [];
  let current: DecodeSegment | null = null;
  for (const picture of pictures) {
    const sample = order.pictures[picture];
    const start = syncStart(order, picture);
    if (sample === undefined || start === null) return null;
    if (current && (sample <= current.to || start <= current.to + JUMP_MIN_SAMPLES)) {
      current.to = Math.max(current.to, sample);
      current.pictures.push(picture);
      continue;
    }
    current = { from: start, to: sample, pictures: [picture] };
    segments.push(current);
  }
  return segments;
}

// ── Which bytes ────────────────────────────────────────────────────────────────────────────────

export interface ByteRun {
  /** File bytes `[start, end)`. */
  start: number;
  end: number;
  /** The samples it holds, in decode order, `[from, to]`. */
  from: number;
  to: number;
}

/** Between two samples this much other data (sound, another track) is read through rather than asked apart. */
export const RUN_GAP = 1024 * 1024;
/** No one request asks for more than this (a single larger sample is asked for alone). */
export const RUN_CAP = 8 * 1024 * 1024;

/**
 * The byte ranges that hold samples `from..to` (decode order), coalesced: neighbouring samples share one
 * request up to `cap` bytes, across gaps of at most `gap` bytes. A sample that lies before the previous
 * one starts a new range.
 */
export function byteRuns(
  layout: { offsets: readonly number[]; sizes: readonly number[] },
  from: number,
  to: number,
  gap = RUN_GAP,
  cap = RUN_CAP,
): ByteRun[] {
  const runs: ByteRun[] = [];
  let run: ByteRun | null = null;
  for (let sample = from; sample <= to; sample += 1) {
    const start = layout.offsets[sample]!;
    const end = start + layout.sizes[sample]!;
    if (run && start >= run.end && start - run.end <= gap && end - run.start <= cap) {
      run.end = end;
      run.to = sample;
      continue;
    }
    if (run && start >= run.start && end <= run.end) {
      run.to = sample;
      continue;
    }
    run = { start, end, from: sample, to: sample };
    runs.push(run);
  }
  return runs;
}

// ── Which colour ───────────────────────────────────────────────────────────────────────────────

/** The colour description fields `VideoDecoderConfig.colorSpace` takes (a subset of WebCodecs' names). */
export interface ColourSpaceInit {
  matrix: 'smpte170m' | 'bt709' | 'bt470bg';
  primaries: 'smpte170m' | 'bt709' | 'bt470bg';
  transfer: 'smpte170m' | 'bt709';
  fullRange: boolean;
}

/**
 * The colour the seek path's `<video>` draws a picture with when NEITHER the stream NOR the MP4's `colr` box
 * says anything about its colour: picked by the picture's coded height, BT.709 from 720 rows up, BT.601
 * (SMPTE 170M) below, limited range (1278×718 → 601, 960×720 → 709, 1280×544 → 601, 720×1280 → 709).
 * It is the last step of the element's rule (measured 2026-11-22, spec G A0): the stream's own description
 * first, then the `colr` box, then this. `decoderColourSpace` gives the decoder the whole rule.
 *
 * Measured on Chromium 2026-11-21 (spec F, F3), frame 0 drawn at native size from a `<video>` and from
 * `VideoDecoder`, on clips whose `colr` box was absent or agreed with this rule: unconfigured, `VideoDecoder`
 * used BT.709, so an untagged 640×360 clip came out greener on saturated red (255, 24, 0 against the
 * element's 254, 0, 0; mean |difference| in green 22.7); configured this way the difference was 0.000.
 *
 * Measured again 2026-11-22 (flat colour patches, whole exported files): a stream that describes its colour
 * (H.264 or HEVC Main 10 with BT.709 in the stream itself) is drawn BT.709 by both paths at 540 rows too, and
 * the decoder's frames say BT.709 although BT.601 was configured: the stream's own description wins on both.
 * Every combination tried came out the same on both paths once the decoder was told the box's colour (mean
 * and largest |difference| 0 on every patch).
 */
export function elementColourSpace(codedHeight: number): ColourSpaceInit {
  return codedHeight >= 720
    ? { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false }
    : { matrix: 'smpte170m', primaries: 'smpte170m', transfer: 'smpte170m', fullRange: false };
}

const PRIMARIES: Record<number, ColourSpaceInit['primaries']> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' };
const TRANSFER: Record<number, ColourSpaceInit['transfer']> = { 1: 'bt709', 6: 'smpte170m' };
const MATRIX: Record<number, ColourSpaceInit['matrix']> = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m' };

/**
 * The colour the decoder is told for a source: what the `<video>` draws it with when the stream says nothing
 * of its colour (when it does, both paths follow the stream, measured). Measured 2026-11-22 (spec G, A0): the
 * element follows the MP4's `colr` box then (H.264 8-bit, HEVC 8-bit and HEVC Main 10 at 540 rows, `colr`
 * BT.709 only: red 232 on the element against 212 by the height rule; mean |difference| 2.0 per frame, 20 on
 * a red patch); without a box, the height rule (`elementColourSpace`). A code the box leaves unspecified (2)
 * falls back to the height rule for that part.
 */
export function decoderColourSpace(config: { codedHeight: number; colour: { primaries: number; transfer: number; matrix: number; fullRange: boolean } | null }): ColourSpaceInit {
  const fallback = elementColourSpace(config.codedHeight);
  const stated = config.colour;
  if (!stated) return fallback;
  return {
    primaries: PRIMARIES[stated.primaries] ?? fallback.primaries,
    transfer: TRANSFER[stated.transfer] ?? fallback.transfer,
    matrix: MATRIX[stated.matrix] ?? fallback.matrix,
    fullRange: stated.fullRange,
  };
}

/**
 * Footage whose colour the decoder path was measured on, so it may take it (`false`: seeked, reason
 * `colour`). Every case below gave the same pixels on both paths (mean and largest |difference| 0 on every
 * patch, every frame) on Chromium 149 with an NVIDIA RTX PRO 6000 Blackwell (D3D11). Exactly:
 *
 * - SDR by what the file states (sample-index.ts `sdr`; spec F review 1, item 1), and the chroma format read
 *   from the record and 4:2:0 (sample-index.ts `chroma`; not read: seeked). At 8 bits the range is not
 *   looked at: limited and full range are both taken, as measured. H.264 High at 1080 rows with full range
 *   in the box only (spec G, `h8-1080-colr-full`); on 2026-11-22 (spec H, round 2), at 1080 and 540 rows:
 *   Constrained Baseline, Main and HEVC Main with full range in the stream and the box, H.264 High with full
 *   range in the stream only (no box: what phone recordings often are), and the box saying full over a
 *   limited stream. All equal on both paths;
 * - the pictures stored as frames (sample-index.ts `progressive`; spec I, G6): every measured file was. H.264:
 *   the first SPS in `avcC` read and frame_mbs_only_flag 1 (no SPS in the record, as `avc3` may, or one that
 *   cannot be read: seeked). HEVC: seeked only when `hvcC` says interlaced and not progressive;
 * - H.264, 8 bits: Constrained Baseline (profile_idc 66 with constraint_set1), Main (77) and High (100).
 *   Measured: High in spec F and G; Constrained Baseline and Main untagged and `colr`-only on 2026-11-22
 *   (spec H, F7). Not Extended (88) or Baseline without constraint_set1: never measured;
 * - HEVC Main (general_profile_idc 1), 8 bits;
 * - HEVC Main 10 (profile 2), 10 bits, whose `colr` says BT.709 primaries, transfer and matrix (1/1/1) and
 *   limited range: what the studio's own video tool writes (seen on production, spec G A0). Measured on
 *   2026-11-22 with the hardware HEVC decoder (there is no software one here) at 1080, 720 and 540 rows.
 *
 * The colour the stream itself states (its parameter sets) is not read: the decoder used what the stream said
 * whenever it differed from the box, in both directions (BT.601 in the stream with BT.709 in the box, and the
 * reverse), and so did the `<video>` element, so the two paths agreed (spec H, F7). The range too: told limited
 * over a full-range stream with no box, and full over a limited stream, its frames came out in the stream's
 * range (2026-11-22, round 2).
 *
 * Not taken: anything else, among it interlaced H.264 and H.264 not known to be frames, HEVC stated as
 * interlaced only, 10-bit footage whose container says nothing (the stream itself may say
 * HLG or PQ), 10-bit footage in full range or tagged BT.601, BT.2020 at any depth, PQ, HLG, an ICC profile,
 * H.264 High 10 / 4:2:2 / 4:4:4, HEVC Main 10 at 8 bits, HEVC range extensions, 12 bits, 4:2:2, 4:4:4 and
 * monochrome.
 */
export function colourAdmitted(config: {
  entry: string;
  profile: number | null;
  bitDepth: number | null;
  chroma: number | null;
  constraintFlags?: number | null;
  progressive: boolean | null;
  sdr: boolean;
  colour: { primaries: number; transfer: number; matrix: number; fullRange: boolean } | null;
}): boolean {
  if (!config.sdr || config.chroma !== 1) return false;
  if (config.entry === 'avc1' || config.entry === 'avc3') {
    // Interlaced H.264 was never measured: only an SPS read as frames is taken (spec I, G6).
    if (config.bitDepth !== 8 || config.progressive !== true) return false;
    if (config.profile === 66) return ((config.constraintFlags ?? 0) & 0x40) !== 0;
    return config.profile === 77 || config.profile === 100;
  }
  if (config.entry === 'hvc1' || config.entry === 'hev1') {
    if (config.progressive === false) return false;
    if (config.profile === 1) return config.bitDepth === 8;
    const bt709 = !!config.colour && config.colour.primaries === 1 && config.colour.transfer === 1 && config.colour.matrix === 1 && !config.colour.fullRange;
    return config.profile === 2 && config.bitDepth === 10 && bt709;
  }
  return false;
}

// ── Which path ─────────────────────────────────────────────────────────────────────────────────

export type ExportPath = 'decoder' | 'seek';

/**
 * A developer's choice for the proof (`?exportPath=seek|decoder` on the editor page, no UI): `seek` takes
 * every source by seeking; `decoder` takes every source through the decoder and stops the export where it
 * cannot (no quiet fallback); `null` is the product: the decoder where it can, seeking where it cannot.
 */
export type ExportPathOverride = 'decoder' | 'seek' | null;

export function exportPathOverride(value: string | string[] | null | undefined): ExportPathOverride {
  const one = Array.isArray(value) ? value[0] : value;
  return one === 'seek' || one === 'decoder' ? one : null;
}

/**
 * A developer's switch for the checks (`?exportDownload=off` on the editor page, no UI; spec H, F9): `false`
 * skips only the automatic download when an export finishes. The finished sheet, its data and "download
 * again" are unchanged. Anything else, or no parameter: the file downloads by itself, as always.
 */
export function exportAutoDownload(value: string | string[] | null | undefined): boolean {
  const one = Array.isArray(value) ? value[0] : value;
  return one !== 'off';
}

/**
 * Whether every cut on a source runs at the file's own rate (spec F review 1, item 2). For evenly spaced
 * footage the decoder path shows picture `sourceFrame` and the seek path the picture at
 * `(sourceFrame + ½) / sourceFps`: the same picture only when the cut's `sourceFps` is the file's rate. A
 * stored block can carry another rate (an old playback measurement wrote 30 for a 29.97 file); there the two
 * paths part after a few hundred frames, so such a source keeps the seek path. Footage whose frames are not
 * evenly spaced follows the time rule and its timestamps, not a rate. One rule for "the same rate":
 * stored.ts `sameRate`.
 */
export function cutRatesMatch(cutRates: readonly number[], file: { fps: number; variable: boolean }): boolean {
  if (file.variable) return true;
  return cutRates.every((rate) => sameRate(rate, file.fps));
}

/**
 * The sample entries the decoder path was measured on (spec F; spec G A0, B3): H.264 and HEVC. VP9 and AV1 in MP4
 * would go through the same reader with a colour rule nobody measured for them: they are seeked, reason
 * `codec-unmeasured`, until they are.
 */
const MEASURED_ENTRIES = new Set(['avc1', 'avc3', 'hvc1', 'hev1']);

export function codecMeasured(entry: string): boolean {
  return MEASURED_ENTRIES.has(entry);
}

/** Why a source is taken by seeking. */
export type SeekReason = 'forced' | 'no-decoder' | 'container' | 'codec-unmeasured' | 'colour' | 'rate' | 'codec-unsupported' | 'error' | string;

export function choosePath(input: {
  override: ExportPathOverride;
  /** `VideoDecoder` exists in this browser. */
  hasDecoder: boolean;
  /**
   * Why the clip's frame facts (lib/brand-studio/editor-v2/container.ts) could not be read, or `null` when
   * they were. The editor then measured the clip by playback and numbers its pictures that way, so its
   * pictures are taken by seeking too (a fragmented file above the reader's limit, too many requests).
   */
  factsFailure?: string | null;
  /** The source's index could be read (`null` when not: a reason is given). */
  indexFailure: string | null;
  /** Its sample entry is one the decoder path was measured on (`codecMeasured`). `false`: seeked, reason `codec-unmeasured`. */
  codecMeasured?: boolean | null;
  /**
   * The footage is what the decoder path's colour was measured on (`colourAdmitted`). `false`: seeked, reason
   * `colour`. Omitted: not asked.
   */
  plainColour?: boolean | null;
  /** Every cut on the source runs at the file's own rate (`cutRatesMatch`). `false`: seeked, reason `rate`. */
  rateMatches?: boolean | null;
  /** `VideoDecoder.isConfigSupported` said yes (`null` when not asked). */
  configSupported: boolean | null;
}): { path: ExportPath; reason: SeekReason | null } {
  if (input.override === 'seek') return { path: 'seek', reason: 'forced' };
  if (!input.hasDecoder) return { path: 'seek', reason: 'no-decoder' };
  if (input.factsFailure) return { path: 'seek', reason: `facts:${input.factsFailure}` };
  if (input.indexFailure !== null) return { path: 'seek', reason: `container:${input.indexFailure}` };
  if (input.codecMeasured === false) return { path: 'seek', reason: 'codec-unmeasured' };
  if (input.plainColour === false) return { path: 'seek', reason: 'colour' };
  if (input.rateMatches === false) return { path: 'seek', reason: 'rate' };
  if (input.configSupported !== true) return { path: 'seek', reason: 'codec-unsupported' };
  return { path: 'decoder', reason: null };
}

/**
 * The export sheet's "this window is covered, so it is slow" line (spec E addendum C2): true only while the
 * screen refreshes slowly AND the picture being made comes from the seek path, which waits for the screen.
 * The decoder path does not wait for it, so there the line would not be true.
 */
export function slowNotice(reduced: boolean, path: ExportPath | null): boolean {
  return reduced && path === 'seek';
}

/**
 * The sheet's line before export about footage whose frames are not evenly spaced ("a few frames may
 * differ"): only when that footage will be taken by seeking. Through the decoder the file follows the
 * footage's own timestamps. `null` (not known yet) keeps the line, as before.
 */
export function unevenWarning(variable: boolean, path: ExportPath | null): boolean {
  return variable && path !== 'decoder';
}
