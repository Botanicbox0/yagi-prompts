import { describe, expect, it } from 'vitest';
import { DEFAULT_FILM_FPS, fpsFromMediaTimes, median, playbackFacts, rateFromMediaTimes, snapFilmFps, snapSourceFps, sourceFramesOf } from '@/lib/brand-studio/editor-v2/fps';

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

  it('a container that keeps times to the millisecond (WebM: 0, 42, 83, 125 ms …) reads 24, not 1 / 0.042 = 23.81', () => {
    // Found by the real-screen check of review round 1 (part E, item 4): a 97-picture WebM measured by
    // playback stored 96 pictures at 23.81 fps. The rate is the frames over the time they span.
    const ms = (fps: number, count: number) => Array.from({ length: count }, (_, i) => Math.round((i * 1000) / fps) / 1000);
    expect(fpsFromMediaTimes(ms(24, 13))).toBe(24);
    expect(fpsFromMediaTimes(ms(30, 13))).toBe(30);
    expect(fpsFromMediaTimes(ms(25, 13))).toBe(25);
    // A skipped frame among them still counts as two frames of time. (Thirteen frames on a millisecond clock
    // cannot tell 24 from 23.976, 0.1 % apart; the playback measurement refines the rate from the first and
    // last pictures it reads, components/brand-studio/editor-v2/measure-fps.ts.)
    expect(fpsFromMediaTimes(ms(24, 14).filter((_, i) => i !== 6))).toBeCloseTo(24, 1);
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

/**
 * Review round 2 of part E, N1: footage measured by playback gets its rate from the whole span between its
 * first and last pictures, never from a count the length rule cut. The window of a dozen frames only says
 * which standard rates to try.
 */
describe('the rate and count of footage measured by playback', () => {
  const ms = (sec: number) => Math.round(sec * 1000) / 1000;
  const exact = (sec: number) => sec;
  /** Fourteen pictures from picture `from`, the one at `skip` not presented: thirteen steps in the window. */
  const skipped = (fps: number, from: number, skip = 6, clock = ms) => Array.from({ length: 14 }, (_, i) => clock((from + i) / fps)).filter((_, i) => i !== skip);
  const clean = (fps: number, clock = exact) => Array.from({ length: 13 }, (_, i) => clock(i / fps));
  const ntsc = 24000 / 1001;

  it('the reproduction: a true 24 fps WebM of 97 pictures (4.042 s) with a skipped picture in the window is 97 at 24, not 96 at 23.75', () => {
    for (const from of [0, 1, 2]) {
      const window = skipped(24, from);
      const facts = playbackFacts({ windowTimes: window, firstSec: 0, lastSec: ms(96 / 24), durationSec: 4.042 });
      expect(facts, `phase ${from}`).toEqual({ fps: 24, frames: 97, variable: false });
    }
    // Two of the three phases read the window alone as 23.976.
    expect([0, 1, 2].map((from) => rateFromMediaTimes(skipped(24, from)).fps)).toEqual([23.976, 24, 23.976]);
  });

  it('its 30 fps twin: 121 pictures at 30', () => {
    for (const from of [0, 1, 2]) {
      expect(playbackFacts({ windowTimes: skipped(30, from), firstSec: 0, lastSec: ms(120 / 30), durationSec: 4.033 }), `phase ${from}`).toEqual({ fps: 30, frames: 121, variable: false });
    }
  });

  it('a true 23.976 of 1,200 pictures is 23.976 and 1,200, whatever the window read', () => {
    for (const from of [0, 1, 2]) {
      const facts = playbackFacts({ windowTimes: skipped(ntsc, from), firstSec: 0, lastSec: ms((1199 * 1001) / 24000), durationSec: 50.05 });
      expect(facts?.fps, `phase ${from}`).toBeCloseTo(ntsc, 9);
      expect(facts?.frames, `phase ${from}`).toBe(1200);
    }
  });

  it('a true 24 of 400 pictures, the window misread as 23.976: 24 and 400', () => {
    expect(rateFromMediaTimes(skipped(24, 0)).fps).toBe(23.976);
    expect(playbackFacts({ windowTimes: skipped(24, 0), firstSec: 0, lastSec: ms(399 / 24), durationSec: 16.667 })).toEqual({ fps: 24, frames: 400, variable: false });
  });

  it('clean windows at 24, 25, 30, 50 and 60, exact and on a millisecond clock', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      for (const clock of [exact, ms]) {
        expect(playbackFacts({ windowTimes: clean(fps, clock), firstSec: 0, lastSec: clock(239 / fps), durationSec: clock(240 / fps) }), `${fps}`).toEqual({ fps, frames: 240, variable: false });
      }
    }
    for (const [num, den] of [[30000, 1001], [60000, 1001]] as const) {
      const fps = num / den;
      const facts = playbackFacts({ windowTimes: clean(fps, ms), firstSec: 0, lastSec: ms(599 / fps), durationSec: ms(600 / fps) });
      expect(facts?.fps).toBeCloseTo(fps, 9);
      expect(facts?.frames).toBe(600);
    }
  });

  it('a rate no standard one is near (15 fps, 12 fps): the window’s own rate, and the right count', () => {
    expect(playbackFacts({ windowTimes: clean(15), firstSec: 0, lastSec: 59 / 15, durationSec: 4 })).toEqual({ fps: 15, frames: 60, variable: false });
    expect(playbackFacts({ windowTimes: clean(15, ms), firstSec: 0, lastSec: ms(59 / 15), durationSec: 4 })).toEqual({ fps: 15, frames: 60, variable: false });
    expect(playbackFacts({ windowTimes: clean(12, ms), firstSec: 0.5, lastSec: ms(0.5 + 47 / 12), durationSec: 4.5 })).toEqual({ fps: 12, frames: 48, variable: false });
  });

  it('a span where 24 and 23.976 both fit (every 1001/24 s, and spans under about 2 s): the one nearest the window', () => {
    // 1,002 pictures at 24 span 1001/24 s, exactly 1,000 steps at 23.976: the ends cannot tell them apart.
    const span = 1001 / 24;
    expect(playbackFacts({ windowTimes: clean(24, ms), firstSec: 0, lastSec: ms(span), durationSec: 41.75 })).toEqual({ fps: 24, frames: 1002, variable: false });
    const misread = playbackFacts({ windowTimes: skipped(24, 0), firstSec: 0, lastSec: ms(span), durationSec: 41.75 });
    expect(misread?.fps).toBeCloseTo(ntsc, 9);
    expect(misread?.frames).toBe(1001);
    // A one-second clip: both fit, the count is the same either way.
    expect(playbackFacts({ windowTimes: clean(24, ms), firstSec: 0, lastSec: 1, durationSec: 1.042 })).toEqual({ fps: 24, frames: 25, variable: false });
  });

  it('the length caps the count, never the rate', () => {
    // The ends say 97 pictures; the stated length gives 93 at 24 fps: 93 at 24 (not 92 steps over 4 s = 23).
    expect(playbackFacts({ windowTimes: clean(24), firstSec: 0, lastSec: 4, durationSec: 3.9 })).toEqual({ fps: 24, frames: 93, variable: false });
    // A container that runs past the last picture (its sound is longer) adds nothing.
    expect(playbackFacts({ windowTimes: clean(24), firstSec: 0, lastSec: 4, durationSec: 4.308 })).toEqual({ fps: 24, frames: 97, variable: false });
    expect(playbackFacts({ windowTimes: clean(24), firstSec: 0.5, lastSec: 4.5, durationSec: 4.56 })).toEqual({ fps: 24, frames: 97, variable: false });
  });

  it('no ends, no answer: without the first and the last picture nothing is counted (review round 2, item 4)', () => {
    expect(playbackFacts({ windowTimes: clean(24), firstSec: null, lastSec: 4, durationSec: 4.06 })).toBeNull();
    expect(playbackFacts({ windowTimes: clean(24), firstSec: 0, lastSec: null, durationSec: 4.06 })).toBeNull();
    expect(playbackFacts({ windowTimes: clean(24), firstSec: 2, lastSec: 1, durationSec: 4.06 })).toBeNull();
    expect(playbackFacts({ windowTimes: clean(24).slice(0, 4), firstSec: 0, lastSec: 4, durationSec: 4.06 })).toBeNull();
    expect(playbackFacts({ windowTimes: clean(24), firstSec: 0, lastSec: 4, durationSec: Number.NaN })).toBeNull();
  });

  it('uneven frames are still reported', () => {
    const mixed = [0, 1 / 24, 2 / 24, 2 / 24 + 1 / 30, 2 / 24 + 2 / 30, 3 / 24 + 2 / 30, 3 / 24 + 3 / 30, 4 / 24 + 3 / 30, 4 / 24 + 4 / 30, 5 / 24 + 4 / 30, 5 / 24 + 5 / 30, 6 / 24 + 5 / 30, 6 / 24 + 6 / 30];
    expect(playbackFacts({ windowTimes: mixed, firstSec: 0, lastSec: 4, durationSec: 4.06 })?.variable).toBe(true);
  });
});
