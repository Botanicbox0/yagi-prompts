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

/** Where to seek now, or null to leave playback alone. */
export function rangeLoopSeek(loop: RangeLoop | null, currentTime: number): number | null {
  if (!loop || loop.to === null || !Number.isFinite(currentTime)) return null;
  if (currentTime >= loop.to || currentTime < loop.from - RANGE_LOOP_SLACK) return loop.from;
  return null;
}
