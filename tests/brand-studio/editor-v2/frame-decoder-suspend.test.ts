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

  it('spec H, F2: let go near the end of a long segment, the new decoder is fed only from the last sync sample before the picture', async () => {
    // 300 samples, a sync sample every 48 (a key frame every 2 s at 24 fps), one long segment.
    const index = makeIndex(300, 48);
    const s = await session(index);
    const wanted = Array.from({ length: 300 }, (_, i) => i);
    for (let picture = 0; picture <= 250; picture += 1) expect(pictureOf(await s.picture(0, wanted, picture))).toBe(picture);
    s.suspend();
    expect(pictureOf(await s.picture(0, wanted, 251))).toBe(251);
    const again = FakeDecoder.made[1]!;
    // Sync samples at 0, 48, … 240, 288: from 240, not from 0.
    expect(again.decoded[0]).toBe(us(240 * STEP));
    expect(again.decoded.length).toBe(251 - 240 + 1);
    expect(pictureOf(await s.picture(0, wanted, 299))).toBe(299);
    s.close();
    expect(counter.open).toBe(0);
  });
});
