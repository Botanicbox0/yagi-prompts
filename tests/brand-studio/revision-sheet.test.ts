import { describe, expect, it } from 'vitest';
import {
  cleanSheet,
  lengthOfSheet,
  onlyRemoved,
  openQuestion,
  samePoint,
  sheetRequest,
  wayOfSheet,
  withoutLast,
  type ReviseQuestion,
} from '@/lib/brand-studio/revision/sheet';

/** The change sheet of the revise conversation (lib/brand-studio/revision/sheet.ts). */
describe('the change sheet', () => {
  it('keeps only well-formed items, once each, within the limits', () => {
    const sheet = cleanSheet({
      change: [
        { text: '  배경을   바다로 ', kind: 'look' },
        { text: '배경을 바다로', kind: 'look' },
        { text: 'x', kind: 'vibes' },
        { text: 12, kind: 'look' },
        { text: '10초로', kind: 'length' },
        { text: '10초로 늘리기', kind: 'length', seconds: 10.4 },
      ],
      keep: ['병', '병', '', 3, '카메라 움직임'],
      exclude: 'nope',
    });
    expect(sheet).toEqual({
      change: [
        { text: '배경을 바다로', kind: 'look' },
        { text: '10초로 늘리기', kind: 'length', seconds: 10 },
      ],
      keep: ['병', '카메라 움직임'],
      exclude: [],
    });
    expect(cleanSheet(null)).toEqual({ change: [], keep: [], exclude: [] });
    expect(cleanSheet({ change: Array.from({ length: 9 }, (_, i) => ({ text: `c${i}`, kind: 'look' })) }).change).toHaveLength(6);
  });

  it('is edited when every change is a look, made again otherwise, and nothing when empty', () => {
    expect(wayOfSheet({ change: [] })).toBeNull();
    expect(wayOfSheet({ change: [{ text: 'a', kind: 'look' }, { text: 'b', kind: 'look' }] })).toBe('edit');
    for (const kind of ['motion', 'framing'] as const) expect(wayOfSheet({ change: [{ text: 'a', kind: 'look' }, { text: 'b', kind }] })).toBe('reshoot');
    expect(wayOfSheet({ change: [{ text: '10초', kind: 'length', seconds: 10 }] })).toBe('reshoot');
  });

  it('reads its length, writes its request and loses its last change', () => {
    const sheet = { change: [{ text: '배경 바다', kind: 'look' as const }, { text: '10초로', kind: 'length' as const, seconds: 10 }], keep: ['병'], exclude: [] };
    expect(lengthOfSheet(sheet)).toBe(10);
    expect(lengthOfSheet({ change: [] })).toBeNull();
    expect(sheetRequest(sheet)).toBe('배경 바다\n10초로');
    expect(withoutLast(sheet).change).toEqual([{ text: '배경 바다', kind: 'look' }]);
    expect(onlyRemoved(sheet, withoutLast(sheet))).toBe(true);
    expect(onlyRemoved(sheet, { ...sheet, change: [{ text: '배경 숲', kind: 'look' }] })).toBe(false);
    expect(onlyRemoved(sheet, sheet)).toBe(false);
  });

  it('has an open question only when the last one is neither answered nor skipped', () => {
    const q = (o: Partial<ReviseQuestion>): ReviseQuestion => ({ point: 'p', question: 'q?', options: ['a', 'b'], answer: null, ...o });
    expect(openQuestion([])).toBeNull();
    expect(openQuestion([q({})])).toBe(0);
    expect(openQuestion([q({ answer: 'a' }), q({})])).toBe(1);
    expect(openQuestion([q({}), q({ answer: 'b' })])).toBeNull();
    expect(openQuestion([q({ skipped: true })])).toBeNull();
    expect(samePoint('Background target', 'background-target')).toBe(true);
    expect(samePoint('background target', 'logo place')).toBe(false);
  });
});
