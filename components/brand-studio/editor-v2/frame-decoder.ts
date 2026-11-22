'use client';

import { byteRuns, decodeSegments, decoderColourSpace, syncStart, type ByteRun, type DecodeSegment } from '@/lib/brand-studio/editor-v2/decode-plan';
import { isReclaim } from '@/lib/brand-studio/editor-v2/export-run';
import type { SampleBytes } from '@/lib/brand-studio/editor-v2/sample-bytes';
import { stampUs, type VideoIndex } from '@/lib/brand-studio/editor-v2/sample-index';
import { ReadCancelled, eitherSignal, watchRead, type Watch } from '@/lib/brand-studio/editor-v2/watched-read';

/**
 * Editing studio v2 — the export's decoder path (spec F, F3): a source's pictures from its own samples,
 * through `VideoDecoder`, without a `<video>` element and without waiting for the screen.
 *
 * For each run of film frames on this source (lib/brand-studio/editor-v2/decode-plan.ts `decodeGroups`) the
 * samples are fed in decode order from a sync sample (`decodeSegments`), their bytes read by range
 * (`byteRuns`, lib/brand-studio/editor-v2/sample-bytes.ts). Outputs are matched back to pictures by their
 * timestamps (each sample carries its own composition time in, and the decoder hands it back out): the
 * decoder's output order is never assumed. Only wanted pictures are kept, every other frame is closed at
 * once, and no more than a few are held ahead (decoders stall when the page keeps their frames). A slowed
 * cut asks for the same picture again: the held frame is reused. A picture that does not come out, a
 * decoder error or a stuck decoder is a `DecodeFailure`: the export never draws a frame it did not verify
 * by timestamp, and takes the rest of that source by seeking (lib/brand-studio/editor-v2/picture-paths.ts).
 *
 * Every wait has an end (spec G, B1; spec H, F2): a picture request ends when one of its own waits does: a
 * run of bytes after 15 s without a byte or after its size's time at the slowest connection given time for
 * (lib/brand-studio/editor-v2/watched-read.ts `totalLimitMs`), the decoder after 20 s without an output, a
 * dequeue or an error, and the export's cancel at once. There is no fixed total per picture any more: on a slow
 * connection the encoder can wait longer than the ~90 s after which a HIDDEN page's encoder is taken back
 * (spec G, A1); the export then starts again once the page is visible (A2). A visible page's idle encoder was not
 * taken back in 200 s (measured, spec H F2).
 *
 * The decoder itself is made on first use and may be let go (`suspend`: the export keeps at most four open)
 * or taken back by the browser (a `QuotaExceededError`, spec G A3): either way it is made again and fed from
 * the sync sample before the picture asked for, once per request. Every frame it gives is either held for a
 * picture asked for or closed at once, and everything held is closed on `suspend`, `close` and a reclaim; a
 * frame that arrives from a decoder already let go is closed too (spec G A0: no frame left to the garbage
 * collector).
 */

/** Decode requests waiting in the decoder before feeding pauses. */
const QUEUE_CAP = 6;
/**
 * Wanted pictures held after the one asked for, while it has not come out. A decoder gives its pictures out
 * in presentation order, so later pictures before it mean it was skipped: at this many the request fails
 * instead of feeding on (spec G, B7).
 */
export const HOLD_CAP = 6;
/** No output, dequeue or error for this long while waiting: the decoder is stuck. */
const STALL_MS = 20_000;

export class DecodeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecodeFailure';
  }
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * What `VideoDecoder.configure` is given for a source. The colour is the one the seek path's `<video>` draws
 * with (`decoderColourSpace`): the same pixels on both paths.
 */
export function decoderConfig(index: VideoIndex): VideoDecoderConfig {
  const { config } = index;
  const out: VideoDecoderConfig = { codec: config.codec, codedWidth: config.codedWidth, codedHeight: config.codedHeight, colorSpace: decoderColourSpace(config) };
  if (config.description) out.description = config.description;
  const [h, v] = config.pixelAspect;
  if (h !== v) {
    const width = config.codedWidth * h;
    const height = config.codedHeight * v;
    const divisor = gcd(width, height) || 1;
    out.displayAspectWidth = width / divisor;
    out.displayAspectHeight = height / divisor;
  }
  return out;
}

