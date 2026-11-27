import { describe, expect, it } from 'vitest';
import { price1080KrwFor, quoteRecipe, quoteRecipeBase, quoteRecipeByResolution } from '@/lib/recipes/pricing';
import { authoredResolution, defaultRecipeResolution, recipeAtResolution, recipeResolutions, resolveRecipeResolution } from '@/lib/recipes/resolution';
import { parseRecipe, type Recipe } from '@/lib/recipes/schema';
import { baseKrw } from '@/lib/twings/template-price';
import { quoteVideo } from '@/lib/video/models';

/**
 * The buyer's resolution decides what a recipe film is rendered at and what it costs (founder,
 * 2026-11-15). The live rows that exposed the gap: a 10 s 4:3 film written at 1080p and sold at the
 * 720p price.
 */

function recipe(raw: Record<string, unknown>): Recipe {
  const checked = parseRecipe(raw, { studio: true });
  if (!checked.ok) throw new Error(JSON.stringify(checked.issues));
  return checked.recipe;
}

const film = (resolution: '720p' | '1080p', engine = 'seedance-2.5', duration = 10) => recipe({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [{ id: 'film', kind: 'video', engine, inputs: ['selfie'], prompt: 'The person in {{selfie}} walks.', params: { aspect: '4:3', duration, resolution } }],
  output: { from: 'film' },
});

const carousel = recipe({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [1, 2].map((n) => ({ id: `f${n}`, kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `Frame ${n} of {{selfie}}.`, params: { aspect: '4:5' } })),
  output: { frames: ['f1', 'f2'] },
});

describe('recipe resolution', () => {
  it('renders the film at the order resolution, whatever the recipe was written at', () => {
    const authored = film('1080p');
    const at720 = recipeAtResolution(authored, '720p');
    expect(at720.steps[0]).toMatchObject({ kind: 'video', params: { resolution: '720p', duration: 10, aspect: '4:3' } });
    // The stored recipe is never mutated: a later 1080p order reads the same template.
    expect(authored.steps[0]).toMatchObject({ params: { resolution: '1080p' } });
    expect(recipeAtResolution(film('720p'), '1080p').steps[0]).toMatchObject({ params: { resolution: '1080p' } });
  });

  it('leaves the recipe alone when no resolution was ordered, or one the engine cannot make', () => {
    const authored = film('1080p');
    expect(recipeAtResolution(authored, null)).toBe(authored);
    expect(recipeAtResolution(authored, '')).toBe(authored);
    expect(recipeAtResolution(authored, '480p')).toBe(authored);
    expect(recipeAtResolution(authored, '1080p')).toBe(authored);
    expect(recipeAtResolution(carousel, '1080p')).toBe(carousel);
  });

  it('only moves the film the buyer receives, not a clip another step reads', () => {
    // The schema allows one film today, so this shape is built by hand: the rule must already hold
    // the day a recipe may chain films.
    const base = film('720p', 'seedance-2.5', 10);
    const filmStep = base.steps[0]!;
    const chained = { ...base, steps: [{ ...filmStep, id: 'clip' }, filmStep] } as Recipe;
    const at1080 = recipeAtResolution(chained, '1080p');
    expect(at1080.steps.map((step) => (step.kind === 'video' ? step.params.resolution : null))).toEqual(['720p', '1080p']);
  });

  it('names what a recipe can sell and what it was written at', () => {
    expect(recipeResolutions(film('1080p'))).toEqual(['720p', '1080p']);
    expect(authoredResolution(film('1080p'))).toBe('1080p');
    expect(authoredResolution(film('720p'))).toBe('720p');
    expect(recipeResolutions(carousel)).toEqual([]);
    expect(authoredResolution(carousel)).toBeNull();
  });
});

