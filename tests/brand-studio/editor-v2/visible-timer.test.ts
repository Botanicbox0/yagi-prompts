import { afterEach, describe, expect, it, vi } from 'vitest';
import { VISIBLE_STEP_CAP_MS, visibleStep } from '@/lib/brand-studio/editor-v2/refresh';

/**
 * Spec G, A2 (found by its real-screen proof): the seek path's load limit ("footage did not load", 30 s of
 * time on screen) counted the whole time a page had been hidden as soon as it was visible again: a hidden
 * page's timers barely run, and the first tick after showing it added the full gap (110 s). The export then
 * failed with "load" the moment the window came back instead of starting again. A tick now counts at most a
 * quarter of a second.
 */
describe('time on screen, as a load limit counts it', () => {
  it('a hidden tick counts nothing; a late tick counts at most the cap', () => {
    expect(visibleStep(100, false)).toBe(100);
    expect(visibleStep(110_000, true)).toBe(0);
    expect(visibleStep(110_000, false)).toBe(VISIBLE_STEP_CAP_MS);
    expect(VISIBLE_STEP_CAP_MS).toBeLessThanOrEqual(250);
    expect(visibleStep(Number.NaN, false)).toBe(0);
  });
});

describe('the load limit after a long hidden spell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('110 s hidden, then visible: not expired at once; expires after 30 s of visible time', async () => {
    let tick: (() => void) | null = null;
    let now = 0;
    const doc = { hidden: true };
    vi.stubGlobal('window', { setInterval: (cb: () => void) => ((tick = cb), 1), clearInterval: () => (tick = null) });
    vi.stubGlobal('document', doc);
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { visibleTimer } = await import('@/components/brand-studio/editor-v2/export-film');
    let expired = false;
    visibleTimer(30_000, () => (expired = true));
    // Hidden: one throttled tick after 110 s, and the page is visible by the time it runs.
    now = 110_000;
    doc.hidden = false;
    tick!();
    expect(expired).toBe(false);
    for (let i = 0; i < 290 && !expired; i += 1) {
      now += 100;
      tick!();
    }
    expect(expired).toBe(false);
    for (let i = 0; i < 20 && !expired; i += 1) {
      now += 100;
      tick!();
    }
    expect(expired).toBe(true);
  });
});
