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

export function sampleBytes(request: RangeFetch, wholeLimit: number): SampleBytes {
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
        mode = mode ?? 'range';
        fileSize = fileSize ?? totalFromContentRange(answer.headers?.get('content-range'));
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
        whole = answer.arrayBuffer().then((buffer) => {
          if (buffer.byteLength > wholeLimit) throw new WholeFileTooLarge(buffer.byteLength);
          received += buffer.byteLength;
          fileSize = buffer.byteLength;
          return new Uint8Array(buffer);
        });
        return cut(await whole, run, 0);
      }
      throw new RangeRefused(answer.status);
    },
    stats: () => ({ requests, received, mode, fileSize }),
  };
}
