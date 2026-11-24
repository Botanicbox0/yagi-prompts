import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURE_MATERIALS } from '@/lib/brand-studio/editor-v2/fixture';
import { soundTrackOf } from '@/lib/brand-studio/editor-v2/media-probe';
import { setClipAudio, setClipConstantSpeed, setClipSpeedCurve, splitAtFrame, trimClipEdge, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import {
  PREVIEW_RATE_RANGE,
  SOUND_MARGIN_FLOOR_SEC,
  cutOffsetAt,
  frameGaps,
  previewSound,
  soundLeftSec,
  soundMarginSec,
  soundRunsOn,
  type PreviewSoundInput,
} from '@/lib/brand-studio/editor-v2/preview-sound';
import { SPEED_PRESETS } from '@/lib/brand-studio/editor-v2/speed-curve';

/**
 * Audit A1 (2026-11-24): the new editor's preview never played a cut's own sound — its one <video> was
 * always muted. The preview now lets the cut on screen be heard while the film plays forward, at the
 * cut's own volume, and keeps it silent everywhere else. These are the decision's rules, as a pure
 * function of what the play loop knows on each animation frame (preview.tsx → play-forward.ts).
 */

const heard: PreviewSoundInput = {
  playing: true,
  gesture: true,
  refused: false,
  hidden: false,
  seeking: false,
  replay: false,
  cutChange: false,
  volume: 0.6,
  muted: false,
  shifted: false,
  rate: 1,
  soundTrack: null,
};

function clip(overrides: Partial<FrameClip> = {}): FrameClip {
  return {
    id: 'cut-1',
    label: 'Scene 1',
    srcUrl: '/media/a.mp4',
    thumbUrl: null,
    sourceFps: 24,
    sourceFrames: 480,
    inFrame: 0,
    phase: 0,
    frames: 96,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function seq(clips: FrameClip[]): FrameSequence {
  return { fps: 24, aspect: '9:16', clips, captions: [] };
}

describe('previewSound: when the cut on screen is heard', () => {
  it('playing forward after the person started it: heard at the cut’s own volume', () => {
    expect(previewSound(heard)).toEqual({ muted: false, volume: 0.6, why: null });
    expect(previewSound({ ...heard, volume: 1 })).toEqual({ muted: false, volume: 1, why: null });
  });

  it('nothing while stopped (paused, scrubbing, stepping frames, shuttling back): the stop wins over everything', () => {
    expect(previewSound({ ...heard, playing: false })).toMatchObject({ muted: true, why: 'stopped' });
    expect(previewSound({ ...heard, playing: false, seeking: true, muted: true, gesture: false })).toMatchObject({ muted: true, why: 'stopped' });
  });

  it('a muted cut, or one at 0, stays silent; the element keeps the cut’s volume so unmuting needs no second write', () => {
    expect(previewSound({ ...heard, muted: true })).toEqual({ muted: true, volume: 0.6, why: 'cut-muted' });
    expect(previewSound({ ...heard, volume: 0 })).toEqual({ muted: true, volume: 0, why: 'cut-muted' });
  });

  it('not before the person has used the page (the browser would refuse to play with sound), nor after the browser refused once', () => {
    expect(previewSound({ ...heard, gesture: false })).toMatchObject({ muted: true, why: 'no-gesture' });
    expect(previewSound({ ...heard, refused: true })).toMatchObject({ muted: true, why: 'refused' });
  });

  it('not while the page is hidden (the play loop does not run there, so it cannot keep the sound on its cut)', () => {
    expect(previewSound({ ...heard, hidden: true })).toMatchObject({ muted: true, why: 'hidden' });
  });

  it('not during the seeks the preview makes to stay in step, nor across a cut change it cannot follow in time', () => {
    expect(previewSound({ ...heard, seeking: true })).toMatchObject({ muted: true, why: 'seeking' });
    expect(previewSound({ ...heard, cutChange: true })).toMatchObject({ muted: true, why: 'cut-change' });
  });

  it('not while the element replays what was just heard (the shuttle speed changed and the loop stepped back to the playhead)', () => {
    expect(previewSound({ ...heard, replay: true })).toMatchObject({ muted: true, why: 'replay' });
  });

  it('a cut whose sound the stored film moves (the current editor’s sound offset): the file has it elsewhere, so the preview stays silent', () => {
    expect(previewSound({ ...heard, shifted: true })).toEqual({ muted: true, volume: 0.6, why: 'shifted' });
  });

  it('a file with no sound track: muted (nothing to hear, and the file has none either); unknown is treated as maybe', () => {
    expect(previewSound({ ...heard, soundTrack: false })).toMatchObject({ muted: true, why: 'no-track' });
    expect(previewSound({ ...heard, soundTrack: true })).toMatchObject({ muted: false, why: null });
    expect(previewSound({ ...heard, soundTrack: null })).toMatchObject({ muted: false, why: null });
  });

  it('every speed the element is given is heard (0.10× and 10× included): Chromium sounds across its whole 0.0625–16 range', () => {
    for (const rate of [0.1, 0.25, 0.5, 2, 4, 10, PREVIEW_RATE_RANGE.min, PREVIEW_RATE_RANGE.max]) {
      expect(previewSound({ ...heard, rate })).toMatchObject({ muted: false, why: null });
    }
    for (const rate of [0.05, 16.5, 0, Number.NaN]) {
      expect(previewSound({ ...heard, rate })).toMatchObject({ muted: true, why: 'rate' });
    }
  });

  it('the volume the element gets is always a valid element volume', () => {
    expect(previewSound({ ...heard, volume: 1.4 }).volume).toBe(1);
    expect(previewSound({ ...heard, volume: -0.2 })).toEqual({ muted: true, volume: 0, why: 'cut-muted' });
    expect(previewSound({ ...heard, volume: Number.NaN })).toEqual({ muted: true, volume: 0, why: 'cut-muted' });
  });
});

describe('soundRunsOn: the element runs from one cut into the next without a seek and at the same loudness', () => {
  it('a cut split in two runs on; the last cut runs on into nothing', () => {
    const split = splitAtFrame(seq([clip()]), 40, 'cut-2');
    expect(soundRunsOn(split.clips[0]!, split.clips[1])).toBe(true);
    expect(soundRunsOn(split.clips[1]!, undefined)).toBe(false);
  });

  it('a split cut at 0.5×, and a split speed curve, still run on', () => {
    const half = splitAtFrame(setClipConstantSpeed(seq([clip()]), 0, 0.5), 41, 'cut-2');
    expect(soundRunsOn(half.clips[0]!, half.clips[1])).toBe(true);
    const curved = splitAtFrame(setClipSpeedCurve(seq([clip({ frames: 120 })]), 0, SPEED_PRESETS[0]!.points), 37, 'cut-2');
    expect(curved.clips[0]!.speedCurve).toBeDefined();
    expect(soundRunsOn(curved.clips[0]!, curved.clips[1])).toBe(true);
  });

  it('a different loudness on the second half does not run on: the change is a cut change', () => {
    const split = splitAtFrame(seq([clip()]), 40, 'cut-2');
    expect(soundRunsOn(split.clips[0]!, setClipAudio(split, 1, 0.3, false).clips[1])).toBe(false);
    expect(soundRunsOn(split.clips[0]!, setClipAudio(split, 1, 1, true).clips[1])).toBe(false);
    // Both silent: nothing changes in what is heard.
    const quiet = setClipAudio(setClipAudio(split, 0, 1, true), 1, 0.4, true);
    expect(soundRunsOn(quiet.clips[0]!, quiet.clips[1])).toBe(true);
  });

  it('another file, or the same file from a later point, does not run on', () => {
    const split = splitAtFrame(seq([clip()]), 40, 'cut-2');
    expect(soundRunsOn(split.clips[0]!, { ...split.clips[1]!, srcUrl: '/media/b.mp4' })).toBe(false);
    const trimmed = trimClipEdge(split, 1, 'start', 6).seq;
    expect(trimmed.clips[1]!.inFrame).toBeGreaterThan(split.clips[1]!.inFrame);
    expect(soundRunsOn(trimmed.clips[0]!, trimmed.clips[1])).toBe(false);
  });
});

describe('the sample film (?sample=1)', () => {
  it('its footage has no sound track, as the preview and the cut panel say (read from each file’s own boxes)', () => {
    expect(FIXTURE_MATERIALS.length).toBeGreaterThan(0);
    for (const material of FIXTURE_MATERIALS) {
      const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'public', material.src)));
      expect([material.src, soundTrackOf(bytes)]).toEqual([material.src, 'no']);
    }
  });
});

