import { describe, expect, it } from 'vitest';
import {
  JUMP_MIN_SAMPLES,
  byteRuns,
  choosePath,
  decodeGroups,
  decodeSegments,
  exportPathOverride,
  pictureFor,
  pictureTimes,
  slowNotice,
  syncStart,
  unevenWarning,
  type PictureTimes,
} from '@/lib/brand-studio/editor-v2/decode-plan';
import { clipFrameAt, sourceFrameIndex, type FrameClip } from '@/lib/brand-studio/editor-v2/frames';

/**
 * Spec F, F3: which picture of a source each film frame shows on the decoder path, which samples are fed
 * for it and which bytes hold them. The heart of the proof: on evenly spaced footage the decoder path
 * numbers pictures exactly as the timeline and the seek path do.
 */

/** Evenly spaced timestamps: `count` pictures of `ticks` each. */
function even(count: number, ticks: number, timescale: number, variable = false): PictureTimes {
  return { frames: count, variable, timescale, relTicks: Array.from({ length: count }, (_, k) => k * ticks), endTicks: count * ticks };
}

describe('which picture: one rule', () => {
  it('evenly spaced footage: the timeline’s own source frame, unchanged', () => {
    const times = even(240, 512, 12288);
    for (const sourceFrame of [0, 1, 17, 239]) expect(pictureFor({ sourceFrame, mediaFrame: 999 }, 24, times)).toEqual({ picture: sourceFrame, past: false });
  });

  it('a frame asked for past the last picture is the last picture, and says so (spec E addendum C3)', () => {
    expect(pictureFor({ sourceFrame: 97, mediaFrame: 97 }, 24, even(97, 512, 12288))).toEqual({ picture: 96, past: true });
    expect(pictureFor({ sourceFrame: 97, mediaFrame: 97 }, 24, even(97, 512, 12288, true))).toEqual({ picture: 96, past: true });
  });

  /**
   * The time rule on evenly spaced timestamps gives frames.ts' `floor(mediaFrame × rate / fps)` for every
   * frame: footage at 23.976/24/25/29.97/30/50/60 in films at 24/25/30/50/60, in exact track ticks.
   */
  const SOURCES: Array<[string, number, number, number]> = [
    ['23.976', 24000, 1001, 24000 / 1001],
    ['24', 12288, 512, 24],
    ['25', 12800, 512, 25],
    ['29.97', 30000, 1001, 30000 / 1001],
    ['30', 15360, 512, 30],
    ['50', 12800, 256, 50],
    ['60', 15360, 256, 60],
  ];
  for (const [label, timescale, ticks, rate] of SOURCES) {
    it(`by time on evenly spaced ${label} fps timestamps equals the frame-count rule, film at 24/25/30/50/60`, () => {
      const times = even(600, ticks, timescale, true);
      for (const fps of [24, 25, 30, 50, 60]) {
        for (let mediaFrame = 0; mediaFrame < Math.floor((600 * fps) / rate); mediaFrame += 1) {
          const byIndex = Math.min(599, sourceFrameIndex(mediaFrame, fps, rate));
          expect(pictureFor({ sourceFrame: -1, mediaFrame }, fps, times).picture, `${label} in ${fps}, media frame ${mediaFrame}`).toBe(byIndex);
        }
      }
    });
  }

  it('speeds go through frames.ts the same way: 0.5× repeats, 2× skips, 3/2 steps, on both rules', () => {
    const base: FrameClip = { id: 'c', label: 'c', srcUrl: 'u', thumbUrl: null, sourceFps: 30, sourceFrames: 300, inFrame: 5, phase: 0, frames: 40, speedNum: 1, speedDen: 1, volume: 1, muted: false };
    const evenTimes = even(300, 512, 15360);
    const timeRule = { ...evenTimes, variable: true };
    for (const [num, den] of [[1, 2], [2, 1], [3, 2], [1, 1]] as const) {
      const clip = { ...base, speedNum: num, speedDen: den };
      for (let offset = 0; offset < 40; offset += 1) {
        const at = clipFrameAt(clip, offset, 24);
        expect(pictureFor(at, 24, evenTimes).picture).toBe(at.sourceFrame);
        expect(pictureFor(at, 24, timeRule).picture).toBe(at.sourceFrame);
      }
    }
  });

  it('frames not evenly spaced: the picture whose span holds the film frame’s moment', () => {
    // One second at 24 fps, then one at 30 fps (timescale 1000: 41/42 ms, then 33/34 ms).
    const rel: number[] = [];
    for (let k = 0; k < 24; k += 1) rel.push(Math.round((k * 1000) / 24));
    for (let k = 0; k < 30; k += 1) rel.push(1000 + Math.round((k * 1000) / 30));
    const times: PictureTimes = { frames: rel.length, variable: true, timescale: 1000, relTicks: rel, endTicks: 2000 };
    const at = (mediaFrame: number) => pictureFor({ sourceFrame: -1, mediaFrame }, 30, times).picture;
    // Film at 30 fps: the first second shows 24 pictures over 30 frames (some twice), the second one each.
    // Frame 4 is at 133.3 ms and frame 5 at 166.7 ms: both inside picture 3's span [125, 167) ms.
    expect([0, 1, 2, 3, 4, 5, 6].map(at)).toEqual([0, 0, 1, 2, 3, 3, 4]);
    expect(at(30)).toBe(24);
    expect(at(31)).toBe(25);
    // Frame 59 is at 1966.7 ms; the last picture starts at 1967 ms (rounded to the clock): the one before.
    expect(at(59)).toBe(52);
    expect(pictureFor({ sourceFrame: -1, mediaFrame: 60 }, 30, times)).toEqual({ picture: 53, past: true });
    // Each answer's span holds the moment.
    for (let f = 0; f < 60; f += 1) {
      const p = at(f);
      const moment = (f * 1000) / 30;
      expect(rel[p]!).toBeLessThanOrEqual(moment + 1e-3);
      expect(p === rel.length - 1 || rel[p + 1]! > moment).toBe(true);
    }
  });

  it('pictureTimes reads the times from an index (picture 0 at 0, the last picture’s end)', () => {
    const times = pictureTimes({ pictures: [0, 2, 1], cts: [1024, 2048, 1536], durations: [512, 512, 512], timescale: 12288, variable: false });
    expect(times.relTicks).toEqual([0, 512, 1024]);
    expect(times.endTicks).toBe(1536);
  });
});

