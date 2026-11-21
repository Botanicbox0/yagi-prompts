import { describe, expect, it } from 'vitest';
import { muxAvc1ToMp4 } from '@/lib/brand-studio/compose/mp4-muxer';
import { cutAnchor } from '@/lib/brand-studio/editor-v2/cut-anchor';
import { videoInfo } from '@/lib/brand-studio/files';
import {
  EXPORT_SAMPLE_RATE,
  MUX_TIMESCALE,
  audioPlan,
  captionsAt,
  filmSampleCount,
  frameDurationUs,
  imageOverlaysAt,
  isKeyFrame,
  muxTicks,
  notIncluded,
  soundSourceUrls,
  soundWindow,
  timestampUs,
  videoPlan,
  type AudioSegment,
} from '@/lib/brand-studio/editor-v2/export-plan';
import { FIXTURE_MATERIALS, clipOfMaterial, fixtureDoc, fixtureSequence } from '@/lib/brand-studio/editor-v2/fixture';
import {
  addCaption,
  frameStateAt,
  insertClips,
  moveClip,
  removeClips,
  setClipSpeed,
  spansOf,
  splitAtFrame,
  totalFrames,
  type FrameClip,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import type { ComposerProject } from '@/lib/brand-studio/compose/timeline';

/**
 * The export is planned before anything is drawn (docs/BRAND-EDITING-STUDIO-V2.md §5.1.5): frame N of
 * the file is the frame the timeline shows at N, at the film's own rate, and each cut's sound starts on
 * the sample that matches its first frame. These tests hold the plan to that.
 */

const clip = (id: string, sourceFrames: number, extra: Partial<FrameClip> = {}): FrameClip => ({
  id,
  label: id,
  srcUrl: `/reel/${id}.mp4`,
  thumbUrl: null,
  sourceFps: 24,
  sourceFrames,
  inFrame: 0,
  phase: 0,
  frames: sourceFrames,
  speedNum: 1,
  speedDen: 1,
  volume: 1,
  muted: false,
  ...extra,
});

/** A small deterministic generator, so a failure can be replayed. */
function rng(seed: number) {
  let state = seed % 2147483647 || 1;
  return (max: number) => {
    state = (state * 48271) % 2147483647;
    return state % max;
  };
}

const SPEEDS: ReadonlyArray<[number, number]> = [
  [1, 1],
  [1, 2],
  [3, 2],
  [2, 1],
];

/** A film with retimed cuts and a 30 fps clip in a 24 fps film. */
function mixedFilm(fps = 24): FrameSequence {
  let seq: FrameSequence = {
    fps,
    aspect: '16:9',
    clips: [
      clip('a', 113, { frames: 60 }),
      clip('b30', 147, { sourceFps: 30, inFrame: 6, frames: 50 }),
      clip('c', 240, { inFrame: 10, frames: 40 }),
      clip('d', 240, { inFrame: 100, frames: 30 }),
      clip('e', 240, { inFrame: 5, frames: 40 }),
    ],
    captions: [],
  };
  seq = setClipSpeed(seq, 2, 1, 2);
  seq = setClipSpeed(seq, 3, 3, 2);
  seq = setClipSpeed(seq, 4, 2, 1);
  return seq;
}

const pictures = (seq: FrameSequence) => videoPlan(seq).map((p) => `${p.srcUrl}@${p.sourceFrame}`);

describe('videoPlan: one entry per film frame, straight from the timeline', () => {
  const sequences: Array<[string, FrameSequence]> = [
    ['the sample film', fixtureSequence((id) => id)],
    ['a film with retimed cuts and a 30 fps clip', mixedFilm()],
  ];

  for (const [name, seq] of sequences) {
    it(`${name}: exactly totalFrames entries, entry i equals frameStateAt(i)`, () => {
      const plan = videoPlan(seq);
      expect(plan).toHaveLength(totalFrames(seq));
      plan.forEach((entry, i) => {
        const active = frameStateAt(seq, i).active!;
        expect(entry).toEqual({
          frame: i,
          clipId: active.clip.id,
          srcUrl: active.clip.srcUrl,
          sourceFrame: active.sourceFrame,
          mediaFrame: active.mediaFrame,
          seekSec: active.seekSec,
          sourceFps: active.clip.sourceFps,
        });
      });
    });
  }

  it('seeks to the middle of each source frame', () => {
    for (const entry of videoPlan(mixedFilm())) {
      expect(entry.seekSec).toBeCloseTo((entry.sourceFrame + 0.5) / entry.sourceFps, 12);
      expect(Number.isInteger(entry.sourceFrame)).toBe(true);
    }
  });

  it('a split anywhere leaves the list of pictures unchanged, and frames N−1, N are consecutive source frames at a 1× split', () => {
    const base = fixtureSequence((id) => id);
    const m7 = FIXTURE_MATERIALS.find((m) => m.id === 'm7')!;
    const seq = insertClips(base, base.clips.length, [clipOfMaterial(m7, 'm7', 'm7', 24, 0, 120)]);
    const before = pictures(seq);
    const total = totalFrames(seq);
    for (let at = 1; at < total; at += 1) {
      const split = splitAtFrame(seq, at, `cut-${at}`);
      expect(pictures(split)).toEqual(before);
      const plan = videoPlan(split);
      const left = plan[at - 1]!;
      const right = plan[at]!;
      if (left.srcUrl === right.srcUrl && frameStateAt(split, at).active!.offset === 0) {
        // The split landed inside one cut (not on an existing cut edge): the right piece continues the left.
        expect(right.sourceFrame).toBe(left.sourceFrame + 1);
      }
    }
  });

  it('a split at every frame of a film with retimed and other-rate cuts changes no picture (randomised order of splits)', () => {
    for (const seed of [3, 17, 101]) {
      const next = rng(seed);
      let seq = mixedFilm();
      const before = pictures(seq);
      const total = totalFrames(seq);
      const frames = Array.from({ length: total - 1 }, (_, i) => i + 1);
      for (let i = frames.length - 1; i > 0; i -= 1) {
        const j = next(i + 1);
        [frames[i], frames[j]] = [frames[j]!, frames[i]!];
      }
      frames.forEach((frame, n) => {
        seq = splitAtFrame(seq, frame, `s${seed}-${n}`);
      });
      expect(seq.clips).toHaveLength(total);
      expect(pictures(seq)).toEqual(before);
    }
  });

  it('a 30 fps clip in a 24 fps film skips one source frame in five', () => {
    const seq: FrameSequence = { fps: 24, aspect: '16:9', clips: [clip('x', 300, { sourceFps: 30, frames: 24 })], captions: [] };
    expect(videoPlan(seq).map((p) => p.sourceFrame)).toEqual(Array.from({ length: 24 }, (_, i) => Math.floor((i * 30) / 24)));
  });

  it('0.5× shows each source frame twice, 2× every other one', () => {
    let seq: FrameSequence = { fps: 24, aspect: '16:9', clips: [clip('h', 240, { inFrame: 10, frames: 6 }), clip('d', 240, { inFrame: 50, frames: 6 })], captions: [] };
    seq = setClipSpeed(seq, 0, 1, 2);
    seq = setClipSpeed(seq, 1, 2, 1);
    const plan = videoPlan(seq);
    const half = plan.filter((p) => p.clipId === 'h').map((p) => p.sourceFrame);
    const double = plan.filter((p) => p.clipId === 'd').map((p) => p.sourceFrame);
    expect(half).toEqual([10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15]);
    expect(double).toEqual([50, 52, 54]);
  });
});

describe('timestamps at the film rate', () => {
  for (const fps of [24, 25, 30, 50, 60]) {
    it(`${fps} fps: strictly increasing, durations add up exactly, whole 90 kHz ticks`, () => {
      const total = fps * 17 + 7;
      let sum = 0;
      let ticks = 0;
      for (let i = 0; i < total; i += 1) {
        if (i > 0) expect(timestampUs(i, fps)).toBeGreaterThan(timestampUs(i - 1, fps));
        const duration = frameDurationUs(i, fps);
        expect(duration).toBeGreaterThan(0);
        sum += duration;
        ticks += muxTicks(duration);
        // 90 000 / fps is a whole number for these rates and every frame lands on it.
        expect(muxTicks(duration)).toBe(MUX_TIMESCALE / fps);
      }
      expect(Number.isInteger(MUX_TIMESCALE / fps)).toBe(true);
      expect(timestampUs(total - 1, fps) + frameDurationUs(total - 1, fps)).toBe(Math.round((total * 1e6) / fps));
      expect(sum).toBe(Math.round((total * 1e6) / fps));
      expect(ticks).toBe((total * MUX_TIMESCALE) / fps);
    });
  }

  it('a key frame every second of film', () => {
    expect([0, 1, 23, 24, 25, 48].map((i) => isKeyFrame(i, 24))).toEqual([true, false, false, true, false, true]);
    expect([0, 29, 30, 60].map((i) => isKeyFrame(i, 30))).toEqual([true, false, true, true]);
  });

  it('the muxer writes the film rate exactly: one stts run of 90000/fps ticks, duration total/fps', () => {
    for (const fps of [24, 25, 30]) {
      const total = fps * 3 + 5;
      const sample = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, 0x00]);
      const mp4 = muxAvc1ToMp4({
        width: 1920,
        height: 1080,
        fps,
        videoSamples: Array.from({ length: total }, (_, i) => ({ data: sample, isKeyFrame: isKeyFrame(i, fps), durationUs: frameDurationUs(i, fps) })),
      });
      const buf = Buffer.from(mp4.buffer, mp4.byteOffset, mp4.byteLength);
      const at = buf.indexOf('stts', 0, 'latin1');
      expect(at).toBeGreaterThan(0);
      const entries = buf.readUInt32BE(at + 8);
      expect(entries).toBe(1);
      expect(buf.readUInt32BE(at + 12)).toBe(total);
      expect(buf.readUInt32BE(at + 16)).toBe(MUX_TIMESCALE / fps);
      expect(videoInfo(mp4)?.durationMs).toBe(Math.round((total * 1000) / fps));
    }
  });
});

