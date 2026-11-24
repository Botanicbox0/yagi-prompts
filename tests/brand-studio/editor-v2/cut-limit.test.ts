import { describe, expect, it } from 'vitest';
import { cutLimitLine } from '@/components/brand-studio/editor-v2/use-editor';
import { MAX_COMPOSE_CLIPS } from '@/lib/brand-studio/compose/timeline';
import { studioEditorEn, studioEditorKo, type StudioEditorCopy } from '@/messages/studio-editor';

/**
 * Audit A3 (2026-11-24): past the cut limit the editor said only "no more cuts". The line now says the limit,
 * and the number comes from the limit itself (`MAX_COMPOSE_CLIPS`), never written into the dictionary.
 */
const COPIES: ReadonlyArray<[string, StudioEditorCopy]> = [
  ['ko', studioEditorKo],
  ['en', studioEditorEn],
];

describe('A3: the cut limit says the number, taken from the limit itself', () => {
  for (const [lang, copy] of COPIES) {
    it(`${lang}: "${cutLimitLine(copy)}"`, () => {
      const line = cutLimitLine(copy);
      expect(line).toContain(String(MAX_COMPOSE_CLIPS));
      expect(line).not.toMatch(/[{}]/);
      // The dictionary holds a placeholder, not the number: a changed limit changes the line.
      expect(copy.toast.full).toContain('{max}');
      expect(copy.toast.full).not.toContain(String(MAX_COMPOSE_CLIPS));
    });
  }
});