describe('which film frames are decoded together', () => {
  const req = (frame: number, srcUrl: string, picture: number) => ({ frame, srcUrl, picture });

  it('a cut at 0.5× repeats each picture: it is decoded once', () => {
    const groups = decodeGroups([0, 0, 1, 1, 2, 2].map((p, f) => req(f, 'a', p)));
    expect(groups).toEqual([{ srcUrl: 'a', first: 0, last: 5, pictures: [0, 1, 2] }]);
  });

  it('a cut at 2× skips pictures: only the shown ones are wanted', () => {
    expect(decodeGroups([0, 2, 4, 6].map((p, f) => req(f, 'a', p)))[0]!.pictures).toEqual([0, 2, 4, 6]);
  });

  it('a split that continues stays one pass; a piece moved before another, or another source, starts a new one', () => {
    const film = [req(0, 'a', 10), req(1, 'a', 11), req(2, 'a', 12), req(3, 'a', 3), req(4, 'a', 4), req(5, 'b', 0), req(6, 'a', 5)];
    expect(decodeGroups(film).map((g) => [g.srcUrl, g.first, g.last, g.pictures])).toEqual([
      ['a', 0, 2, [10, 11, 12]],
      ['a', 3, 4, [3, 4]],
      ['b', 5, 5, [0]],
      ['a', 6, 6, [5]],
    ]);
  });
});

