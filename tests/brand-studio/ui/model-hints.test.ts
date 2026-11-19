import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { selectableModels } from '@/lib/brand-studio/models';

/**
 * The one-line hints of the image model menu (brandStudio.models) say only what still holds (2026-11-20):
 * partial edits run on Seedream 5.5 alone (founder 2026-11-17), people may be made with GPT Image (2026-11-19),
 * and nothing claims a comparison we did not test ("matched Pro") or a superlative.
 */
describe('image model hints', () => {
  for (const locale of ['ko', 'en'] as const) {
    const models = getDictionary(locale).brandStudio.models as Record<string, string>;
    const offered = selectableModels('image');

    it(`${locale}: every offered image model has its own non-empty hint`, () => {
      expect(offered.map((m) => m.id)).toEqual(['seedream-5.5', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'nano-banana-pro', 'nano-banana-2.1']);
      for (const model of offered) expect(models[model.hintKey]?.trim(), model.id).toBeTruthy();
      expect(new Set(offered.map((m) => models[m.hintKey])).size).toBe(offered.length);
    });

    it(`${locale}: no hint offers editing, sends people elsewhere, compares untested or brags`, () => {
      for (const model of offered) {
        const hint = models[model.hintKey]!;
        expect(hint, model.id).not.toMatch(/부분 수정|고쳐|편집|\bedit/i);
        expect(hint, model.id).not.toMatch(/인물은|사람은|people.*(?:avoid|not)|not for people/i);
        expect(hint, model.id).not.toMatch(/Pro와 같|Pro만큼|match(?:es|ed)? (?:the )?Pro|as good as/i);
        expect(hint, model.id).not.toMatch(/가장|최고|최적|완벽|압도|\b(?:best|most|perfect|ultimate)\b/i);
      }
    });
  }
});
