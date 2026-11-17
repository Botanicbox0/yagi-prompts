import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composerHolds, REVIEW_REFRESH_MS, startQuietRefresh, type ComposerHold } from '@/components/brand-studio/review/auto-refresh';

/**
 * docs/BRAND-ROOMS-FEEDBACK.md §4 — the team's review stage re-reads its notes every 15 seconds while the tab
 * is visible, and waits while the composer holds unsent text, an open or unsent drawing, or a send in flight.
 * `AdminReviewStage` wires `ReviewStage`'s `onComposingChange` into the `paused` check below (this repo's
 * tests run without a DOM, so the timer is driven here directly with fake timers).
 */
const idle: ComposerHold = { draft: '', replyDraft: '', drawing: false, pendingStrokes: 0, sending: false };

describe('composerHolds', () => {
  it('holds for unsent text, a reply, an open pen, strokes not yet sent and a send in flight', () => {
    expect(composerHolds(idle)).toBe(false);
    expect(composerHolds({ ...idle, draft: '   \n' })).toBe(false);
    expect(composerHolds({ ...idle, draft: 'Logo smaller' })).toBe(true);
    expect(composerHolds({ ...idle, replyDraft: 'On it' })).toBe(true);
    expect(composerHolds({ ...idle, drawing: true })).toBe(true);
    expect(composerHolds({ ...idle, pendingStrokes: 2 })).toBe(true);
    expect(composerHolds({ ...idle, sending: true })).toBe(true);
  });
});

describe('startQuietRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-reads every 15 seconds, pauses while the composer holds unsent text, and never while the tab is hidden', () => {
    const refresh = vi.fn();
    const state = { composer: { ...idle }, visible: true };
    const stop = startQuietRefresh({ refresh, paused: () => composerHolds(state.composer), visible: () => state.visible });

    expect(REVIEW_REFRESH_MS).toBe(15_000);
    vi.advanceTimersByTime(14_999);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The team member starts typing: no re-read for as long as the text is unsent.
    state.composer = { ...idle, draft: 'The logo needs' };
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // A drawing in progress holds too.
    state.composer = { ...idle, drawing: true };
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Sent (or cleared): the re-reads resume.
    state.composer = { ...idle };
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(2);

    // Another tab in front: nothing.
    state.visible = false;
    vi.advanceTimersByTime(45_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    state.visible = true;
    vi.advanceTimersByTime(15_000);
    expect(refresh).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