export async function decoderSupports(config: VideoDecoderConfig): Promise<boolean> {
  if (typeof VideoDecoder === 'undefined') return false;
  try {
    return (await VideoDecoder.isConfigSupported(config)).supported === true;
  } catch {
    return false;
  }
}

export interface DecoderStats {
  fed: number;
  outputs: number;
  segments: number;
  /** Times a decoder was made again after the first (let go to stay under the cap, or taken back). */
  reopened: number;
  /** Of those, taken back by the browser. */
  reclaimed: number;
}

export class PictureDecoder {
  private decoder: VideoDecoder | null = null;
  private made = false;
  private closed = false;
  private readonly stamps = new Map<number, number>();
  private readonly held = new Map<number, VideoFrame>();
  private wanted = new Set<number>();
  private floor = 0;
  private failure: Error | null = null;
  /** The browser took the decoder back since the last step (spec G, A3). */
  private reclaimedNow = false;
  private waiters: Array<() => void> = [];
  private group = -1;
  private segments: DecodeSegment[] = [];
  /** Wanted picture → the segment that yields it. */
  private segmentOf = new Map<number, number>();
  private segment = -1;
  private next = 0;
  /**
   * The segment's flush: not asked yet, running in the background, or settled. It is never awaited: the
   * decoder may need the frames held here back before it can finish, so every output wakes the loop and a
   * wanted picture is taken as soon as it is out (measured: awaiting it deadlocked a second export).
   */
  private flushState: 'none' | 'running' | 'done' = 'none';
  /** Bumped on every reset or close: a flush that settles afterwards belongs to an earlier segment. */
  private generation = 0;
  private runs: ByteRun[] = [];
  private runOf = new Map<number, number>();
  private fetched = new Map<number, Promise<Uint8Array>>();
  /** The export's cancel, for reads started ahead of the picture that needs them. */
  private signal: AbortSignal | undefined;
  /**
   * Aborts the reads started for this segment when the session lets go of them (suspend, close, another group or
   * segment, a reclaim): no bytes read and thrown away after that (spec H, F6).
   */
  private reading = new AbortController();
  private readonly counts: DecoderStats = { fed: 0, outputs: 0, segments: 0, reopened: 0, reclaimed: 0 };

  constructor(
    private readonly index: VideoIndex,
    private readonly bytes: SampleBytes,
    private readonly config: VideoDecoderConfig,
  ) {
    index.pictures.forEach((sample, picture) => this.stamps.set(stampUs(index.cts[sample]!, index.timescale), picture));
  }

  /** A decoder is open now (made on first use; let go by `suspend`, `close` or the browser). */
  get live(): boolean {
    return this.decoder !== null;
  }

  stats(): DecoderStats {
    return { ...this.counts };
  }

  /**
   * Picture `picture` of group `group` (whose wanted pictures are `pictures`, ascending). The frame stays
   * the session's: it is valid until the next call asks for a later picture, another group, `suspend()` or
   * `close()`.
   */
  async picture(group: number, pictures: readonly number[], picture: number, signal?: AbortSignal): Promise<VideoFrame> {
    if (this.closed) throw new DecodeFailure('the decoder session is closed');
    this.signal = signal;
    // No fixed total for a picture (spec H, F2): it ends when one of its own waits does: a read (a stall, or its
    // size's time), the decoder's stall guard, or the export's cancel (this watch).
    const watch = watchRead({ stallMs: 0, totalMs: 0 }, signal);
    try {
      return await this.take(group, pictures, picture, watch);
    } catch (error) {
      if (error instanceof DecodeFailure) throw error;
      if (error instanceof ReadCancelled) throw new DecodeFailure('cancelled');
      throw new DecodeFailure(error instanceof Error ? error.message : String(error));
    } finally {
      watch.done();
    }
  }

  /** Lets go of the decoder, the frames it holds and the bytes read ahead; the next request makes them again. */
  suspend(): void {
    this.drop();
  }

  close(): void {
    this.closed = true;
    this.drop();
  }

