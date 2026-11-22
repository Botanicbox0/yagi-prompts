import { describe, expect, it } from 'vitest';
import { FakeDecoder, counter, makeIndex, pictureOf, session, useFakeDecoder } from './fake-decoder';

/**
 * Spec G, B10 (b): the decoder session through several groups, with a restart between segments and B-frame
 * order (decode order is not presentation order, the decoder reorders), each picture matched by its timestamp.
 */
useFakeDecoder();

describe('several groups and restarts, with B-frame order', () => {
  it('each wanted picture comes out right, in groups that go forward, jump and come back', async () => {
    FakeDecoder.reorder = 2;
    const index = makeIndex(52, 13, true);
    // Decode order I P B B …: picture 1 is sample 2, picture 3 is sample 1.
    expect(index.pictures.slice(0, 7)).toEqual([0, 2, 3, 1, 5, 6, 4]);
    const s = await session(index);
    const groups = [
      [0, 1, 2, 3, 4, 5],
      [30, 31, 32, 33],
      [7, 8, 9],
      [2, 45],
    ];
    const seen: number[][] = [];
    for (const [g, pictures] of groups.entries()) {
      const got: number[] = [];
      for (const picture of pictures) got.push(pictureOf(await s.picture(g, pictures, picture)));
      seen.push(got);
    }
    expect(seen).toEqual(groups);
    // A new segment for each group, and one more where the last group jumps a whole stretch with a sync sample.
    expect(s.stats().segments).toBe(5);
    s.close();
    expect(counter.open).toBe(0);
  });

  it('a slowed cut asks for the same picture again: the same frame, no second decode', async () => {
    const s = await session(makeIndex(12));
    const pictures = [2, 3];
    const first = await s.picture(0, pictures, 2);
    const again = await s.picture(0, pictures, 2);
    expect(again).toBe(first);
    expect(pictureOf(await s.picture(0, pictures, 3))).toBe(3);
    s.close();
    expect(counter.open).toBe(0);
  });
});

describe('spec H, F8: with a decoder that works in tasks and has a real queue', () => {
  it('no more than 6 chunks ever wait in the decoder (the session waits for a dequeue), and every picture comes out', async () => {
    const s = await session(makeIndex(40));
    const wanted = Array.from({ length: 40 }, (_, i) => i);
    for (const picture of wanted) expect(pictureOf(await s.picture(0, wanted, picture))).toBe(picture);
    expect(FakeDecoder.mostQueued).toBeGreaterThan(1);
    expect(FakeDecoder.mostQueued).toBeLessThanOrEqual(6);
    s.close();
    expect(counter.open).toBe(0);
  });

  it('a picture already decoded is returned while the next run of bytes is still coming', async () => {
    const index = makeIndex(24, 12);
    const spread = { ...index, offsets: index.offsets.map((_, i) => i * 2_000_000) };
    const bytes = {
      read: (run: { start: number; end: number }) => (run.start >= 6 * 2_000_000 ? new Promise<Uint8Array>(() => undefined) : Promise.resolve(new Uint8Array(run.end - run.start))),
      stats: () => ({ requests: 0, received: 0, mode: 'range' as const, fileSize: null }),
    };
    const s = await session(spread, bytes);
    const started = Date.now();
    expect(pictureOf(await s.picture(0, [5, 6, 7], 5))).toBe(5);
    expect(Date.now() - started).toBeLessThan(1000);
    s.close();
  });
});

describe('spec I, G5: a flush the reset rejects belongs to the old segment', () => {
  it('a group change while the last flush is still settling: the flush is rejected (AbortError) and ignored, the new group decodes', async () => {
    // Two pictures held back by the decoder, so the end of the first group needs a flush to give them out.
    FakeDecoder.reorder = 2;
    const s = await session(makeIndex(24, 12));
    const first = [0, 1, 2, 3];
    for (const picture of first) expect(pictureOf(await s.picture(0, first, picture))).toBe(picture);
    // The flush's work is done, its promise settles in the next task: the next group starts now.
    expect(pictureOf(await s.picture(1, [16, 17], 16))).toBe(16);
    expect(FakeDecoder.abortedFlushes).toBeGreaterThan(0);
    expect(pictureOf(await s.picture(1, [16, 17], 17))).toBe(17);
    s.close();
    expect(counter.open).toBe(0);
  });
});