describe('soundLeftSec: how long the sound heard now may go on, through the cuts it runs on into', () => {
  it('the time left in a cut runs at the film’s rate and the shuttle’s; past its end it is negative', () => {
    const film = seq([clip({ frames: 48 })]);
    // Media position = film-grid frame of the element (currentTime × fps).
    expect(soundLeftSec(film.clips, 0, 24, 24, 1)).toBeCloseTo(1, 9);
    expect(soundLeftSec(film.clips, 0, 24, 24, 2)).toBeCloseTo(0.5, 9);
    expect(soundLeftSec(film.clips, 0, 48, 24, 1)).toBeCloseTo(0, 9);
    expect(soundLeftSec(film.clips, 0, 50, 24, 1)).toBeLessThan(0);
  });

  it('a cut at a speed: its own mapping (0.5× plays 24 media frames in 48 film frames)', () => {
    const half = setClipConstantSpeed(seq([clip({ frames: 48 })]), 0, 0.5);
    expect(half.clips[0]!.frames).toBe(96);
    expect(cutOffsetAt(half.clips[0]!, 12)).toBeCloseTo(24, 9);
    expect(soundLeftSec(half.clips, 0, 12, 24, 1)).toBeCloseTo(3, 9);
  });

  it('a split cut runs on: the time left reaches to the end of the second piece, and stays right once the element is in it', () => {
    const split = splitAtFrame(seq([clip({ frames: 96 })]), 40, 'cut-2');
    expect(soundLeftSec(split.clips, 0, 30, 24, 1)).toBeCloseTo(66 / 24, 9);
    // The loop still on the first piece while the element is already 2 frames into the second.
    expect(soundLeftSec(split.clips, 0, 42, 24, 1)).toBeCloseTo(54 / 24, 9);
    // Past both pieces (back from a hidden tab): negative, not the second piece's length.
    expect(soundLeftSec(split.clips, 0, 120, 24, 1)).toBeLessThan(0);
  });

  it('another file after the cut, or another loudness: the time left ends with the cut', () => {
    const split = splitAtFrame(seq([clip({ frames: 96 })]), 40, 'cut-2');
    const louder = setClipAudio(split, 1, 0.3, false);
    expect(soundLeftSec(louder.clips, 0, 30, 24, 1)).toBeCloseTo(10 / 24, 9);
    expect(soundLeftSec(louder.clips, 0, 42, 24, 1)).toBeLessThan(0);
  });

  it('a speed curve: the offset is the curve’s own time at the element’s position', () => {
    const curved = setClipSpeedCurve(seq([clip({ frames: 72 })]), 0, SPEED_PRESETS[0]!.points);
    const cut = curved.clips[0]!;
    expect(cutOffsetAt(cut, 0)).toBeCloseTo(0, 6);
    expect(Math.abs(cutOffsetAt(cut, 72 - 1e-6) - cut.frames)).toBeLessThan(1);
    expect(soundLeftSec(curved.clips, 0, 72 + 3, 24, 1)).toBeLessThan(0);
  });
});

