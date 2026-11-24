import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_CHARS, SEEDANCE_25_PROMPT_CHARS } from '@/lib/engines/prompt-limits';
import {
  INTRO_MAX,
  MAX_RECIPE_BYTES,
  MAX_RECIPE_STEPS,
  MAX_STUDIO_RECIPE_BYTES,
  NOTE_MAX,
  OUTRO_MAX,
  exportRecipe,
  parseRecipe,
  setPromptTooLong,
  type Recipe,
} from '@/lib/recipes/schema';

/**
 * Founder, 2026-11-25: Seedance 2.5 takes up to 15,000 characters PER CLIP (one generation); every other engine keeps
 * its 8,000. A step is one generation, so the rule is per step — never a total over the recipe. Filler text only: no
 * production prompt is quoted here (the repo is public).
 */

const fill = (head: string, total: number, char = 'x'): string => `${head}${char.repeat(total - head.length)}`;
const codes = (raw: unknown, studio = false): string[] => {
  const checked = parseRecipe(raw, { studio });
  return checked.ok ? [] : checked.issues.map((issue) => issue.code);
};

const film = (engine: string, prompt: string): Recipe => ({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [{ id: 'film', kind: 'video', engine, inputs: ['selfie'], prompt, params: { aspect: '9:16', duration: 10, resolution: '720p' } }],
  output: { from: 'film' },
}) as Recipe;

const stillThenFilm = (stillPrompt: string, filmPrompt: string, notes = false): Recipe => ({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [
    { id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: stillPrompt, ...(notes ? { note: '가'.repeat(NOTE_MAX) } : {}), params: { aspect: '9:16' } },
    { id: 'film', kind: 'video', engine: 'seedance-2.5', inputs: ['still'], prompt: filmPrompt, ...(notes ? { note: '가'.repeat(NOTE_MAX) } : {}), params: { aspect: '9:16', duration: 10, resolution: '720p' } },
  ],
  output: { from: 'film' },
  ...(notes ? { notes: { intro: '가'.repeat(INTRO_MAX), outro: '가'.repeat(OUTRO_MAX) } } : {}),
}) as Recipe;

const carousel = (frames: number, prompt: string, notes = false): Recipe => ({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: Array.from({ length: frames }, (_, i) => ({
    id: `frame${i + 1}`, kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt, ...(notes ? { note: '가'.repeat(NOTE_MAX) } : {}), params: { aspect: '4:5' },
  })),
  output: { frames: Array.from({ length: frames }, (_, i) => `frame${i + 1}`) },
  ...(notes ? { notes: { intro: '가'.repeat(INTRO_MAX), outro: '가'.repeat(OUTRO_MAX) } } : {}),
}) as Recipe;

describe('a step prompt is held to its own engine', () => {
  it('takes a Seedance 2.5 clip of exactly 15,000 characters, in English or Korean, and refuses 15,001', () => {
    for (const char of ['x', '가']) {
      const exact = fill('{{selfie}} ', SEEDANCE_25_PROMPT_CHARS, char);
      expect(exact).toHaveLength(15_000);
      expect(codes(film('seedance-2.5', exact)), char).toEqual([]);
      expect(codes(film('seedance-2.5', exact), true), char).toEqual([]);
      expect(codes(film('seedance-2.5', `${exact}${char}`)), char).toContain('shape');
    }
  });

  it('counts per clip, not per recipe: an image step and a film each at their own limit pass together', () => {
    // main allows one film per recipe (image → film); several clips per recipe arrive with the multi-part branch.
    const recipe = stillThenFilm(fill('{{selfie}} ', DEFAULT_PROMPT_CHARS, '가'), fill('{{still}} ', SEEDANCE_25_PROMPT_CHARS, '가'));
    expect(recipe.steps[0]!.prompt.length + recipe.steps[1]!.prompt.length).toBe(23_000);
    expect(codes(recipe)).toEqual([]);
  });

  it('still refuses 8,001 characters on every engine without a verified larger limit', () => {
    expect(codes(film('seedance-2.0', fill('{{selfie}} ', DEFAULT_PROMPT_CHARS)))).toEqual([]);
    expect(codes(film('seedance-2.0', fill('{{selfie}} ', DEFAULT_PROMPT_CHARS + 1)))).toContain('shape');
    const longStill = stillThenFilm(fill('{{selfie}} ', DEFAULT_PROMPT_CHARS + 1), '{{still}} turns to the camera.');
    const checked = parseRecipe(longStill);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.issues).toContainEqual({ code: 'shape', step: 'still' });
    expect(codes(carousel(2, fill('{{selfie}} ', DEFAULT_PROMPT_CHARS + 1)), true)).toContain('shape');
  });

  it('keeps an image-set frame at the image limit', () => {
    expect(setPromptTooLong(fill('Image 1 ', DEFAULT_PROMPT_CHARS - '{{selfie}} '.length + 'Image 1 '.length))).toBe(false);
    expect(setPromptTooLong(fill('Image 1 ', DEFAULT_PROMPT_CHARS - '{{selfie}} '.length + 'Image 1 '.length + 1))).toBe(true);
  });
});

describe('the recipe byte caps admit the largest legitimate recipe', () => {
  // UTF-8 bytes (Buffer.byteLength), as before: a Korean syllable is 3 bytes, so 15,000 of them are 45,000 bytes.
  const largest = [
    ['ten Korean frames at the image limit, every note full', carousel(MAX_RECIPE_STEPS, fill('{{selfie}} ', DEFAULT_PROMPT_CHARS, '가'), true)],
    ['a Korean still and a Korean 15,000-character film, every note full', stillThenFilm(fill('{{selfie}} ', DEFAULT_PROMPT_CHARS, '가'), fill('{{still}} ', SEEDANCE_25_PROMPT_CHARS, '가'), true)],
  ] as const;

  it.each(largest)('%s', (_name, recipe) => {
    for (const studio of [false, true]) {
      expect(codes(recipe, studio), `object studio=${studio}`).toEqual([]);
      expect(codes(exportRecipe(recipe), studio), `export studio=${studio}`).toEqual([]);
    }
  });

  it('room for every step at the largest limit in Korean, plus notes and structure', () => {
    const prompts = MAX_RECIPE_STEPS * SEEDANCE_25_PROMPT_CHARS * 3;
    expect(MAX_RECIPE_BYTES).toBeGreaterThan(prompts);
    expect(MAX_STUDIO_RECIPE_BYTES).toBeGreaterThanOrEqual(MAX_RECIPE_BYTES);
  });

  it('still refuses a recipe past the cap', () => {
    const huge = film('seedance-2.5', fill('{{selfie}} ', Math.ceil(MAX_STUDIO_RECIPE_BYTES / 3) + 1, '가'));
    expect(codes(huge)).toContain('too_large');
    expect(codes(huge, true)).toContain('too_large');
    expect(codes(JSON.stringify(huge))).toContain('too_large');
  });
});
