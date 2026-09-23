/**
 * Audit H3: the studio's pay/make button could double-submit — no re-entry check while a request
 * was in flight, and `finally` re-enabled the button right after `location.assign` had started
 * the navigation (a second click then created a second order or render).
 *
 * A plain object held in a ref, so a second click in the same tick (before React re-renders the
 * disabled button) is refused, and a submission that ends in navigation stays locked.
 */
export interface SubmitGuard {
  /** False while a submission is in flight or the page is navigating away. */
  begin(): boolean;
  /** The submission ends by leaving the page: stay locked. */
  leave(): void;
  /** True when the button should re-enable (the submission ended here, with an error). */
  finish(): boolean;
}

export function createSubmitGuard(): SubmitGuard {
  let inFlight = false;
  let leaving = false;
  return {
    begin() {
      if (inFlight || leaving) return false;
      inFlight = true;
      return true;
    },
    leave() {
      leaving = true;
    },
    finish() {
      if (leaving) return false;
      inFlight = false;
      return true;
    },
  };
}