  private async take(group: number, pictures: readonly number[], picture: number, watch: Watch): Promise<VideoFrame> {
    if (group !== this.group) this.startGroup(group, pictures);
    this.release(picture);
    let reopenedHere = false;
    for (;;) {
      const held = this.held.get(picture);
      if (held) return held;
      if (this.failure) throw this.failure;
      if (this.reclaimedNow) {
        // Taken back by the browser (spec G, A3): made again and fed from the sync sample, once per request.
        if (reopenedHere) throw new DecodeFailure('the browser took the decoder back twice for one picture');
        reopenedHere = true;
        this.reclaimedNow = false;
        this.counts.reclaimed += 1;
        this.drop();
        continue;
      }
      if (this.decoder?.state === 'closed') {
        // Closed by the browser and its error not delivered yet: it says whether it was taken back.
        await watch.guard(this.event());
        continue;
      }
      const at = this.segmentOf.get(picture);
      if (at === undefined || at < this.segment) throw new DecodeFailure(`picture ${picture} is in no segment ahead`);
      if (at !== this.segment || !this.decoder) {
        this.startSegment(at, picture);
        continue;
      }
      // Later wanted pictures came out and this one did not: the decoder skipped it (spec G, B7).
      if (this.held.size >= HOLD_CAP) throw new DecodeFailure(`picture ${picture} did not come out before ${this.held.size} later ones`);
      const decoder = this.decoder;
      const segment = this.segments[at]!;
      if (this.next <= segment.to) {
        if (decoder.decodeQueueSize >= QUEUE_CAP) {
          await watch.guard(this.event());
          continue;
        }
        // While the next sample's bytes come, a picture that comes out is looked at first: the one asked for may
        // already be decoded, and a slow read for later samples must not hold it back (found with a decoder that
        // answers in tasks, spec H F8). Waiting for bytes is not the decoder's silence: no stall guard here.
        const run = this.runOf.get(this.next);
        if (run === undefined) throw new DecodeFailure(`sample ${this.next} is in no byte range`);
        const bytes = this.fetchRun(run);
        const ready = await watch.guard(Promise.race([bytes.then(() => true, () => true), this.signalled().then(() => false)]));
        if (!ready) continue;
        await this.feed(this.next, watch);
        this.next += 1;
        continue;
      }
      if (this.flushState === 'none') {
        this.flushState = 'running';
        const generation = this.generation;
        decoder.flush().then(
          () => {
            if (generation !== this.generation) return;
            this.flushState = 'done';
            this.wake();
          },
          (error: unknown) => {
            if (generation !== this.generation) return;
            this.flushState = 'done';
            this.onError(decoder, error);
          },
        );
        continue;
      }
      if (this.flushState === 'running') {
        await watch.guard(this.event());
        continue;
      }
      throw new DecodeFailure(`picture ${picture} did not come out of the decoder`);
    }
  }

  /** Everything the decoder made or holds goes; the group and its wanted pictures stay. */
  private drop() {
    this.generation += 1;
    for (const frame of this.held.values()) frame.close();
    this.held.clear();
    this.dropReads();
    const decoder = this.decoder;
    this.decoder = null;
    if (decoder && decoder.state !== 'closed') decoder.close();
    this.segment = -1;
    this.flushState = 'none';
    this.wake();
  }

  private makeDecoder(): VideoDecoder {
    const decoder: VideoDecoder = new VideoDecoder({ output: (frame) => this.onOutput(decoder, frame), error: (error) => this.onError(decoder, error) });
    decoder.addEventListener('dequeue', () => {
      if (decoder === this.decoder) this.wake();
    });
    if (this.made) this.counts.reopened += 1;
    this.made = true;
    return decoder;
  }

  private startGroup(group: number, pictures: readonly number[]) {
    const segments = decodeSegments(this.index, pictures);
    if (!segments) throw new DecodeFailure('a picture has no sync sample before it');
    this.dropReads();
    for (const frame of this.held.values()) frame.close();
    this.held.clear();
    this.group = group;
    this.segments = segments;
    this.segmentOf = new Map(segments.flatMap((segment, i) => segment.pictures.map((picture) => [picture, i] as const)));
    this.segment = -1;
    this.wanted = new Set(pictures);
    this.floor = 0;
  }

