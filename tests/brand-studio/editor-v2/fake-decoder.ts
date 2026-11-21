import { afterEach, beforeEach, vi } from 'vitest';
import type { SampleBytes } from '@/lib/brand-studio/editor-v2/sample-bytes';
import type { VideoIndex } from '@/lib/brand-studio/editor-v2/sample-index';

/**
 * Spec G: a fake `VideoDecoder` for the decoder session (components/brand-studio/editor-v2/frame-decoder.ts)
 * that gives its frames out in presentation order after a reorder delay, as a real one does. Every frame it
 * makes is counted, so a frame left open (garbage collected unclosed on production, A0) shows as a number.
 */
export const counter = { open: 0 };

export class FakeFrame {
  closed = false;
  readonly displayWidth = 64;
  readonly displayHeight = 36;
  constructor(readonly timestamp: number) {
    counter.open += 1;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    counter.open -= 1;
  }
}

type Init = { output: (frame: FakeFrame) => void; error: (error: unknown) => void };

/**
 * Works like a real decoder where the session depends on it (spec H, F8): `decode()` queues the chunk and raises
 * `decodeQueueSize`; the work is done in later tasks, one chunk per task, lowering the queue and firing
 * `dequeue`; pictures come out in presentation order after `reorder` more samples, each in a task (not a
 * microtask); `reset()` drops the queued work, the reorder buffer and anything already scheduled; `flush()`
 * finishes the queue, gives out what it holds, then settles.
 */
export class FakeDecoder {
  static made: FakeDecoder[] = [];
  /** `eager`: frames come out as decoding goes (after `reorder` more samples); `never`: nothing ever comes out. */
  static mode: 'eager' | 'never' = 'eager';
  static reorder = 0;
  /** Timestamps that never come out (a picture the decoder drops). */
  static drop = new Set<number>();
  /** The most chunks ever waiting in any decoder's queue. */
  static mostQueued = 0;
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  decoded: number[] = [];
  private queue: number[] = [];
  private buffer: number[] = [];
  private flushing: Array<() => void> = [];
  private listeners: Array<() => void> = [];
  /** Bumped by reset and close: work scheduled before belongs to an earlier configuration. */
  private generation = 0;
  private working = false;
  constructor(readonly init: Init) {
    FakeDecoder.made.push(this);
  }
  get decodeQueueSize() {
    return this.queue.length;
  }
  addEventListener(_: string, listener: () => void) {
    this.listeners.push(listener);
  }
  configure() {
    if (this.state === 'closed') throw new DOMException('closed', 'InvalidStateError');
    this.state = 'configured';
  }
  decode(chunk: { timestamp: number }) {
    if (this.state !== 'configured') throw new DOMException("Cannot call 'decode' on a closed codec.", 'InvalidStateError');
    this.decoded.push(chunk.timestamp);
    this.queue.push(chunk.timestamp);
    FakeDecoder.mostQueued = Math.max(FakeDecoder.mostQueued, this.queue.length);
    this.work();
  }
  flush(): Promise<void> {
    if (FakeDecoder.mode === 'never') return new Promise(() => undefined);
    return new Promise((resolve) => {
      this.flushing.push(resolve);
      this.work();
    });
  }
  reset() {
    this.generation += 1;
    this.queue = [];
    this.buffer = [];
    this.flushing = [];
    this.working = false;
  }
  close() {
    this.reset();
    this.state = 'closed';
  }
  /** The browser takes it back (the measured shape, spec G A1). */
  reclaim() {
    this.close();
    this.init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'));
  }
  /** A frame that arrives although the decoder was closed or reset (a task already queued). */
  late(stamp: number) {
    this.init.output(new FakeFrame(stamp));
  }
  /** One queued chunk per task; pictures out in presentation order; a flush settles once all is out. */
  private work() {
    if (this.working) return;
    this.working = true;
    const generation = this.generation;
    setTimeout(() => {
      if (generation !== this.generation) return;
      this.working = false;
      const stamp = this.queue.shift();
      if (stamp !== undefined) {
        for (const listener of this.listeners) listener();
        if (FakeDecoder.mode !== 'never') {
          this.buffer.push(stamp);
          this.buffer.sort((a, b) => a - b);
          while (this.buffer.length > FakeDecoder.reorder) this.emit(this.buffer.shift()!);
        }
      }
      if (this.queue.length > 0) return this.work();
      if (this.flushing.length > 0) {
        for (const left of this.buffer.splice(0)) this.emit(left);
        const settle = this.flushing.splice(0);
        setTimeout(() => {
          if (generation === this.generation) for (const resolve of settle) resolve();
        }, 0);
      }
    }, 0);
  }
  private emit(stamp: number) {
    if (FakeDecoder.drop.has(stamp)) return;
    const generation = this.generation;
    setTimeout(() => {
      if (generation !== this.generation || this.state === 'closed') return;
      this.init.output(new FakeFrame(stamp));
    }, 0);
  }
}

