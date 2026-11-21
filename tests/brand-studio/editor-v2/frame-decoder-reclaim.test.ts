import { describe, expect, it } from 'vitest';
import { FakeDecoder, counter, makeIndex, pictureOf, session, tick, us, useFakeDecoder } from './fake-decoder';

/**
 * Spec G, A3: a decoder the browser takes back (its error callback gets a QuotaExceededError, the shape
 * measured for the encoder in A1) is made again and fed from the group's sync sample, once per picture
 * request; it is not a failure and does not move the source to seeking. Any other error is a failure.
 */
useFakeDecoder();

describe('a decoder the browser takes back is made again', () => {
  it('taken back between two requests: made again, fed from the sync sample, the right picture, counted', async () => {
    const s = await session(makeIndex(24, 12));
    const pictures = [2, 3, 4, 20];
    expect(pictureOf(await s.picture(0, pictures, 2))).toBe(2);
    FakeDecoder.made[0]!.reclaim();
    expect(counter.open).toBe(0);
    expect(pictureOf(await s.picture(0, pictures, 3))).toBe(3);
    expect(FakeDecoder.made).toHaveLength(2);
    expect(FakeDecoder.made[1]!.decoded[0]).toBe(us(0));
    expect(pictureOf(await s.picture(0, pictures, 20))).toBe(20);
    expect(s.stats()).toMatchObject({ reopened: 1, reclaimed: 1 });
    s.close();
    expect(counter.open).toBe(0);
  });

  it('taken back again during the same request: a decode failure', async () => {
    const s = await session(makeIndex(24, 12));
    const { DecodeFailure } = await import('@/components/brand-studio/editor-v2/frame-decoder');
    expect(pictureOf(await s.picture(0, [2, 9], 2))).toBe(2);
    FakeDecoder.made[0]!.reclaim();
    FakeDecoder.mode = 'never';
    const asked = s.picture(0, [2, 9], 9).catch((error: unknown) => error);
    await tick();
    FakeDecoder.made[1]!.reclaim();
    expect(await asked).toBeInstanceOf(DecodeFailure);
    s.close();
    expect(counter.open).toBe(0);
  });

  it('any other decoder error is a decode failure, not a reopen (B10 c)', async () => {
    const s = await session(makeIndex(12));
    const { DecodeFailure } = await import('@/components/brand-studio/editor-v2/frame-decoder');
    expect(pictureOf(await s.picture(0, [1, 6], 1))).toBe(1);
    FakeDecoder.made[0]!.init.error(new DOMException('Decoding error.', 'EncodingError'));
    await expect(s.picture(0, [1, 6], 6)).rejects.toBeInstanceOf(DecodeFailure);
    expect(FakeDecoder.made).toHaveLength(1);
    s.close();
    expect(counter.open).toBe(0);
  });
});
