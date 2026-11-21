import { describe, expect, it } from 'vitest';
import { gatherBoxes, readTiming, timingOfFile, type ByteSource, type SoundTiming } from '@/lib/brand-studio/editor-v2/container';
import { concat, ftyp, mdat, moof, moov, runs, wide, type TrackSpec } from './mp4-bytes';

/**
 * Spec E, items C1 and B1: what an MP4 / MOV file states about its own timing, read from its boxes.
 * The frame facts (rate, frame count, even spacing, first frame) replace measuring by playback, which
 * fails in a covered window; the two tracks' start times place the sound under the picture.
 *
 * Every number is checked against what ffprobe and Chromium reported for files ffmpeg wrote with the
 * same layout (scripts/editor-v2-sound-sync-check.py and scripts/editor-v2-covered-window-check.py
 * print the table for real files).
 */
const frames = (n: number, d: number) => Array.from({ length: n }, () => d);

/**
 * Composition offsets of x264's B-pyramid (three B-frames), in decode order: I0 P4 B2 B1 B3 P8 B6 B5 B7 …,
 * each frame shown two frames after its decode time at the earliest (the offset ffmpeg's edit list removes).
 */
function pyramidOffsets(n: number, d: number): number[] {
  const shown: number[] = [0];
  for (let k = 1; shown.length < n; k += 4) {
    const group = k + 3 < n ? [k + 3, k + 1, k, k + 2] : Array.from({ length: n - k }, (_, j) => k + j);
    shown.push(...group);
  }
  return shown.slice(0, n).map((p, i) => (p + 2 - i) * d);
}

const VIDEO_24: TrackSpec = { handler: 'vide', timescale: 12288, durations: frames(72, 512) };
const SOUND: TrackSpec = { handler: 'soun', timescale: 48000, durations: frames(141, 1024) };

function file(...tracks: TrackSpec[]): Uint8Array {
  return concat(ftyp(), moov({ tracks }), mdat(64));
}