describe('soundMarginSec and frameGaps: quiet before the sound must change, by a margin one long frame cannot defeat', () => {
  it('at least the floor; one and a half times the longest gap between animation frames of the last 2 s when that is more', () => {
    expect(SOUND_MARGIN_FLOOR_SEC).toBeGreaterThanOrEqual(0.1);
    expect(soundMarginSec(1 / 60)).toBe(SOUND_MARGIN_FLOOR_SEC);
    expect(soundMarginSec(0.05)).toBe(SOUND_MARGIN_FLOOR_SEC);
    expect(soundMarginSec(0.2)).toBeCloseTo(0.3, 9);
    // A covered window that draws about once a second goes quiet a second and a half ahead.
    expect(soundMarginSec(1)).toBeCloseTo(1.5, 9);
  });

  it('frameGaps keeps the longest gap of the last 2 s', () => {
    const gaps = frameGaps();
    expect(gaps.longestSec()).toBe(0);
    gaps.add(1000, 17);
    gaps.add(1200, 200);
    gaps.add(1217, 17);
    expect(gaps.longestSec()).toBeCloseTo(0.2, 9);
    gaps.add(3100, 17);
    expect(gaps.longestSec()).toBeCloseTo(0.2, 9);
    gaps.add(3300, 17);
    expect(gaps.longestSec()).toBeCloseTo(0.017, 9);
  });
});
