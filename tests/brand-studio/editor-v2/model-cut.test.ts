import { describe, expect, it } from 'vitest';
import { fixtureDoc } from '@/lib/brand-studio/editor-v2/fixture';
import {
  HISTORY_LIMIT,
  LOOK_DETAILS,
  applyDocPatches,
  commit,
  formatClock,
  redo,
  scopeClipIds,
  settleScope,
  undo,
  type ClipLook,
  type EditorDoc,
  type EditorHistory,
} from '@/lib/brand-studio/editor-v2/model';

const label = (id: string) => id;
const warm: ClipLook = { source: 'look', lookId: 'warm', detail: LOOK_DETAILS.warm, strength: 1 };

describe('applyDocPatches', () => {
  it('gives the right half of a split the look and framing of the cut it came from', () => {
    const doc: EditorDoc = { ...fixtureDoc(label), looks: { 'cut-1': warm }, reframe: { 'cut-1': { fit: 'fill', x: 30 } } };
    const { doc: next, appliedCount } = applyDocPatches(doc, [{ op: 'split_clip_at', clipIndex: 0, atMediaSec: 2 }]);
    expect(appliedCount).toBe(1);
    expect(next.project.clips).toHaveLength(5);
    const [left, right] = next.project.clips;
    expect(left!.id).toBe('cut-1');
    expect(right!.id).not.toBe('cut-1');
    expect(next.looks[right!.id]).toEqual(warm);
    expect(next.reframe[right!.id]).toEqual({ fit: 'fill', x: 30 });
    expect(next.looks['cut-1']).toEqual(warm);
    expect(next.looks['cut-2']).toBeUndefined();
    expect(Object.keys(next.looks).sort()).toEqual(['cut-1', right!.id].sort());
  });

  it('drops the extras of a removed cut', () => {
    const doc: EditorDoc = {
      ...fixtureDoc(label),
      looks: { 'cut-2': warm, 'cut-3': warm },
      reframe: { 'cut-2': { fit: 'fit', x: 50 } },
    };
    const { doc: next } = applyDocPatches(doc, [{ op: 'remove_clip', clipIndex: 1 }]);
    expect(next.project.clips.map((c) => c.id)).toEqual(['cut-1', 'cut-3', 'cut-4']);
    expect(next.looks).toEqual({ 'cut-3': warm });
    expect(next.reframe).toEqual({});
  });

  it('returns the same doc when nothing applies', () => {
    const doc = fixtureDoc(label);
    const result = applyDocPatches(doc, [{ op: 'remove_clip', clipIndex: 99 }]);
    expect(result.appliedCount).toBe(0);
    expect(result.doc).toBe(doc);
  });

  it('clips titles to the new duration', () => {
    // 4.7 + 4.7 + 5 + 4.5 = 18.9 seconds; without the last cut, 14.4.
    const doc: EditorDoc = {
      ...fixtureDoc(label),
      titles: [
        { id: 'a', text: 'A', startSec: 0, endSec: 18.9, preset: 'big' },
        { id: 'b', text: 'B', startSec: 17, endSec: 18.9, preset: 'end' },
        { id: 'c', text: 'C', startSec: 1, endSec: 3, preset: 'lower' },
      ],
    };
    const { doc: next } = applyDocPatches(doc, [{ op: 'remove_clip', clipIndex: 3 }]);
    expect(next.titles.map((t) => t.id)).toEqual(['a', 'c']);
    expect(next.titles[0]!.endSec).toBeCloseTo(14.4, 5);
    expect(next.titles[1]).toEqual(doc.titles[2]);
  });
});

describe('scope', () => {
  const project = fixtureDoc(label).project;
  const all = ['cut-1', 'cut-2', 'cut-3', 'cut-4'];

  it('resolves all, current and selected', () => {
    expect(scopeClipIds(project, 'all', ['cut-2'], 0)).toEqual(all);
    // cut 3 runs from 9.4 to 14.4 on the timeline.
    expect(scopeClipIds(project, 'current', [], 11)).toEqual(['cut-3']);
    expect(scopeClipIds(project, 'current', [], 1)).toEqual(['cut-1']);
    expect(scopeClipIds(project, 'selected', ['cut-4', 'cut-2'], 0)).toEqual(['cut-2', 'cut-4']);
  });

  it('falls back to the whole film when the selection is empty or dead', () => {
    expect(scopeClipIds(project, 'selected', [], 0)).toEqual(all);
    expect(scopeClipIds(project, 'selected', ['ghost'], 0)).toEqual(all);
  });

  it('settleScope drops dead ids and leaves selected for all when nothing is left', () => {
    expect(settleScope(project, 'selected', ['cut-1', 'ghost'])).toEqual({ mode: 'selected', selection: ['cut-1'] });
    expect(settleScope(project, 'selected', ['ghost'])).toEqual({ mode: 'all', selection: [] });
    expect(settleScope(project, 'current', ['ghost'])).toEqual({ mode: 'current', selection: [] });
    expect(settleScope(project, 'all', [])).toEqual({ mode: 'all', selection: [] });
  });
});

describe('history', () => {
  const docs = Array.from({ length: 3 }, () => fixtureDoc(label));
  const [d0, d1, d2] = docs as [EditorDoc, EditorDoc, EditorDoc];
  const empty: EditorHistory = { past: [], future: [] };

  it('undoes and redoes', () => {
    const h1 = commit(empty, d0);
    expect(h1).toEqual({ past: [d0], future: [] });
    const back = undo(h1, d1)!;
    expect(back.doc).toBe(d0);
    expect(back.history.past).toEqual([]);
    expect(back.history.future[0]).toBe(d1);
    const forward = redo(back.history, back.doc)!;
    expect(forward.doc).toBe(d1);
    expect(forward.history.past[0]).toBe(d0);
    expect(forward.history.future).toEqual([]);
  });

  it('returns null with nothing to undo or redo', () => {
    expect(undo(empty, d0)).toBeNull();
    expect(redo(empty, d0)).toBeNull();
  });

  it('a new commit clears redo', () => {
    const back = undo(commit(empty, d0), d1)!;
    expect(back.history.future).toHaveLength(1);
    const after = commit(back.history, d2);
    expect(after.future).toEqual([]);
    expect(redo(after, d2)).toBeNull();
  });

  it(`keeps at most ${HISTORY_LIMIT} steps, the newest ones`, () => {
    let history = empty;
    const all = Array.from({ length: HISTORY_LIMIT + 10 }, () => fixtureDoc(label));
    for (const doc of all) history = commit(history, doc);
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(all[10]);
    expect(history.past.at(-1)).toBe(all.at(-1));
  });
});

describe('formatClock', () => {
  it('formats whole seconds and tenths', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(21)).toBe('0:21');
    expect(formatClock(21.6)).toBe('0:22');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(4.7, true)).toBe('0:04.7');
    expect(formatClock(59.99, true)).toBe('0:59.9');
    expect(formatClock(125.3, true)).toBe('2:05.3');
    expect(formatClock(0, true)).toBe('0:00.0');
  });
});
