import { describe, expect, it } from 'vitest';
import { templateCredits } from '@/lib/twings/credits';

/** docs/PLATFORM-2.0.md §19.2's table is the contract: the page shows these numbers, nothing in won. */

const film = (runtimeSeconds: number | null, engine = 'seedance-2.5', aspectDefault = '9:16') => ({ medium: 'video' as const, engine, runtimeSeconds, aspectDefault, gallery: [] });

describe('template credits', () => {
  it('matches the founder table for Seedance 2.5 films at 720p', () => {
    expect(templateCredits(film(10))).toBe(25);
    expect(templateCredits(film(15))).toBe(38);
  });

  it('is one credit per Seedream picture, five for a five-frame set', () => {
    const picture = { medium: 'image' as const, engine: 'seedream-5.0-pro', runtimeSeconds: null, aspectDefault: '3:4' };
    expect(templateCredits({ ...picture, gallery: [] })).toBe(1);
    const frames = Array.from({ length: 5 }, () => ({ src: '/x.webp', w: 1, h: 1 }));
    expect(templateCredits({ ...picture, gallery: frames as never })).toBe(5);
  });

  it('has no number for a film without a length', () => {
    expect(templateCredits(film(null))).toBeNull();
  });
});
