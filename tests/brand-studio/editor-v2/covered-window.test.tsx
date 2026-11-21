import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportStatus } from '@/components/brand-studio/editor-v2/export-sheet';
import type { ExportJob } from '@/components/brand-studio/editor-v2/export-job';
import { LIVE, LIVE_AGAIN_FRAMES, REDUCED_GAP_MS, SCREEN_STEP_CAP_MS, nextRefreshState, screenStep, silentTooLong } from '@/lib/brand-studio/editor-v2/refresh';
import { studioEditorEn, studioEditorKo } from '@/messages/studio-editor';

/**
 * Spec E addendum, C2 (a): a window covered by another one stays "visible" but draws about once a
 * second (production, 2026-11-21: requestAnimationFrame twice in 2 s, a playing video's
 * requestVideoFrameCallback once a second). The editor watches the gaps between animation frames; the
 * export's wait for a picture counts screen time, so it never fails only because the window is covered,
 * and the sheet says why it is slow while that lasts.
 */
describe('telling a reduced refresh from a live one', () => {
  it('one long gap means reduced; it is live again only after several short gaps in a row', () => {
    let state = nextRefreshState(LIVE, 16.7);
    expect(state.reduced).toBe(false);
    state = nextRefreshState(state, 1000);
    expect(state.reduced).toBe(true);
    for (let i = 1; i < LIVE_AGAIN_FRAMES; i += 1) {
      state = nextRefreshState(state, 16.7);
      expect(state.reduced, `after ${i} short gaps`).toBe(true);
    }
    expect(nextRefreshState(state, 16.7).reduced).toBe(false);
    // A gap of exactly the limit is still live; longer is not.
    expect(nextRefreshState(LIVE, REDUCED_GAP_MS).reduced).toBe(false);
    expect(nextRefreshState(LIVE, REDUCED_GAP_MS + 1).reduced).toBe(true);
  });

  it('no animation frame for longer than the limit is reduced too (checked by a timer)', () => {
    expect(silentTooLong(REDUCED_GAP_MS)).toBe(false);
    expect(silentTooLong(REDUCED_GAP_MS + 50)).toBe(true);
  });

  it('screen time: a live screen counts real time, a screen drawing once a second counts a tenth', () => {
    expect(screenStep(16.7)).toBeCloseTo(16.7, 9);
    expect(screenStep(1000)).toBe(SCREEN_STEP_CAP_MS);
    expect(screenStep(-5)).toBe(0);
    expect(screenStep(Number.NaN)).toBe(0);
  });
});

describe('screenTimer: the export’s wait for a picture does not run out in a covered window', () => {
  // A fake window: animation frames at a chosen gap, advanced by hand.
  let now = 0;
  let queue: Array<(t: number) => void> = [];
  const advance = (ms: number, gap: number) => {
    for (let t = 0; t < ms; t += gap) {
      now += gap;
      const due = queue;
      queue = [];
      for (const callback of due) callback(now);
    }
  };

  beforeEach(() => {
    now = 0;
    queue = [];
    vi.resetModules();
    vi.stubGlobal('document', { hidden: false, visibilityState: 'visible' });
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: (t: number) => void) => queue.push(callback),
      cancelAnimationFrame: () => undefined,
      setInterval: () => 0,
      clearInterval: () => undefined,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('live (60 per second): a 4 s limit runs out after about 4 s', async () => {
    const { screenTimer } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    let expired = false;
    screenTimer(4000, () => (expired = true));
    advance(3900, 1000 / 60);
    expect(expired).toBe(false);
    advance(300, 1000 / 60);
    expect(expired).toBe(true);
  });

  it('covered (once a second): the same limit has not run out after 30 s, and does after about 40 s', async () => {
    const { refreshReduced, screenTimer, watchRefresh } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    const seen: boolean[] = [];
    const stop = watchRefresh((reduced) => seen.push(reduced));
    let expired = false;
    screenTimer(4000, () => (expired = true));
    advance(30_000, 1000);
    expect(expired).toBe(false);
    expect(refreshReduced()).toBe(true);
    advance(12_000, 1000);
    expect(expired).toBe(true);
    // Back to live: the watcher hears it.
    advance(100, 1000 / 60);
    expect(refreshReduced()).toBe(false);
    expect(seen).toEqual([false, true, false]);
    stop();
  });

  it('a hidden page counts nothing', async () => {
    const { screenTimer } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    (globalThis.document as { hidden: boolean }).hidden = true;
    let expired = false;
    screenTimer(1000, () => (expired = true));
    advance(10_000, 1000 / 60);
    expect(expired).toBe(false);
  });
});

describe('the export sheet says it while it is true', () => {
  const running = (slow: boolean): ExportJob => ({ status: 'running', progress: { phase: 'video', done: 12, total: 48 }, frames: 48, fps: 24, slow, restarts: 0 });

  it('a slow screen: one line saying why, and how to speed it up', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: running(true), copy: studioEditorKo.export }));
    expect(html).toContain('data-editor-export-slow');
    expect(html).toContain(studioEditorKo.export.slowWindow);
    // What the sheet already promises stays: editing goes on.
    expect(html).toContain(studioEditorKo.export.keepEditing);
  });

  it('a live screen: no such line', () => {
    const html = renderToStaticMarkup(h(ExportStatus, { job: running(false), copy: studioEditorKo.export }));
    expect(html).not.toContain('data-editor-export-slow');
  });

  it('both languages have the line', () => {
    expect(studioEditorKo.export.slowWindow).toMatch(/가려져|뒤에/);
    // The English says what the Korean says: covered by another window (review round 1 of part E).
    expect(studioEditorEn.export.slowWindow).toBe('This window is covered by another window, so the export is slow. Bring it to the front and it speeds up again.');
  });
});

