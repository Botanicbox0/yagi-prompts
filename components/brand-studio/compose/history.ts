/**
 * Undo / redo for the editing studio's timeline: one value, pure transitions.
 *
 * The composer keeps `{ past, present, future }` in ONE piece of state and changes it only through these
 * functions, passed as state updaters. React may run an updater twice (StrictMode in development); a pure
 * transition gives the same result both times, so a commit pushes the previous timeline exactly once and
 * undo / redo move exactly one step. No other state setter is ever called from inside an updater.
 *
 * Client-safe and React-free.
 */

/** Steps kept on each side, as before: 25. */
export const HISTORY_LIMIT = 25;

export interface History<T> {
  /** Oldest first; the last item is what one undo returns to. */
  past: readonly T[];
  present: T;
  /** Oldest first; the last item is what one redo returns to. */
  future: readonly T[];
}

const NONE: readonly never[] = Object.freeze([]);

function pushCapped<T>(stack: readonly T[], item: T): readonly T[] {
  return [...stack.slice(-(HISTORY_LIMIT - 1)), item];
}

export function initHistory<T>(present: T): History<T> {
  return { past: NONE, present, future: NONE };
}

/**
 * One edit: the present goes on the undo stack, the redo stack empties. Committing the timeline that is
 * already current changes nothing (so the same commit run twice adds one step, not two).
 */
export function commitHistory<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  return {
    past: pushCapped(history.past, history.present),
    present: next,
    future: history.future.length === 0 ? history.future : NONE,
  };
}

/** One step back. Nothing to undo: the same history. */
export function undoHistory<T>(history: History<T>): History<T> {
  if (history.past.length === 0) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1]!,
    future: pushCapped(history.future, history.present),
  };
}

/** One step forward. Nothing to redo: the same history. */
export function redoHistory<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  return {
    past: pushCapped(history.past, history.present),
    present: history.future[history.future.length - 1]!,
    future: history.future.slice(0, -1),
  };
}

/** Swaps the present without a history step (loading the saved timeline). */
export function replaceHistory<T>(history: History<T>, next: T): History<T> {
  return next === history.present ? history : { ...history, present: next };
}
