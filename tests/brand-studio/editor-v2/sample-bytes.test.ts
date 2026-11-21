import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RangeRefused } from '@/lib/brand-studio/editor-v2/ranged-source';
import { ReadCancelled, ReadTimedOut } from '@/lib/brand-studio/editor-v2/watched-read';
import { WHOLE_FILE_LIMIT, WholeFileTooLarge, sampleBytes, totalFromContentRange, type RangeReply as RangeAnswer } from '@/lib/brand-studio/editor-v2/sample-bytes';

/**
 * Spec F, F2: the decoder path reads only the byte ranges that hold the pictures it shows. A server that
 * ignores Range (answers 200) is read once, under the size limit, and cut from there.
 */
const FILE = Uint8Array.from({ length: 10_000 }, (_, i) => i % 251);

function server(honoursRange: boolean, log: Array<[number, number]> = []) {
  return async (start: number, end: number): Promise<RangeAnswer> => {
    log.push([start, end]);
    const body = honoursRange ? FILE.slice(start, Math.min(FILE.length, end + 1)) : FILE.slice();
    const headers = new Map<string, string>(
      honoursRange ? [['content-range', `bytes ${start}-${Math.min(FILE.length - 1, end)}/${FILE.length}`]] : [['content-length', String(FILE.length)]],
    );
    return { status: honoursRange ? 206 : 200, body: null, arrayBuffer: async () => body.buffer, headers: { get: (name) => headers.get(name) ?? null } };
  };
}

describe('reading pictures by range', () => {
  it('206: each run is one request for exactly its bytes; the file size comes from Content-Range', async () => {
    const log: Array<[number, number]> = [];
    const reader = sampleBytes(server(true, log), 1 << 20);
    expect(await reader.read({ start: 100, end: 400 })).toEqual(FILE.slice(100, 400));
    expect(await reader.read({ start: 5000, end: 5010 })).toEqual(FILE.slice(5000, 5010));
    expect(log).toEqual([[100, 399], [5000, 5009]]);
    expect(reader.stats()).toEqual({ requests: 2, received: 310, mode: 'range', fileSize: 10_000 });
  });

  it('200 (Range ignored): the whole file is read once and every later run is cut from it', async () => {
    const log: Array<[number, number]> = [];
    const reader = sampleBytes(server(false, log), 1 << 20);
    expect(await reader.read({ start: 100, end: 400 })).toEqual(FILE.slice(100, 400));
    expect(await reader.read({ start: 9000, end: 9990 })).toEqual(FILE.slice(9000, 9990));
    expect(log).toHaveLength(1);
    expect(reader.stats()).toMatchObject({ mode: 'whole', received: 10_000, fileSize: 10_000 });
  });

  it('200 for a file larger than the limit: refused, so the source is seeked', async () => {
    await expect(sampleBytes(server(false), 5000).read({ start: 0, end: 10 })).rejects.toBeInstanceOf(WholeFileTooLarge);
  });

  it('200 with no Content-Length: the body is read as a stream and stopped past the limit (review 1, item 3)', async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(4000));
        if (pulled > 50) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const endless = async (): Promise<RangeAnswer> => ({
      status: 200,
      body,
      arrayBuffer: async () => {
        throw new Error('the whole body must not be read at once');
      },
      headers: { get: () => null },
    });
    const reader = sampleBytes(endless, 10_000);
    await expect(reader.read({ start: 0, end: 100 })).rejects.toBeInstanceOf(WholeFileTooLarge);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThan(10);
    // Nothing kept: a later read does not answer from a partial file.
    await expect(reader.read({ start: 0, end: 100 })).rejects.toBeInstanceOf(WholeFileTooLarge);
  });

  it('a short answer or a refusal is an error, never fewer bytes', async () => {
    await expect(sampleBytes(server(true), 1 << 20).read({ start: 9990, end: 10_020 })).rejects.toThrow(/ended/);
    const refusing = async (): Promise<RangeAnswer> => ({ status: 403, body: null, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(sampleBytes(refusing, 1 << 20).read({ start: 0, end: 10 })).rejects.toBeInstanceOf(RangeRefused);
  });

  it('a 206 that starts somewhere else than asked is refused, never cut into pictures', async () => {
    const shifted = async (start: number, end: number): Promise<RangeAnswer> => {
      const from = Math.max(0, start - 100);
      const headers = new Map([['content-range', `bytes ${from}-${end}/${FILE.length}`]]);
      return { status: 206, body: null, arrayBuffer: async () => FILE.slice(from, end + 1).buffer, headers: { get: (name) => headers.get(name) ?? null } };
    };
    await expect(sampleBytes(shifted, 1 << 20).read({ start: 500, end: 900 })).rejects.toThrow(/range/);
  });

  it('the whole-file fallback holds at most the facts reader’s ceiling (64 MiB) by default', () => {
    expect(WHOLE_FILE_LIMIT).toBe(64 * 1024 * 1024);
  });

  it('Content-Range totals', () => {
    expect(totalFromContentRange('bytes 0-99/175533')).toBe(175533);
    expect(totalFromContentRange('bytes 0-99/*')).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
  });
});

describe('spec G, B1: a run read ends on cancel, on a stall and after its total time', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** A 206 whose body sends `first` bytes, then nothing more (a stalled connection); the request's signal is kept. */
  function stalling(first: number, signals: AbortSignal[]) {
    return async (start: number, end: number, signal?: AbortSignal): Promise<RangeAnswer> => {
      if (signal) signals.push(signal);
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new Uint8Array(first));
            return;
          }
          return new Promise(() => undefined);
        },
      });
      const headers = new Map([['content-range', `bytes ${start}-${end}/${FILE.length}`]]);
      return { status: 206, body, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: (name) => headers.get(name) ?? null } };
    };
  }

  it('no bytes for 15 s: the read fails as stalled and its request is aborted', async () => {
    const signals: AbortSignal[] = [];
    const reader = sampleBytes(stalling(100, signals));
    const outcome = reader.read({ start: 0, end: 400 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(ReadTimedOut);
    expect((error as ReadTimedOut).kind).toBe('stall');
    expect(signals[0]!.aborted).toBe(true);
  });

  it('an answer whose headers never come fails after 15 s too', async () => {
    const signals: AbortSignal[] = [];
    const reader = sampleBytes(async (_s, _e, signal) => {
      if (signal) signals.push(signal);
      return new Promise<RangeAnswer>(() => undefined);
    });
    const outcome = reader.read({ start: 0, end: 400 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(15_500);
    expect(await outcome).toBeInstanceOf(ReadTimedOut);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('cancelling the export ends a run read at once', async () => {
    const signals: AbortSignal[] = [];
    const controller = new AbortController();
    const reader = sampleBytes(stalling(100, signals));
    const outcome = reader.read({ start: 0, end: 400 }, controller.signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await outcome).toBeInstanceOf(ReadCancelled);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('a finished read leaves no timer running', async () => {
    const reader = sampleBytes(server(true));
    await reader.read({ start: 0, end: 400 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
