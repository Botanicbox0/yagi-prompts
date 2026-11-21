/**
 * Editing studio v2 — a file's bytes read piece by piece with HTTP Range requests (spec E addendum, C1),
 * for the container reader (lib/brand-studio/editor-v2/container.ts): it asks for the head, steps over
 * the media by box sizes, and asks for the `moov` (and the fragments' `moof` boxes) only.
 *
 * Each request asks for at least `chunk` bytes and keeps them, so neighbouring small boxes cost one
 * request. A server that ignores Range answers 200 with the whole file: the body is then read as a
 * stream only as far as the reader needs and cancelled when it is done (`close`). Checked servers: the
 * local development media route answers 206 (`Content-Range: bytes 0-99/175533`); production's media
 * domain answers 206 too (spec E addendum, the lead's check).
 *
 * Pure apart from the request function it is given (components/brand-studio/editor-v2/footage-facts.ts
 * makes the one real request).
 */
import type { ByteSource } from './container';

/** What a request returns: the standard `Response` is one. */
export interface RangeAnswer {
  status: number;
  body: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Asks for bytes `start` to `end` inclusive. */
export type RangeRequest = (start: number, end: number) => Promise<RangeAnswer>;

export const RANGE_CHUNK = 64 * 1024;

export interface RangedSource extends ByteSource {
  /** Stops a body still being read (a server that ignored Range). */
  close(): void;
  stats(): { requests: number; received: number; mode: 'range' | 'whole' | null };
}

export class RangeRefused extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`media answered ${status}`);
    this.name = 'RangeRefused';
    this.status = status;
  }
}

export function rangedSource(request: RangeRequest, chunk = RANGE_CHUNK): RangedSource {
  const pieces: Array<{ start: number; bytes: Uint8Array }> = [];
  let mode: 'range' | 'whole' | null = null;
  let requests = 0;
  let received = 0;
  let atEnd = Infinity;
  // The whole file, read from a 200 answer as far as needed.
  let whole = new Uint8Array(0);
  let wholeLength = 0;
  let wholeDone = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const fromWhole = async (start: number, length: number) => {
    while (wholeLength < start + length && !wholeDone && reader) {
      const { value, done } = await reader.read();
      if (done || !value) {
        wholeDone = true;
        break;
      }
      if (wholeLength + value.length > whole.length) {
        const grown = new Uint8Array(Math.max(whole.length * 2, wholeLength + value.length, chunk));
        grown.set(whole.subarray(0, wholeLength));
        whole = grown;
      }
      whole.set(value, wholeLength);
      wholeLength += value.length;
      received += value.length;
    }
    return whole.slice(Math.min(start, wholeLength), Math.min(wholeLength, start + length));
  };

  const cached = (start: number, length: number): Uint8Array | null => {
    for (const piece of pieces) {
      const end = piece.start + piece.bytes.length;
      if (start >= piece.start && (start + length <= end || (end >= atEnd && start <= end))) {
        return piece.bytes.subarray(start - piece.start, Math.min(piece.bytes.length, start + length - piece.start));
      }
    }
    return null;
  };

  return {
    async read(start, length) {
      if (length <= 0 || start >= atEnd) return new Uint8Array(0);
      if (mode === 'whole') return fromWhole(start, length);
      const hit = cached(start, length);
      if (hit) return hit;
      const want = Math.max(length, chunk);
      requests += 1;
      const answer = await request(start, start + want - 1);
      if (answer.status === 416) {
        atEnd = Math.min(atEnd, start);
        return new Uint8Array(0);
      }
      if (answer.status === 206) {
        mode = 'range';
        const bytes = new Uint8Array(await answer.arrayBuffer());
        received += bytes.length;
        if (bytes.length < want) atEnd = Math.min(atEnd, start + bytes.length);
        pieces.push({ start, bytes });
        return bytes.subarray(0, Math.min(bytes.length, length));
      }
      if (answer.status === 200 && answer.body) {
        // The server sent the whole file: read only as far as needed.
        mode = 'whole';
        reader = answer.body.getReader();
        return fromWhole(start, length);
      }
      throw new RangeRefused(answer.status);
    },
    close() {
      if (reader && !wholeDone) void reader.cancel().catch(() => undefined);
      reader = null;
      wholeDone = true;
    },
    stats: () => ({ requests, received, mode }),
  };
}