describe('which samples: from a sync sample, in decode order', () => {
  // Closed groups as x264 writes them, decode order I0 P4 B2 B1 B3 P8 B6 B5 B7 | I9 P13 B11 B10 B12: sample → picture.
  const shownOf = [0, 4, 2, 1, 3, 8, 6, 5, 7, 9, 13, 11, 10, 12];
  const pictures = shownOf.map((_, p) => shownOf.indexOf(p));
  const order = { pictures, cts: shownOf.map((p) => p * 512), syncs: [0, 9] };

  it('the sync sample at or before the picture’s sample', () => {
    expect(syncStart(order, 0)).toBe(0);
    expect(syncStart(order, 3)).toBe(0);
    expect(syncStart(order, 8)).toBe(0);
    expect(syncStart(order, 9)).toBe(9);
    expect(syncStart(order, 12)).toBe(9);
  });

  it('a leading picture (shown before the sync sample it follows in decode order) starts a group earlier', () => {
    // An open group: sample 5 is a sync sample shown at 8; picture 5 is sample 7, after it in decode
    // order but shown before it, and may refer to the group before.
    const open = { pictures: [0, 3, 2, 4, 1, 7, 6, 8, 5], cts: [0, 4, 2, 1, 3, 8, 6, 5, 7].map((p) => p * 512), syncs: [0, 5] };
    expect(open.pictures[5]).toBe(7);
    expect(syncStart(open, 5)).toBe(0);
    expect(syncStart(open, 8)).toBe(5);
  });

  it('a run of pictures is one segment, fed up to the last one’s sample (B-frames: past it in decode order)', () => {
    expect(decodeSegments(order, [0, 1, 2, 3, 4])).toEqual([{ from: 0, to: 4, pictures: [0, 1, 2, 3, 4] }]);
    expect(decodeSegments(order, [5, 6])).toEqual([{ from: 0, to: 7, pictures: [5, 6] }]);
    expect(decodeSegments(order, [10, 11])).toEqual([{ from: 9, to: 12, pictures: [10, 11] }]);
  });

  it('a fast cut restarts at a later sync sample only when that skips enough samples', () => {
    const long = { pictures: Array.from({ length: 100 }, (_, i) => i), cts: Array.from({ length: 100 }, (_, i) => i * 10), syncs: [0, 24, 48, 72, 96] };
    // Every 8th picture: within one group of 24 no restart; across groups the restart skips 24 - 16 - 1 = 7 samples: not worth it.
    expect(decodeSegments(long, [0, 8, 16, 24, 32])).toEqual([{ from: 0, to: 32, pictures: [0, 8, 16, 24, 32] }]);
    // Every 30th: the next group's sync sample skips more than JUMP_MIN_SAMPLES: restart there.
    expect(decodeSegments(long, [0, 30, 60, 99])).toEqual([
      { from: 0, to: 0, pictures: [0] },
      { from: 24, to: 30, pictures: [30] },
      { from: 48, to: 60, pictures: [60] },
      { from: 96, to: 99, pictures: [99] },
    ]);
    expect(JUMP_MIN_SAMPLES).toBeGreaterThan(0);
  });

  it('a picture with no sync sample before it cannot be decoded: null (the source is seeked)', () => {
    expect(decodeSegments({ pictures: [0, 1, 2], cts: [0, 1, 2], syncs: [2] }, [0])).toBeNull();
  });
});

describe('which bytes', () => {
  const layout = { offsets: [100, 200, 260, 5000, 5100, 20_000_000, 300], sizes: [100, 60, 40, 100, 50, 10_000_000, 10] };

  it('neighbouring samples share one request; a big gap or the cap starts another; going back starts another', () => {
    expect(byteRuns(layout, 0, 6, 1024 * 1024, 8 * 1024 * 1024)).toEqual([
      { start: 100, end: 5150, from: 0, to: 4 },
      { start: 20_000_000, end: 30_000_000, from: 5, to: 5 },
      { start: 300, end: 310, from: 6, to: 6 },
    ]);
    expect(byteRuns(layout, 0, 4, 1000)).toEqual([
      { start: 100, end: 300, from: 0, to: 2 },
      { start: 5000, end: 5150, from: 3, to: 4 },
    ]);
    expect(byteRuns(layout, 0, 2, 1024, 150)).toEqual([
      { start: 100, end: 200, from: 0, to: 0 },
      { start: 200, end: 300, from: 1, to: 2 },
    ]);
  });
});

describe('which path, and what the sheet says', () => {
  const ok = { override: null, hasDecoder: true, indexFailure: null, configSupported: true } as const;

  it('the decoder where it can; seeking where it cannot, with the reason', () => {
    expect(choosePath(ok)).toEqual({ path: 'decoder', reason: null });
    expect(choosePath({ ...ok, override: 'seek' })).toEqual({ path: 'seek', reason: 'forced' });
    expect(choosePath({ ...ok, hasDecoder: false })).toEqual({ path: 'seek', reason: 'no-decoder' });
    expect(choosePath({ ...ok, indexFailure: 'not-mp4' })).toEqual({ path: 'seek', reason: 'container:not-mp4' });
    expect(choosePath({ ...ok, configSupported: false })).toEqual({ path: 'seek', reason: 'codec-unsupported' });
    expect(choosePath({ ...ok, override: 'decoder' })).toEqual({ path: 'decoder', reason: null });
  });

  it('the developer override is read from the address only as seek or decoder', () => {
    expect(exportPathOverride('seek')).toBe('seek');
    expect(exportPathOverride(['decoder', 'seek'])).toBe('decoder');
    expect(exportPathOverride('fast')).toBeNull();
    expect(exportPathOverride(undefined)).toBeNull();
  });

  it('"the window is covered, so it is slow" only while the seek path is making the picture', () => {
    expect(slowNotice(true, 'seek')).toBe(true);
    expect(slowNotice(true, 'decoder')).toBe(false);
    expect(slowNotice(false, 'seek')).toBe(false);
    expect(slowNotice(true, null)).toBe(false);
  });

  it('"a few frames may differ" for uneven footage only when it will be seeked', () => {
    expect(unevenWarning(true, 'seek')).toBe(true);
    expect(unevenWarning(true, null)).toBe(true);
    expect(unevenWarning(true, 'decoder')).toBe(false);
    expect(unevenWarning(false, 'seek')).toBe(false);
  });
});
