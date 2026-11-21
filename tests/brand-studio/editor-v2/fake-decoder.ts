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

export class FakeDecoder {
  static made: FakeDecoder[] = [];
  /** `eager`: frames come out as decoding goes (after `reorder` more samples); `never`: nothing ever comes out. */
  static mode: 'eager' | 'never' = 'eager';
  static reorder = 0;
  /** Timestamps that never come out (a picture the decoder drops). */
  static drop = new Set<number>();
  state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
  decodeQueueSize = 0;
  decoded: number[] = [];
  private buffer: number[] = [];
  private listeners: Array<() => void> = [];
  constructor(readonly init: Init) {
    FakeDecoder.made.push(this);
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
    if (FakeDecoder.mode === 'never') return;
    this.buffer.push(chunk.timestamp);
    this.buffer.sort((a, b) => a - b);
    while (this.buffer.length > FakeDecoder.reorder) this.emit(this.buffer.shift()!);
  }
  flush(): Promise<void> {
    if (FakeDecoder.mode === 'never') return new Promise(() => undefined);
    for (const stamp of this.buffer.splice(0)) this.emit(stamp);
    return new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)));
  }
  reset() {
    this.buffer = [];
  }
  close() {
    this.state = 'closed';
    this.buffer = [];
  }
  /** The browser takes it back (the measured shape, spec G A1). */
  reclaim() {
    this.state = 'closed';
    this.buffer = [];
    this.init.error(new DOMException('Codec reclaimed due to inactivity.', 'QuotaExceededError'));
  }
  /** A frame that arrives although the decoder was closed or reset (a task already queued). */
  late(stamp: number) {
    this.init.output(new FakeFrame(stamp));
  }
  private emit(stamp: number) {
    if (FakeDecoder.drop.has(stamp)) return;
    queueMicrotask(() => {
      if (this.state === 'closed') return;
      this.init.output(new FakeFrame(stamp));
      for (const listener of this.listeners) listener();
    });
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
    config: { entry: 'avc1', codec: 'avc1.64001e', description: null, codedWidth: 64, codedHeight: 36, pixelAspect: [1, 1], colour: null, profile: 100, bitDepth: 8, sdr: true },
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
