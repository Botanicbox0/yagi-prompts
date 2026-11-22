/**
 * Editing studio v2 — the export survives a browser that takes its codecs back (spec G, A2).
 *
 * Measured on Chromium 149 (2026-11-22, a minimised window of the script's own browser, spec G A1): an
 * H.264 `VideoEncoder` the browser runs in hardware (the default here) that has done nothing for about 90 s
 * while the page is hidden is closed by the browser, and its `error` callback gets a `DOMException` named
 * `QuotaExceededError`, "Codec reclaimed due to inactivity.". A software encoder, the `AudioEncoder` and
 * three `VideoDecoder`s (software and hardware) idle as long were not touched. The export's encoder sits idle
 * that long only when the picture it waits for does not come: the seek path in a hidden window (it waits for a
 * screen that does not draw). Nothing is lost by starting again: the file is made in memory.
 *
 * So a reclaimed encoder ends the attempt (`CodecReclaimed`), the export waits until the page is on screen
 * again (restarting hidden would only be reclaimed again a minute and a half later), and runs again from
 * frame 0, at most `MAX_RESTARTS` times. Any other error ends the export as it did.
 *
 * Pure: the attempt and the wait are given (export-film.ts), so this is tested without a browser.
 */

/** The browser took a codec back (WebCodecs reclamation): the attempt that used it cannot go on. */
export class CodecReclaimed extends Error {
  readonly codec: 'video' | 'audio';
  constructor(codec: 'video' | 'audio') {
    super(`the browser took back the ${codec} encoder (reclaimed while the page was hidden)`);
    this.name = 'CodecReclaimed';
    this.codec = codec;
  }
}

/** Reclaimed again after the last restart allowed. */
export class ReclaimedTooOften extends Error {
  readonly reclaims: number;
  readonly codec: 'video' | 'audio';
  constructor(reclaims: number, codec: 'video' | 'audio') {
    super(`the browser took back the ${codec} encoder ${reclaims} times (reclaimed while the page was hidden)`);
    this.name = 'ReclaimedTooOften';
    this.reclaims = reclaims;
    this.codec = codec;
  }
}

/** Restarts after a reclaim, before the export gives up: one budget for the whole export (spec H, F4). */
export const MAX_RESTARTS = 3;

/** The restarts an export may still make, shared by its picture pass and its sound encoding (spec H, F4). */
export interface RestartBudget {
  used: number;
  readonly max: number;
}

export function restartBudget(max = MAX_RESTARTS): RestartBudget {
  return { used: 0, max };
}

/**
 * What a codec's `error` callback gets when the browser reclaims it: a `DOMException` named
 * `QuotaExceededError` (measured, spec G A1). Nothing else counts as a reclaim: a codec found closed with no
 * error was not seen, so it stays an ordinary failure.
 */
export function isReclaim(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'QuotaExceededError';
}

/**
 * Runs `attempt`; when it ends with `CodecReclaimed`, takes one restart from `budget` (the export's one budget
 * for pictures and sound together, spec H F4; a budget of its own when none is given), calls `onRestart`
 * unless the export was already cancelled (`aborted`: no "starting again" line after a cancel, F6), waits for
 * `waitVisible` and runs it again from the start. `restarts`: how many times THIS run started again.
 */
export async function runWithRestarts<T>(
  attempt: (restarts: number) => Promise<T>,
  waitVisible: () => Promise<void>,
  options: { max?: number; budget?: RestartBudget; aborted?: () => boolean; onRestart?: (restarts: number, codec: 'video' | 'audio') => void } = {},
): Promise<{ result: T; restarts: number }> {
  const budget = options.budget ?? restartBudget(options.max ?? MAX_RESTARTS);
  for (let restarts = 0; ; restarts += 1) {
    try {
      return { result: await attempt(restarts), restarts };
    } catch (error) {
      if (!(error instanceof CodecReclaimed)) throw error;
      if (budget.used >= budget.max) throw new ReclaimedTooOften(budget.used + 1, error.codec);
      budget.used += 1;
      if (!options.aborted?.()) options.onRestart?.(budget.used, error.codec);
      await waitVisible();
    }
  }
}

/**
 * The export's restart rules in one place (spec H, F4): ONE budget for the picture pass and the sound encoding
 * together; `announce` (the sheet's line) is told which part starts again, except after a cancel. `used` is the
 * export's `restarts`.
 */
export function restarter(options: { waitVisible: () => Promise<void>; aborted: () => boolean; announce: (phase: 'video' | 'audio', restarts: number) => void; max?: number }) {
  const budget = restartBudget(options.max);
  return {
    get used() {
      return budget.used;
    },
    run: <T,>(phase: 'video' | 'audio', attempt: () => Promise<T>): Promise<T> =>
      runWithRestarts(attempt, options.waitVisible, { budget, aborted: options.aborted, onRestart: (restarts) => options.announce(phase, restarts) }).then((done) => done.result),
  };
}

/** The page's visibility, as `document` gives it (a fake in tests). */
export type VisibilitySource = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

/**
 * Resolves once `doc` is visible (at once when it already is). Cancelling rejects at once with `cancelled()`.
 */
export function whenVisible(doc: VisibilitySource, signal: AbortSignal | undefined, cancelled: () => Error): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    if (doc.visibilityState === 'visible') return resolve();
    const done = () => {
      doc.removeEventListener('visibilitychange', changed);
      signal?.removeEventListener('abort', aborted);
    };
    const changed = () => {
      if (doc.visibilityState !== 'visible') return;
      done();
      resolve();
    };
    const aborted = () => {
      done();
      reject(cancelled());
    };
    doc.addEventListener('visibilitychange', changed);
    signal?.addEventListener('abort', aborted, { once: true });
  });
}
