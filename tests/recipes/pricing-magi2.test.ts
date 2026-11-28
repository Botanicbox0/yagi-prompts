import { describe, expect, it } from 'vitest';
import { RecipePricingError, quoteRecipe, stepCosts } from '@/lib/recipes/pricing';
import type { Recipe } from '@/lib/recipes/schema';

const makeVideoRecipe = (engine: string, resolution: '720p' | '1080p' = '1080p', duration = 10): Recipe =>
  ({
    version: 2,
    slots: { selfie: { kind: 'image', source: 'user', required: true } },
    steps: [
      {
        id: 'film',
        kind: 'video',
        engine,
        inputs: ['selfie'],
        prompt: 'The person in {{selfie}} walks in the rain.',
        params: { aspect: '9:16', duration, resolution },
      },
    ],
    output: { from: 'film' },
  }) as Recipe;

describe('recipe stepCosts error handling and MAGI-2 pricing', () => {
  it('prices a 10s MAGI-2 recipe step from 0.08 * seconds * 1.05', () => {
    const recipe = makeVideoRecipe('magi-2', '1080p', 10);
    expect(stepCosts(recipe)).toEqual([{ step: 'film', providerUsd: 0.84 }]);
    expect(quoteRecipe(recipe, 0)).toMatchObject({
      providerUsd: 0.84,
      providerKrw: 1176,
      baseCredits: 126,
      floorKrw: 1500,
      proposedKrw: 1500,
    });
  });

  it('refuses an unknown engine with a typed RecipePricingError instead of pricing it at 0', () => {
    const unknownVideo = makeVideoRecipe('nonexistent-video-engine', '720p', 10);
    expect(() => stepCosts(unknownVideo)).toThrow(RecipePricingError);
    expect(() => stepCosts(unknownVideo)).toThrow(/unknown_engine|nonexistent-video-engine/);
    try {
      stepCosts(unknownVideo);
    } catch (error) {
      expect(error).toBeInstanceOf(RecipePricingError);
      expect((error as RecipePricingError).code).toBe('unknown_engine');
    }

    const unknownImage = {
      version: 2,
      slots: { selfie: { kind: 'image', source: 'user', required: true } },
      steps: [
        {
          id: 'still',
          kind: 'image',
          engine: 'nonexistent-image-engine',
          inputs: ['selfie'],
          prompt: 'Portrait of {{selfie}}.',
          params: { aspect: '4:5' },
        },
      ],
      output: { from: 'still' },
    } as Recipe;
    expect(() => stepCosts(unknownImage)).toThrow(RecipePricingError);
  });

  it('refuses an unquotable step (e.g. MAGI-2 at 720p) with RecipePricingError instead of pricing it at 0', () => {
    const badRes = makeVideoRecipe('magi-2', '720p', 10);
    expect(() => stepCosts(badRes)).toThrow(RecipePricingError);
    try {
      stepCosts(badRes);
    } catch (error) {
      expect(error).toBeInstanceOf(RecipePricingError);
      expect((error as RecipePricingError).code).toBe('unquotable_step');
    }
  });
});
