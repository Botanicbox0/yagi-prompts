import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preview } from '@/components/brand-studio/editor-v2/preview';
import type { EditorApi } from '@/components/brand-studio/editor-v2/use-editor';
import {
  frameStateAt,
  mediaFramesOf,
  setClipSpeed,
  setClipSpeedCurve,
  spansOf,
  splitAtFrame,
  totalFrames,
  trimClipEdge,
  type FrameClip,
  type FrameSequence,
} from '@/lib/brand-studio/editor-v2/frames';
import { realDoc } from '@/lib/brand-studio/editor-v2/real';
import { DEFAULT_SHORTCUT_PREFS, effectiveBindings } from '@/lib/brand-studio/editor-v2/shortcuts';
import { SPEED_PRESETS } from '@/lib/brand-studio/editor-v2/speed-curve';
import { studioEditorKo } from '@/messages/studio-editor';
import { mountDom, type MountedDom } from '@/tests/brands/_dom-harness';

/**
 * Regression suite for playback freezing when a cut plays to the exact end of its source video.
 *
 * Drives the REAL `<Preview />` React component (its `useEffect([rate])` -> `playForward`, its
 * stopped settle effect, and its transport button) against an instrumented `<video>` element whose
 * clock stops at `duration`, fires `ended`, and follows WHATWG HTML §4.8.11.8 (`play()` on an ended
 * element resets `currentTime` to 0 and clears `ended`). Two browser variants are exercised:
 *   - `'chromium'`: reaching `duration` sets both `ended = true` and `paused = true` (firing
 *     `pause` then `ended`), matching Chromium/Blink.
 *   - `'spec'`: reaching `duration` sets `ended = true` while leaving `paused = false` (firing
 *     `ended`).
 */

type EndMode = 'chromium' | 'spec';

interface VideoRig {
  readonly element: HTMLVideoElement;
  readonly endedEvents: number;
  readonly restartedFromEnded: number;
  readonly seeks: Array<{ src: string; to: number }>;
  advance(ms?: number): void;
  setDuration(src: string, sec: number): void;
}

