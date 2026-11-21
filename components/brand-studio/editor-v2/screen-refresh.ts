'use client';

import { LIVE, nextRefreshState, screenStep, silentTooLong, type RefreshState } from '@/lib/brand-studio/editor-v2/refresh';

/**
 * Editing studio v2 — is the screen refreshing live (spec E addendum, C2)? One `requestAnimationFrame`
 * loop, running only while something listens, watches the gaps between frames
 * (lib/brand-studio/editor-v2/refresh.ts): a window covered by another one can stay "visible" and still
 * draw about once a second. The export sheet says so while it lasts, and every limit that waits for the
 * screen (a frame shown, a rate measured by playback) counts screen time with `screenTimer`, so nothing
 * fails only because the window is covered; it is slow, and still exact.
 */
let state: RefreshState = LIVE;
let last = 0;
/** The animation frame asked for and not yet run, or 0: never more than one (review round 1 of part E, item 6). */
let pending = 0;
let silenceTimer = 0;
let users = 0;
const listeners = new Set<(reduced: boolean) => void>();
const tickers = new Set<(stepMs: number) => void>();

function notify() {
  for (const listener of listeners) listener(state.reduced);
}

function request() {
  if (pending === 0) pending = window.requestAnimationFrame(onFrame);
}

function onFrame(now: number) {
  pending = 0;
  const gap = last > 0 ? now - last : 0;
  last = now;
  const before = state.reduced;
  if (gap > 0) state = nextRefreshState(state, gap);
  const step = screenStep(gap);
  for (const tick of [...tickers]) tick(step);
  if (state.reduced !== before) notify();
  // Only while something still watches: the last user may have let go inside this frame.
  if (users > 0) request();
}

function onSilence() {
  if (state.reduced || last === 0 || !silentTooLong(performance.now() - last)) return;
  state = { reduced: true, liveRun: 0 };
  notify();
}

function use() {
  users += 1;
  if (users > 1) return;
  state = LIVE;
  last = 0;
  request();
  silenceTimer = window.setInterval(onSilence, 250);
}

function release() {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  if (pending !== 0) window.cancelAnimationFrame(pending);
  pending = 0;
  window.clearInterval(silenceTimer);
}

/** Calls `listener` now and whenever the screen goes from live to reduced or back. */
export function watchRefresh(listener: (reduced: boolean) => void): () => void {
  listeners.add(listener);
  use();
  listener(state.reduced);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    listeners.delete(listener);
    release();
  };
}

/** The screen is refreshing slower than live right now (only known while something watches it). */
export function refreshReduced(): boolean {
  return users > 0 && state.reduced;
}

/** The least wall-clock time a screen-time limit lasts on a visible page before it ends anyway. */
export const SCREEN_WALL_CEILING_MIN_MS = 60_000;
/** The wall-clock ceiling of a screen-time limit, as a multiple of the limit. */
export const SCREEN_WALL_CEILING_FACTOR = 15;

/**
 * A time limit in screen time: each animation frame adds its gap, at most `SCREEN_STEP_CAP_MS`, and a
 * hidden page adds nothing. It also ends after a wall-clock ceiling, `max(60 s, 15 × limit)`, counted by a
 * timer (timers still run about once a second where frames do not) and only while the page is not hidden
 * (review round 1 of part E, item 7). What each state does:
 *
 * - live screen: screen time is real time; the limit ends after `limitMs`;
 * - visible, drawing slowly (a covered window, a frame a second): screen time is a tenth of real time,
 *   so a 4 s limit ends after about 40 s, before its 60 s ceiling;
 * - visible, drawing nothing at all: no screen time; the ceiling ends it (60 s for a 4 s limit);
 * - hidden (another tab, minimised): nothing counts; it waits until the page is shown again or the
 *   person cancels: switching tabs never fails an export.
 *
 * No path waits forever while the page is visible. Returns a function that cancels it.
 */
export function screenTimer(limitMs: number, onExpire: () => void): () => void {
  let spent = 0;
  let wall = 0;
  let lastWall = performance.now();
  const ceiling = Math.max(SCREEN_WALL_CEILING_MIN_MS, SCREEN_WALL_CEILING_FACTOR * limitMs);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    tickers.delete(tick);
    window.clearInterval(wallTimer);
    release();
  };
  const expire = () => {
    finish();
    onExpire();
  };
  const tick = (step: number) => {
    if (done || document.hidden) return;
    spent += step;
    if (spent > limitMs) expire();
  };
  const wallTimer = window.setInterval(() => {
    const now = performance.now();
    if (!document.hidden) wall += now - lastWall;
    lastWall = now;
    if (!done && wall > ceiling) expire();
  }, 500);
  tickers.add(tick);
  use();
  return finish;
}
