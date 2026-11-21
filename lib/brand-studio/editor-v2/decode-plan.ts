/**
 * Editing studio v2 — what the decoder path feeds the decoder for the pictures a film needs (spec F, F3).
 *
 * The export plan (export-plan.ts) says which source frame every film frame shows. Here that becomes, per
 * source: which picture of the file it is, which samples must be decoded to get it (from a sync sample,
 * in decode order) and which byte ranges hold them. Pure: numbers in, numbers out; the browser part is
 * components/brand-studio/editor-v2/frame-decoder.ts.
 */

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

/** Why a source is taken by seeking. */
export type SeekReason = 'forced' | 'no-decoder' | 'container' | 'codec-unsupported' | 'error' | string;

export function choosePath(input: {
  override: ExportPathOverride;
  /** `VideoDecoder` exists in this browser. */
  hasDecoder: boolean;
  /** The source's index could be read (`null` when not: a reason is given). */
  indexFailure: string | null;
  /** `VideoDecoder.isConfigSupported` said yes (`null` when not asked). */
  configSupported: boolean | null;
}): { path: ExportPath; reason: SeekReason | null } {
  if (input.override === 'seek') return { path: 'seek', reason: 'forced' };
  if (!input.hasDecoder) return { path: 'seek', reason: 'no-decoder' };
  if (input.indexFailure !== null) return { path: 'seek', reason: `container:${input.indexFailure}` };
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
