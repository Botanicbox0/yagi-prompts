import { describe, expect, it } from 'vitest';
import { fixtureDoc } from '@/lib/brand-studio/editor-v2/fixture';
import { removeClips, setAspect, splitAtFrame, spansOf, totalFrames, wholeFrameViolations } from '@/lib/brand-studio/editor-v2/frames';
import {
  HISTORY_LIMIT,
  LOOK_DETAILS,
  commit,
  formatClock,
  redo,
  scopeClipIds,
  settleScope,
  undo,
  withSequence,
  type ClipLook,
  type EditorDoc,
  type EditorHistory,
} from '@/lib/brand-studio/editor-v2/model';

const label = (id: string) => id;
const warm: ClipLook = { source: 'look', lookId: 'warm', detail: LOOK_DETAILS.warm, strength: 1 };

// The sample film: cut-1 0–113, cut-2 113–226, cut-3 226–346, cut-4 346–454 (frames at 24 fps).

describe('withSequence', () => {
  it('gives the right half of a split the look and framing of the cut it came from', () => {
    const doc: EditorDoc = { ...fixtureDoc(label), looks: { 'cut-1': warm }, reframe: { 'cut-1': { fit: 'fill', x: 30 } } };
    const next = withSequence(doc, splitAtFrame(doc.sequence, 48, 'cut-1b'), [['cut-1b', 'cut-1']]);
    expect(next.sequence.clips).toHaveLength(5);
    const [left, right] = next.sequence.clips;
    expect(left!.id).toBe('cut-1');
    expect(right!.id).toBe('cut-1b');
    expect(spansOf(next.sequence)[1]!.start).toBe(48);
    expect(next.looks['cut-1b']).toEqual(warm);
    expect(next.reframe['cut-1b']).toEqual({ fit: 'fill', x: 30 });
    expect(next.looks['cut-1']).toEqual(warm);
    expect(next.looks['cut-2']).toBeUndefined();
    expect(Object.keys(next.looks).sort()).toEqual(['cut-1', 'cut-1b']);
  });

  it('without the inherit pair a new cut starts with no extras', () => {
    const doc: EditorDoc = { ...fixtureDoc(label), looks: { 'cut-1': warm } };
    const next = withSequence(doc, splitAtFrame(doc.sequence, 48, 'cut-1b'));
    expect(Object.keys(next.looks)).toEqual(['cut-1']);
  });

  it('drops the extras of a removed cut', () => {
    const doc: EditorDoc = {
      ...fixtureDoc(label),
      looks: { 'cut-2': warm, 'cut-3': warm },
      reframe: { 'cut-2': { fit: 'fit', x: 50 } },
    };
    const next = withSequence(doc, removeClips(doc.sequence, ['cut-2']));
    expect(next.sequence.clips.map((c) => c.id)).toEqual(['cut-1', 'cut-3', 'cut-4']);
    expect(next.looks).toEqual({ 'cut-3': warm });
    expect(next.reframe).toEqual({});
  });

  it('returns the same doc when the sequence did not change', () => {
    const doc = fixtureDoc(label);
    expect(withSequence(doc, removeClips(doc.sequence, ['ghost']))).toBe(doc);
    expect(withSequence(doc, splitAtFrame(doc.sequence, 113, 'x'))).toBe(doc);
    expect(withSequence(doc, setAspect(doc.sequence, '16:9'))).toBe(doc);
  });

  it('clips titles to the new total', () => {
    // 454 frames; without the last cut, 346.
    const doc: EditorDoc = {
      ...fixtureDoc(label),
      titles: [
        { id: 'a', text: 'A', start: 0, end: 454, preset: 'big' },
        { id: 'b', text: 'B', start: 400, end: 454, preset: 'end' },
        { id: 'c', text: 'C', start: 24, end: 72, preset: 'lower' },
        { id: 'd', text: 'D', start: 346, end: 360, preset: 'lower' },
      ],
    };
    const next = withSequence(doc, removeClips(doc.sequence, ['cut-4']));
    expect(totalFrames(next.sequence)).toBe(346);
    expect(next.titles.map((t) => t.id)).toEqual(['a', 'c']);
    expect(next.titles[0]!.end).toBe(346);
    expect(next.titles[1]).toBe(doc.titles[2]);
  });

  it('keeps every frame whole when the film is split at any of its frames', () => {
    const doc: EditorDoc = { ...fixtureDoc(label), looks: { 'cut-3': warm } };
    const total = totalFrames(doc.sequence);
    for (let at = 0; at <= total; at += 1) {
      const under = spansOf(doc.sequence).find((span) => at > span.start && at < span.end);
      const sequence = splitAtFrame(doc.sequence, at, 'split');
      const next = withSequence(doc, sequence, under ? [['split', under.clip.id]] : []);
      expect(wholeFrameViolations(next.sequence), `split at ${at}`).toEqual([]);
      expect(totalFrames(next.sequence)).toBe(total);
      expect(next.sequence.clips.length, `split at ${at}`).toBe(under ? 5 : 4);
      if (!under) expect(next, `split at ${at}`).toBe(doc);
      expect(next.looks.split, `split at ${at}`).toEqual(under?.clip.id === 'cut-3' ? warm : undefined);
    }
  });
});

describe('scope', () => {
  const sequence = fixtureDoc(label).sequence;
  const all = ['cut-1', 'cut-2', 'cut-3', 'cut-4'];

  it('resolves all, current and selected', () => {
    expect(scopeClipIds(sequence, 'all', ['cut-2'], 0)).toEqual(all);
    expect(scopeClipIds(sequence, 'current', [], 264)).toEqual(['cut-3']);
    expect(scopeClipIds(sequence, 'current', [], 24)).toEqual(['cut-1']);
    // Boundaries: frame 113 is the first frame of cut 2, 112 the last of cut 1.
    expect(scopeClipIds(sequence, 'current', [], 112)).toEqual(['cut-1']);
    expect(scopeClipIds(sequence, 'current', [], 113)).toEqual(['cut-2']);
    expect(scopeClipIds(sequence, 'selected', ['cut-4', 'cut-2'], 0)).toEqual(['cut-2', 'cut-4']);
  });

  it('falls back to the whole film when the selection is empty or dead', () => {
    expect(scopeClipIds(sequence, 'selected', [], 0)).toEqual(all);
    expect(scopeClipIds(sequence, 'selected', ['ghost'], 0)).toEqual(all);
  });

  it('settleScope drops dead ids and leaves selected for all when nothing is left', () => {
    expect(settleScope(sequence, 'selected', ['cut-1', 'ghost'])).toEqual({ mode: 'selected', selection: ['cut-1'] });
    expect(settleScope(sequence, 'selected', ['ghost'])).toEqual({ mode: 'all', selection: [] });
    expect(settleScope(sequence, 'current', ['ghost'])).toEqual({ mode: 'current', selection: [] });
    expect(settleScope(sequence, 'all', [])).toEqual({ mode: 'all', selection: [] });
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