function attachVideoRig(raw: unknown, durations: Readonly<Record<string, number>>, mode: EndMode): VideoRig {
  const el = raw as Record<string, unknown> & {
    attributes: Record<string, string>;
    dispatchEvent(ev: { type: string; bubbles?: boolean; cancelable?: boolean }): boolean;
  };

  let address = '';
  let position = 0;
  let paused = true;
  let seeking = false;
  let readyState = 0;
  let quiet = true;
  let level = 1;
  let speed = 1;
  let loadLeft = 0;
  let seekLeft = 0;
  let endedFlag = false;
  let endedEvents = 0;
  let restartedFromEnded = 0;
  const seeks: Array<{ src: string; to: number }> = [];
  const table: Record<string, number> = { ...durations };

  const durationOf = () => table[address] ?? 30;
  const emit = (type: string) => {
    el.dispatchEvent({ type, bubbles: false, cancelable: false });
  };

  const dataset = new Proxy<Record<string, string>>(
    {},
    {
      get: (_t, key) => el.attributes[`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`],
      set: (_t, key, value) => {
        el.attributes[`data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`] = String(value);
        return true;
      },
    },
  );

  Object.defineProperties(el, {
    dataset: { configurable: true, get: () => dataset },
    duration: { configurable: true, get: () => durationOf() },
    readyState: { configurable: true, get: () => readyState },
    paused: { configurable: true, get: () => paused },
    seeking: { configurable: true, get: () => seeking },
    ended: { configurable: true, get: () => endedFlag },
    preservesPitch: { configurable: true, writable: true, value: true },
    videoWidth: { configurable: true, get: () => 1920 },
    videoHeight: { configurable: true, get: () => 1080 },
    muted: {
      configurable: true,
      get: () => quiet,
      set: (value: boolean) => {
        quiet = Boolean(value);
      },
    },
    volume: {
      configurable: true,
      get: () => level,
      set: (value: number) => {
        if (!Number.isFinite(value)) throw new TypeError('volume must be finite');
        if (value < 0 || value > 1) throw Object.assign(new Error('volume out of range'), { name: 'IndexSizeError' });
        level = value;
      },
    },
    playbackRate: {
      configurable: true,
      get: () => speed,
      set: (value: number) => {
        if (!Number.isFinite(value)) throw new TypeError('playbackRate must be finite');
        if (value !== 0 && (value < 0.0625 || value > 16)) throw Object.assign(new Error('rate out of range'), { name: 'NotSupportedError' });
        speed = value;
      },
    },
    src: {
      configurable: true,
      get: () => address,
      set: (value: string) => {
        address = String(value);
        paused = true;
        seeking = false;
        endedFlag = false;
        position = 0;
        readyState = 0;
        loadLeft = 20;
      },
    },
    currentTime: {
      configurable: true,
      get: () => position,
      set: (value: number) => {
        const dur = durationOf();
        const clamped = Math.max(0, Math.min(dur, value));
        seeks.push({ src: address, to: clamped });
        position = clamped;
        endedFlag = position >= dur;
        seeking = true;
        seekLeft = 15;
      },
    },
    play: {
      configurable: true,
      value: (): Promise<void> => {
        // WHATWG HTML §4.8.11.8: play() while ended seeks to 0 and clears ended.
        if (endedFlag) {
          restartedFromEnded += 1;
          position = 0;
          endedFlag = false;
        }
        paused = false;
        return Promise.resolve();
      },
    },
    pause: {
      configurable: true,
      value: (): void => {
        paused = true;
      },
    },
  });

  const stepOneMs = () => {
    if (readyState < 4 && loadLeft > 0) {
      loadLeft -= 1;
      if (loadLeft <= 0) {
        readyState = 4;
        emit('loadedmetadata');
        emit('loadeddata');
      }
      return;
    }
    if (seeking) {
      seekLeft -= 1;
      if (seekLeft <= 0) {
        seeking = false;
        emit('seeked');
      }
      return;
    }
    if (!paused && !endedFlag) {
      const dur = durationOf();
      const next = position + 0.001 * speed;
      if (next >= dur) {
        position = dur;
        endedFlag = true;
        endedEvents += 1;
        if (mode === 'chromium') {
          paused = true;
          emit('pause');
        }
        emit('ended');
      } else {
        position = next;
      }
    }
  };

  return {
    element: el as unknown as HTMLVideoElement,
    get endedEvents() {
      return endedEvents;
    },
    get restartedFromEnded() {
      return restartedFromEnded;
    },
    seeks,
    advance(ms = 1) {
      for (let i = 0; i < ms; i += 1) stepOneMs();
    },
    setDuration(src: string, sec: number) {
      table[src] = sec;
    },
  };
}

function makeClip(overrides: Partial<FrameClip> = {}): FrameClip {
  return {
    id: 'c1',
    label: 'Cut 1',
    srcUrl: '/media/bottle.mp4',
    thumbUrl: null,
    sourceFps: 24,
    sourceFrames: 289,
    inFrame: 0,
    phase: 0,
    frames: 289,
    speedNum: 1,
    speedDen: 1,
    volume: 1,
    muted: false,
    ...overrides,
  };
}

function makeSequence(clips: FrameClip[], fps = 24): FrameSequence {
  return { fps, aspect: '16:9', clips, captions: [] };
}

interface HarnessControls {
  seek(frame: number): void;
  setRate(rate: number): void;
  getState(): { playhead: number; rate: number };
}

