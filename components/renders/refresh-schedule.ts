/**
 * docs/PLATFORM-2.0.md §3.2-4 — the wait page's poll, made polite.
 *
 * `router.refresh()` re-runs the server page, and that run is also what nudges the queue (a film
 * waiting on the provider is polled there). So the poll is worth keeping, but not at full speed
 * forever and not for a tab nobody is looking at:
 *
 *   · every 6s while the job is young, every 15s once it is two minutes old;
 *   · nothing while the tab is hidden; one refresh the moment it is shown again (the reader came
 *     back to see where it is), then the normal rhythm.
 *
 * A plain module with the browser passed in, so the rhythm is tested with fake timers rather than
 * trusted.
 */
export const REFRESH_FAST_MS = 6_000;
export const REFRESH_SLOW_MS = 15_000;
export const REFRESH_SLOW_AFTER_MS = 120_000;

export function refreshDelay(elapsedMs: number): number {
  return elapsedMs < REFRESH_SLOW_AFTER_MS ? REFRESH_FAST_MS : REFRESH_SLOW_MS;
}

export interface RefreshHost {
  isHidden(): boolean;
  /** Subscribe to visibility changes; returns the unsubscribe. */
  onVisibilityChange(listener: () => void): () => void;
  now(): number;
}

/** Starts the loop; `since` is when the job was created (epoch ms). Returns the stop function. */
export function startRefreshLoop(refresh: () => void, host: RefreshHost, since: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clear();
    if (stopped || host.isHidden()) return;
    timer = setTimeout(() => {
      timer = null;
      if (stopped || host.isHidden()) return;
      refresh();
      schedule();
    }, refreshDelay(Math.max(0, host.now() - since)));
  };

  const unsubscribe = host.onVisibilityChange(() => {
    if (host.isHidden()) {
      clear();
      return;
    }
    refresh();
    schedule();
  });
  schedule();

  return () => {
    stopped = true;
    clear();
    unsubscribe();
  };
}
