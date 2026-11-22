import { describe, expect, it, vi } from 'vitest';
import type { SampleBytes } from '@/lib/brand-studio/editor-v2/sample-bytes';
import { ReadTimedOut } from '@/lib/brand-studio/editor-v2/watched-read';
import { FakeDecoder, bytesOk, counter, makeIndex, pictureOf, session, tick, useFakeDecoder } from './fake-decoder';

/**
 * Spec G, B1: a picture request ends at once when the export is cancelled, whatever it waits for; a run whose
 * bytes stall is a decode failure (the source is then seeked); and no request lasts longer than 45 s, so the
 * encoder never waits on the decoder path anywhere near the ~90 s after which a hidden page loses it (A1).
 */
useFakeDecoder();

describe('cancelling ends a picture request at once, in every wait', () => {
  it('while it waits for the decoder', async () => {
    FakeDecoder.mode = 'never';
    const s = await session(makeIndex(12));
    const controller = new AbortController();
    const asked = s.picture(0, [5], 5, controller.signal).catch((error: unknown) => error);
    await tick();
    const started = Date.now();
    controller.abort();
    expect(await asked).toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThan(1000);
    s.close();
    expect(counter.open).toBe(0);
  });

  it('while its bytes are being read (a read that ignores the signal)', async () => {
    const never: SampleBytes = { read: () => new Promise(() => undefined), stats: bytesOk.stats };
    const s = await session(makeIndex(12), never);
    const controller = new AbortController();
    const asked = s.picture(0, [3], 3, controller.signal).catch((error: unknown) => error);
    await tick();
    const started = Date.now();
    controller.abort();
    expect(await asked).toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThan(1000);
    s.close();
  });

  it('the export’s cancel reaches the byte reads', async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const watching: SampleBytes = { read: (run, signal) => (signals.push(signal), bytesOk.read(run)), stats: bytesOk.stats };
    const s = await session(makeIndex(12), watching);
    const controller = new AbortController();
    await s.picture(0, [3], 3, controller.signal);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.some((signal) => signal?.aborted)).toBe(false);
    controller.abort();
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
    s.close();
  });
});

describe('every wait has an end', () => {
  it('a run whose read stalls is a decode failure', async () => {
    const stalled: SampleBytes = { read: async () => Promise.reject(new ReadTimedOut('stall', 15_000)), stats: bytesOk.stats };
    const s = await session(makeIndex(12), stalled);
    const { DecodeFailure } = await import('@/components/brand-studio/editor-v2/frame-decoder');
    await expect(s.picture(0, [3], 3)).rejects.toBeInstanceOf(DecodeFailure);
    s.close();
  });

  it('spec H, F2: no fixed total for a picture: bytes that take 60 s (inside their own read limits) still give the picture', async () => {
    vi.useFakeTimers();
    const slow: SampleBytes = { read: (run) => new Promise((resolve) => setTimeout(() => resolve(new Uint8Array(run.end - run.start)), 60_000)), stats: bytesOk.stats };
    const s = await session(makeIndex(12), slow);
    const frame = s.picture(0, [5], 5);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(pictureOf(await frame)).toBe(5);
    s.close();
  });

  it('a decoder that gives nothing for 20 s ends the request (its own stall guard)', async () => {
    vi.useFakeTimers();
    FakeDecoder.mode = 'never';
    const s = await session(makeIndex(12));
    const { DecodeFailure } = await import('@/components/brand-studio/editor-v2/frame-decoder');
    let settled = false;
    const asked = s
      .picture(0, [5], 5)
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await vi.advanceTimersByTimeAsync(19_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await asked).toBeInstanceOf(DecodeFailure);
    s.close();
  });
});
