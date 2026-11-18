import { describe, expect, it } from 'vitest';
import {
  canUndoEntry,
  entryHistory,
  markState,
  settleUndone,
  type AssistEntry,
  type HistoryView,
} from '@/components/brand-studio/compose/assist/assist-model';
import {
  commitHistory,
  HISTORY_LIMIT,
  initHistory,
  redoHistory,
  replaceHistory,
  undoHistory,
  type History,
} from '@/components/brand-studio/compose/history';
import { applyTimelinePatches, type ComposerProject } from '@/lib/brand-studio/compose/timeline';
import type { EditDelta } from '@/lib/brand-studio/edit-assist/diff';
import { assistFixture, deepFreeze } from './fixture';

type T = { n: number };
const t = (n: number): T => ({ n });

/** React StrictMode runs a state updater twice on the same state and keeps one result. */
function strict<S>(state: S, update: (s: S) => S): S {
  const first = update(state);
  const second = update(state);
  expect(second).toEqual(first);
  return second;
}

function frozen<S>(history: History<S>): History<S> {
  return deepFreeze(history) as History<S>;
}

describe('history — commit, undo, redo', () => {
  it('pushes the previous timeline exactly once per commit and empties redo', () => {
    const a = t(0);
    const b = t(1);
    const h = strict(frozen(initHistory(a)), (s) => commitHistory(s, b));
    expect(h.past).toEqual([a]);
    expect(h.past[0]).toBe(a);
    expect(h.present).toBe(b);
    expect(h.future).toEqual([]);
  });

  it('needs exactly one undo for one edit, and one redo to bring it back', () => {
    const a = t(0);
    const b = t(1);
    const edited = strict(frozen(initHistory(a)), (s) => commitHistory(s, b));
    const undone = strict(frozen(edited), undoHistory);
    expect(undone.present).toBe(a);
    expect(undone.past).toEqual([]);
    expect(undone.future).toEqual([b]);
    const redone = strict(frozen(undone), redoHistory);
    expect(redone.present).toBe(b);
    expect(redone.past).toEqual([a]);
    expect(redone.future).toEqual([]);
  });

  it('undo and redo move one step each, and do nothing at the ends', () => {
    let h = initHistory(t(0));
    for (let i = 1; i <= 3; i += 1) h = commitHistory(h, t(i));
    expect(h.past.map((x) => x.n)).toEqual([0, 1, 2]);
    h = undoHistory(h);
    expect([h.past.length, h.present.n, h.future.length]).toEqual([2, 2, 1]);
    h = undoHistory(undoHistory(undoHistory(h)));
    expect([h.past.length, h.present.n, h.future.map((x) => x.n)]).toEqual([0, 0, [3, 2, 1]]);
    expect(undoHistory(h)).toBe(h);
    h = redoHistory(redoHistory(redoHistory(h)));
    expect([h.past.length, h.present.n, h.future.length]).toEqual([3, 3, 0]);
    expect(redoHistory(h)).toBe(h);
  });

  it('a new edit after undo drops the redo stack', () => {
    let h = commitHistory(initHistory(t(0)), t(1));
    h = undoHistory(h);
    expect(h.future).toHaveLength(1);
    h = commitHistory(h, t(2));
    expect(h.future).toEqual([]);
    expect(h.past.map((x) => x.n)).toEqual([0]);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps on each side`, () => {
    let h = initHistory(t(0));
    for (let i = 1; i <= 40; i += 1) h = commitHistory(h, t(i));
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]!.n).toBe(40 - HISTORY_LIMIT);
    for (let i = 0; i < 40; i += 1) h = undoHistory(h);
    expect(h.past).toHaveLength(0);
    expect(h.future).toHaveLength(HISTORY_LIMIT);
    expect(h.present.n).toBe(40 - HISTORY_LIMIT);
  });

  it('committing the same timeline twice in a row adds one step, not two', () => {
    const b = t(1);
    const once = commitHistory(initHistory(t(0)), b);
    expect(commitHistory(once, b)).toBe(once);
  });

  it('replace swaps the present without a history step, and is the same applied twice', () => {
    const a = t(0);
    const saved = t(9);
    const h = commitHistory(initHistory(a), t(1));
    const replaced = replaceHistory(h, saved);
    expect(replaced.present).toBe(saved);
    expect(replaced.past).toBe(h.past);
    expect(replaced.future).toBe(h.future);
    expect(replaceHistory(replaced, saved)).toBe(replaced);
    const fresh = replaceHistory(initHistory(a), saved);
    expect([fresh.past.length, fresh.future.length]).toEqual([0, 0]);
  });

  it('never mutates its input (every transition is a pure updater)', () => {
    const h = frozen(commitHistory(commitHistory(initHistory(t(0)), t(1)), t(2)));
    const u = frozen(undoHistory(h));
    expect(() => {
      commitHistory(h, t(5));
      undoHistory(h);
      redoHistory(u);
      replaceHistory(h, t(7));
    }).not.toThrow();
    expect(h.past.map((x) => x.n)).toEqual([0, 1]);
    expect(u.future.map((x) => x.n)).toEqual([2]);
  });
});

/* ------------------------------------------------------------------ "말로 편집" history marks on top */

const trimDelta: EditDelta = { kind: 'clip_trimmed', cut: 2, beforeSec: 5, afterSec: 2 };
const view = (h: History<ComposerProject>): HistoryView => ({ current: h.present, undo: h.past, redo: h.future });

describe('history marks against the history value', () => {
  it("an applied entry's undo is live only while its timeline is the present, and one undo returns to what it replaced", () => {
    const base = assistFixture();
    const edited = applyTimelinePatches(base, [{ op: 'trim_clip', clipIndex: 1, trimEndSec: 3 }]).project;
    const later = applyTimelinePatches(edited, [{ op: 'set_aspect', aspect: '1:1' }]).project;
    const flags = { proposalOpen: false, canCreate: true };

    // The instant edit is committed once (under StrictMode the updater runs twice).
    let h = strict(initHistory(base), (s) => commitHistory(s, edited));
    let entries: AssistEntry[] = [{ id: 'a1', type: 'applied', deltas: [trimDelta], historyMark: edited, undone: false }];
    expect(markState(edited, view(h))).toBe('top');
    expect(h.past[h.past.length - 1]).toBe(base);
    expect(canUndoEntry(entries[0]!, view(h), flags)).toBe(true);

    // The entry's own undo: ONE step, straight back to the timeline it replaced.
    h = strict(h, undoHistory);
    expect(h.present).toBe(base);
    entries = [...settleUndone(entries, view(h))];
    expect(entryHistory(entries[0]!, view(h))).toBe('undone');
    expect(canUndoEntry(entries[0]!, view(h), flags)).toBe(false);

    // Redo makes it the top again.
    h = strict(h, redoHistory);
    entries = [...settleUndone(entries, view(h))];
    expect(entryHistory(entries[0]!, view(h))).toBe('top');

    // A later edit buries it; undoing that edit once makes it the top again.
    h = strict(h, (s) => commitHistory(s, later));
    expect(entryHistory(entries[0]!, view(h))).toBe('buried');
    expect(canUndoEntry(entries[0]!, view(h), flags)).toBe(false);
    h = strict(h, undoHistory);
    expect(h.present).toBe(edited);
    expect(h.past[h.past.length - 1]).toBe(base);
    expect(canUndoEntry(entries[0]!, view(h), flags)).toBe(true);
  });
});
