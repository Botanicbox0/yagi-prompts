import { describe, expect, it } from 'vitest';
import { FakeDecoder, counter, makeIndex, pictureOf, session, us, STEP, useFakeDecoder } from './fake-decoder';

/**
 * Spec G, B7: the frames held while the picture asked for has not come out are bounded. A decoder gives its
 * pictures out in presentation order, so later ones before it mean it was skipped: the session fails at
 * `HOLD_CAP` held frames instead of feeding on.
 */
useFakeDecoder();

describe('frames held while the asked picture has not come out are bounded', () => {
  it('the decoder skips the asked picture and gives later ones: a decode failure, the feeding stops, nothing left open', async () => {
    FakeDecoder.drop = new Set([us(3 * STEP)]);
    const s = await session(makeIndex(40));
    const { DecodeFailure, HOLD_CAP } = await import('@/components/brand-studio/editor-v2/frame-decoder');
    const wanted = Array.from({ length: 30 }, (_, i) => i + 3);
    await expect(s.picture(0, wanted, 3)).rejects.toBeInstanceOf(DecodeFailure);
    // It stopped about HOLD_CAP pictures after the one asked for, not at the end of the run.
    expect(FakeDecoder.made[0]!.decoded.length).toBeLessThanOrEqual(4 + HOLD_CAP + 1);
    s.close();
    expect(counter.open).toBe(0);
  });

  it('a decoder that gives pictures in order holds at most the few asked for ahead', async () => {
    FakeDecoder.reorder = 2;
    const s = await session(makeIndex(40));
    const wanted = Array.from({ length: 30 }, (_, i) => i);
    for (const picture of wanted) expect(pictureOf(await s.picture(0, wanted, picture))).toBe(picture);
    s.close();
    expect(counter.open).toBe(0);
  });
});
