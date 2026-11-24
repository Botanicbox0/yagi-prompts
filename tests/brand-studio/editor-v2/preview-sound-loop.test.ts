import { afterEach, describe, expect, it, vi } from 'vitest';
import { playForward, type PlayState } from '@/components/brand-studio/editor-v2/play-forward';
import { emptyComposerProject, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import { soundShiftSec } from '@/lib/brand-studio/editor-v2/export-plan';
import { clipMediaPosAt, setClipAudio, setClipConstantSpeed, setClipSpeedCurve, spansOf, splitAtFrame, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { SPEED_PRESETS } from '@/lib/brand-studio/editor-v2/speed-curve';
import { toStored } from '@/lib/brand-studio/editor-v2/stored';

/**
 * Audit A1: the preview's play loop (components/brand-studio/editor-v2/play-forward.ts, run by preview.tsx
 * while the film plays forward) and the one <video> it drives. The repo's tests run without a DOM, so the
 * element is a stand-in that behaves like one where it matters here: a new address pauses it and loads,
 * a seek takes a while, it plays at its rate, it may refuse to play with sound, and it throws on a volume
 * or rate a real element refuses. Time moves a millisecond at a time, with animation frames at the gaps a
 * test gives (1/60 s by default; irregular, long frames and stalls where a test says), and after every
 * millisecond:
 *   - what can be heard (playing, not seeking, not muted) belongs to the cut on screen — the cut the
 *     playhead the loop last pushed is in, or the next ones up to where it has moved since — at that cut's
 *     volume, its position inside that cut's own stretch of its file; never a muted cut;
 *   - a seeking element is muted.
 */

class StandInVideo {
  dataset: Record<string, string> = {};
  duration = 30;
  readyState = 4;
  paused = true;
  seeking = false;
  preservesPitch = true;
  refuseWithSound = false;
  plays: Array<{ muted: boolean }> = [];
  log: string[] = [];
  private address = '';
  private position = 0;
  private quiet = true;
  private level = 1;
  private speed = 1;
  private loadLeft = 0;
  private seekLeft = 0;

  get muted() {
    return this.quiet;
  }
  set muted(value: boolean) {
    this.quiet = value;
    this.log.push(`muted=${value}`);
  }
  /** As HTMLMediaElement: a non-finite value is a TypeError, outside 0–1 an IndexSizeError. */
  get volume() {
    return this.level;
  }
  set volume(value: number) {
    if (!Number.isFinite(value)) throw new TypeError("Failed to set the 'volume' property: The provided double value is non-finite.");
    if (value < 0 || value > 1) throw Object.assign(new Error(`The volume provided (${value}) is outside the range [0, 1].`), { name: 'IndexSizeError' });
    this.level = value;
  }
  /** As Chromium: a non-finite rate is a TypeError; a rate other than 0 outside 0.0625–16 a NotSupportedError. */
  get playbackRate() {
    return this.speed;
  }
  set playbackRate(value: number) {
    if (!Number.isFinite(value)) throw new TypeError("Failed to set the 'playbackRate' property: The provided double value is non-finite.");
    if (value !== 0 && (value < 0.0625 || value > 16)) throw Object.assign(new Error(`The provided playback rate (${value}) is not in the supported playback range.`), { name: 'NotSupportedError' });
    this.speed = value;
  }
  get src() {
    return this.address;
  }
  set src(value: string) {
    this.address = value;
    this.paused = true;
    this.seeking = false;
    this.position = 0;
    this.readyState = 0;
    this.loadLeft = 30;
  }
  get currentTime() {
    return this.position;
  }
  set currentTime(value: number) {
    if (value < this.position - 1e-6) this.log.push('seek-back');
    this.position = value;
    this.seeking = true;
    this.seekLeft = 20;
  }
  get ended() {
    return this.position >= this.duration;
  }
  play(): Promise<void> {
    this.plays.push({ muted: this.quiet });
    if (this.refuseWithSound && !this.quiet) return Promise.reject(Object.assign(new Error('play() can only be initiated by a user gesture.'), { name: 'NotAllowedError' }));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.log.push('pause');
  }
  /** A millisecond of the browser's own time. */
  advance() {
    if (this.readyState < 4) {
      this.loadLeft -= 1;
      if (this.loadLeft <= 0) this.readyState = 4;
      return;
    }
    if (this.seeking) {
      this.seekLeft -= 1;
      if (this.seekLeft <= 0) this.seeking = false;
      return;
    }
    if (!this.paused && !this.ended) this.position = Math.min(this.duration, this.position + 0.001 * this.speed);
  }
  /** Heard right now: playing, past its seek, loaded and not muted. */
  audible() {
    return !this.paused && !this.seeking && this.readyState >= 2 && !this.quiet && !this.ended;
  }
}

function clip(overrides: Partial<FrameClip> = {}): FrameClip {
  return {
    id: 'a',
    label: 'A',
    srcUrl: '/media/a.mp4',
    thumbUrl: null,
    sourceFps: 24,
    sourceFrames: 480,
    inFrame: 0,
    phase: 0,
    frames: 48,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function film(clips: FrameClip[]): FrameSequence {
  return { fps: 24, aspect: '16:9', clips, captions: [] };
}

interface Options {
  gesture?: boolean;
  soundTrack?: boolean | null;
  refuse?: boolean;
  rate?: number;
  /** Gaps between animation frames, in ms, repeated (default 17, 17, 16). */
  gaps?: number[];
  /** One long frame: the first frame at or after `at` ms is followed by a gap of `ms`. */
  stall?: { at: number; ms: number };
  shift?: (cutId: string) => number;
}

interface Run {
  video: StandInVideo;
  latest: { current: PlayState };
  /** Milliseconds heard, per cut id. */
  heard: Record<string, number>;
  /** Milliseconds played (not paused, not seeking) but muted. */
  mutedWhilePlaying: number;
  /** Milliseconds where something other than the cut on screen, or the wrong volume, could be heard. */
  wrong: string[];
  /** Milliseconds heard of a stretch of a file already heard since the start. */
  replays: number;
  /** The element's rate on every audible millisecond. */
  audibleRates: Set<number>;
  stopped: boolean;
  rates: Set<number>;
  hide: () => void;
  show: () => void;
  stop: () => void;
  /** The shuttle's speed changes while playing: the preview's effect stops the loop and starts it again. */
  restart: (rate: number) => void;
  sincePush: () => number;
  run: (ms: number, options?: { frames?: boolean }) => Promise<void>;
}

/** The cuts on screen at `now`: from the one the last pushed playhead is in to where the film has moved since. */
function onScreen(sequence: FrameSequence, playhead: number, sinceMs: number, rate: number): FrameClip[] {
  const ahead = playhead + (sinceMs / 1000) * sequence.fps * rate + 1;
  return spansOf(sequence)
    .filter((span) => span.end > playhead && span.start <= ahead)
    .map((span) => span.clip);
}

function start(sequence: FrameSequence, options: Options = {}): Run {
  const video = new StandInVideo();
  const first = sequence.clips[0]!;
  video.src = first.srcUrl;
  video.dataset.src = first.srcUrl;
  video.readyState = 4;
  video.currentTime = 0.5 / first.sourceFps;
  video.seeking = false;
  video.log.length = 0;
  video.refuseWithSound = !!options.refuse;

  let callbacks: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    callbacks = [];
  });
  const listeners: Array<() => void> = [];
  const doc = {
    visibilityState: 'visible' as DocumentVisibilityState,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.push(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      const at = listeners.indexOf(listener);
      if (type === 'visibilitychange' && at >= 0) listeners.splice(at, 1);
    },
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('navigator', { userActivation: { hasBeenActive: options.gesture ?? true, isActive: false } });

  const gaps = options.gaps ?? [17, 17, 16];
  let gapIndex = 0;
  let stallDone = false;
  let now = 0;
  let nextFrame = 0;
  let lastPushAt = 0;
  let rate = options.rate ?? 1;
  const furthest = new Map<string, number>();
  const result: Run = {
    video,
    latest: {
      current: {
        sequence,
        playhead: 0,
        seek: (frame: number) => {
          result.latest.current.playhead = frame;
          lastPushAt = now;
        },
        setRate: (next: number) => {
          if (next === 0) result.stop();
        },
        soundTrack: () => (options.soundTrack === undefined ? null : options.soundTrack),
        soundShift: options.shift ?? (() => 0),
      },
    },
    heard: {},
    mutedWhilePlaying: 0,
    wrong: [],
    replays: 0,
    audibleRates: new Set(),
    stopped: false,
    rates: new Set(),
    hide: () => {
      doc.visibilityState = 'hidden';
      for (const listener of [...listeners]) listener();
    },
    show: () => {
      doc.visibilityState = 'visible';
      for (const listener of [...listeners]) listener();
    },
    stop: () => {
      if (result.stopped) return;
      result.stopped = true;
      cleanup();
    },
    restart: (next: number) => {
      cleanup();
      rate = next;
      cleanup = playForward(video as unknown as HTMLVideoElement, result.latest, rate, { resumed: true });
    },
    sincePush: () => now - lastPushAt,
    run: async (ms, runOptions) => {
      for (let i = 0; i < ms; i += 1) {
        video.advance();
        now += 1;
        const current = result.latest.current.sequence;
        if (video.seeking && !video.muted) result.wrong.push(`${now} ms: heard while seeking`);
        if (video.audible()) {
          const at = video.currentTime * current.fps;
          const shown = onScreen(current, result.latest.current.playhead, now - lastPushAt, rate);
          const under = shown.find((cut) => cut.srcUrl === video.src && at >= clipMediaPosAt(cut, 0) - 1e-6 && at < clipMediaPosAt(cut, cut.frames) - 1e-6);
          if (!under) result.wrong.push(`${now} ms: heard ${video.currentTime.toFixed(4)} s of ${video.src}, outside the cut on screen (${shown.map((cut) => cut.id).join(', ')})`);
          else if (under.muted || Math.abs(video.volume - under.volume) > 1e-6) result.wrong.push(`${now} ms: ${under.id} heard at ${video.volume}, its volume is ${under.muted ? 'muted' : under.volume}`);
          else result.heard[under.id] = (result.heard[under.id] ?? 0) + 1;
          const seen = furthest.get(video.src) ?? -1;
          if (video.currentTime < seen - 1e-6) result.replays += 1;
          furthest.set(video.src, Math.max(seen, video.currentTime));
          result.audibleRates.add(video.playbackRate);
        } else if (!video.paused && !video.seeking && video.readyState >= 2 && !video.ended) {
          result.mutedWhilePlaying += 1;
        }
        if ((runOptions?.frames ?? true) && !result.stopped && now >= nextFrame) {
          let gap = gaps[gapIndex++ % gaps.length]!;
          if (options.stall && !stallDone && now >= options.stall.at) {
            stallDone = true;
            gap = options.stall.ms;
          }
          nextFrame = now + gap;
          const due = callbacks;
          callbacks = [];
          for (const callback of due) callback(now);
          result.rates.add(Math.round(video.playbackRate * 1000) / 1000);
          await Promise.resolve();
          await Promise.resolve();
        }
      }
    },
  };
  let cleanup = playForward(video as unknown as HTMLVideoElement, result.latest, rate);
  return result;
}

afterEach(() => vi.unstubAllGlobals());

const twoFiles = () => film([clip({ id: 'a', frames: 24 }), clip({ id: 'b', srcUrl: '/media/b.mp4', inFrame: 48, frames: 48, volume: 0.5 })]);

describe('the stand-in element refuses what a real one refuses', () => {
  it('volume outside 0–1 and rates outside 0.0625–16 throw, as in Chromium', () => {
    const video = new StandInVideo();
    expect(() => (video.volume = 1.01)).toThrow(/outside the range/);
    expect(() => (video.volume = Number.NaN)).toThrow(TypeError);
    expect(() => (video.playbackRate = 20)).toThrow(/supported playback range/);
    expect(() => (video.playbackRate = 0.05)).toThrow(/supported playback range/);
    expect(() => (video.playbackRate = Number.NaN)).toThrow(TypeError);
    video.volume = 0;
    video.playbackRate = 16;
    video.playbackRate = 0.0625;
    expect([video.volume, video.playbackRate]).toEqual([0, 0.0625]);
  });
});

describe('the preview plays the cut on screen with its own sound (audit A1)', () => {
  it('play: the cut is heard at its own volume; pause: muted before the element stops', async () => {
    const run = start(film([clip({ frames: 96, volume: 0.6 })]));
    await run.run(400);
    expect(run.video.plays[0]).toEqual({ muted: false });
    expect(run.video.muted).toBe(false);
    expect(run.video.volume).toBeCloseTo(0.6, 9);
    expect(run.heard.a).toBeGreaterThan(350);
    expect(run.wrong).toEqual([]);
    run.stop();
    expect(run.video.muted).toBe(true);
    expect(run.video.paused).toBe(true);
    expect(run.video.log.slice(-2)).toEqual(['muted=true', 'pause']);
  });

  it('two cuts from two files: the first is silent before its end, nothing is heard while the second loads and seeks, then the second at its own volume', async () => {
    const run = start(twoFiles());
    await run.run(3300);
    expect(run.wrong).toEqual([]);
    expect(run.heard.a).toBeGreaterThan(800);
    expect(run.heard.b).toBeGreaterThan(1700);
    // The film ended: the loop stopped it, silent.
    expect(run.stopped).toBe(true);
    expect(run.video.muted).toBe(true);
    expect(run.video.paused).toBe(true);
  });

  it('a cut split in two at the same volume runs on without a gap; at another volume the change is silent for a moment, never the wrong volume', async () => {
    const whole = film([clip({ frames: 96 })]);
    const same = start(splitAtFrame(whole, 40, 'b'));
    await same.run(3000);
    expect(same.wrong).toEqual([]);
    expect(same.mutedWhilePlaying).toBe(0);
    expect(same.heard.a! + same.heard.b!).toBeGreaterThan(2950);

    vi.unstubAllGlobals();
    const split = splitAtFrame(whole, 40, 'b');
    const quieter = start(setClipAudio(split, 1, 0.3, false));
    await quieter.run(3000);
    expect(quieter.wrong).toEqual([]);
    expect(quieter.heard.a).toBeGreaterThan(1450);
    expect(quieter.heard.b).toBeGreaterThan(1250);
    expect(quieter.mutedWhilePlaying).toBeGreaterThan(0);
    expect(quieter.mutedWhilePlaying).toBeLessThan(160);
  });

  it('a muted cut is silent and the next one is heard', async () => {
    const run = start(film([clip({ id: 'a', frames: 24, muted: true }), clip({ id: 'b', srcUrl: '/media/b.mp4', frames: 24, volume: 0.8 })]));
    await run.run(2300);
    expect(run.wrong).toEqual([]);
    expect(run.heard.a ?? 0).toBe(0);
    expect(run.heard.b).toBeGreaterThan(800);
  });

  it('a panel change while playing reaches the element on the next frame', async () => {
    const run = start(film([clip({ frames: 96, volume: 1 })]));
    await run.run(300);
    expect(run.video.volume).toBe(1);
    expect(run.wrong).toEqual([]);
    // Until the next animation frame the element still has the old value: at most one frame.
    run.latest.current.sequence = setClipAudio(run.latest.current.sequence, 0, 0.25, false);
    await run.run(40);
    expect(run.video.volume).toBeCloseTo(0.25, 9);
    expect(run.wrong.length).toBeLessThanOrEqual(17);
    run.wrong.length = 0;
    run.latest.current.sequence = setClipAudio(run.latest.current.sequence, 0, 0.25, true);
    await run.run(40);
    expect(run.video.muted).toBe(true);
    expect(run.wrong.length).toBeLessThanOrEqual(17);
    run.wrong.length = 0;
    await run.run(100);
    expect(run.wrong).toEqual([]);
  });

  it('0.10× and 10×: the element plays at that rate, with the pitch following the speed as in the export, and is heard', async () => {
    const slow = start(setClipConstantSpeed(film([clip({ frames: 24 })]), 0, 0.1));
    await slow.run(600);
    expect(slow.video.playbackRate).toBeCloseTo(0.1, 9);
    expect(slow.video.preservesPitch).toBe(false);
    expect(slow.heard.a).toBeGreaterThan(550);
    expect(slow.wrong).toEqual([]);

    vi.unstubAllGlobals();
    const fast = start(setClipConstantSpeed(film([clip({ frames: 240, sourceFrames: 480 })]), 0, 10));
    await fast.run(600);
    expect(fast.video.playbackRate).toBeCloseTo(10, 9);
    expect(fast.heard.a).toBeGreaterThan(400);
    expect(fast.wrong).toEqual([]);
  });

  it('a speed curve: the element’s rate follows the curve frame by frame and the cut is heard throughout', async () => {
    const run = start(setClipSpeedCurve(film([clip({ frames: 72 })]), 0, SPEED_PRESETS[0]!.points));
    await run.run(1500);
    expect(run.latest.current.sequence.clips[0]!.speedCurve).toBeDefined();
    expect(run.rates.size).toBeGreaterThan(5);
    expect(run.video.preservesPitch).toBe(false);
    expect(run.heard.a).toBeGreaterThan(1000);
    expect(run.wrong).toEqual([]);
  });

  it('a browser that refuses to play with sound: the film still plays, silent', async () => {
    const run = start(film([clip({ frames: 96 })]), { refuse: true });
    await run.run(500);
    expect(run.video.plays[0]).toEqual({ muted: false });
    expect(run.video.plays.at(-1)).toEqual({ muted: true });
    expect(run.video.paused).toBe(false);
    expect(run.latest.current.playhead).toBeGreaterThan(8);
    expect(run.heard.a ?? 0).toBe(0);
  });

  it('before the person has used the page: plays silent', async () => {
    const run = start(film([clip({ frames: 96 })]), { gesture: false });
    await run.run(500);
    expect(run.video.plays.every((call) => call.muted)).toBe(true);
    expect(run.video.paused).toBe(false);
    expect(run.heard.a ?? 0).toBe(0);
  });

  it('the sample film’s footage has no sound track: plays silent', async () => {
    const run = start(film([clip({ frames: 96 })]), { soundTrack: false });
    await run.run(500);
    expect(run.video.muted).toBe(true);
    expect(run.video.paused).toBe(false);
    expect(run.heard.a ?? 0).toBe(0);
  });

  it('a hidden page: muted at once (no animation frames run there); heard again once visible', async () => {
    const run = start(film([clip({ id: 'a', frames: 24 }), clip({ id: 'b', srcUrl: '/media/b.mp4', frames: 48 })]));
    await run.run(300);
    expect(run.video.muted).toBe(false);
    run.hide();
    expect(run.video.muted).toBe(true);
    // Hidden: the element keeps playing past the first cut's end, the loop does not run.
    await run.run(1200, { frames: false });
    expect(run.wrong).toEqual([]);
    run.show();
    await run.run(800);
    expect(run.wrong).toEqual([]);
    expect(run.heard.b).toBeGreaterThan(500);
  });

  it('back from a hidden page on a cut split from the same file: nothing is heard past both pieces (review finding 4)', async () => {
    const pieces = splitAtFrame(film([clip({ id: 'a', frames: 48 }), clip({ id: 'c', srcUrl: '/media/c.mp4', frames: 48 })]), 24, 'b');
    const run = start(pieces);
    await run.run(300);
    run.hide();
    await run.run(5000, { frames: false });
    run.show();
    await run.run(2300);
    expect(run.wrong).toEqual([]);
    expect(run.heard.b).toBeGreaterThan(700);
    expect(run.heard.c).toBeGreaterThan(600);
  });

  it('the shuttle (2×): the cut on screen is heard at 2× and nothing else, before its end', async () => {
    const run = start(film([clip({ id: 'a', frames: 48 }), clip({ id: 'b', srcUrl: '/media/b.mp4', frames: 48, volume: 0.4 })]), { rate: 2 });
    await run.run(2000);
    expect([...run.audibleRates]).toEqual([2]);
    expect(run.wrong).toEqual([]);
    expect(run.heard.a).toBeGreaterThan(800);
    expect(run.heard.b).toBeGreaterThan(800);
  });

  it('the shuttle speed changes while playing (L): the loop steps back to the lagging playhead, and nothing already heard is heard again (review finding 5)', async () => {
    // At many moments, with steady and with uneven frames: how far the playhead lags depends on both.
    let backwards = 0;
    let replayed = 0;
    for (const gaps of [[17, 17, 16], [17, 50]]) {
      for (let extra = 0; extra < 60; extra += 3) {
        vi.unstubAllGlobals();
        const run = start(film([clip({ frames: 240 })]), { gaps });
        await run.run(480 + extra);
        const before = run.video.log.filter((entry) => entry === 'seek-back').length;
        run.restart(2);
        await run.run(400);
        backwards += run.video.log.filter((entry) => entry === 'seek-back').length - before;
        replayed += run.replays;
        expect(run.wrong).toEqual([]);
        expect(run.heard.a).toBeGreaterThan(480 + 250);
        expect(run.audibleRates.has(2)).toBe(true);
      }
    }
    expect(backwards).toBeGreaterThan(10);
    expect(replayed).toBe(0);
  });
});

describe('irregular animation frames: nothing outside the cut on screen is heard (review finding 2)', () => {
  it('17/50 ms frames, two files and a split at another volume', async () => {
    const run = start(twoFiles(), { gaps: [17, 50] });
    await run.run(3300);
    expect(run.wrong).toEqual([]);
    expect(run.heard.a).toBeGreaterThan(700);
    expect(run.heard.b).toBeGreaterThan(1500);

    vi.unstubAllGlobals();
    const quieter = start(setClipAudio(splitAtFrame(film([clip({ frames: 96 })]), 40, 'b'), 1, 0.3, false), { gaps: [17, 50] });
    await quieter.run(3000);
    expect(quieter.wrong).toEqual([]);
    expect(quieter.heard.b).toBeGreaterThan(1100);
  });

  it('one 60 ms frame shortly before the first cut ends (it ends about 980 ms in)', async () => {
    for (let at = 840; at <= 970; at += 10) {
      vi.unstubAllGlobals();
      const run = start(twoFiles(), { stall: { at, ms: 60 } });
      await run.run(2000);
      expect([at, run.wrong]).toEqual([at, []]);
    }
  });

  it('a cut, another file, then the first cut’s continuation, with a 60 ms frame near the first cut’s end (the oracle is the cut on screen)', async () => {
    const sameFile = () => film([clip({ id: 'a', frames: 24 }), clip({ id: 'c', srcUrl: '/media/c.mp4', frames: 24 }), clip({ id: 'b', inFrame: 24, frames: 24 })]);
    for (const at of [930, 950, 970]) {
      vi.unstubAllGlobals();
      const run = start(sameFile(), { stall: { at, ms: 60 } });
      await run.run(3200);
      expect([at, run.wrong]).toEqual([at, []]);
      expect(run.heard.b).toBeGreaterThan(600);
    }
  });

  it('a 200 ms hitch about once a second: the margin remembers it', async () => {
    const gaps = [200, ...Array.from({ length: 48 }, () => 17)];
    const run = start(twoFiles(), { gaps });
    await run.run(3500);
    expect(run.wrong).toEqual([]);
    expect(run.heard.b).toBeGreaterThan(1000);
  });

  it('a lone 200 ms stall in the middle of a cut changes nothing', async () => {
    const run = start(twoFiles(), { stall: { at: 400, ms: 200 } });
    await run.run(3300);
    expect(run.wrong).toEqual([]);
  });

  it('what still leaks: a lone stall longer than the 120 ms floor right before a cut’s end plays at most its excess (200 ms → 80 ms)', async () => {
    let worst = 0;
    for (let at = 800; at <= 990; at += 10) {
      vi.unstubAllGlobals();
      const run = start(twoFiles(), { stall: { at, ms: 200 } });
      await run.run(2000);
      worst = Math.max(worst, run.wrong.length);
    }
    expect(worst).toBeLessThanOrEqual(80);
  });
});

describe('a cut whose sound the stored film moves (review finding 1)', () => {
  const stored = (offset: number): ComposerProject => ({
    ...emptyComposerProject('16:9'),
    clips: [
      { id: 'a', label: 'A', sourceKind: 'asset', srcUrl: '/media/a.mp4', durationSec: 20, trimStartSec: 0, trimEndSec: 4, volume: 1, muted: false, audioOffsetSec: offset },
      { id: 'c', label: 'C', sourceKind: 'asset', srcUrl: '/media/c.mp4', durationSec: 20, trimStartSec: 0, trimEndSec: 1, volume: 1, muted: false },
    ],
  });
  const cuts = () => splitAtFrame(film([clip({ id: 'a', frames: 96 }), clip({ id: 'c', srcUrl: '/media/c.mp4', frames: 24 })]), 40, 'b');

  it('moved by 0.5 s: never heard, the piece split from it too (it carries the offset into the file); the next cut is', async () => {
    const sequence = cuts();
    const written = toStored(sequence, stored(0.5));
    expect([soundShiftSec(written, 'a'), soundShiftSec(written, 'b'), soundShiftSec(written, 'c')]).toEqual([0.5, 0.5, 0]);
    const run = start(sequence, { shift: (id) => soundShiftSec(written, id) });
    await run.run(5300);
    expect(run.heard.a ?? 0).toBe(0);
    expect(run.heard.b ?? 0).toBe(0);
    expect(run.heard.c).toBeGreaterThan(700);
    expect(run.wrong).toEqual([]);
  });

  it('an offset of 0: heard as before', async () => {
    const sequence = cuts();
    const written = toStored(sequence, stored(0));
    const run = start(sequence, { shift: (id) => soundShiftSec(written, id) });
    await run.run(3000);
    expect(run.heard.a! + run.heard.b!).toBeGreaterThan(2900);
    expect(run.wrong).toEqual([]);
  });
});