export const TS = 12288;
export const STEP = 512;
export const us = (ticks: number) => Math.round((ticks * 1_000_000) / TS);

/**
 * `count` samples, a sync sample every `gop`; with `bframes` (`gop` − 1 a multiple of 3), each three samples
 * after the sync sample are decoded P B B and shown B B P: decode order differs from presentation order.
 */
export function makeIndex(count: number, gop = count, bframes = false): VideoIndex {
  const cts: number[] = [];
  for (let i = 0; i < count; i += 1) {
    let shown = i;
    if (bframes && i % gop !== 0) {
      const k = (i % gop) - 1;
      const base = i - (i % gop) + 1 + 3 * Math.floor(k / 3);
      shown = k % 3 === 0 ? base + 2 : base + (k % 3) - 1;
    }
    cts.push(shown * STEP);
  }
  const pictures = Array.from({ length: count }, (_, i) => i).sort((a, b) => cts[a]! - cts[b]!);
  return {
    config: { entry: 'avc1', codec: 'avc1.64001e', description: null, codedWidth: 64, codedHeight: 36, pixelAspect: [1, 1], colour: null, profile: 100, bitDepth: 8, chroma: 1, constraintFlags: 0, sdr: true },
    rotation: 0,
    timescale: TS,
    offsets: Array.from({ length: count }, (_, i) => i * 10),
    sizes: Array.from({ length: count }, () => 10),
    cts,
    durations: Array.from({ length: count }, () => STEP),
    sync: Array.from({ length: count }, (_, i) => i % gop === 0),
    pictures,
    syncs: Array.from({ length: count }, (_, i) => i).filter((i) => i % gop === 0),
    variable: false,
    sound: 'no',
  };
}

export const bytesOk: SampleBytes = { read: async (run) => new Uint8Array(run.end - run.start), stats: () => ({ requests: 1, received: 0, mode: 'range', fileSize: null }) };
export const pictureOf = (frame: { timestamp: number }) => Math.round((frame.timestamp * TS) / 1_000_000 / STEP);

export async function session(index: VideoIndex, bytes: SampleBytes = bytesOk) {
  const { PictureDecoder } = await import('@/components/brand-studio/editor-v2/frame-decoder');
  return new PictureDecoder(index, bytes, { codec: index.config.codec });
}

export const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** The fake in place of `VideoDecoder` (and `EncodedVideoChunk`) for every test of the file that calls it. */
export function useFakeDecoder() {
  beforeEach(() => {
    counter.open = 0;
    FakeDecoder.made = [];
    FakeDecoder.mode = 'eager';
    FakeDecoder.reorder = 0;
    FakeDecoder.drop = new Set();
    FakeDecoder.mostQueued = 0;
    vi.stubGlobal('VideoDecoder', FakeDecoder);
    vi.stubGlobal(
      'EncodedVideoChunk',
      class {
        readonly timestamp: number;
        constructor(init: { timestamp: number }) {
          this.timestamp = init.timestamp;
        }
      },
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
}