describe('frame facts from the sample table (C1)', () => {
  it('a plain 24 fps file: 72 frames, an exact rate, evenly spaced, first frame at 0', async () => {
    const answer = await timingOfFile(file(VIDEO_24, SOUND));
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.timing.video).toEqual({ firstSec: 0, frames: 72, fps: 24, fpsNum: 24, fpsDen: 1, variable: false, timescale: 12288 });
    expect(answer.timing.sound).toEqual({ firstSec: 0 });
    expect(answer.timing.fragmented).toBe(false);
  });

  it('24000/1001 comes out as 23.976…, not 24', async () => {
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 24000, durations: frames(48, 1001) }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.fpsNum / answer.timing.video!.fpsDen).toBe(24000 / 1001);
    expect(answer.timing.video!.fps).toBeCloseTo(23.976024, 6);
  });

  it.each([
    [25, 12800, 512],
    [30, 15360, 512],
    [60, 15360, 256],
    [29.97, 30000, 1001],
  ])('%s fps (time scale %i, %i per frame)', async (fps, timescale, d) => {
    const answer = await timingOfFile(file({ handler: 'vide', timescale, durations: frames(90, d) }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.fps).toBeCloseTo(fps === 29.97 ? 30000 / 1001 : fps, 9);
    expect(answer.timing.video!.frames).toBe(90);
    expect(answer.timing.video!.variable).toBe(false);
  });

  it('a millisecond time scale that cannot hold 29.97 (33, 33, 34 …) is still even: one tick of rounding', async () => {
    // 30000/1001 fps on a 1/1000 s clock: each frame starts at round(k × 1001 / 30) ms.
    const starts = Array.from({ length: 301 }, (_, k) => Math.round((k * 1001) / 30));
    const durations = starts.slice(1).map((t, k) => t - starts[k]!);
    expect(new Set(durations).size).toBe(2);
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 1000, durations }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.variable).toBe(false);
    expect(answer.timing.video!.fps).toBe(30000 / 1001);
  });

  it('the usual odd last sample does not make a file variable, nor change its rate', async () => {
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: [...frames(47, 512), 100] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video).toMatchObject({ frames: 48, fps: 24, variable: false });
  });

  it('frames at 1/24 s next to frames at 1/30 s: variable', async () => {
    const durations = [...frames(30, 512), ...frames(30, 410), ...frames(30, 512)];
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.variable).toBe(true);
    // The average rate: frames over their duration.
    expect(answer.timing.video!.fps).toBeCloseTo((90 * 12288) / (60 * 512 + 30 * 410), 9);
  });

  it('a missing frame (one gap of two frames) is not evenly spaced: frame k is no longer at k / rate', async () => {
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: [...frames(20, 512), 1024, ...frames(20, 512)] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.variable).toBe(true);
  });

  it('B-frames: the first frame shown is the smallest composition time; an edit list brings it to 0', async () => {
    const offsets = pyramidOffsets(48, 512);
    expect(Math.min(...offsets)).toBe(0);
    const bare = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: frames(48, 512), offsets }));
    if (!bare.ok) throw new Error(bare.reason);
    expect(bare.timing.video!.firstSec).toBeCloseTo(1024 / 12288, 12); // 0.083333: ffprobe and Chromium say the same
    expect(bare.timing.video!.frames).toBe(48);
    const edited = await timingOfFile(
      file({ handler: 'vide', timescale: 12288, durations: frames(48, 512), offsets, edits: [{ duration: 2000, mediaTime: 1024 }] }),
    );
    if (!edited.ok) throw new Error(edited.reason);
    expect(edited.timing.video!.firstSec).toBe(0);
    expect(edited.timing.video!.frames).toBe(48);
  });

  it('ctts version 1 (signed offsets): the first frame can start before its decode time', async () => {
    // The same pyramid written the other way: the key frame at its decode time, B-frames before theirs.
    const offsets = pyramidOffsets(24, 512).map((o) => o - 1024);
    expect(Math.min(...offsets)).toBeLessThan(0);
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: frames(24, 512), offsets, cttsVersion: 1 }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video).toMatchObject({ firstSec: 0, frames: 24, fps: 24, variable: false });
  });

  it('an edit list that trims leading frames: only the frames inside the edit are counted, the first of them at 0', async () => {
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: frames(72, 512), edits: [{ duration: 2500, mediaTime: 12 * 512 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    // 2.5 s of a 1000-tick movie clock from frame 12 on: frames 12 … 71 (60 frames), the first shown at 0.
    expect(answer.timing.video).toMatchObject({ firstSec: 0, frames: 60, fps: 24 });
  });

  it('an edit list starting between two frames (ffmpeg -ss 0.3 -c copy): the next frame is the first, shown at 0', async () => {
    // ffmpeg wrote media time 3686 (0.3 s) over frames 512 ticks apart: frames 0–7 are decoded only.
    // Chromium shows frame 8 at mediaTime 0 and its last frame is 55; ffprobe: start_time 0, 48 frames read.
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: frames(56, 512), edits: [{ duration: 2034, mediaTime: 3686 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video).toMatchObject({ firstSec: 0, frames: 48, fps: 24, variable: false });
  });

  it('an edit starting two frames before the first picture: the first picture still shows at the edit’s start', async () => {
    // Measured (review round 1 of part E, sound case (a)): x264 B-frames with the picture's edit moved from
    // media time 1024 to 0. Chromium's first frame mediaTime is 0 and ffprobe's start_time is 0 (it shows
    // packet times 0, 0.0417 …): the gap before the first picture is not kept. The edit's length (3 s from
    // media time 0) ends two frames earlier: ffprobe decodes 70 of the 72 pictures, and so does this.
    const offsets = pyramidOffsets(72, 512);
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: frames(72, 512), offsets, edits: [{ duration: 3000, mediaTime: 0 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video).toMatchObject({ firstSec: 0, frames: 70, fps: 24 });
  });

  it('an edit list that ends early: frames past its end are not shown', async () => {
    const answer = await timingOfFile(file({ handler: 'vide', timescale: 12288, durations: frames(72, 512), edits: [{ duration: 1000, mediaTime: 0 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.frames).toBe(24);
  });

  it('64-bit boxes (mdhd and elst version 1) read the same', async () => {
    const answer = await timingOfFile(file({ ...VIDEO_24, wide: true, edits: [{ duration: 0, mediaTime: 0 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video).toMatchObject({ firstSec: 0, frames: 72, fps: 24 });
  });
});

describe('the two tracks’ start times (B1): the edit list applied, as ffprobe and Chromium read them', () => {
  it('sound with an encoder delay (media time 1024) starts at 0: the delay is not played', async () => {
    const answer = await timingOfFile(file(VIDEO_24, { ...SOUND, edits: [{ duration: 3000, mediaTime: 1024 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect((answer.timing.sound as SoundTiming).firstSec).toBe(0);
  });

  it('picture behind an empty edit of 0.5 s starts at 0.5 s; the sound at 0', async () => {
    const answer = await timingOfFile(
      file({ ...VIDEO_24, edits: [{ duration: 500, mediaTime: -1 }, { duration: 3000, mediaTime: 0 }] }, { ...SOUND, edits: [{ duration: 3000, mediaTime: 1024 }] }),
    );
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.firstSec).toBe(0.5);
    expect((answer.timing.sound as SoundTiming).firstSec).toBe(0);
  });

  it('sound behind an empty edit starts at the edit (ffmpeg writes 0.478 s for "0.5 s minus the encoder delay")', async () => {
    const answer = await timingOfFile(file(VIDEO_24, { ...SOUND, edits: [{ duration: 478, mediaTime: -1 }, { duration: 3000, mediaTime: 0 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect((answer.timing.sound as SoundTiming).firstSec).toBe(0.478);
  });

  it('an empty edit and a media time together: the edit’s start', async () => {
    const answer = await timingOfFile(file(VIDEO_24, { ...SOUND, edits: [{ duration: 300, mediaTime: -1 }, { duration: 3000, mediaTime: 1024 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect((answer.timing.sound as SoundTiming).firstSec).toBe(0.3);
  });

  it('no edit list: the first sample’s own time', async () => {
    const answer = await timingOfFile(file(VIDEO_24, SOUND));
    if (!answer.ok) throw new Error(answer.reason);
    expect((answer.timing.sound as SoundTiming).firstSec).toBe(0);
  });

  it('a file with only a picture, or only sound', async () => {
    const picture = await timingOfFile(file(VIDEO_24));
    const sound = await timingOfFile(file(SOUND));
    expect(picture.ok && picture.timing.sound).toBe(null);
    expect(sound.ok && sound.timing.video).toBe(null);
  });
});

describe('fragmented files: the fragments’ own tables', () => {
  const movie = moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [] }, { handler: 'soun', timescale: 48000, durations: [] }], fragmented: { defaultDuration: { 1: 512, 2: 1024 } } });

  it('frames add up over the fragments; the first frame’s time comes from tfdt and its offset', async () => {
    const offsets = pyramidOffsets(24, 512);
    const bytes = concat(
      ftyp('iso5'),
      movie,
      moof(1, [{ trackId: 1, base: 0, count: 24, offsets }, { trackId: 2, base: 0, count: 47 }]),
      mdat(64),
      moof(2, [{ trackId: 1, count: 24, durations: frames(24, 512), offsets }, { trackId: 2, base: 47 * 1024, count: 47, defaultDuration: 1024 }]),
      mdat(64),
    );
    const answer = await timingOfFile(bytes);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.fragmented).toBe(true);
    expect(answer.timing.video).toEqual({ firstSec: 1024 / 12288, frames: 48, fps: 24, fpsNum: 24, fpsDen: 1, variable: false, timescale: 12288 });
    expect(answer.timing.sound).toEqual({ firstSec: 0 });
  });

  it('a fragment that starts later (tfdt, 64-bit) and signed offsets (trun version 1)', async () => {
    const bytes = concat(
      movie,
      moof(1, [{ trackId: 1, base: 6144, count: 12, offsets: pyramidOffsets(12, 512).map((o) => o - 1024), trunVersion: 1, wide: true }]),
      mdat(8),
    );
    const answer = await timingOfFile(bytes);
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video!.firstSec).toBe(0.5);
    expect(answer.timing.video!.frames).toBe(12);
  });

  it('spec G, B4: negative offsets written into a version 0 trun are read signed, as version 1 and ctts version 0 are', async () => {
    // The first sample is shown 1024 ticks before its decode time.
    const timing = async (trunVersion: 0 | 1) => {
      const bytes = concat(movie, moof(1, [{ trackId: 1, base: 6144, count: 12, offsets: pyramidOffsets(12, 512).map((o) => o - 2048), trunVersion, wide: true }]), mdat(8));
      const answer = await timingOfFile(bytes);
      if (!answer.ok) throw new Error(answer.reason);
      return answer.timing.video!;
    };
    const signed = await timing(1);
    expect(signed.firstSec).toBeCloseTo((6144 - 1024) / 12288, 9);
    expect(await timing(0)).toEqual(signed);
  });
});

describe('what the reader refuses (the editor then measures by playback, and the export says the sound could not be placed)', () => {
  it('not an MP4 or MOV (WebM)', async () => {
    expect(await timingOfFile(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0))).toEqual({ ok: false, reason: 'not-mp4' });
  });

  it('a file cut off inside its moov', async () => {
    const whole = file(VIDEO_24, SOUND);
    expect(await timingOfFile(whole.subarray(0, 120))).toEqual({ ok: false, reason: 'broken' });
  });

  it('no moov at all', async () => {
    expect(await timingOfFile(concat(ftyp(), mdat(16)))).toEqual({ ok: false, reason: 'no-moov' });
  });

  it('edit lists the export cannot follow: two pieces of media, or a changed speed', async () => {
    const twoPieces = file({ ...VIDEO_24, edits: [{ duration: 500, mediaTime: 0 }, { duration: 500, mediaTime: 6144 }] });
    const faster = file({ ...VIDEO_24, edits: [{ duration: 1000, mediaTime: 0, rate: 2 }] });
    expect(await timingOfFile(twoPieces)).toEqual({ ok: false, reason: 'edits' });
    expect(await timingOfFile(faster)).toEqual({ ok: false, reason: 'edits' });
  });

  it('a sound edit list it cannot follow keeps the picture facts; the sound start is unknown (review round 1 of part E, item 3)', async () => {
    const answer = await timingOfFile(file(VIDEO_24, { ...SOUND, edits: [{ duration: 500, mediaTime: 0 }, { duration: 500, mediaTime: 48000 }] }));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video).toMatchObject({ firstSec: 0, frames: 72, fps: 24 });
    expect(answer.timing.sound).toBe('unknown');
    // A picture edit list it cannot follow still fails the whole answer: frame numbering would be unsafe.
    expect(await timingOfFile(file({ ...VIDEO_24, edits: [{ duration: 1000, mediaTime: 0, rate: 2 }] }, SOUND))).toEqual({ ok: false, reason: 'edits' });
  });
});

describe('MOV (QuickTime) is the same layout', () => {
  it('a wide box first, the qt brand', async () => {
    const answer = await timingOfFile(concat(ftyp('qt  '), wide(), mdat(32), moov({ tracks: [VIDEO_24, { ...SOUND, edits: [{ duration: 3000, mediaTime: 1024 }] }] })));
    if (!answer.ok) throw new Error(answer.reason);
    expect(answer.timing.video).toMatchObject({ firstSec: 0, frames: 72, fps: 24 });
    expect(answer.timing.sound).toEqual({ firstSec: 0 });
  });
});

describe('finding the boxes without the whole file (Range requests)', () => {
  /** A file read through ranges: records every request. */
  function rangedSource(bytes: Uint8Array): ByteSource & { reads: Array<[number, number]> } {
    const reads: Array<[number, number]> = [];
    return {
      reads,
      async read(start, length) {
        reads.push([start, length]);
        return bytes.subarray(start, Math.min(bytes.length, start + length));
      },
    };
  }

  it('moov first (fast start): one look at the head, then the moov', async () => {
    const bytes = concat(ftyp(), moov({ tracks: [VIDEO_24, SOUND] }), mdat(5_000_000));
    const source = rangedSource(bytes);
    const found = await gatherBoxes(source);
    if ('failure' in found) throw new Error(found.failure);
    expect(readTiming(found).ok).toBe(true);
    // Nothing of the media data is asked for.
    expect(source.reads.every(([start, length]) => start + length <= bytes.length - 5_000_000 + 16)).toBe(true);
  });

  it('moov at the end: the mdat is stepped over by its size, the moov fetched from the tail', async () => {
    const head = concat(ftyp(), mdat(5_000_000));
    const bytes = concat(head, moov({ tracks: [VIDEO_24, SOUND] }));
    const source = rangedSource(bytes);
    const found = await gatherBoxes(source);
    if ('failure' in found) throw new Error(found.failure);
    expect(readTiming(found)).toEqual(await timingOfFile(bytes));
    expect(source.reads.some(([start]) => start === head.length)).toBe(true);
    const asked = source.reads.reduce((n, [, length]) => n + length, 0);
    expect(asked).toBeLessThan(10_000);
  });

  it('a 64-bit mdat size is stepped over too', async () => {
    const big = concat(Uint8Array.of(0, 0, 0, 1), Uint8Array.from('mdat', (c) => c.charCodeAt(0)), Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 16 + 32), new Uint8Array(32));
    const bytes = concat(ftyp(), big, moov({ tracks: [VIDEO_24] }));
    const found = await gatherBoxes(rangedSource(bytes));
    if ('failure' in found) throw new Error(found.failure);
    expect(readTiming(found).ok).toBe(true);
  });

  it('fragmented: the rest after the moov is read in one piece and every moof in it is found (review round 1 of part E, item 10)', async () => {
    const movie = moov({ tracks: [{ handler: 'vide', timescale: 12288, durations: [] }], fragmented: { defaultDuration: { 1: 512 } } });
    const bytes = concat(ftyp('iso5'), movie, moof(1, [{ trackId: 1, base: 0, count: 24 }]), mdat(400_000), moof(2, [{ trackId: 1, count: 24 }]), mdat(400_000));
    const source = { ...rangedSource(bytes), size: () => bytes.length };
    const found = await gatherBoxes(source);
    if ('failure' in found) throw new Error(found.failure);
    expect(found.moofs).toHaveLength(2);
    const answer = readTiming(found);
    expect(answer.ok && answer.timing.video!.frames).toBe(48);
    // Its size not known: not walked fragment by fragment, measured by playback instead.
    expect(await gatherBoxes(rangedSource(bytes))).toEqual({ failure: 'fragmented-too-large' });
  });

  it('a file whose first box is not one an MP4 starts with is refused at once', async () => {
    const found = await gatherBoxes(rangedSource(Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0, 0, 0, 0, 0, 0, 0)));
    expect(found).toEqual({ failure: 'not-mp4' });
  });

  it('runs() is the table the builder writes', async () => {
    expect(runs([1, 1, 2, 2, 2, 1])).toEqual([[2, 1], [3, 2], [1, 1]]);
  });
});

describe('the rate of footage on a clock that rounds each frame (review round 1 of part E, item 2)', () => {
  /** Durations of `n` frames at `num/den` fps written on a clock of `tick` ticks per second, each frame's time rounded. */
  const rounded = (n: number, num: number, den: number, tick: number, scale = 1) => {
    const starts = Array.from({ length: n + 1 }, (_, k) => Math.round((k * den * tick) / num) * scale);
    return starts.slice(1).map((t, k) => t - starts[k]!);
  };
  const rateOf = async (durations: number[], timescale: number) => {
    const answer = await timingOfFile(file({ handler: 'vide', timescale, durations }));
    if (!answer.ok) throw new Error(answer.reason);
    return answer.timing.video!;
  };

  it.each([10, 11, 24, 100, 997, 2000])('24 fps on a millisecond clock, %i frames: 24/1, never 24000/1001', async (n) => {
    const video = await rateOf(rounded(n, 24, 1, 1000), 1000);
    expect([video.fpsNum, video.fpsDen]).toEqual([24, 1]);
    expect(video.variable).toBe(false);
  });

  it.each([10, 11, 100, 997, 2000])('30 and 60 fps on a millisecond clock, %i frames', async (n) => {
    const thirty = await rateOf(rounded(n, 30, 1, 1000), 1000);
    const sixty = await rateOf(rounded(n, 60, 1, 1000), 1000);
    expect([thirty.fpsNum, thirty.fpsDen, thirty.variable]).toEqual([30, 1, false]);
    expect([sixty.fpsNum, sixty.fpsDen, sixty.variable]).toEqual([60, 1, false]);
  });

  it('true 23.976 on a millisecond clock, long enough to tell: 24000/1001', async () => {
    const video = await rateOf(rounded(600, 24000, 1001, 1000), 1000);
    expect([video.fpsNum, video.fpsDen, video.variable]).toEqual([24000, 1001, false]);
  });

  it('twelve frames: both 24 and 23.976 fit a millisecond clock; the one that fits best (nearest the average) is taken', async () => {
    // Over 12 frames the two rates are 0.46 ms apart at the last frame, less than the clock's rounding:
    // from so few frames the file cannot say which it is. Each answer is the rate that fits its times best.
    expect((await rateOf(rounded(12, 24, 1, 1000), 1000)).fpsNum).toBe(24);
    expect((await rateOf(rounded(12, 24000, 1001, 1000), 1000)).fpsNum).toBe(24000);
  });

  it('millisecond footage remuxed onto a 1/16000 clock (656 and 672 ticks): even, 24/1', async () => {
    const durations = rounded(500, 24, 1, 1000, 16);
    expect(new Set(durations)).toEqual(new Set([656, 672]));
    const video = await rateOf(durations, 16000);
    expect([video.fpsNum, video.fpsDen, video.variable]).toEqual([24, 1, false]);
  });

  it('real variable footage and a dropped frame on a millisecond clock stay variable', async () => {
    const mixed = [...rounded(48, 24, 1, 1000), ...rounded(60, 30, 1, 1000)];
    expect((await rateOf(mixed, 1000)).variable).toBe(true);
    const dropped = rounded(100, 24, 1, 1000);
    dropped[50] = dropped[50]! + dropped[51]!;
    dropped.splice(51, 1);
    expect((await rateOf(dropped, 1000)).variable).toBe(true);
  });
});
