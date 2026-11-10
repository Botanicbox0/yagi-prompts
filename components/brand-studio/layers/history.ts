/**
 * Undo/redo for the layer document. Snapshots are whole documents (edits never mutate, so unchanged
 * layers are shared). A drag shows its in-between states with `preview` and becomes one step on
 * release with `settle`; quick repeated edits of one field (typing a hex, arrow nudges) fold into one
 * step with a `key`.
 */
export const HISTORY_CAP = 100;
/** Edits with the same key closer together than this become one step. */
export const COALESCE_MS = 900;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The key and time of the last committed step, for coalescing. */
  lastKey: string | null;
  lastAt: number;
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

/** A new step. Same `key` within COALESCE_MS replaces the last step instead of adding one. */
export function commit<T>(h: History<T>, next: T, opts: { key?: string; now?: number; cap?: number } = {}): History<T> {
  if (next === h.present) return h;
  const now = opts.now ?? Date.now();
  const cap = opts.cap ?? HISTORY_CAP;
  if (opts.key && h.lastKey === opts.key && now - h.lastAt < COALESCE_MS && h.past.length > 0) {
    return { ...h, present: next, future: [], lastAt: now };
  }
  return { past: [...h.past, h.present].slice(-cap), present: next, future: [], lastKey: opts.key ?? null, lastAt: now };
}

/** Shows a state without making it a step (the middle of a drag, an address refreshed on reopening). */
export function preview<T>(h: History<T>, next: T): History<T> {
  return next === h.present ? h : { ...h, present: next };
}

/** Ends a drag: one step from `start` (the state before the drag) to the present. */
export function settle<T>(h: History<T>, start: T, opts: { cap?: number; now?: number } = {}): History<T> {
  if (h.present === start) return h;
  return { past: [...h.past, start].slice(-(opts.cap ?? HISTORY_CAP)), present: h.present, future: [], lastKey: null, lastAt: opts.now ?? Date.now() };
}

/** Drops a preview and goes back to `start` (a drag cancelled with Escape). */
export function revert<T>(h: History<T>, start: T): History<T> {
  return { ...h, present: start };
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return h;
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1), lastKey: null, lastAt: 0 };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
