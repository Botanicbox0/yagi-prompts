/**
 * Editing studio v2 — telling a reduced screen refresh from a live one (spec E addendum, C2).
 *
 * Measured on production (2026-11-21): a Chrome window covered by another window stays
 * `visibilityState === 'visible'` and focused, but `requestAnimationFrame` fires about once a second and
 * a playing video's `requestVideoFrameCallback` once a second. The page cannot see that state any other
 * way, so the intervals between animation frames are watched. On this workstation a fully covered or
 * minimised Chromium window goes `hidden` instead (no frames at all); both states are handled the same:
 * time limits that wait for the screen count only what the screen actually did.
 *
 * Pure: the browser part is components/brand-studio/editor-v2/screen-refresh.ts.
 */

/** An animation-frame gap longer than this means the screen is not refreshing live (below 5 per second). */
export const REDUCED_GAP_MS = 200;
/** This many consecutive short gaps in a row mean it is live again. */
export const LIVE_AGAIN_FRAMES = 3;
/**
 * How much of one animation-frame gap a screen-time limit counts. A screen at 10 frames a second or
 * more counts in real time; one refreshing once a second counts a tenth of a second per second, so a limit
 * that is 4 s on a live screen lasts about 40 s in a covered window: nothing fails only because the window
 * is covered, and a picture that truly cannot be shown still fails in the end.
 */
export const SCREEN_STEP_CAP_MS = 100;

/** How much screen time one animation-frame gap of `gapMs` adds to a limit. */
export function screenStep(gapMs: number): number {
  if (!Number.isFinite(gapMs) || gapMs <= 0) return 0;
  return Math.min(gapMs, SCREEN_STEP_CAP_MS);
}

/**
 * The most one tick of a visible-time limit (every 100 ms) may count. A hidden page's timers barely run, so the
 * first tick after it is shown again comes long after the one before: counting that whole gap counted the
 * hidden time as time on screen (measured, spec G A2: a load limit of 30 s failed at once after 110 s hidden).
 * Measured again (spec H F1, Chromium 149, a minimised window of the script's own browser): a 100 ms interval
 * runs once a second while hidden (gaps 987–1013 ms over 60 s); past five minutes hidden it ran once in up to
 * 52 s, and the first tick after the window was shown came 26 ms later and spanned 46.6 s.
 */
export const VISIBLE_STEP_CAP_MS = 250;

/** How much time on screen one tick adds, `elapsedMs` after the previous one; at most `capMs` (twice its period or so). */
export function visibleStep(elapsedMs: number, hidden: boolean, capMs = VISIBLE_STEP_CAP_MS): number {
  if (hidden || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return Math.min(elapsedMs, capMs);
}

export interface RefreshState {
  reduced: boolean;
  /** Short gaps seen in a row since the last long one. */
  liveRun: number;
}

export const LIVE: RefreshState = { reduced: false, liveRun: LIVE_AGAIN_FRAMES };

/** The state after one more animation frame, `gapMs` after the previous one. */
export function nextRefreshState(state: RefreshState, gapMs: number): RefreshState {
  if (gapMs > REDUCED_GAP_MS) return { reduced: true, liveRun: 0 };
  const liveRun = state.liveRun + 1;
  return { reduced: state.reduced && liveRun < LIVE_AGAIN_FRAMES, liveRun };
}

/** No animation frame for longer than the reduced gap: the screen is not live (checked by a timer). */
export function silentTooLong(sinceLastFrameMs: number): boolean {
  return sinceLastFrameMs > REDUCED_GAP_MS;
}
