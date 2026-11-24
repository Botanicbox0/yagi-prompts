/**
 * docs/PERSONAL-STUDIO.md §3.4.4 (T1a) — replaying one range of the template page's example video. Tapping a fixed
 * part sets the loop (seek to `from`, play, jump back at `to`); tapping it again, tapping a beat of the keyframe strip
 * or pressing pause clears it. Pure: the player keeps the state and asks `rangeLoopSeek` on every frame.
 */

export interface RangeLoop {
  id: string;
  from: number;
  /** null: a mark with no end — seek there, never wrap. */
  to: number | null;
}

export type RangeLoopAction =
  | { type: 'tap'; id: string; from: number; to: number | null }
  | { type: 'beat' }
  | { type: 'pause' }
  | { type: 'reset' };

export function rangeLoopReducer(state: RangeLoop | null, action: RangeLoopAction): RangeLoop | null {
  if (action.type !== 'tap') return null;
  if (!Number.isFinite(action.from)) return null;
  if (state?.id === action.id) return null;
  const to = action.to !== null && Number.isFinite(action.to) && action.to > action.from ? action.to : null;
  return { id: action.id, from: action.from, to };
}

/**
 * How far before `from` playback may sit without being pulled back: a seek can land a few frames early, and the
 * clip's own loop (end → 0) lands well before it.
 */
export const RANGE_LOOP_SLACK = 0.3;

/**
 * Whether the player should be scrolled into view before a range replays: on a phone the fixed row sits a screen
 * below the clip, and a clip off screen is paused by the playback pool, so the tap would show nothing. True when less
 * than `min` of the clip's height is on screen.
 */
export function playerMostlyHidden(rect: { top: number; bottom: number; height: number }, viewportHeight: number, min = 0.6): boolean {
  if (!(rect.height > 0) || !(viewportHeight > 0)) return false;
  const visible = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
  return visible / rect.height < min;
}

/** Where to seek now, or null to leave playback alone. */
export function rangeLoopSeek(loop: RangeLoop | null, currentTime: number): number | null {
  if (!loop || loop.to === null || !Number.isFinite(currentTime)) return null;
  if (currentTime >= loop.to || currentTime < loop.from - RANGE_LOOP_SLACK) return loop.from;
  return null;
}
