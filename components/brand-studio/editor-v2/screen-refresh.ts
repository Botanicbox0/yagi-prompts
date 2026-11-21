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
let frameHandle = 0;
let silenceTimer = 0;
let users = 0;
const listeners = new Set<(reduced: boolean) => void>();
const tickers = new Set<(stepMs: number) => void>();

function notify() {
  for (const listener of listeners) listener(state.reduced);
}

function onFrame(now: number) {
  const gap = last > 0 ? now - last : 0;
  last = now;
  const before = state.reduced;
  if (gap > 0) state = nextRefreshState(state, gap);
  const step = screenStep(gap);
  for (const tick of [...tickers]) tick(step);
  if (state.reduced !== before) notify();
  frameHandle = window.requestAnimationFrame(onFrame);
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
  frameHandle = window.requestAnimationFrame(onFrame);
  silenceTimer = window.setInterval(onSilence, 250);
}

function release() {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  window.cancelAnimationFrame(frameHandle);
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

/**
 * A time limit in screen time: each animation frame adds its gap, at most `SCREEN_STEP_CAP_MS`, and a
 * hidden page adds nothing. On a live screen that is real time; in a covered window refreshing once a
 * second the same limit lasts about ten times longer. Returns a function that cancels it.
 */
export function screenTimer(limitMs: number, onExpire: () => void): () => void {
  let spent = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    tickers.delete(tick);
    release();
  };
  const tick = (step: number) => {
    if (done || document.hidden) return;
    spent += step;
    if (spent > limitMs) {
      finish();
      onExpire();
    }
  };
  tickers.add(tick);
  use();
  return finish;
}
