'use client';

import { byteRuns, decodeSegments, elementColourSpace, type ByteRun, type DecodeSegment } from '@/lib/brand-studio/editor-v2/decode-plan';
import type { SampleBytes } from '@/lib/brand-studio/editor-v2/sample-bytes';
import { stampUs, type VideoIndex } from '@/lib/brand-studio/editor-v2/sample-index';

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
 * by timestamp, and takes the rest of that source by seeking (export-film.ts).
 *
 * Waits are on the decoder's own events (output, dequeue, error); the one timer is a last-resort guard
 * against a decoder that stops answering.
 */

/** Decode requests waiting in the decoder before feeding pauses. */
const QUEUE_CAP = 6;
/** Wanted pictures held ahead of the one asked for before feeding pauses. */
const HOLD_CAP = 6;
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
 * with (`elementColourSpace`): the same pixels on both paths.
 */
export function decoderConfig(index: VideoIndex): VideoDecoderConfig {
  const { config } = index;
  const out: VideoDecoderConfig = { codec: config.codec, codedWidth: config.codedWidth, codedHeight: config.codedHeight, colorSpace: elementColourSpace(config.codedHeight) };
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
}

export class PictureDecoder {
  private readonly decoder: VideoDecoder;
  private readonly stamps = new Map<number, number>();
  private readonly held = new Map<number, VideoFrame>();
  private wanted = new Set<number>();
  private floor = 0;
  private failure: Error | null = null;
  private waiters: Array<() => void> = [];
  private group = -1;
  private segments: DecodeSegment[] = [];
  /** Wanted picture → the segment that yields it. */
  private segmentOf = new Map<number, number>();
  private segment = -1;
  private next = 0;
  private flushed = false;
  private used = false;
  private runs: ByteRun[] = [];
  private runOf = new Map<number, number>();
  private fetched = new Map<number, Promise<Uint8Array>>();
  private readonly counts: DecoderStats = { fed: 0, outputs: 0, segments: 0 };

  constructor(
    private readonly index: VideoIndex,
    private readonly bytes: SampleBytes,
    private readonly config: VideoDecoderConfig,
  ) {
    index.pictures.forEach((sample, picture) => this.stamps.set(stampUs(index.cts[sample]!, index.timescale), picture));
    this.decoder = new VideoDecoder({ output: (frame) => this.onOutput(frame), error: (error) => this.fail(error) });
    this.decoder.addEventListener('dequeue', () => this.wake());
  }

  stats(): DecoderStats {
    return { ...this.counts };
  }

  /**
   * Picture `picture` of group `group` (whose wanted pictures are `pictures`, ascending). The frame stays
   * the decoder's: it is valid until the next call asks for a later picture, another group, or `close()`.
   */
  async picture(group: number, pictures: readonly number[], picture: number, signal?: AbortSignal): Promise<VideoFrame> {
    if (group !== this.group) this.startGroup(group, pictures);
    this.release(picture);
    for (;;) {
      const held = this.held.get(picture);
      if (held) {
        if (held.timestamp !== stampUs(this.index.cts[this.index.pictures[picture]!]!, this.index.timescale)) throw new DecodeFailure(`picture ${picture} carries the wrong time`);
        return held;
      }
      if (this.failure) throw this.failure;
      if (signal?.aborted) throw new DecodeFailure('cancelled');
      const at = this.segmentOf.get(picture);
      if (at === undefined || at < this.segment) throw new DecodeFailure(`picture ${picture} is in no segment ahead`);
      if (at !== this.segment) {
        this.startSegment(at);
        continue;
      }
      const segment = this.segments[at]!;
      if (this.next <= segment.to) {
        const queued = this.decoder.decodeQueueSize;
        if (queued >= QUEUE_CAP || (this.held.size >= HOLD_CAP && queued > 0)) {
          await this.event();
          continue;
        }
        await this.feed(this.next);
        this.next += 1;
        continue;
      }
      if (!this.flushed) {
        this.flushed = true;
        try {
          await this.decoder.flush();
        } catch (error) {
          this.fail(error);
        }
        continue;
      }
      throw new DecodeFailure(`picture ${picture} did not come out of the decoder`);
    }
  }

  close(): void {
    for (const frame of this.held.values()) frame.close();
    this.held.clear();
    this.fetched.clear();
    if (this.decoder.state !== 'closed') this.decoder.close();
    this.wake();
  }

  private startGroup(group: number, pictures: readonly number[]) {
    const segments = decodeSegments(this.index, pictures);
    if (!segments) throw new DecodeFailure('a picture has no sync sample before it');
    for (const frame of this.held.values()) frame.close();
    this.held.clear();
    this.group = group;
    this.segments = segments;
    this.segmentOf = new Map(segments.flatMap((segment, i) => segment.pictures.map((picture) => [picture, i] as const)));
    this.segment = -1;
    this.wanted = new Set(pictures);
    this.floor = 0;
  }

  private startSegment(at: number) {
    const segment = this.segments[at]!;
    if (this.used) this.decoder.reset();
    this.decoder.configure(this.config);
    this.used = true;
    this.segment = at;
    this.next = segment.from;
    this.flushed = false;
    this.runs = byteRuns(this.index, segment.from, segment.to);
    this.runOf.clear();
    this.fetched.clear();
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

  private fetchRun(i: number): Promise<Uint8Array> {
    let pending = this.fetched.get(i);
    if (!pending) {
      pending = this.bytes.read(this.runs[i]!);
      // A prefetch that fails is reported when it is needed, not before.
      pending.catch(() => undefined);
      this.fetched.set(i, pending);
    }
    return pending;
  }

  private async feed(sample: number) {
    const i = this.runOf.get(sample);
    if (i === undefined) throw new DecodeFailure(`sample ${sample} is in no byte range`);
    const bytes = await this.fetchRun(i);
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

  private onOutput(frame: VideoFrame) {
    this.counts.outputs += 1;
    const picture = this.stamps.get(frame.timestamp);
    if (picture === undefined || picture < this.floor || !this.wanted.has(picture) || this.held.has(picture)) frame.close();
    else this.held.set(picture, frame);
    this.wake();
  }

  private fail(error: unknown) {
    if (!this.failure) this.failure = error instanceof Error ? new DecodeFailure(error.message) : new DecodeFailure(String(error));
    this.wake();
  }

  private wake() {
    const waiting = this.waiters;
    this.waiters = [];
    for (const resolve of waiting) resolve();
  }

  private event(): Promise<void> {
    return new Promise((resolve) => {
      const guard = setTimeout(() => this.fail(new DecodeFailure('the decoder stopped answering')), STALL_MS);
      this.waiters.push(() => {
        clearTimeout(guard);
        resolve();
      });
    });
  }
}