  /**
   * Starts (or starts again) segment `at` for `picture`: fed from the latest sync sample at or before that
   * picture's sample, not from the segment's start: pictures before it are not wanted any more (the floor), so a
   * decoder made again near the end of a long segment (let go under the cap, taken back) reads and decodes only
   * that group (spec H, F2). `syncStart` keeps the open-GOP rule: a leading picture starts one group earlier.
   */
  private startSegment(at: number, picture: number) {
    const segment = this.segments[at]!;
    const from = Math.max(segment.from, syncStart(this.index, picture) ?? segment.from);
    this.generation += 1;
    if (this.decoder) this.decoder.reset();
    else this.decoder = this.makeDecoder();
    this.decoder.configure(this.config);
    this.segment = at;
    this.next = from;
    this.flushState = 'none';
    this.runs = byteRuns(this.index, from, segment.to);
    this.runOf.clear();
    this.dropReads();
    this.runs.forEach((run, i) => {
      for (let sample = run.from; sample <= run.to; sample += 1) this.runOf.set(sample, i);
    });
    this.counts.segments += 1;
  }

  private release(picture: number) {
    for (const [held, frame] of this.held) {
      if (held < picture) {
        frame.close();
        this.held.delete(held);
      }
    }
    this.floor = picture;
  }

  /** The reads started so far are no longer wanted: aborted, and the next ones get a fresh signal. */
  private dropReads() {
    this.reading.abort();
    this.reading = new AbortController();
    this.fetched.clear();
  }

  private fetchRun(i: number): Promise<Uint8Array> {
    let pending = this.fetched.get(i);
    if (!pending) {
      const either = eitherSignal(this.signal, this.reading.signal);
      pending = this.bytes.read(this.runs[i]!, either.signal);
      // A read ahead that fails is reported when it is needed, not before; either way its listeners go.
      pending.then(either.release, either.release);
      this.fetched.set(i, pending);
    }
    return pending;
  }

  private async feed(sample: number, watch: Watch) {
    const i = this.runOf.get(sample);
    if (i === undefined) throw new DecodeFailure(`sample ${sample} is in no byte range`);
    const generation = this.generation;
    const bytes = await watch.guard(this.fetchRun(i));
    // Let go or taken back while the bytes came: the loop starts the segment again.
    if (generation !== this.generation || !this.decoder) return;
    if (i + 1 < this.runs.length) void this.fetchRun(i + 1);
    for (const key of this.fetched.keys()) if (key < i) this.fetched.delete(key);
    const run = this.runs[i]!;
    const start = this.index.offsets[sample]! - run.start;
    const data = bytes.subarray(start, start + this.index.sizes[sample]!);
    if (this.failure) throw this.failure;
    this.decoder.decode(
      new EncodedVideoChunk({
        type: this.index.sync[sample] ? 'key' : 'delta',
        timestamp: stampUs(this.index.cts[sample]!, this.index.timescale),
        duration: Math.round((this.index.durations[sample]! * 1_000_000) / this.index.timescale),
        data,
      }),
    );
    this.counts.fed += 1;
  }

  private onOutput(source: VideoDecoder, frame: VideoFrame) {
    // From a decoder already let go, closed or taken back: nobody will ask for it.
    if (source !== this.decoder || this.closed) {
      frame.close();
      return;
    }
    this.counts.outputs += 1;
    const picture = this.stamps.get(frame.timestamp);
    if (picture === undefined || picture < this.floor || !this.wanted.has(picture) || this.held.has(picture)) frame.close();
    else this.held.set(picture, frame);
    this.wake();
  }

  private onError(source: VideoDecoder, error: unknown) {
    if (source !== this.decoder) return;
    if (isReclaim(error)) {
      // Closed by the browser: its frames go now, a new decoder is made on the next step.
      this.dropReads();
      for (const frame of this.held.values()) frame.close();
      this.held.clear();
      this.decoder = null;
      this.generation += 1;
      this.segment = -1;
      this.flushState = 'none';
      this.reclaimedNow = true;
      this.wake();
      return;
    }
    if (!this.failure) this.failure = error instanceof Error ? new DecodeFailure(error.message) : new DecodeFailure(String(error));
    this.wake();
  }

  private wake() {
    const waiting = this.waiters;
    this.waiters = [];
    for (const resolve of waiting) resolve();
  }

  /** The next output, dequeue, error or let-go, with no stall guard (waiting for bytes, not for the decoder). */
  private signalled(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private event(): Promise<void> {
    return new Promise((resolve) => {
      const guard = setTimeout(() => {
        if (!this.failure) this.failure = new DecodeFailure('the decoder stopped answering');
        this.wake();
      }, STALL_MS);
      this.waiters.push(() => {
        clearTimeout(guard);
        resolve();
      });
    });
  }
}
