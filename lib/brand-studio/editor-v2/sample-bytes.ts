/**
 * Editing studio v2 — the bytes of the pictures the decoder path feeds (spec F, F2).
 *
 * Each run of samples (lib/brand-studio/editor-v2/decode-plan.ts `byteRuns`: neighbouring samples, at most
 * a few MB per request) is asked for with a Range request, so a film reads only what it shows instead of
 * whole files. A server that ignores Range answers 200 with the whole file: it is then read once, if it
 * is no larger than `wholeLimit`, kept for the rest of the export and cut from there. Checked servers: the
 * local development media route answers 206; production's media domain answers 206 (spec E addendum).
 *
 * Pure apart from the request function it is given (components/brand-studio/editor-v2/footage-facts.ts
 * makes the one real request, for the clip's own address).
 */
import type { ByteRun } from './decode-plan';
import { RangeRefused } from './ranged-source';

/** What a range request returns (the standard `Response` is one): the headers say the file's size. */
export interface RangeReply {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null };
}

/** Asks for bytes `start` to `end` inclusive. */
export type RangeFetch = (start: number, end: number) => Promise<RangeReply>;

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
  /** Exactly the run's bytes, `end − start` of them. */
  read(run: Pick<ByteRun, 'start' | 'end'>): Promise<Uint8Array>;
  stats(): { requests: number; received: number; mode: 'range' | 'whole' | null; fileSize: number | null };
}

/** `bytes 0-99/175533` → 175533. */
export function totalFromContentRange(value: string | null | undefined): number | null {
  const match = /\/(\d+)\s*$/.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * A whole-file answer, read as a stream and stopped the moment more than `limit` bytes have come, whether or
 * not the server said its length (spec F review 1, item 3): the body is cancelled and nothing is kept.
 */
async function readWhole(answer: RangeReply, limit: number): Promise<Uint8Array> {
  if (!answer.body) {
    const buffer = await answer.arrayBuffer();
    if (buffer.byteLength > limit) throw new WholeFileTooLarge(buffer.byteLength);
    return new Uint8Array(buffer);
  }
  const reader = answer.body.getReader();
  const pieces: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      throw new WholeFileTooLarge(null);
    }
    pieces.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const piece of pieces) {
    bytes.set(piece, at);
    at += piece.length;
  }
  return bytes;
}

export function sampleBytes(request: RangeFetch, wholeLimit = WHOLE_FILE_LIMIT): SampleBytes {
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
    async read(run) {
      if (whole) return cut(await whole, run, 0);
      requests += 1;
      const answer = await request(run.start, run.end - 1);
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
        const bytes = new Uint8Array(await answer.arrayBuffer());
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
        whole = readWhole(answer, wholeLimit).then((bytes) => {
          received += bytes.length;
          fileSize = bytes.length;
          return bytes;
        });
        return cut(await whole, run, 0);
      }
      throw new RangeRefused(answer.status);
    },
    stats: () => ({ requests, received, mode, fileSize }),
  };
}
