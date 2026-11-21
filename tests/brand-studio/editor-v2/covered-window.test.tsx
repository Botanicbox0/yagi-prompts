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
  const running = (slow: boolean): ExportJob => ({ status: 'running', progress: { phase: 'video', done: 12, total: 48 }, frames: 48, fps: 24, slow });

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
    expect(studioEditorEn.export.slowWindow).toMatch(/covered|background/);
  });
});
