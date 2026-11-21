import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleBytes } from '@/lib/brand-studio/editor-v2/sample-bytes';
import type { VideoIndex } from '@/lib/brand-studio/editor-v2/sample-index';

/**
 * Spec F, F3: the decoder session must never wait on the decoder while it holds the very frames the decoder
 * needs back. Measured on Chromium (2026-11-21): a second export in one page stopped for good at frame 112
 * of 665: the session awaited `flush()` while holding pictures 127–135, the hardware decoder had no free
 * output frame for 136, and the flush never finished. The fake decoder here has a pool of three frames
 * and, like a decoder with a long reorder delay, gives nothing out before `flush()`.
 */
const POOL = 3;

class FakeFrame {
  closed = false;
  constructor(
    readonly timestamp: number,
    private readonly owner: FakeDecoder,
  ) {}
  close() {
    if (this.closed) return;
    this.closed = true;
    this.owner.unclosed -= 1;
    this.owner.pump();
  }
  get displayWidth() {
    return 64;
  }
  get displayHeight() {
    return 36;
  }
}

class FakeDecoder {
  static made: FakeDecoder[] = [];
  state = 'unconfigured';
  unclosed = 0;
  private pending: number[] = [];
  private flushing: Array<() => void> = [];
  private listeners: Array<() => void> = [];
  constructor(private readonly init: { output: (frame: FakeFrame) => void; error: (error: unknown) => void }) {
    FakeDecoder.made.push(this);
  }
  get decodeQueueSize() {
    return 0;
  }
  addEventListener(_: string, listener: () => void) {
    this.listeners.push(listener);
  }
  configure() {
    this.state = 'configured';
  }
  decode(chunk: { timestamp: number }) {
    this.pending.push(chunk.timestamp);
  }
  flush(): Promise<void> {
    return new Promise((resolve) => {
      this.flushing.push(resolve);
      this.pump();
    });
  }
  /** Gives out what it holds, one frame at a time, while the pool has room; then settles a flush. */
  pump() {
    if (this.flushing.length === 0) return;
    queueMicrotask(() => {
      while (this.pending.length > 0 && this.unclosed < POOL) {
        this.unclosed += 1;
        this.init.output(new FakeFrame(this.pending.shift()!, this));
      }
      if (this.pending.length === 0) for (const resolve of this.flushing.splice(0)) resolve();
    });
  }
  reset() {
    this.pending = [];
    this.flushing.splice(0);
  }
  close() {
    this.state = 'closed';
  }
}

const SAMPLES = 12;
const index: VideoIndex = {
  config: { entry: 'avc1', codec: 'avc1.64001e', description: null, codedWidth: 64, codedHeight: 36, pixelAspect: [1, 1], colour: null },
  rotation: 0,
  timescale: 12288,
  offsets: Array.from({ length: SAMPLES }, (_, i) => i * 10),
  sizes: Array.from({ length: SAMPLES }, () => 10),
  cts: Array.from({ length: SAMPLES }, (_, i) => i * 512),
  durations: Array.from({ length: SAMPLES }, () => 512),
  sync: Array.from({ length: SAMPLES }, (_, i) => i === 0),
  pictures: Array.from({ length: SAMPLES }, (_, i) => i),
  syncs: [0],
  variable: false,
  sound: 'no',
};
const bytes: SampleBytes = { read: async (run) => new Uint8Array(run.end - run.start), stats: () => ({ requests: 1, received: 0, mode: 'range', fileSize: null }) };

describe('the decoder session does not wait on a decoder it is starving', () => {
  beforeEach(() => {
    FakeDecoder.made = [];
    vi.stubGlobal('VideoDecoder', FakeDecoder);
    vi.stubGlobal('EncodedVideoChunk', class {
      readonly timestamp: number;
      constructor(init: { timestamp: number }) {
        this.timestamp = init.timestamp;
      }
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('every picture of a run comes out although the decoder gives frames only on flush and has three to lend', async () => {
    const { PictureDecoder } = await import('@/components/brand-studio/editor-v2/frame-decoder');
    const session = new PictureDecoder(index, bytes, { codec: index.config.codec });
    const pictures = Array.from({ length: SAMPLES }, (_, i) => i);
    const seen: number[] = [];
    const run = (async () => {
      for (const picture of pictures) {
        const frame = await session.picture(0, pictures, picture);
        seen.push(Math.round((frame.timestamp * 12288) / 1_000_000 / 512));
      }
    })();
    const outcome = await Promise.race([run.then(() => 'done'), new Promise((resolve) => setTimeout(() => resolve('stuck'), 2000))]);
    session.close();
    expect(outcome).toBe('done');
    expect(seen).toEqual(pictures);
  });
});
