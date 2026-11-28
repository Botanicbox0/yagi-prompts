/**
 * Editing studio v2 — how one change becomes an undo step, and the speed-curve edit built on it (review item 8).
 *
 * The editor's `change` (components/brand-studio/editor-v2/use-editor.ts) is these two functions: a change with
 * a `coalesce` key joins the previous step when the previous change had the same key and came less than
 * `MERGE_MS` before (one slider drag is one step, not one per pixel); every such change, even one that changes
 * nothing, keeps that window open. Pure.
 */
import { applyClipSpeedCurve, type SpeedCurveRefusal } from './frames';
import { commit, withSequence, type EditorDoc, type EditorHistory } from './model';
import type { SpeedPoint } from './speed-curve';

export const MERGE_MS = 900;

export interface ChangeMark {
  key: string;
  at: number;
}

/** Whether a change made `now` joins the previous step, and the mark the next change will see. */
export function mergeWindow(last: ChangeMark | null, coalesce: string | undefined, now: number): { merge: boolean; mark: ChangeMark | null } {
  const merge = !!coalesce && last?.key === coalesce && now - last.at < MERGE_MS;
  return { merge, mark: coalesce ? { key: coalesce, at: now } : null };
}

/** The document and its history after a change: `next` `null` (or the same document) changes nothing. */
export function applyChange<T extends { doc: EditorDoc; history: EditorHistory }>(stored: T, next: EditorDoc | null, merge: boolean): T {
  if (!next || next === stored.doc) return stored;
  return { ...stored, doc: next, history: merge ? stored.history : commit(stored.history, stored.doc) };
}

export interface CurveEditDeps {
  /** The document as it is now (the latest the screen holds). */
  doc: EditorDoc;
  /** The editor's change: `mutate` gives the next document, `null` for none; `coalesce` joins a drag into one step. */
  change: (mutate: (current: EditorDoc) => EditorDoc | null, coalesce?: string) => void;
  /** Says why a shape could not go on (audit A2). */
  say: (refused: SpeedCurveRefusal) => void;
  /** Whether linked overlays follow main-track edits. */
  linkage?: boolean;
}

/**
 * A speed curve on a cut as one edit. The retime is worked out once, on the document as it is now, and reused
 * when the change applies to that same document. A refused shape still goes through `change` (it changes
 * nothing) so a drag that passes through a refused stretch stays one undo step; the reason is said once.
 */
export function runCurveEdit(
  deps: CurveEditDeps,
  index: number,
  points: readonly SpeedPoint[],
  coalesce?: string,
  apply: typeof applyClipSpeedCurve = applyClipSpeedCurve,
): void {
  const base = deps.doc;
  const first = apply(base.sequence, index, points);
  deps.change((current) => {
    const result = current === base ? first : apply(current.sequence, index, points);
    return result.refused ? null : withSequence(current, result.seq, [], { linkage: deps.linkage });
  }, coalesce);
  if (first.refused) deps.say(first.refused);
}
