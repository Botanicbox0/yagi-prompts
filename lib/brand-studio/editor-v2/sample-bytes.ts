/**
 * Editing studio v2 — the bytes of the pictures the decoder path feeds (spec F, F2).
 *
 * Each run of samples (lib/brand-studio/editor-v2/decode-plan.ts `byteRuns`: neighbouring samples, at most
 * a few MB per request) is asked for with a Range request, so a film reads only what it shows instead of
 * whole files. A server that ignores Range answers 200 with the whole file: it is then read once, if it
 * is no larger than `wholeLimit`, kept for the rest of the export and cut from there. Checked servers: the
 * local development media route answers 206; production's media domain answers 206 (spec E addendum).
 *
 * Every read ends (spec G B1, spec H F2, ./watched-read.ts): no byte for 15 s, or not done in its size's time at
 * the slowest connection given time for (`totalLimitMs`: 45 s + bytes ÷ 32 KiB/s; a whole file by its stated
 * length, else by `wholeLimit`), fails it (the source is then taken by seeking); cancelling the export ends it at
 * once, and the request itself is aborted.
 *
 * Pure apart from the request function it is given (components/brand-studio/editor-v2/footage-facts.ts
 * makes the one real request, for the clip's own address).
 */
import type { ByteRun } from './decode-plan';
import { RangeRefused } from './ranged-source';
import { STALL_MS, readStream, totalLimitMs, watchRead, type Watch } from './watched-read';

/** What a range request returns (the standard `Response` is one): the headers say the file's size. */
export interface RangeReply {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}

/** Asks for bytes `start` to `end` inclusive; `signal` aborts the request. */
export type RangeFetch = (start: number, end: number, signal?: AbortSignal) => Promise<RangeReply>;

/**
 * The most a picture source may hold of a whole file when its server ignores Range: the frame facts reader's
 * own ceiling (ranged-source.ts `MAX_WHOLE_BYTES`, 64 MiB; uploads are at most 50 MB). Above it the source
 * is taken by seeking.
 */
export const WHOLE_FILE_LIMIT = 64 * 1024 * 1024;

/** The whole file was sent and it is larger than the export may hold: the source is taken by seeking. */
export class WholeFileTooLarge extends Error {
  readonly bytes: number | null;
  constructor(bytes: number | null) {
    super(`the server sent the whole file (${bytes ?? 'unknown'} bytes) instead of a range`);
    this.name = 'WholeFileTooLarge';
    this.bytes = bytes;
  }
}

export interface SampleBytes {
  /** Exactly the run's bytes, `end − start` of them. `signal`: the export's cancel. */
  read(run: Pick<ByteRun, 'start' | 'end'>, signal?: AbortSignal): Promise<Uint8Array>;
  stats(): { requests: number; received: number; mode: 'range' | 'whole' | null; fileSize: number | null };
}

/** `bytes 0-99/175533` → 175533. */
export function totalFromContentRange(value: string | null | undefined): number | null {
  const match = /\/(\d+)\s*$/.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * An answer's body, read as a stream under the watch (a stall or the total time ends it) and stopped the moment
 * more than `limit` bytes have come, whether or not the server said its length (spec F review 1, item 3): the
 * body is then cancelled and nothing is kept.
 */
async function readBody(answer: RangeReply, watch: Watch, limit: number, tooLarge: () => Error): Promise<Uint8Array> {
  if (answer.body) return readStream(answer.body, watch, limit, tooLarge);
  const buffer = await watch.guard(answer.arrayBuffer());
  if (buffer.byteLength > limit) throw tooLarge();
  return new Uint8Array(buffer);
}

export function sampleBytes(request: RangeFetch, wholeLimit = WHOLE_FILE_LIMIT, stallMs = STALL_MS): SampleBytes {
  let requests = 0;
  let received = 0;
  let mode: 'range' | 'whole' | null = null;
  let fileSize: number | null = null;
  let whole: Promise<Uint8Array> | null = null;

  const cut = (bytes: Uint8Array, run: Pick<ByteRun, 'start' | 'end'>, from: number) => {
    const slice = bytes.subarray(run.start - from, run.end - from);
    if (run.start < from || slice.length !== run.end - run.start) throw new Error(`file ended before byte ${run.end}`);
    return slice;
  };

  return {
    async read(run, signal) {
      if (whole) return cut(await whole, run, 0);
      requests += 1;
      const watch = watchRead({ stallMs, totalMs: totalLimitMs(run.end - run.start) }, signal);
      try {
        const answer = await watch.guard(request(run.start, run.end - 1, watch.signal));
        watch.alive();
        if (answer.status === 206) {
          // A range other than the one asked for is refused, as the frame facts reader refuses it; an answer that
          // does not show its range (a media domain that does not expose Content-Range) is taken as asked.
          const shown = answer.headers?.get('content-range') ?? null;
          const from = shown?.match(/^\s*bytes\s+(\d+)-/i);
          if (shown && (!from || Number(from[1]) !== run.start)) {
            void answer.body?.cancel().catch(() => undefined);
            throw new Error(`the server sent a range from ${from ? from[1] : '?'} for ${run.start}`);
          }
          mode = mode ?? 'range';
          fileSize = fileSize ?? totalFromContentRange(shown);
          const bytes = await readBody(answer, watch, Infinity, () => new Error('unreachable'));
          received += bytes.length;
          return cut(bytes, run, run.start);
        }
        if (answer.status === 200) {
          if (whole) {
            void answer.body?.cancel().catch(() => undefined);
            return cut(await whole, run, 0);
          }
          const length = Number(answer.headers?.get('content-length'));
          if (Number.isFinite(length) && length > wholeLimit) {
            void answer.body?.cancel().catch(() => undefined);
            throw new WholeFileTooLarge(length);
          }
          mode = 'whole';
          // The whole file instead of the run: its length's time (stated, else the most it may be).
          watch.limitTotal(totalLimitMs(Number.isFinite(length) && length > 0 ? length : wholeLimit));
          whole = readBody(answer, watch, wholeLimit, () => new WholeFileTooLarge(null)).then((bytes) => {
            received += bytes.length;
            fileSize = bytes.length;
            return bytes;
          });
          whole.catch(() => undefined);
          return cut(await whole, run, 0);
        }
        void answer.body?.cancel().catch(() => undefined);
        throw new RangeRefused(answer.status);
      } finally {
        watch.done();
      }
    },
    stats: () => ({ requests, received, mode, fileSize }),
  };
}