describe('audioPlan: cuts tile the film sound to the sample', () => {
  const check = (seq: FrameSequence, sampleRate = EXPORT_SAMPLE_RATE) => {
    const plan = audioPlan(seq, sampleRate);
    const total = totalFrames(seq);
    expect(plan.totalSamples).toBe(Math.ceil((total * sampleRate) / seq.fps));
    expect(plan.segments).toHaveLength(seq.clips.length);
    let cursor = 0;
    plan.segments.forEach((segment, index) => {
      const span = spansOf(seq)[index]!;
      expect(Number.isInteger(segment.startSample)).toBe(true);
      expect(Number.isInteger(segment.sampleCount)).toBe(true);
      expect(segment.startSample).toBe(cursor);
      expect(segment.startSample).toBe(Math.round((span.start * sampleRate) / seq.fps));
      expect(segment.sampleCount).toBeGreaterThan(0);
      expect(segment.sourceOffsetSec).toBeCloseTo((span.clip.inFrame + span.clip.phase / span.clip.speedDen) / seq.fps, 12);
      expect(segment.rate).toBe(span.clip.speedNum / span.clip.speedDen);
      cursor += segment.sampleCount;
    });
    expect(cursor).toBe(plan.totalSamples);
    return plan;
  };

  it('the sample film: 2000 samples per frame at 24 fps', () => {
    const seq = fixtureSequence((id) => id);
    const plan = check(seq);
    expect(plan.totalSamples).toBe(totalFrames(seq) * 2000);
    expect(plan.segments.map((s) => s.startSample)).toEqual(spansOf(seq).map((span) => span.start * 2000));
  });

  it('randomised films at 24/25/30/50/60 fps, split at random frames, retimed, muted', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      const next = rng(fps * 7);
      let seq = mixedFilm(fps);
      for (let n = 0; n < 25; n += 1) seq = splitAtFrame(seq, 1 + next(totalFrames(seq) - 1), `r${fps}-${n}`);
      seq = { ...seq, clips: seq.clips.map((c, i) => (i % 4 === 0 ? { ...c, muted: true } : c)) };
      const plan = check(seq);
      plan.segments.forEach((segment, i) => expect(segment.gain).toBe(seq.clips[i]!.muted ? 0 : seq.clips[i]!.volume));
    }
  });

  it('an odd film rate still gives whole-sample boundaries with no gap or overlap', () => {
    const seq: FrameSequence = { fps: 23, aspect: '16:9', clips: [clip('a', 50, { frames: 7 }), clip('b', 50, { frames: 11 }), clip('c', 50, { frames: 5 })], captions: [] };
    check(seq);
    check(seq, 44_100);
  });

  it('a split keeps the sound continuous: the right piece reads on where the left stopped', () => {
    let seq = mixedFilm();
    const before = audioPlan(seq);
    seq = splitAtFrame(seq, 61 + 50 + 7, 'split-c');
    const after = audioPlan(seq);
    const left = after.segments[2]!;
    const right = after.segments[3]!;
    expect(left.startSample).toBe(before.segments[2]!.startSample);
    expect(left.startSample + left.sampleCount).toBe(right.startSample);
    // Where the left piece would be after its own samples, at its own speed.
    expect(right.sourceOffsetSec).toBeCloseTo(left.sourceOffsetSec + (left.sampleCount / EXPORT_SAMPLE_RATE) * left.rate, 9);
  });

  it('filmSampleCount matches the plan', () => {
    const seq = mixedFilm(30);
    expect(filmSampleCount(seq)).toBe(audioPlan(seq).totalSamples);
  });
});