describe('the refresh watcher stops, and no wait outlasts a visible page (review round 1 of part E, items 6 and 7)', () => {
  // A fake window with real cancelling: animation frames at a chosen gap (or none), intervals by the clock.
  let now = 0;
  let nextId = 1;
  let frames = new Map<number, (t: number) => void>();
  let intervals = new Map<number, { every: number; next: number; run: () => void }>();
  let requested = 0;
  const step = (ms: number, gap: number | null) => {
    const end = now + ms;
    while (now < end) {
      const nextFrame = gap === null ? Infinity : now + gap;
      const nextInterval = Math.min(Infinity, ...[...intervals.values()].map((i) => i.next));
      const at = Math.min(nextFrame, nextInterval, end);
      now = at;
      for (const interval of [...intervals.values()]) {
        if (interval.next <= now) {
          interval.next += interval.every;
          interval.run();
        }
      }
      if (gap !== null && at === nextFrame) {
        const due = frames;
        frames = new Map();
        for (const callback of due.values()) callback(now);
      }
    }
  };

  beforeEach(() => {
    now = 0;
    nextId = 1;
    frames = new Map();
    intervals = new Map();
    requested = 0;
    vi.resetModules();
    vi.stubGlobal('document', { hidden: false, visibilityState: 'visible' });
    vi.stubGlobal('performance', { now: () => now });
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: (t: number) => void) => {
        requested += 1;
        const id = nextId++;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      setInterval: (run: () => void, every: number) => {
        const id = nextId++;
        intervals.set(id, { every, next: now + every, run });
        return id;
      },
      clearInterval: (id: number) => intervals.delete(id),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('after the last user lets go (a timer running out inside a frame), no further frame is asked for', async () => {
    const { screenTimer } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    let expired = 0;
    screenTimer(100, () => (expired += 1));
    step(500, 1000 / 60);
    expect(expired).toBe(1);
    expect(frames.size).toBe(0);
    const asked = requested;
    step(2000, 1000 / 60);
    expect(requested).toBe(asked);
    // Used again: the loop runs again, once.
    const stop = screenTimer(10_000, () => undefined);
    step(100, 1000 / 60);
    expect(frames.size).toBe(1);
    stop();
    expect(frames.size).toBe(0);
  });

  it('a timer that starts another from inside its expiry keeps one loop, not two', async () => {
    const { screenTimer } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    screenTimer(50, () => {
      screenTimer(10_000, () => undefined);
    });
    step(1000, 1000 / 60);
    expect(frames.size).toBe(1);
  });

  it('visible, no animation frames at all: the wait still ends after its wall-clock ceiling (max(60 s, 15 × limit))', async () => {
    const { SCREEN_WALL_CEILING_MIN_MS, screenTimer } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    expect(SCREEN_WALL_CEILING_MIN_MS).toBe(60_000);
    let expired = false;
    screenTimer(4000, () => (expired = true));
    step(59_000, null);
    expect(expired).toBe(false);
    step(2_000, null);
    expect(expired).toBe(true);
    // A longer limit gets fifteen times its length.
    let long = false;
    screenTimer(8000, () => (long = true));
    step(119_000, null);
    expect(long).toBe(false);
    step(2_000, null);
    expect(long).toBe(true);
  });

  it('spec H, F1: the first wall tick after a long hidden spell does not count the spell (measured: 46.6 s in one tick after 5.5 min hidden)', async () => {
    const { screenTimer } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    (globalThis.document as { hidden: boolean }).hidden = true;
    let expired = false;
    screenTimer(4000, () => (expired = true));
    step(300_000, null);
    // Past five minutes hidden the browser runs the interval about once a minute: none for the last 46.5 s, and the
    // first tick after the page is shown comes 26 ms later.
    for (const interval of intervals.values()) interval.next = now + 46_568;
    now += 46_542;
    (globalThis.document as { hidden: boolean }).hidden = false;
    step(30_000, null);
    expect(expired).toBe(false);
    step(31_500, null);
    expect(expired).toBe(true);
  });

  it('hidden: neither the screen time nor the ceiling counts (switching tabs never fails an export)', async () => {
    const { screenTimer } = await import('@/components/brand-studio/editor-v2/screen-refresh');
    (globalThis.document as { hidden: boolean }).hidden = true;
    let expired = false;
    screenTimer(4000, () => (expired = true));
    step(600_000, null);
    expect(expired).toBe(false);
    // Visible again: the ceiling counts from here.
    (globalThis.document as { hidden: boolean }).hidden = false;
    step(61_000, null);
    expect(expired).toBe(true);
  });
});
