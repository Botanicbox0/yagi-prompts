import { describe, expect, it } from 'vitest';
import {
  overLimitClips,
  promptLengthRefusal,
  promptLengthRefusalDetail,
  promptLengthUpdateRefusal,
  readPromptLengthRefusal,
  templateClipLengths,
  type TemplateLengthInput,
} from '@/lib/prompts/prompt-length';
import { parseRecipe, type Recipe } from '@/lib/recipes/schema';

/**
 * Founder, 2026-11-25: "그 15000자 원칙 잘 지켜졌나 여부" — before a template reaches buyers, every Seedance 2.5 clip it
 * sends must be within 15,000 characters. A clip is a prompt the compile reads: a plain template's main text, or each
 * result step of a recipe. Filler text only (the repo is public).
 */

const fill = (total: number, head = 'A woman walks through a quiet street at dusk. '): string => `${head}${'x'.repeat(total - head.length)}`;
const film = (promptText: string, extra: Partial<TemplateLengthInput> = {}): TemplateLengthInput => ({ promptText, medium: 'video', engine: 'seedance-2.5', runtimeSeconds: 10, ...extra });

const stillThenFilm = (filmPrompt: string): Recipe => ({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [
    { id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: fill(8_000, '{{selfie}} stands in a white studio. '), params: { aspect: '9:16' } },
    { id: 'film', kind: 'video', engine: 'seedance-2.5', inputs: ['still'], prompt: filmPrompt, params: { aspect: '9:16', duration: 10, resolution: '720p' } },
  ],
  output: { from: 'film' },
}) as Recipe;

describe('the clips of a template', () => {
  it('reads a plain template as one clip held to the model it renders on', () => {
    expect(templateClipLengths(film(fill(12_340)))).toEqual([{ clip: 1, stepId: null, chars: 12_340, limit: 15_000 }]);
    // A 10-second Seedance 2.0 template has no verified limit; a 20-second one renders on 2.5.
    expect(templateClipLengths(film(fill(20_000), { engine: 'seedance-2.0' }))).toEqual([]);
    expect(templateClipLengths(film(fill(20_000), { engine: 'seedance-2.0', runtimeSeconds: 20 }))[0]).toMatchObject({ limit: 15_000 });
    expect(templateClipLengths({ promptText: fill(20_000), medium: 'image', engine: 'gpt-image-2', runtimeSeconds: null })).toEqual([]);
  });

  it('reads a recipe template by its result steps, counted as written, its blocks included', () => {
    const recipe = stillThenFilm(fill(15_000, '{{still}} turns to the camera.\n\nTemplate styling:\n- Styled by the template: hair — a sleek low bun.\n\n'));
    expect(parseRecipe(recipe, { studio: true }).ok).toBe(true);
    // The main text is not what the compile reads for a recipe template.
    const clips = templateClipLengths({ ...film(fill(30_000)), recipe, recipeReady: true });
    expect(clips).toEqual([{ clip: 1, stepId: 'film', chars: 15_000, limit: 15_000 }]);
    expect(overLimitClips(clips)).toEqual([]);
    // Without the recipe tables the render reads the main text.
    expect(overLimitClips(templateClipLengths({ ...film(fill(30_000)), recipe, recipeReady: false }))).toHaveLength(1);
  });

  it('a recipe that reaches the gate is never over: the recipe rules refuse a 15,001-character clip first', () => {
    const over = parseRecipe(stillThenFilm(fill(15_001, '{{still}} turns. ')));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.issues.map((issue) => issue.code)).toContain('shape');
  });
});

describe('the publish gate', () => {
  it('lets exactly 15,000 through and refuses 15,001, naming the clip and both lengths', () => {
    expect(promptLengthRefusal('promptText', film(fill(15_000)))).toBeNull();
    const detail = promptLengthRefusal('promptText', film(fill(15_001)));
    expect(detail).toBe('promptText: prompt length: clip 1 is 15,001 characters; Seedance 2.5 takes up to 15,000 per clip');
    expect(readPromptLengthRefusal(detail)).toEqual({ clip: 1, chars: 15_001, limit: 15_000 });
    expect(readPromptLengthRefusal(promptLengthRefusalDetail('block', { clip: 2, stepId: 'film', chars: 15_480, limit: 15_000 }))).toEqual({ clip: 2, chars: 15_480, limit: 15_000 });
    expect(readPromptLengthRefusal('promptText: template locks: line 3 header_typo')).toBeNull();
  });

  it('lets an over-limit template be shortened step by step, never lengthened, and ignores saves that keep the text', () => {
    const before = film(fill(20_000));
    expect(promptLengthUpdateRefusal('promptText', before, film(fill(19_000)))).toBeNull();
    expect(promptLengthUpdateRefusal('promptText', before, film(fill(20_000)))).toBeNull();
    expect(promptLengthUpdateRefusal('promptText', before, film(fill(20_001)))).toMatch(/clip 1 is 20,001 characters/);
    expect(promptLengthUpdateRefusal('promptText', before, film(fill(14_000)))).toBeNull();
    // A template within the limit cannot be saved past it.
    expect(promptLengthUpdateRefusal('promptText', film(fill(14_000)), film(fill(15_001)))).toMatch(/clip 1 is 15,001 characters/);
    // The text unchanged: never refused here, whatever else the save changes.
    expect(promptLengthUpdateRefusal('promptText', before, { ...before, runtimeSeconds: 12 })).toBeNull();
  });
});
