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
