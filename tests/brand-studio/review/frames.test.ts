import { describe, expect, it } from 'vitest';
import {
  COMMON_FRAME_RATES,
  FALLBACK_FPS,
  estimateFps,
  exactRate,
  endsOnWholeSecond,
  formatFrameTimecode,
  frameAt,
  frameSeekSeconds,
  frameStartMs,
  frameTimecodeParts,
  lastFrame,
  loopKeyOf,
  loopTarget,
  parseFrameTimecode,
  snapFps,
  snapToFrameMs,
  stepFrame,
} from '@/lib/brand-studio/review-frames';
import { formatTimecode, parseReviewTime } from '@/lib/brand-studio/review-contracts';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §11 — the frame arithmetic the review stage runs on: the rate a probe or the
 * browser reports, snapped; the frame on screen at a stored millisecond; one-frame steps that land on the
 * next frame and never on the same one twice; `m:ss:ff`; and the range loop's boundary.
 */
describe('snapping a measured rate', () => {
  it('snaps to a common rate within 0.5 %, and keeps three decimals otherwise', () => {
    expect(snapFps(24000 / 1001)).toBe(23.976);
    expect(snapFps(23.98)).toBe(23.976);
    expect(snapFps(24.05)).toBe(24);
    expect(snapFps(25)).toBe(25);
    expect(snapFps(30000 / 1001)).toBe(29.97);
    expect(snapFps(29.99)).toBe(30);
    expect(snapFps(60000 / 1001)).toBe(59.94);
    expect(snapFps(47.9)).toBe(48);
    expect(snapFps(50.2)).toBe(50);
    expect(snapFps(12.5)).toBe(12.5);
    expect(snapFps(15.0001)).toBe(15);
    expect(snapFps(119.88)).toBe(119.88);
  });

  it('gives up outside 1–240 and on things that are not rates', () => {
    for (const bad of [0, -24, 0.5, 241, 1000, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) expect(snapFps(bad as number)).toBeNull();
  });

  it('knows the NTSC rates by their exact value', () => {
    expect(exactRate(23.976)).toBeCloseTo(24000 / 1001, 12);
    expect(exactRate(29.97)).toBeCloseTo(30000 / 1001, 12);
    expect(exactRate(59.94)).toBeCloseTo(60000 / 1001, 12);
    expect(exactRate(25)).toBe(25);
    expect(COMMON_FRAME_RATES).toContain(48);
  });
});

describe("the browser's estimate", () => {
  it('takes the median gap between presented frames', () => {
    const gaps = Array.from({ length: 12 }, () => 1001 / 24000);
    expect(estimateFps(gaps)).toBe(23.976);
    // A dropped frame or two (double gaps) and a seek (negative) do not move the median.
    expect(estimateFps([...Array.from({ length: 10 }, () => 1 / 30), 2 / 30, 2 / 30, -0.5, 0])).toBe(30);
    expect(estimateFps(Array.from({ length: 9 }, () => 1 / 25))).toBe(25);
  });

  it('needs enough usable gaps', () => {
    expect(estimateFps([1 / 24, 1 / 24, 1 / 24])).toBeNull();
    expect(estimateFps(Array.from({ length: 12 }, () => 0.5))).toBeNull();
    expect(estimateFps([])).toBeNull();
  });
});

describe('frames from milliseconds and back', () => {
  for (const fps of [23.976, 24, 25, 29.97, 30, 59.94, 60]) {
    it(`reads every stored frame start back as its own frame at ${fps}`, () => {
      for (let n = 0; n < 2_000; n += 1) {
        const ms = frameStartMs(n, fps);
        expect(Number.isInteger(ms)).toBe(true);
        expect(frameAt(ms, fps)).toBe(n);
        // The millisecond before is still the previous frame.
        if (n > 0) expect(frameAt(ms - 1, fps)).toBe(n - 1);
      }
    });
  }

  it('snaps a note time to the start of the frame on screen', () => {
    expect(snapToFrameMs(1_020, 24)).toBe(1_000);
    expect(snapToFrameMs(1_041, 24)).toBe(1_000);
    expect(snapToFrameMs(1_042, 24)).toBe(1_042);
    expect(snapToFrameMs(0, 24)).toBe(0);
    // 23.976: frame 24 starts at 1001 ms exactly.
    expect(snapToFrameMs(1_020, 23.976)).toBe(1_001);
  });

  it('knows the last frame of a film', () => {
    expect(lastFrame(1_000, 24)).toBe(23);
    expect(lastFrame(3_000, 30)).toBe(89);
    expect(lastFrame(0, 24)).toBeNull();
  });
});

describe('one-frame steps', () => {
  it('lands on consecutive frames, from a frame start or from the middle of a frame', () => {
    for (const fps of [23.976, 24, 30, 59.94]) {
      let ms = 0;
      for (let n = 1; n <= 300; n += 1) {
        const frame = stepFrame(ms, fps, 1, 60_000);
        expect(frame).toBe(n);
        // The player is put a little past the frame's start; the clock reads that back as the same frame.
        ms = frameSeekSeconds(frame, fps) * 1000;
        expect(frameAt(ms, fps)).toBe(n);
      }
      for (let n = 299; n >= 0; n -= 1) {
        const frame = stepFrame(ms, fps, -1, 60_000);
        expect(frame).toBe(n);
        ms = frameSeekSeconds(frame, fps) * 1000;
      }
    }
    // Paused mid-frame (after playback): the next step is the next frame, not two.
    expect(stepFrame(1_030, 24, 1)).toBe(25);
    expect(stepFrame(1_030, 24, -1)).toBe(23);
  });

  it('stays inside the film', () => {
    expect(stepFrame(0, 24, -1)).toBe(0);
    expect(stepFrame(frameStartMs(23, 24), 24, 1, 1_000)).toBe(23);
  });

  it('seeks a little past the frame start, never into the next frame', () => {
    for (const fps of [23.976, 24, 25, 30, 60, 120]) {
      const s = frameSeekSeconds(10, fps);
      const start = 10 / exactRate(fps);
      expect(s).toBeGreaterThan(start);
      expect(s - start).toBeGreaterThanOrEqual(Math.min(0.0006, 1 / exactRate(fps) / 4) - 1e-12);
      expect(s).toBeLessThan(11 / exactRate(fps));
    }
    expect(FALLBACK_FPS).toBe(24);
  });
});

describe('m:ss:ff', () => {
  it('writes real minutes and seconds and the frame within that second', () => {
    expect(formatFrameTimecode(0, 24)).toBe('0:00:00');
    expect(formatFrameTimecode(999, 24)).toBe('0:00:23');
    expect(formatFrameTimecode(1_000, 24)).toBe('0:01:00');
    expect(formatFrameTimecode(61_500, 24)).toBe('1:01:12');
    expect(formatFrameTimecode(frameStartMs(24, 23.976), 23.976)).toBe('0:01:00');
    expect(formatFrameTimecode(frameStartMs(23, 23.976), 23.976)).toBe('0:00:23');
    expect(formatFrameTimecode(frameStartMs(29, 29.97), 29.97)).toBe('0:00:29');
    expect(formatFrameTimecode(frameStartMs(30, 29.97), 29.97)).toBe('0:01:00');
    expect(formatFrameTimecode(3_723_000, 25)).toBe('1:02:03:00');
    expect(formatFrameTimecode(1_000 + 1_000 / 120 * 5, 120)).toBe('0:01:005');
  });

  it('splits into the clock and the frame for the screen', () => {
    expect(frameTimecodeParts(8_008, 23.976)).toEqual({ clock: '0:08', frames: ':00' });
    expect(frameTimecodeParts(1_200, 23.976)).toEqual({ clock: '0:01', frames: ':04' });
    expect(frameTimecodeParts(3_723_000, 25)).toEqual({ clock: '1:02:03', frames: ':00' });
    expect(frameTimecodeParts(1_000 + (1_000 / 120) * 5, 120)).toEqual({ clock: '0:01', frames: ':005' });
    expect(endsOnWholeSecond(8_008, 23.976)).toBe(true);
    expect(endsOnWholeSecond(6_000, 30)).toBe(true);
    expect(endsOnWholeSecond(6_500, 30)).toBe(false);
  });

  it('is read back to the same frame start', () => {
    for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]) {
      for (let n = 0; n < 1_500; n += 7) {
        const ms = frameStartMs(n, fps);
        expect(parseFrameTimecode(formatFrameTimecode(ms, fps), fps)).toBe(ms);
      }
    }
  });

  it('refuses what it never writes', () => {
    expect(parseFrameTimecode('0:00:24', 24)).toBeNull();
    expect(parseFrameTimecode('0:61:00', 24)).toBeNull();
    expect(parseFrameTimecode('1:60:00:00', 24)).toBeNull();
    expect(parseFrameTimecode('0:00.5', 24)).toBeNull();
    expect(parseFrameTimecode('abc', 24)).toBeNull();
  });

  it('leaves the tenths format and ?t= as they were', () => {
    expect(formatTimecode(1_250)).toBe('0:01.2');
    expect(parseReviewTime('1001')).toBe(1001);
    expect(parseReviewTime('1.5')).toBeNull();
  });
});

