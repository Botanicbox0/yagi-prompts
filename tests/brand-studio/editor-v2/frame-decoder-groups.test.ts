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
