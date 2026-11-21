import { describe, expect, it } from 'vitest';
import { DEFAULT_FILM_FPS, fpsFromMediaTimes, median, snapFilmFps, snapSourceFps, sourceFramesOf } from '@/lib/brand-studio/editor-v2/fps';

/**
 * The footage's frame rate is measured in the browser from the media times of presented frames
 * (components/brand-studio/editor-v2/measure-fps.ts). The arithmetic is checked here.
 */
const times = (fps: number, count: number, from = 0) => Array.from({ length: count }, (_, i) => from + i / fps);

describe('frame rate from presented frames', () => {
  it('reads common rates exactly, including the NTSC ones', () => {
    expect(fpsFromMediaTimes(times(24, 13))).toBe(24);
    expect(fpsFromMediaTimes(times(25, 13))).toBe(25);
    expect(fpsFromMediaTimes(times(30, 13))).toBe(30);
    expect(fpsFromMediaTimes(times(50, 13))).toBe(50);
    expect(fpsFromMediaTimes(times(60, 13))).toBe(60);
    expect(fpsFromMediaTimes(times(24000 / 1001, 13))).toBe(23.976);
    expect(fpsFromMediaTimes(times(30000 / 1001, 13))).toBe(29.97);
    expect(fpsFromMediaTimes(times(60000 / 1001, 13))).toBe(59.94);
  });

  it('takes the median gap, so a frame the browser skipped does not change the answer', () => {
    const seen = times(24, 14).filter((_, i) => i !== 4 && i !== 9);
    expect(fpsFromMediaTimes(seen)).toBe(24);
  });

  it('ignores repeated and backwards times, and needs enough gaps', () => {
    const repeated = [0, 0, 1 / 30, 1 / 30, 2 / 30, 3 / 30, 4 / 30, 5 / 30, 6 / 30, 7 / 30];
    expect(fpsFromMediaTimes(repeated)).toBe(30);
    expect(fpsFromMediaTimes(times(24, 4))).toBeNull();
    expect(fpsFromMediaTimes([])).toBeNull();
    expect(fpsFromMediaTimes([0, 2, 4, 6, 8, 10, 12, 14])).toBeNull();
  });

  it('snaps within half a percent and keeps any other rate to three decimals', () => {
    expect(snapSourceFps(24.05)).toBe(24);
    expect(snapSourceFps(23.98)).toBe(23.976);
    expect(snapSourceFps(29.9)).toBe(29.97);
    expect(snapSourceFps(15)).toBe(15);
    expect(snapSourceFps(12.5004)).toBe(12.5);
    expect(snapSourceFps(0)).toBeNull();
    expect(snapSourceFps(Number.NaN)).toBeNull();
  });

  it('brings footage onto a whole film rate', () => {
    expect([23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map(snapFilmFps)).toEqual([24, 24, 25, 30, 30, 50, 60, 60]);
    expect(snapFilmFps(null)).toBe(DEFAULT_FILM_FPS);
    expect(snapFilmFps(-1)).toBe(DEFAULT_FILM_FPS);
    expect(DEFAULT_FILM_FPS).toBe(30);
  });

  it('median and frame counts', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(sourceFramesOf(10, 24)).toBe(240);
    expect(sourceFramesOf(5.005, 23.976)).toBe(120);
    expect(sourceFramesOf(0, 30)).toBe(1);
  });
});
