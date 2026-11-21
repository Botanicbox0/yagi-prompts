import { describe, expect, it } from 'vitest';
import { FakeDecoder, counter, makeIndex, pictureOf, session, us, STEP, useFakeDecoder } from './fake-decoder';

/**
 * Spec G, B2: a session let go to stay under the cap of open decoders (lib/brand-studio/editor-v2/
 * picture-paths.ts) closes its decoder, its frames and its byte cache, and makes them again on its next use,
 * fed from the sync sample, the same way as after a reclaim (A3).
 */
useFakeDecoder();

describe('a session let go comes back on its next use', () => {
  it('suspended: decoder and frames let go; the next request makes a new decoder and the right picture', async () => {
    const s = await session(makeIndex(24, 12));
    expect(s.live).toBe(false);
    expect(pictureOf(await s.picture(0, [4, 5, 15], 4))).toBe(4);
    expect(s.live).toBe(true);
    s.suspend();
    expect(s.live).toBe(false);
    expect(counter.open).toBe(0);
    expect(FakeDecoder.made[0]!.state).toBe('closed');
    expect(pictureOf(await s.picture(0, [4, 5, 15], 5))).toBe(5);
    expect(s.live).toBe(true);
    expect(pictureOf(await s.picture(0, [4, 5, 15], 15))).toBe(15);
    expect(s.stats()).toMatchObject({ reopened: 1, reclaimed: 0 });
    s.close();
    expect(counter.open).toBe(0);
  });

  it('a frame that arrives from a decoder already let go is closed at once', async () => {
    const s = await session(makeIndex(24, 12));
    expect(pictureOf(await s.picture(0, [2, 20], 2))).toBe(2);
    const decoder = FakeDecoder.made[0]!;
    s.suspend();
    decoder.late(us(20 * STEP));
    expect(counter.open).toBe(0);
    s.close();
  });
});
