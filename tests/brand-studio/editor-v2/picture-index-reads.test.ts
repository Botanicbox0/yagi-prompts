import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NON_SYNC, SYNC, avcC, box, concat, ftyp, mdat, moof, moov, visualEntry } from './mp4-bytes';

/**
 * Spec G, B8 and B9: how far the picture index reads a file (components/brand-studio/editor-v2/footage-facts.ts
 * `readPictureIndex`) and what it remembers. A fragmented file has its own request budget for walking its
 * fragments (64; a plain file keeps 8); past it the file is `unreadable`. The file's own answers are remembered
 * for the visit; a network failure is not (it is remembered for one export only).
 */
const ENTRY = visualEntry('avc1', 320, 180, avcC(0x42, 0xc0, 0x1e));

/** A fragmented file of `count` fragments, each two pictures over 100 KB of data (so each needs a request). */
function fragmented(count: number): Uint8Array {
  const parts = [ftyp('iso5'), moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [], entry: ENTRY }], fragmented: { defaultDuration: { 1: 512 } } })];
  for (let i = 0; i < count; i += 1) {
    const make = (dataOffset: number) => moof(i + 1, [{ trackId: 1, base: i * 1024, count: 2, sizes: [60_000, 50_000], firstFlags: SYNC, defaultFlags: NON_SYNC, dataOffset }]);
    parts.push(make(make(0).length + 8), mdat(110_000));
  }
  return concat(...parts);
}

/** A plain file whose moov comes after `gaps` free boxes of 100 KB each. */
function plainAfter(gaps: number): Uint8Array {
  const free = box('free', new Uint8Array(100_000));
  const movie = moov({ tracks: [{ handler: 'vide', timescale: 30, durations: [1, 1, 1, 1], chunks: { perChunk: [4], offsets: [100] }, entry: ENTRY }] });
  return concat(ftyp(), ...Array.from({ length: gaps }, () => free), movie, mdat(500));
}

function serve(bytes: Uint8Array) {
  return vi.fn(async (_url: string, init: { headers: { Range: string } }) => {
    const [start, end] = init.headers.Range.slice(6).split('-').map(Number) as [number, number];
    if (start >= bytes.length) return new Response(null, { status: 416 });
    const last = Math.min(end, bytes.length - 1);
    return new Response(bytes.slice(start, last + 1), { status: 206, headers: { 'Content-Range': `bytes ${start}-${last}/${bytes.length}` } });
  });
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('B8: a fragmented file has its own request budget', () => {
  it('twenty fragments, a request each: indexed (more than the 8 a plain file may use)', async () => {
    const fetch = serve(fragmented(20));
    vi.stubGlobal('fetch', fetch);
    const { readPictureIndex, FRAGMENTED_INDEX_REQUESTS } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect(FRAGMENTED_INDEX_REQUESTS).toBe(64);
    const answer = await readPictureIndex('/media/frag20.mp4');
    expect(answer.ok && answer.index.pictures.length).toBe(40);
    expect(fetch.mock.calls.length).toBeGreaterThan(8);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(64);
  });

  it('past 64 requests: unreadable (the source is seeked)', async () => {
    const fetch = serve(fragmented(70));
    vi.stubGlobal('fetch', fetch);
    const { readPictureIndex } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect(await readPictureIndex('/media/frag70.mp4')).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(fetch.mock.calls.length).toBe(64);
  });

  it('a plain file keeps its budget of 8', async () => {
    vi.stubGlobal('fetch', serve(plainAfter(5)));
    const { readPictureIndex } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect((await readPictureIndex('/media/plain5.mp4')).ok).toBe(true);
    vi.stubGlobal('fetch', serve(plainAfter(12)));
    expect(await readPictureIndex('/media/plain12.mp4')).toMatchObject({ ok: false, reason: 'unreadable' });
  });
});

describe('B9: what a failed index read leaves behind', () => {
  it('the file’s own answer (a codec the index does not read) is remembered: one read', async () => {
    const bytes = concat(ftyp(), moov({ tracks: [{ handler: 'vide', timescale: 30, durations: [1, 1], chunks: { perChunk: [2], offsets: [100] }, entry: visualEntry('mp4v', 320, 180) }] }), mdat(500));
    const fetch = serve(bytes);
    vi.stubGlobal('fetch', fetch);
    const { readPictureIndex } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect(await readPictureIndex('/media/mp4v.mp4')).toMatchObject({ ok: false, reason: 'codec' });
    const asked = fetch.mock.calls.length;
    expect(await readPictureIndex('/media/mp4v.mp4')).toMatchObject({ ok: false, reason: 'codec' });
    expect(fetch.mock.calls.length).toBe(asked);
  });

  it('a file past its request budget is that file’s answer too: remembered', async () => {
    const fetch = serve(fragmented(70));
    vi.stubGlobal('fetch', fetch);
    const { readPictureIndex } = await import('@/components/brand-studio/editor-v2/footage-facts');
    await readPictureIndex('/media/frag70.mp4');
    const asked = fetch.mock.calls.length;
    expect(await readPictureIndex('/media/frag70.mp4')).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(fetch.mock.calls.length).toBe(asked);
  });

  it('a network failure is not the file’s answer: read again next time', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', offline);
    const { readPictureIndex } = await import('@/components/brand-studio/editor-v2/footage-facts');
    expect(await readPictureIndex('/media/away.mp4')).toMatchObject({ ok: false, reason: 'network' });
    await readPictureIndex('/media/away.mp4');
    expect(offline).toHaveBeenCalledTimes(2);
  });

  it('within one export a network failure is read once; the next export reads again', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', offline);
    const { exportIndexReads } = await import('@/components/brand-studio/editor-v2/footage-facts');
    const first = exportIndexReads();
    await first('/media/away.mp4');
    await first('/media/away.mp4');
    expect(offline).toHaveBeenCalledTimes(1);
    await exportIndexReads()('/media/away.mp4');
    expect(offline).toHaveBeenCalledTimes(2);
  });
});
