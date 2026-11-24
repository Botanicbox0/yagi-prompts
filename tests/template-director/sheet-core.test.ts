import { describe, expect, it } from 'vitest';
import * as brand from '@/lib/brand-studio/revision/sheet';
import * as core from '@/lib/revision/sheet-core';

/**
 * docs/PERSONAL-STUDIO.md §2.3 — the kind-agnostic part of the brand change sheet moved to a shared place.
 * The brand module re-exports it under the same names; the personal edit sheet builds on it.
 */
describe('lib/revision/sheet-core', () => {
  it('is what the brand sheet module re-exports, under the same names', () => {
    expect(brand.hasChange).toBe(core.hasChange);
    expect(brand.sheetRequest).toBe(core.sheetRequest);
    expect(brand.onlyRemoved).toBe(core.onlyRemoved);
    expect(brand.withoutLast).toBe(core.withoutLast);
    expect(brand.changesDiffer).toBe(core.changesDiffer);
    expect(brand.samePoint).toBe(core.samePoint);
    expect(brand.emptySheet).toBe(core.emptySheet);
    expect(brand.SHEET_LIMITS).toMatchObject(core.SHEET_BLOCK_LIMITS);
    expect(Object.keys(brand.SHEET_LIMITS)).toEqual([
      'itemMax',
      'changeMax',
      'keepMax',
      'excludeMax',
      'questionsMax',
      'questionMax',
      'optionMax',
      'optionsMin',
      'optionsMax',
      'pointMax',
      'replyMax',
      'turnMax',
      'transcriptMax',
    ]);
  });

  it('reads only the text of a change line, whatever else the line carries', () => {
    const a = { change: [{ text: '빨간 드레스', slot: 'outfit' }, { text: '우산 들기', slot: 'prop' }] };
    const b = { change: [{ text: '  빨간   드레스 ', slot: 'outfit' }] };
    expect(core.hasChange(a)).toBe(true);
    expect(core.hasChange(null)).toBe(false);
    expect(core.sheetRequest(a)).toBe('빨간 드레스\n우산 들기');
    expect(core.onlyRemoved(a, b)).toBe(true);
    expect(core.changesDiffer(a, b)).toBe(true);
    expect(core.withoutLast(a)).toEqual({ change: [{ text: '빨간 드레스', slot: 'outfit' }] });
    expect(core.emptySheet()).toEqual({ change: [], keep: [], exclude: [] });
  });

  it('normalises, keys and de-duplicates texts within the item limit', () => {
    expect(core.normSheetText('  a \n  b ')).toBe('a b');
    expect(core.sheetTextKey(' Red  Dress ')).toBe('red dress');
    expect(core.uniqueSheetTexts(['x', ' X ', 3, '', 'y', 'z'], 2)).toEqual(['x', 'y']);
    expect(core.uniqueSheetTexts(['a'.repeat(200)], 1)[0]).toHaveLength(core.SHEET_BLOCK_LIMITS.itemMax);
    expect(core.SheetTextItemSchema.safeParse('a'.repeat(121)).success).toBe(false);
    expect(core.SheetTextItemSchema.parse('  ok ')).toBe('ok');
  });
});
