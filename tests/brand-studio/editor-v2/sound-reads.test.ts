import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec H, F5: the sound path reads whole files (export-film.ts `mediaReader`). Cancelling while one downloads
 * is a cancel (`ExportStop('cancelled')`), not a raw `AbortError` that the sheet showed as "could not make the
 * file" with a failure notice. A download that stalls ends like any unreadable sound source does today
 * (`ExportStop('sound')`), after 15 s without a byte; a slow but live one is not cut at a fixed time.
 */
const URL_A = '/media/a.mp4';

/** A response whose body sends `pieces` of `size` bytes, `everyMs` apart, then nothing more unless `end`. */
function slowBody(pieces: number, everyMs: number, end: boolean, length?: number, size = 1024) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) =>
      new Promise<void>((resolve) => {
        if (sent >= pieces) {
          if (end) {
            controller.close();
            resolve();
          }
          return;
        }
        setTimeout(() => {
          sent += 1;
          try {
            controller.enqueue(new Uint8Array(size));
          } catch {
            // The reader gave up on it.
          }
          resolve();
        }, everyMs);
      }),
  });
  return new Response(body, { status: 200, headers: length ? { 'Content-Length': String(length) } : {} });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the sound path’s file reads', () => {
  it('cancelling while the body downloads ends it as a cancel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => slowBody(1, 10, false)));
    const { mediaReader, ExportStop } = await import('@/components/brand-studio/editor-v2/export-film');
    const controller = new AbortController();
    const reading = mediaReader(new Set([URL_A]), controller.signal).read(URL_A).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();
    const error = await reading;
    expect(error).toBeInstanceOf(ExportStop);
    expect((error as InstanceType<typeof ExportStop>).reason).toBe('cancelled');
  });

  it('cancelling before the answer comes is a cancel too', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const controller = new AbortController();
    const reading = mediaReader(new Set([URL_A]), controller.signal).read(URL_A).catch((error: unknown) => error);
    controller.abort();
    expect(await reading).toMatchObject({ reason: 'cancelled' });
  });

  it('no byte for 15 s: the read ends as an unreadable sound source', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => slowBody(1, 10, false, 4096)));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const reading = mediaReader(new Set([URL_A])).read(URL_A).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(14_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await reading).toMatchObject({ reason: 'sound' });
  });

  it('a slow but live download is read to its end: 4 MiB at 64 KiB/s takes 64 s, more than a fixed 45 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => slowBody(64, 1000, true, 4 * 1024 * 1024, 64 * 1024)));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const reading = mediaReader(new Set([URL_A])).read(URL_A);
    await vi.advanceTimersByTimeAsync(70_000);
    expect((await reading).byteLength).toBe(4 * 1024 * 1024);
  });

  it('slower than the slowest connection given time for (12 KiB at 100 B/s): ends at 45 s + 12 KiB ÷ 32 KiB/s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => slowBody(12, 10_000, true, 12 * 1024)));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const reading = mediaReader(new Set([URL_A])).read(URL_A).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(44_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await reading).toMatchObject({ reason: 'sound' });
  });
});

/**
 * Spec I, G2: the size request (`HEAD`, for the weight check before the first frame) gives up after 10 s without
 * an answer and the size is unknown, as for a server that does not answer `HEAD`. A read whose length the server
 * does not state is given time by what has come: 45 s + the bytes received ÷ 32 KiB/s, from the start of the read.
 * A file of unknown size that would make the tab hold more than the sound limit stops the export (`memory`).
 */
describe('spec I, G2: the sound reads’ two gaps', () => {
  it('a HEAD that never answers: the size is unknown after 10 s, the request aborted, the export goes on', async () => {
    vi.useFakeTimers();
    let headSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: { signal: AbortSignal }) => ((headSignal = init.signal), new Promise(() => undefined))));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    let size: number | null | undefined;
    void mediaReader(new Set([URL_A])).size(URL_A).then((value) => (size = value));
    await vi.advanceTimersByTimeAsync(9_000);
    expect(size).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(size).toBeNull();
    expect(headSignal?.aborted).toBe(true);
  });

  it('no stated length, 60 MB at 2 Mbit/s (4 min): read to its end', async () => {
    vi.useFakeTimers();
    // 250,000 bytes a second, 240 seconds.
    vi.stubGlobal('fetch', vi.fn(async () => slowBody(240, 1000, true, undefined, 250_000)));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const reading = mediaReader(new Set([URL_A])).read(URL_A).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(245_000);
    const got = await reading;
    expect(got).toBeInstanceOf(ArrayBuffer);
    expect((got as ArrayBuffer).byteLength).toBe(60_000_000);
  });

  it('no stated length, a connection that drops below 32 KiB/s on average is cut (not after 9 hours)', async () => {
    vi.useFakeTimers();
    // 64 KiB a second for 10 s (640 KiB: 45 s + 20 s), then 1 KiB every 10 s: never a stall, ever slower.
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) =>
        new Promise<void>((resolve) =>
          setTimeout(
            () => {
              sent += 1;
              try {
                controller.enqueue(new Uint8Array(sent <= 10 ? 64 * 1024 : 1024));
              } catch {
                // Cancelled.
              }
              resolve();
            },
            sent < 10 ? 1000 : 10_000,
          ),
        ),
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const reading = mediaReader(new Set([URL_A])).read(URL_A).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    let settled = false;
    void reading.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(await reading).toMatchObject({ reason: 'sound' });
  });

  it('a stated length keeps its own total, as before: 4 MiB stated, sent at 16 KiB/s, is cut at 45 s + 128 s, not by the average rule', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => slowBody(256, 1000, false, 4 * 1024 * 1024, 16 * 1024)));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const reading = mediaReader(new Set([URL_A])).read(URL_A).catch((error: unknown) => error);
    let settled = false;
    void reading.then(() => (settled = true));
    // The average rule would have cut it near 90 s (45 s + received ÷ 32 KiB/s at half that rate).
    await vi.advanceTimersByTimeAsync(160_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await reading).toMatchObject({ reason: 'sound' });
  });

  it('a file of unknown size that passes the sound limit while it comes: the export stops (memory), the body is cancelled', async () => {
    let cancelled = false;
    let pulled = 0;
    // 40,000 bytes in all, with no length stated, against a limit of 10,000.
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        pulled += 1;
        controller.enqueue(new Uint8Array(4000));
        if (pulled === 10) controller.close();
      },
      cancel: () => {
        cancelled = true;
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const { mediaReader } = await import('@/components/brand-studio/editor-v2/export-film');
    const error = await mediaReader(new Set([URL_A]), undefined, 10_000).read(URL_A).catch((stop: unknown) => stop);
    expect(error).toMatchObject({ reason: 'memory' });
    expect(cancelled).toBe(true);
  });
});
