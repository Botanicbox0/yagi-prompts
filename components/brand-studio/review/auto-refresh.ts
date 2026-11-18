/**
 * Since stage 2 (docs/BRAND-ROOMS-FEEDBACK.md §11) the team's stage re-reads when the room's pulse moves;
 * this timer is its fallback where the pulse door is not there (rooms switched off), and `composerHolds`
 * still decides when a re-read must wait.
 *
 * The team's review stage re-reads its notes on its own (docs/BRAND-ROOMS-FEEDBACK.md §4): every 15 seconds
 * while the tab is visible, and once on coming back to it. It holds off while the composer has unsent text,
 * a drawing is open or not yet sent, or a note is being sent, so a re-read never lands on half-written work
 * (the server page re-renders; the stage keeps its own composer state either way).
 */
import { useEffect, useRef } from "react";

export const REVIEW_REFRESH_MS = 15_000;

/** What the composer is holding right now. */
export interface ComposerHold {
  draft: string;
  replyDraft: string;
  /** The pen is out. */
  drawing: boolean;
  /** Strokes drawn but not yet sent with a note. */
  pendingStrokes: number;
  /** A note or a status move is on its way. */
  sending: boolean;
}

/** True while a re-read should wait. */
export function composerHolds(state: ComposerHold): boolean {
  return state.draft.trim() !== "" || state.replyDraft.trim() !== "" || state.drawing || state.pendingStrokes > 0 || state.sending;
}

const pageVisible = () => typeof document === "undefined" || document.visibilityState === "visible";

/** The timer itself, apart from React so it can be driven with fake timers. Returns the stop function. */
export function startQuietRefresh(options: { refresh: () => void; paused: () => boolean; visible?: () => boolean; intervalMs?: number }): () => void {
  const visible = options.visible ?? pageVisible;
  const tick = () => {
    if (!visible() || options.paused()) return;
    options.refresh();
  };
  const timer = setInterval(tick, options.intervalMs ?? REVIEW_REFRESH_MS);
  // Back on the tab after a while: catch up at once instead of waiting for the next tick.
  const onVisibility = () => {
    if (visible()) tick();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  return () => {
    clearInterval(timer);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** `startQuietRefresh` for a component: the latest `refresh` and `paused` are read on each tick. */
export function useQuietRefresh(refresh: () => void, paused: () => boolean, intervalMs = REVIEW_REFRESH_MS): void {
  const latest = useRef({ refresh, paused });
  useEffect(() => {
    latest.current = { refresh, paused };
  }, [refresh, paused]);
  useEffect(() => startQuietRefresh({ refresh: () => latest.current.refresh(), paused: () => latest.current.paused(), intervalMs }), [intervalMs]);
}