function PreviewHost({
  sequence,
  initialPlayhead,
  controlsRef,
}: {
  sequence: FrameSequence;
  initialPlayhead: number;
  controlsRef: { current: HarnessControls | null };
}) {
  const total = totalFrames(sequence);
  const lastFrame = Math.max(0, total - 1);
  const [playhead, setPlayhead] = useState(initialPlayhead);
  const [rate, setRate] = useState(0);
  const seek = useCallback((target: number) => setPlayhead(Math.min(Math.max(0, Math.round(target)), lastFrame)), [lastFrame]);
  const step = useCallback(
    (delta: number) => {
      setRate(0);
      setPlayhead((cur) => Math.min(Math.max(0, cur + delta), lastFrame));
    },
    [lastFrame],
  );
  const setPlaying = useCallback((on: boolean) => setRate(on ? 1 : 0), []);
  const frame = frameStateAt(sequence, playhead);
  controlsRef.current = {
    seek,
    setRate,
    getState: () => ({ playhead: frame.frame, rate }),
  };

  const api = {
    copy: studioEditorKo,
    real: false,
    storedFilm: null,
    filmView: null,
    status: 'ready' as const,
    readOnly: false,
    missingSources: {},
    tentative: false,
    doc: realDoc(sequence),
    sequence,
    fps: sequence.fps,
    spans: spansOf(sequence),
    total,
    lastFrame,
    durationSec: total / sequence.fps,
    frame,
    activeClip: frame.active,
    playhead: frame.frame,
    playheadSec: frame.frame / sequence.fps,
    seek,
    step,
    rate,
    setRate,
    playing: rate !== 0,
    setPlaying,
    workspace: 'cut' as const,
    compare: false,
    setCompare: () => undefined,
    shortcutMap: effectiveBindings(DEFAULT_SHORTCUT_PREFS),
    mac: false,
    splitAtPlayhead: () => undefined,
  } as unknown as EditorApi;

  return <Preview api={api} />;
}

interface Session {
  dom: MountedDom;
  rig: VideoRig;
  controls: HarnessControls;
  play(rate?: number): Promise<void>;
  run(ms: number): Promise<Array<{ t: number; playhead: number; rate: number; src: string; currentTime: number; paused: boolean; ended: boolean }>>;
  transportLabel(): string | null;
  playheadAttr(): number;
}

let activeDom: MountedDom | null = null;

afterEach(async () => {
  await activeDom?.unmount();
  activeDom = null;
  vi.unstubAllGlobals();
});

async function mountPreview(
  sequence: FrameSequence,
  durations: Readonly<Record<string, number>>,
  options: { startFrame?: number; mode?: EndMode; frameGapMs?: number } = {},
): Promise<Session> {
  const mode = options.mode ?? 'chromium';
  const gapMs = options.frameGapMs ?? 16;
  let rafQueue: FrameRequestCallback[] = [];
  let now = 0;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue = [];
  });

  const controlsRef: { current: HarnessControls | null } = { current: null };
  const dom = await mountDom(null);
  activeDom = dom;
  vi.stubGlobal('navigator', {
    ...(globalThis.navigator ?? {}),
    userAgent: globalThis.navigator?.userAgent ?? '',
    userActivation: { hasBeenActive: true, isActive: false },
  });

  // Instrument `<video>` creation so the element Preview mounts has real media-element semantics from its first effect.
  const origCreate = dom.document.createElement.bind(dom.document);
  let rig: VideoRig | null = null;
  dom.document.createElement = ((tag: string) => {
    const node = origCreate(tag);
    if (tag.toLowerCase() === 'video') {
      rig = attachVideoRig(node, durations, mode);
    }
    return node;
  }) as typeof dom.document.createElement;

  await dom.rerender(<PreviewHost sequence={sequence} initialPlayhead={options.startFrame ?? 0} controlsRef={controlsRef} />);
  if (!rig) throw new Error('Preview did not mount a <video> element');
  const mountedRig: VideoRig = rig;

  // Let initial stopped load/seek settle.
  const { act } = await import('react');
  await act(async () => {
    mountedRig.advance(60);
  });

  const play = async (rate = 1) => {
    await act(async () => {
      controlsRef.current!.setRate(rate);
    });
  };

  const run = async (ms: number) => {
    const samples: Array<{ t: number; playhead: number; rate: number; src: string; currentTime: number; paused: boolean; ended: boolean }> = [];
    let nextRaf = now;
    const endAt = now + ms;
    const sampleStep = 50;
    let nextSample = now;
    while (now < endAt) {
      const stopAt = Math.min(endAt, nextRaf, nextSample);
      const delta = Math.max(1, stopAt - now);
      await act(async () => {
        mountedRig.advance(delta);
        now += delta;
        if (now >= nextRaf && rafQueue.length > 0) {
          nextRaf = now + gapMs;
          const due = rafQueue;
          rafQueue = [];
          for (const cb of due) cb(now);
        } else if (now >= nextRaf) {
          nextRaf = now + gapMs;
        }
      });
      if (now >= nextSample || now >= endAt) {
        nextSample = now + sampleStep;
        const state = controlsRef.current!.getState();
        samples.push({
          t: now,
          playhead: state.playhead,
          rate: state.rate,
          src: mountedRig.element.src,
          currentTime: mountedRig.element.currentTime,
          paused: mountedRig.element.paused,
          ended: mountedRig.element.ended,
        });
      }
    }
    return samples;
  };

  return {
    dom,
    rig: mountedRig,
    get controls() {
      return controlsRef.current!;
    },
    play,
    run,
    transportLabel: () => dom.query('[data-editor-play]')?.getAttribute('aria-label') ?? null,
    playheadAttr: () => Number(dom.query('[data-editor-preview]')?.getAttribute('data-editor-playhead') ?? 'NaN'),
  };
}