describe('the range loop', () => {
  const range = { startMs: 1_000, endMs: 2_000 };

  it('goes back to the start once the end is reached, or when found before the start', () => {
    expect(loopTarget(1_500, range)).toBeNull();
    expect(loopTarget(1_000, range)).toBeNull();
    expect(loopTarget(1_999, range)).toBe(1_000);
    expect(loopTarget(2_000, range)).toBe(1_000);
    expect(loopTarget(5_000, range)).toBe(1_000);
    expect(loopTarget(400, range)).toBe(1_000);
  });

  it('with a rate, the end frame itself is outside (the end is exclusive)', () => {
    const r = { startMs: frameStartMs(24, 24), endMs: frameStartMs(48, 24) };
    expect(loopTarget(frameStartMs(47, 24) + 5, r, 24)).toBeNull();
    expect(loopTarget(frameStartMs(48, 24) + 1, r, 24)).toBe(r.startMs);
  });

  it('does nothing without a range', () => {
    expect(loopTarget(5_000, null)).toBeNull();
    expect(loopTarget(5_000, { startMs: 2_000, endMs: 2_000 })).toBeNull();
  });

  it('keys a range so the same one keeps looping and another one ends it', () => {
    expect(loopKeyOf('note', 'a', range)).toBe(loopKeyOf('note', 'a', { ...range }));
    expect(loopKeyOf('note', 'a', range)).not.toBe(loopKeyOf('note', 'b', range));
    expect(loopKeyOf('mark', null, range)).not.toBe(loopKeyOf('mark', null, { startMs: 1_000, endMs: 2_100 }));
    expect(loopKeyOf('note', 'a', null)).toBeNull();
  });
});
