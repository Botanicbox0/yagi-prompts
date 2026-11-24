import { afterEach, describe, expect, it, vi } from 'vitest';
import { playForward, type PlayState } from '@/components/brand-studio/editor-v2/play-forward';
import { clipMediaPosAt, setClipAudio, setClipConstantSpeed, setClipSpeedCurve, splitAtFrame, type FrameClip, type FrameSequence } from '@/lib/brand-studio/editor-v2/frames';
import { SPEED_PRESETS } from '@/lib/brand-studio/editor-v2/speed-curve';

/**
 * Audit A1: the preview's play loop (components/brand-studio/editor-v2/play-forward.ts, run by preview.tsx
 * while the film plays forward) and the one <video> it drives. The repo's tests run without a DOM, so the
 * element is a stand-in that behaves like one where it matters here: a new address pauses it and loads,
 * a seek takes a while, it plays at its rate, and it may refuse to play with sound. Time moves a millisecond
 * at a time, with an animation frame every 1/60 s, and after every millisecond:
 *   - what can be heard (playing, not seeking, not muted) is the cut on screen at that moment — the element's
 *     position lies inside that cut's own stretch of its file — at that cut's volume, never a muted cut;
 *   - a seeking element is muted.
 */

class StandInVideo {
  dataset: Record<string, string> = {};
  duration = 30;
  readyState = 4;
  paused = true;
  seeking = false;
  volume = 1;
  playbackRate = 1;
  preservesPitch = true;
  refuseWithSound = false;
  plays: Array<{ muted: boolean }> = [];
  log: string[] = [];
  private address = '';
  private position = 0;
  private quiet = true;
  private loadLeft = 0;
  private seekLeft = 0;

  get muted() {
    return this.quiet;
  }
  set muted(value: boolean) {
    this.quiet = value;
    this.log.push(`muted=${value}`);
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
    if (!this.paused && !this.ended) this.position = Math.min(this.duration, this.position + 0.001 * this.playbackRate);
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

/** The cut whose own stretch of its file holds the element's position (none: the element is past every cut). */
function cutUnder(video: StandInVideo, sequence: FrameSequence): FrameClip | null {
  const at = video.currentTime * sequence.fps;
  return (
    sequence.clips.find((cut) => cut.srcUrl === video.src && at >= clipMediaPosAt(cut, 0) - 1e-6 && at < clipMediaPosAt(cut, cut.frames) - 1e-6) ?? null
  );
}

interface Run {
  video: StandInVideo;
  latest: { current: PlayState };
  /** Milliseconds heard, per cut id. */
  heard: Record<string, number>;
  /** Milliseconds played (not paused, not seeking) but muted. */
  mutedWhilePlaying: number;
  /** Every millisecond where something other than the cut on screen, or the wrong volume, could be heard. */
  wrong: string[];
  stopped: boolean;
  rates: Set<number>;
  hide: () => void;
  show: () => void;
  stop: () => void;
  run: (ms: number, options?: { frames?: boolean }) => Promise<void>;
}

const FRAME_MS = 1000 / 60;

function start(sequence: FrameSequence, options: { gesture?: boolean; soundTrack?: boolean | null; refuse?: boolean; rate?: number } = {}): Run {
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

  const result: Run = {
    video,
    latest: {
      current: {
        sequence,
        playhead: 0,
        seek: (frame: number) => {
          result.latest.current.playhead = frame;
        },
        setRate: (rate: number) => {
          if (rate === 0) result.stop();
        },
        soundTrack: () => (options.soundTrack === undefined ? null : options.soundTrack),
      },
    },
    heard: {},
    mutedWhilePlaying: 0,
    wrong: [],
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
    run: async (ms, runOptions) => {
      for (let i = 0; i < ms; i += 1) {
        video.advance();
        now += 1;
        const current = result.latest.current.sequence;
        if (video.seeking && !video.muted) result.wrong.push(`${now} ms: heard while seeking`);
        if (video.audible()) {
          const under = cutUnder(video, current);
          if (!under) result.wrong.push(`${now} ms: heard past the cuts at ${video.currentTime.toFixed(4)} s of ${video.src}`);
          else if (under.muted || Math.abs(video.volume - under.volume) > 1e-6) result.wrong.push(`${now} ms: ${under.id} heard at ${video.volume}, its volume is ${under.muted ? 'muted' : under.volume}`);
          else result.heard[under.id] = (result.heard[under.id] ?? 0) + 1;
        } else if (!video.paused && !video.seeking && video.readyState >= 2 && !video.ended) {
          result.mutedWhilePlaying += 1;
        }
        if ((runOptions?.frames ?? true) && !result.stopped && now >= nextFrame) {
          // Frames missed while none ran (a hidden page) are not made up, as in a browser.
          nextFrame = Math.max(nextFrame, now - FRAME_MS) + FRAME_MS;
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
  let now = 0;
  let nextFrame = 0;
  const cleanup = playForward(video as unknown as HTMLVideoElement, result.latest, options.rate ?? 1);
  return result;
}

afterEach(() => vi.unstubAllGlobals());

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
    const run = start(film([clip({ id: 'a', frames: 24, volume: 1 }), clip({ id: 'b', srcUrl: '/media/b.mp4', inFrame: 48, frames: 48, volume: 0.5 })]));
    await run.run(3300);
    expect(run.wrong).toEqual([]);
    expect(run.heard.a).toBeGreaterThan(900);
    expect(run.heard.b).toBeGreaterThan(1800);
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
    expect(same.heard.a! + same.heard.b!).toBeGreaterThan(3800 - 1000 - 50);

    vi.unstubAllGlobals();
    const split = splitAtFrame(whole, 40, 'b');
    const quieter = start(setClipAudio(split, 1, 0.3, false));
    await quieter.run(3000);
    expect(quieter.wrong).toEqual([]);
    expect(quieter.heard.a).toBeGreaterThan(1550);
    expect(quieter.heard.b).toBeGreaterThan(1250);
    expect(quieter.mutedWhilePlaying).toBeGreaterThan(0);
    expect(quieter.mutedWhilePlaying).toBeLessThan(60);
  });

  it('a muted cut is silent and the next one is heard', async () => {
    const run = start(film([clip({ id: 'a', frames: 24, muted: true }), clip({ id: 'b', srcUrl: '/media/b.mp4', frames: 24, volume: 0.8 })]));
    await run.run(2300);
    expect(run.wrong).toEqual([]);
    expect(run.heard.a ?? 0).toBe(0);
    expect(run.heard.b).toBeGreaterThan(850);
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

  it('the shuttle (2×): still the cut on screen, before its end', async () => {
    const run = start(film([clip({ id: 'a', frames: 48 }), clip({ id: 'b', srcUrl: '/media/b.mp4', frames: 48, volume: 0.4 })]), { rate: 2 });
    await run.run(2000);
    expect(run.video.playbackRate === 2 || run.stopped).toBe(true);
    expect(run.wrong).toEqual([]);
    expect(run.heard.a).toBeGreaterThan(900);
    expect(run.heard.b).toBeGreaterThan(800);
  });
});