describe('soundWindow', () => {
  const segment: AudioSegment = { clipId: 'a', srcUrl: '/a.mp4', startSample: 4000, sampleCount: 6000, sourceOffsetSec: 2, rate: 0.5, gain: 1 };

  it('without a shift it is the segment itself', () => {
    expect(soundWindow(segment, 20_000)).toEqual({ startSample: 4000, endSample: 10_000, sourceOffsetSec: 2 });
  });

  it('a stored sound offset moves the window by whole samples', () => {
    expect(soundWindow(segment, 20_000, EXPORT_SAMPLE_RATE, 0.0125)).toEqual({ startSample: 4600, endSample: 10_600, sourceOffsetSec: 2 });
  });

  it('what falls before the start is cut from the head, read on at the cut speed', () => {
    const w = soundWindow(segment, 20_000, EXPORT_SAMPLE_RATE, -0.125)!;
    expect(w.startSample).toBe(0);
    expect(w.endSample).toBe(4000);
    expect(w.sourceOffsetSec).toBeCloseTo(2 + (2000 / EXPORT_SAMPLE_RATE) * 0.5, 12);
  });

  it('what falls past the end is cut from the tail; nothing left gives null', () => {
    expect(soundWindow(segment, 8000)).toEqual({ startSample: 4000, endSample: 8000, sourceOffsetSec: 2 });
    expect(soundWindow(segment, 20_000, EXPORT_SAMPLE_RATE, -1)).toBeNull();
  });
});