describe('recipe price by resolution', () => {
  const cost = (resolution: '720p' | '1080p') => quoteVideo({ model: 'seedance-2.5', resolution, seconds: 10, aspect: '4:3' })!.providerUsd;

  it('quotes the resolution asked for, not the one the recipe was written at', () => {
    const authored = film('1080p');
    expect(quoteRecipe(authored, 0, '720p').floorKrw).toBe(baseKrw({ medium: 'video', providerUsd: cost('720p') }));
    expect(quoteRecipe(authored, 0, '1080p').floorKrw).toBe(baseKrw({ medium: 'video', providerUsd: cost('1080p') }));
    // The live row: sold at 6,800원 as 720p. Its 720p base is 4,000원, its 1080p base 9,800원.
    expect(quoteRecipe(authored, 0, '720p').floorKrw).toBe(4000);
    expect(quoteRecipe(authored, 0, '1080p').floorKrw).toBe(9800);
    // No resolution named: the recipe as written (test renders, the editor's own preview).
    expect(quoteRecipe(authored, 0).floorKrw).toBe(9800);
  });

  it('gives both prices with the same raise on top, 1080p above 720p', () => {
    const quotes = quoteRecipeByResolution(film('720p'), 1000);
    expect(Object.keys(quotes)).toEqual(['720p', '1080p']);
    expect(quotes['720p']!.proposedKrw).toBe(5000);
    expect(quotes['1080p']!.proposedKrw).toBe(10800);
    expect(quotes['1080p']!.baseCredits).toBeGreaterThan(quotes['720p']!.baseCredits);
    expect(quotes['720p']!.royaltyKrw).toBe(1000);
    expect(quotes['1080p']!.royaltyKrw).toBe(1000);
  });

  it('sells on the 720p make, and prices 1080p the same won above its own base', () => {
    const authored = film('1080p');
    // The row price is the 720p price however the film was written.
    expect(quoteRecipeBase(authored, 1000).proposedKrw).toBe(5000);
    expect(price1080KrwFor(authored, 5000)).toBe(10800);
    // The live row: 6,800원 at 720p (2,800원 above the base) puts 1080p at 12,600원.
    expect(price1080KrwFor(authored, 6800)).toBe(12600);
    expect(price1080KrwFor(carousel, 1300)).toBe(0);
    expect(quoteRecipeBase(carousel, 0)).toEqual(quoteRecipe(carousel, 0));
  });

  it('has no resolution prices for an image set', () => {
    expect(quoteRecipeByResolution(carousel, 0)).toEqual({});
  });

  it('treats a 1080p-only engine (MAGI-2) recipe as 1080p only and never defaults to 720p', () => {
    const magiRecipe = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [{ id: 'film', kind: 'video', engine: 'magi-2', inputs: ['selfie'], prompt: 'The person in {{selfie}} walks.', params: { aspect: '9:16', duration: 10, resolution: '1080p' } }],
      output: { from: 'film' },
    } as Recipe;
    expect(recipeResolutions(magiRecipe)).toEqual(['1080p']);
    expect(defaultRecipeResolution(magiRecipe)).toBe('1080p');
    expect(defaultRecipeResolution(film('720p'))).toBe('720p');
    expect(resolveRecipeResolution(magiRecipe, '')).toBe('1080p');
    expect(resolveRecipeResolution(magiRecipe, null)).toBe('1080p');
    expect(resolveRecipeResolution(magiRecipe, '1080p')).toBe('1080p');
    expect(resolveRecipeResolution(magiRecipe, '720p')).toBeNull();
    expect(recipeAtResolution(magiRecipe, '')).toBe(magiRecipe);
    expect(recipeAtResolution(magiRecipe, '720p')).toBe(magiRecipe);
    expect((recipeAtResolution(magiRecipe, null).steps[0] as Extract<Recipe['steps'][number], { kind: 'video' }>).params.resolution).toBe('1080p');
    const badMagi = {
      ...magiRecipe,
      steps: [{ id: 'film', kind: 'video', engine: 'magi-2', inputs: ['selfie'], prompt: 'The person in {{selfie}} walks.', params: { aspect: '9:16', duration: 10, resolution: '720p' } }],
    } as Recipe;
    expect((recipeAtResolution(badMagi, '').steps[0] as Extract<Recipe['steps'][number], { kind: 'video' }>).params.resolution).toBe('1080p');
    const quotes = quoteRecipeByResolution(magiRecipe, 0);
    expect(Object.keys(quotes)).toEqual(['1080p']);
    expect(quotes['1080p']!.providerUsd).toBe(0.84);
    expect(quotes['1080p']!.baseCredits).toBe(126);
    expect(quotes['1080p']!.floorKrw).toBe(1500);
    expect(quoteRecipeBase(magiRecipe, 0)).toEqual(quotes['1080p']);
    expect(price1080KrwFor(magiRecipe, 1500)).toBe(0);
  });
});
