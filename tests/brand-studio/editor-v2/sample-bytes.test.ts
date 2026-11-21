import { describe, expect, it } from 'vitest';
import { RangeRefused } from '@/lib/brand-studio/editor-v2/ranged-source';
import { WholeFileTooLarge, sampleBytes, totalFromContentRange, type RangeReply as RangeAnswer } from '@/lib/brand-studio/editor-v2/sample-bytes';

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

  it('a short answer or a refusal is an error, never fewer bytes', async () => {
    await expect(sampleBytes(server(true), 1 << 20).read({ start: 9990, end: 10_020 })).rejects.toThrow(/ended/);
    const refusing = async (): Promise<RangeAnswer> => ({ status: 403, body: null, arrayBuffer: async () => new ArrayBuffer(0) });
    await expect(sampleBytes(refusing, 1 << 20).read({ start: 0, end: 10 })).rejects.toBeInstanceOf(RangeRefused);
  });

  it('Content-Range totals', () => {
    expect(totalFromContentRange('bytes 0-99/175533')).toBe(175533);
    expect(totalFromContentRange('bytes 0-99/*')).toBeNull();
    expect(totalFromContentRange(null)).toBeNull();
  });
});