describe('captions, overlays and what is not included', () => {
  it('captions on a frame come out in seconds, frame-exact', () => {
    const seq = addCaption(fixtureSequence((id) => id), { id: 'c1', text: '안녕하세요', start: 24, end: 48, position: 'bottom', size: 'md' });
    expect(captionsAt(seq, 23)).toEqual([]);
    expect(captionsAt(seq, 24)).toEqual([{ id: 'c1', text: '안녕하세요', startSec: 1, endSec: 2, position: 'bottom', size: 'md' }]);
    expect(captionsAt(seq, 47)).toHaveLength(1);
    expect(captionsAt(seq, 48)).toEqual([]);
  });

  const extras = (patch: Partial<ComposerProject>): ComposerProject => ({ version: 1, aspect: '16:9', clips: [], captions: [], bgm: null, ...patch });
  const overlay = (id: string, mediaKind: 'image' | 'video', startSec: number, endSec: number) => ({
    id,
    label: id,
    sourceKind: 'asset' as const,
    srcUrl: `/o/${id}`,
    mediaKind,
    startSec,
    endSec,
    x: 0.5,
    y: 0.5,
    scale: 0.4,
    opacity: 1,
  });

  it('still-image overlays are drawn on the frames whose time lies in [start, end]; moving ones are not', () => {
    const film = extras({ overlays: [overlay('i', 'image', 1, 2), overlay('v', 'video', 0, 5)] });
    // No cuts: stored seconds on the film's frames (cut-anchor.test.ts holds the mapping on cuts).
    const anchor = cutAnchor(film, { fps: 24, clips: [] });
    expect(imageOverlaysAt(film, 23, anchor)).toEqual([]);
    expect(imageOverlaysAt(film, 24, anchor).map((o) => o.id)).toEqual(['i']);
    expect(imageOverlaysAt(film, 48, anchor).map((o) => o.id)).toEqual(['i']);
    expect(imageOverlaysAt(film, 49, anchor)).toEqual([]);
    expect(imageOverlaysAt(null, 30, anchor)).toEqual([]);
  });

  it('names what the person set that the file will not carry', () => {
    const seq = fixtureSequence((id) => id);
    const doc = fixtureDoc((id) => id);
    expect(notIncluded({ sequence: seq, doc, extras: null })).toEqual([]);
    const busy = {
      ...doc,
      looks: { 'cut-1': { source: 'look' as const, lookId: 'warm' as const, detail: { exposure: 0.04, contrast: 0.06, temperature: 0.5, saturation: 0.1 }, strength: 1 } },
      titles: [{ id: 't', text: '제목', start: 0, end: 24, preset: 'big' as const }],
      music: { id: 't1', label: 'x', mood: 'y', durationSec: 60 },
      sound: { ...doc.sound, loudness: true },
    };
    const captioned = addCaption(seq, { id: 'c', text: '자막', start: 0, end: 10, position: 'bottom', size: 'md' });
    expect(notIncluded({ sequence: captioned, doc: busy })).toEqual(['looks', 'titles', 'music', 'soundFixes', 'captionLook']);
    expect(notIncluded({ sequence: captioned, doc: { ...doc, captionSettings: { ...doc.captionSettings, output: 'file' } } })).toEqual([]);
    const stored = extras({
      overlays: [overlay('v', 'video', 0, 1)],
      clips: [{ id: 'k', label: 'k', sourceKind: 'asset', srcUrl: '/k', durationSec: 5, trimStartSec: 0, trimEndSec: 5, volume: 1, muted: false, transitionIn: 'cross_dissolve' }],
    });
    expect(notIncluded({ sequence: seq, extras: stored })).toEqual(['videoOverlays', 'transitions']);
    expect(notIncluded({ sequence: seq, extras: extras({ overlays: [overlay('i', 'image', 0, 1)] }) })).toEqual([]);
  });

  it('sound is read only from the film’s own media', () => {
    const seq = fixtureSequence((id) => id);
    const urls = soundSourceUrls(seq, extras({ bgm: { label: 'm', sourceKind: 'asset', srcUrl: '/bgm', durationSec: 30, trimStartSec: 0, volume: 0.4 }, sfxClips: [{ id: 's', label: 's', sourceKind: 'asset', srcUrl: '/sfx', startSec: 0, durationSec: 1, volume: 1 }] }));
    expect([...urls].sort()).toEqual([...new Set([...seq.clips.map((c) => c.srcUrl), '/bgm', '/sfx'])].sort());
    expect([...soundSourceUrls(seq)].sort()).toEqual([...new Set(seq.clips.map((c) => c.srcUrl))].sort());
  });
});

