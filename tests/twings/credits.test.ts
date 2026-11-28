import { describe, expect, it } from 'vitest';
import { templateCredits, templateCreditsByResolution } from '@/lib/twings/credits';

/** docs/PLATFORM-2.0.md §19.2's table is the contract: 1 credit = 10원 net, the margin in the template. */

const film = (runtimeSeconds: number | null, engine = 'seedance-2.5', aspectDefault = '9:16') => ({ medium: 'video' as const, engine, runtimeSeconds, aspectDefault, gallery: [] });
const frames = (n: number) => Array.from({ length: n }, () => ({ src: '/x.webp', w: 1, h: 1 })) as never;

describe('template credits', () => {
  it('prices Seedance 2.5 films at 720p on a 6% margin', () => {
    expect(templateCredits(film(10))).toBe(345);
    expect(templateCredits(film(15))).toBe(517);
  });

  it('prices MAGI-2 films at 1080p only from 0.08 * seconds * 1.05', () => {
    const magi10 = film(10, 'magi-2', '9:16');
    expect(templateCredits(magi10)).toBe(126);
    expect(templateCredits(magi10, '1080p')).toBe(126);
    expect(templateCredits(magi10, '720p')).toBeNull();
    expect(templateCreditsByResolution(magi10)).toEqual({ '1080p': 126 });
  });

  it('prices a set on all its frames together, at cost × 1.12', () => {
    const picture = { medium: 'image' as const, engine: 'seedream-5.5', runtimeSeconds: null, aspectDefault: '3:4' };
    expect(templateCredits({ ...picture, gallery: [] })).toBe(7);
    expect(templateCredits({ ...picture, gallery: frames(5) })).toBe(34);
    expect(templateCredits({ ...picture, engine: 'nano-banana-2.1', gallery: frames(5) })).toBe(41);
  });

  it('has no number for a film without a length', () => {
    expect(templateCredits(film(null))).toBeNull();
  });
});