describe('Preview playback across source ends', () => {
  it('Preview mounts <video> without loop', async () => {
    const seq = makeSequence([makeClip({ id: 'a' })]);
    const session = await mountPreview(seq, { '/media/bottle.mp4': 289 / 24 });
    expect(session.dom.query('video')?.hasAttribute('loop')).toBe(false);
  });

  for (const mode of ['chromium', 'spec'] as const) {
    it(`[${mode}] cut ending at its source end crosses on time to the next cut (same source, 289 frames at 24 fps)`, async () => {
      const dur = 289 / 24;
      const seq = makeSequence([
        makeClip({ id: 'a', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
        makeClip({ id: 'b', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289, inFrame: 0 }),
      ]);
      const session = await mountPreview(seq, { '/media/bottle.mp4': dur }, { startFrame: 250, mode });
      await session.play(1);
      const samples = await session.run(3400);

      // Crossed 288 -> 289 and kept advancing past 330.
      const maxPh = Math.max(...samples.map((s) => s.playhead));
      expect(maxPh).toBeGreaterThanOrEqual(325);
      expect(session.playheadAttr()).toBeGreaterThanOrEqual(325);
      // Never called play() on an ended video (no wrap-to-0 loop).
      expect(session.rig.endedEvents).toBeGreaterThanOrEqual(1);
      expect(session.rig.restartedFromEnded).toBe(0);
      // Next cut seeked explicitly to its in-point (0.5 / 24), not 0.
      const cut2Seek = session.rig.seeks.find((s) => Math.abs(s.to - 0.5 / 24) < 1e-6);
      expect(cut2Seek).toBeDefined();
      // Final video clock matches the timeline within 100 ms.
      const last = samples.at(-1)!;
      const expectedSec = (last.playhead - 289) / 24;
      expect(Math.abs(last.currentTime - expectedSec)).toBeLessThan(0.12);
    });

    it(`[${mode}] different-file whole cuts (bottle -> clip18 -> bottle) cross both boundaries cleanly`, async () => {
      const bottleDur = 289 / 24;
      const clip18Dur = 120 / 24;
      const seq = makeSequence([
        makeClip({ id: 'a', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
        makeClip({ id: 'b', srcUrl: '/media/clip18.mp4', frames: 120, sourceFrames: 120, inFrame: 0 }),
        makeClip({ id: 'c', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289, inFrame: 0 }),
      ]);
      const session = await mountPreview(
        seq,
        { '/media/bottle.mp4': bottleDur, '/media/clip18.mp4': clip18Dur },
        { startFrame: 270, mode },
      );
      await session.play(1);
      const samples = await session.run(7200);

      expect(session.rig.restartedFromEnded).toBe(0);
      expect(Math.max(...samples.map((s) => s.playhead))).toBeGreaterThanOrEqual(425);
      expect(samples.some((s) => s.playhead >= 289 && s.playhead < 409 && s.src === '/media/clip18.mp4')).toBe(true);
      expect(samples.some((s) => s.playhead >= 409 && s.src === '/media/bottle.mp4')).toBe(true);
    });

    it(`[${mode}] two source-end boundaries in a row (3 × 289-frame whole cuts) cross both and stop cleanly at the film end`, async () => {
      const dur = 289 / 24;
      const seq = makeSequence([
        makeClip({ id: 'a', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
        makeClip({ id: 'b', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
        makeClip({ id: 'c', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
      ]);
      // Start near boundary 1, play at 4× across boundary 1 (288->289), boundary 2 (577->578), and film end (866).
      const session = await mountPreview(seq, { '/media/bottle.mp4': dur }, { startFrame: 260, mode });
      await session.play(4);
      const samples = await session.run(7000);

      expect(session.rig.restartedFromEnded).toBe(0);
      expect(session.rig.endedEvents).toBeGreaterThanOrEqual(3);
      // Crossed both boundaries in sequence.
      expect(samples.some((s) => s.playhead >= 289 && s.playhead < 578)).toBe(true);
      expect(samples.some((s) => s.playhead >= 578 && s.playhead < 866)).toBe(true);
      // Stopped at film end (866): transport shows stopped, video is paused and muted.
      expect(session.controls.getState()).toEqual({ playhead: 866, rate: 0 });
      expect(session.playheadAttr()).toBe(866);
      expect(session.transportLabel()).toBe(studioEditorKo.timeline.play);
      expect(session.rig.element.paused).toBe(true);
      expect(session.rig.element.muted).toBe(true);
    });

    it(`[${mode}] film end stops transport and pauses every video element (820 -> 866)`, async () => {
      const dur = 289 / 24;
      const seq = makeSequence([
        makeClip({ id: 'a', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
        makeClip({ id: 'b', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
        makeClip({ id: 'c', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
      ]);
      const session = await mountPreview(seq, { '/media/bottle.mp4': dur }, { startFrame: 820, mode });
      await session.play(1);
      expect(session.transportLabel()).toBe(studioEditorKo.timeline.pause);
      await session.run(3500);

      expect(session.rig.restartedFromEnded).toBe(0);
      expect(session.controls.getState()).toEqual({ playhead: 866, rate: 0 });
      expect(session.playheadAttr()).toBe(866);
      expect(session.transportLabel()).toBe(studioEditorKo.timeline.play);
      expect(session.rig.element.paused).toBe(true);
      // Stopped effect settles on the last frame's seekSec (not 0 s, not still advancing).
      const afterPauseTime = session.rig.element.currentTime;
      expect(Math.abs(afterPauseTime - (288 + 0.5) / 24)).toBeLessThan(0.05);
      await session.run(500);
      expect(session.rig.element.paused).toBe(true);
      expect(session.rig.element.currentTime).toBe(afterPauseTime);

      // Pressing play again restarts cleanly from frame 0.
      await session.play(1);
      await session.run(600);
      expect(session.controls.getState().rate).toBe(1);
      expect(session.controls.getState().playhead).toBeGreaterThan(5);
      expect(session.controls.getState().playhead).toBeLessThan(50);
    });
  }

  it('mid-file boundary (split cut) stays seamless without extra seeks or pauses', async () => {
    const dur = 289 / 24;
    const whole = makeSequence([makeClip({ id: 'a', frames: 289, sourceFrames: 289 })]);
    const split = splitAtFrame(whole, 150, 'b');
    const session = await mountPreview(split, { '/media/bottle.mp4': dur }, { startFrame: 120, mode: 'chromium' });
    const seeksBeforePlay = session.rig.seeks.length;
    await session.play(1);
    const samples = await session.run(2600);

    expect(Math.max(...samples.map((s) => s.playhead))).toBeGreaterThanOrEqual(175);
    expect(session.rig.endedEvents).toBe(0);
    expect(session.rig.restartedFromEnded).toBe(0);
    // Crossing the mid-file split triggers no seek at all.
    expect(session.rig.seeks.length).toBe(seeksBeforePlay);
  });

  it('cut trimmed 1 s short of its source end crosses on time (unchanged)', async () => {
    const dur = 289 / 24;
    const base = makeSequence([
      makeClip({ id: 'a', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
      makeClip({ id: 'b', srcUrl: '/media/clip18.mp4', inFrame: 12, frames: 120, sourceFrames: 200 }),
    ]);
    const trimmed = trimClipEdge(base, 0, 'end', -24).seq; // 265 frames
    const session = await mountPreview(
      trimmed,
      { '/media/bottle.mp4': dur, '/media/clip18.mp4': 200 / 24 },
      { startFrame: 240, mode: 'chromium' },
    );
    await session.play(1);
    const samples = await session.run(2600);

    expect(Math.max(...samples.map((s) => s.playhead))).toBeGreaterThanOrEqual(290);
    expect(session.rig.endedEvents).toBe(0);
    expect(session.rig.restartedFromEnded).toBe(0);
    // Cut 2 starts at its in-point (frame 12 -> 12.5 / 24 s).
    const cut2Seek = session.rig.seeks.find((s) => s.src === '/media/clip18.mp4');
    expect(cut2Seek?.to).toBeCloseTo(12.5 / 24, 6);
  });

  it('fractional frame rates (24000/1001): exact source end (1000 source frames -> 1001 film frames) and 289 frames both cross cleanly', async () => {
    const ntsc = 24000 / 1001;
    // 1000 source frames at 24000/1001 fps: duration = 1001/24 s = mediaFramesOf(1000) / 24 exactly.
    const exactFrames = mediaFramesOf({ sourceFrames: 1000, sourceFps: ntsc }, 24);
    expect(exactFrames).toBe(1001);
    const exactDur = 1000 / ntsc;
    const seq1 = makeSequence(
      [
        makeClip({ id: 'a', srcUrl: '/media/ntsc-exact.mp4', sourceFps: ntsc, sourceFrames: 1000, frames: exactFrames }),
        makeClip({ id: 'b', srcUrl: '/media/ntsc-short.mp4', sourceFps: ntsc, sourceFrames: 289, frames: 289 }),
      ],
      24,
    );
    const s1 = await mountPreview(
      seq1,
      { '/media/ntsc-exact.mp4': exactDur, '/media/ntsc-short.mp4': 289 / ntsc },
      { startFrame: 975, mode: 'chromium' },
    );
    await s1.play(1);
    const samples1 = await s1.run(2800);
    expect(s1.rig.restartedFromEnded).toBe(0);
    expect(Math.max(...samples1.map((s) => s.playhead))).toBeGreaterThanOrEqual(1030);

    // Millisecond-truncated duration (e.g. WebM: 119 frames at 24 fps lasts 4.958333 s, stored 4.958 s):
    // at currentTime === duration, offset is 118 < 119 so ONLY video.ended marks the cut's end.
    await activeDom?.unmount();
    activeDom = null;
    vi.unstubAllGlobals();
    const seq2 = makeSequence(
      [
        makeClip({ id: 'w1', srcUrl: '/media/webm.webm', sourceFps: 24, sourceFrames: 119, frames: 119 }),
        makeClip({ id: 'w2', srcUrl: '/media/webm.webm', sourceFps: 24, sourceFrames: 119, frames: 119 }),
      ],
      24,
    );
    const s2 = await mountPreview(seq2, { '/media/webm.webm': 4.958 }, { startFrame: 96, mode: 'chromium' });
    await s2.play(1);
    const samples2 = await s2.run(2600);
    expect(s2.rig.endedEvents).toBeGreaterThanOrEqual(1);
    expect(s2.rig.restartedFromEnded).toBe(0);
    expect(Math.max(...samples2.map((s) => s.playhead))).toBeGreaterThanOrEqual(145);
  });

  it('speed-changed cuts ending at source end (1.5× odd frame count, 2×, 0.5×, and speedCurve) cross and stop cleanly', async () => {
    const dur = 289 / 24;
    // 1.5× on 289 frames -> 193 timeline frames; at currentTime === duration, floor(289*2/3) = 192 < 193 (only video.ended fires).
    const base = makeSequence([
      makeClip({ id: 'fast15', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
      makeClip({ id: 'fast2', srcUrl: '/media/clip18.mp4', frames: 48, sourceFrames: 48 }),
      makeClip({ id: 'slow05', srcUrl: '/media/slow.mp4', frames: 24, sourceFrames: 24 }),
      makeClip({ id: 'curved', srcUrl: '/media/curve.mp4', frames: 48, sourceFrames: 48 }),
    ]);
    let seq = setClipSpeed(base, 0, 3, 2); // 1.5× -> 193 frames
    seq = setClipSpeed(seq, 1, 2, 1); // 2× -> 24 frames
    seq = setClipSpeed(seq, 2, 1, 2); // 0.5× -> 48 frames
    seq = setClipSpeedCurve(seq, 3, SPEED_PRESETS[0]!.points);
    const c0End = seq.clips[0]!.frames;
    const c1End = c0End + seq.clips[1]!.frames;
    const c2End = c1End + seq.clips[2]!.frames;
    const filmEnd = totalFrames(seq) - 1;
    expect(c0End).toBe(193);

    const session = await mountPreview(
      seq,
      {
        '/media/bottle.mp4': dur,
        '/media/clip18.mp4': 48 / 24,
        '/media/slow.mp4': 24 / 24,
        '/media/curve.mp4': 48 / 24,
      },
      { startFrame: c0End - 15, mode: 'chromium' },
    );
    await session.play(1);
    const samples = await session.run(8500);

    expect(session.rig.restartedFromEnded).toBe(0);
    expect(session.rig.endedEvents).toBeGreaterThanOrEqual(4);
    expect(samples.some((s) => s.playhead >= c0End && s.playhead < c1End)).toBe(true);
    expect(samples.some((s) => s.playhead >= c1End && s.playhead < c2End)).toBe(true);
    expect(samples.some((s) => s.playhead >= c2End && s.playhead <= filmEnd)).toBe(true);
    expect(session.controls.getState()).toEqual({ playhead: filmEnd, rate: 0 });
    expect(session.transportLabel()).toBe(studioEditorKo.timeline.play);
    expect(session.rig.element.paused).toBe(true);
  });

  it('same-file 1-frame cut at the very last frame right after a source-end cut seeks and plays instead of skipping', async () => {
    const dur = 289 / 24;
    const seq = makeSequence([
      makeClip({ id: 'a', srcUrl: '/media/bottle.mp4', frames: 289, sourceFrames: 289 }),
      makeClip({ id: 'tail', srcUrl: '/media/bottle.mp4', inFrame: 288, frames: 1, sourceFrames: 289 }),
      makeClip({ id: 'next', srcUrl: '/media/clip18.mp4', frames: 48, sourceFrames: 48 }),
    ]);
    const session = await mountPreview(
      seq,
      { '/media/bottle.mp4': dur, '/media/clip18.mp4': 48 / 24 },
      { startFrame: 270, mode: 'chromium' },
    );
    await session.play(1);
    const samples = await session.run(3000);

    expect(session.rig.restartedFromEnded).toBe(0);
    // Explicitly seeked back from duration (12.041667) to the 1-frame cut's middle (288.5 / 24).
    const tailSeek = session.rig.seeks.find((s) => s.src === '/media/bottle.mp4' && Math.abs(s.to - 288.5 / 24) < 1e-6);
    expect(tailSeek).toBeDefined();
    expect(Math.max(...samples.map((s) => s.playhead))).toBeGreaterThanOrEqual(310);
  });
});