describe('the edited film the real-screen check exports', () => {
  it('pictures follow the edits: split, delete, 0.5×, 2×, move', () => {
    const base = fixtureSequence((id) => id);
    const m7 = FIXTURE_MATERIALS.find((m) => m.id === 'm7')!;
    let seq = insertClips(base, base.clips.length, [clipOfMaterial(m7, 'm7', 'm7', 24, 0, 120)]);
    const start = totalFrames(base);
    seq = splitAtFrame(seq, start + 30, 'p2');
    seq = splitAtFrame(seq, start + 60, 'p3');
    seq = splitAtFrame(seq, start + 90, 'p4');
    seq = removeClips(seq, ['p2']);
    seq = setClipSpeed(seq, seq.clips.findIndex((c) => c.id === 'p3'), 1, 2);
    seq = setClipSpeed(seq, seq.clips.findIndex((c) => c.id === 'p4'), 2, 1);
    seq = moveClip(seq, seq.clips.findIndex((c) => c.id === 'p4'), seq.clips.findIndex((c) => c.id === 'm7'));
    const shown = videoPlan(seq).filter((p) => p.srcUrl === m7.src).map((p) => p.sourceFrame);
    const range = (from: number, to: number, step = 1) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);
    expect(shown).toEqual([...range(90, 120, 2), ...range(0, 30), ...range(60, 90).flatMap((n) => [n, n])]);
  });
});
