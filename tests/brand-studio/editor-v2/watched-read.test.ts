import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadCancelled, STALL_MS, totalLimitMs, ReadTimedOut, readStream, sharedWaits, waitShared, watchRead } from '@/lib/brand-studio/editor-v2/watched-read';

/** Spec G, B1: every network wait of the export ends: on cancel at once, on a stall or after its total. */
const LIMITS = { stallMs: 15_000, totalMs: 45_000 };
describe('a watched read', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A body that gives `pieces` one by one, then nothing (a stalled connection) unless `end`. */
  function body(pieces: number[], end = false) {
    let cancelled = false;
    let i = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < pieces.length) controller.enqueue(new Uint8Array(pieces[i++]!));
        else if (end) controller.close();
        else return new Promise(() => undefined);
      },
      cancel() {
        cancelled = true;
      },
    });
    return { stream, cancelled: () => cancelled };
  }

  it('the limits: 15 s without a byte; in all, 45 s plus the bytes at 32 KiB/s (spec H, F2)', () => {
    expect(STALL_MS).toBe(15_000);
    expect(totalLimitMs(0)).toBe(45_000);
    expect(totalLimitMs(8 * 1024 * 1024)).toBe(45_000 + 256_000);
    expect(totalLimitMs(64 * 1024 * 1024)).toBe(45_000 + 2_048_000);
  });

  it('a body that stops sending fails after the stall limit, its request aborted and its body cancelled', async () => {
    const watch = watchRead(LIMITS);
    const { stream, cancelled } = body([10, 10]);
    const read = readStream(stream, watch);
    const outcome = read.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(watch.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    const error = await outcome;
    expect(error).toBeInstanceOf(ReadTimedOut);
    expect((error as ReadTimedOut).kind).toBe('stall');
    expect(watch.signal.aborted).toBe(true);
    expect(cancelled()).toBe(true);
  });

  it('bytes that keep coming slowly still end at the total limit', async () => {
    const watch = watchRead(LIMITS);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            pulls += 1;
            controller.enqueue(new Uint8Array(1));
            resolve();
          }, 10_000),
        ),
    });
    const outcome = readStream(stream, watch).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(46_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(ReadTimedOut);
    expect((error as ReadTimedOut).kind).toBe('total');
    expect(pulls).toBeGreaterThanOrEqual(3);
  });

  it('cancelling ends the read at once, even when the request itself never answers', async () => {
    const controller = new AbortController();
    const watch = watchRead(LIMITS, controller.signal);
    const never = new Promise<Response>(() => undefined);
    const outcome = watch.guard(never).catch((error: unknown) => error);
    controller.abort();
    expect(await outcome).toBeInstanceOf(ReadCancelled);
    expect(watch.signal.aborted).toBe(true);
  });

  it('a read that finishes leaves no timer behind', async () => {
    const watch = watchRead(LIMITS);
    const { stream } = body([4, 4], true);
    const bytes = await readStream(stream, watch);
    watch.done();
    expect(bytes.length).toBe(8);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a shared read is waited for until cancel or its limit, never aborted', async () => {
    let settle!: (value: string) => void;
    const shared = new Promise<string>((resolve) => {
      settle = resolve;
    });
    const controller = new AbortController();
    const cancelled = () => new ReadCancelled();
    const first = waitShared(shared, controller.signal, 45_000, 'timed out', cancelled).catch((error: unknown) => error);
    controller.abort();
    expect(await first).toBeInstanceOf(ReadCancelled);
    const second = waitShared(shared, undefined, 45_000, 'timed out', cancelled);
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(second).resolves.toBe('timed out');
    // The shared read itself goes on and answers whoever asks next.
    settle('the file');
    await expect(waitShared(shared, undefined, 45_000, 'timed out', cancelled)).resolves.toBe('the file');
  });
});

describe('spec H, F6: a shared read is waited for once per export', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a read that timed out is not waited for again in the same export; other files wait in parallel; a new export waits again', async () => {
    const never = () => new Promise<string>(() => undefined);
    const cancelled = () => new ReadCancelled();
    const waits = sharedWaits(never, undefined, 45_000, 'timed out' as const, cancelled);
    const first = waits('/a.mp4');
    const other = waits('/b.mp4');
    await vi.advanceTimersByTimeAsync(45_000);
    await expect(first).resolves.toBe('timed out');
    await expect(other).resolves.toBe('timed out');
    let again: string | null = null;
    void waits('/a.mp4').then((value) => (again = value));
    await vi.advanceTimersByTimeAsync(0);
    expect(again).toBe('timed out');
    let fresh: string | null = null;
    void sharedWaits(never, undefined, 45_000, 'timed out' as const, cancelled)('/a.mp4').then((value) => (fresh = value));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fresh).toBeNull();
  });

  it('each file is read once per export', async () => {
    let reads = 0;
    const waits = sharedWaits(async (key: string) => (reads += 1, key), undefined, 45_000, null, () => new ReadCancelled());
    await waits('/a.mp4');
    await waits('/a.mp4');
    expect(reads).toBe(1);
  });
});
