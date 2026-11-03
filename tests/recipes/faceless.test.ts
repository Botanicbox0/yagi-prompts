import { describe, expect, it } from 'vitest';
import { runRecipe } from '@/lib/recipes/execute';
import {
  engineStepPrompt,
  parseBrandRecipe,
  parseRecipe,
  personInputs,
  personSlots,
  recipeHasPerson,
  recipeNeedsIdentity,
  slotRole
} from '@/lib/recipes/schema';
import type { RenderEngineDeps } from '@/lib/renders/engines';
import type { RenderStore } from '@/lib/renders/store';

const A_PRODUCT = `ast_${'1'.repeat(32)}`;
const A_SCENE = `ast_${'2'.repeat(32)}`;
const A_CAST = `ast_${'3'.repeat(32)}`;
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function facelessProductRecipe() {
  return {
    version: 2,
    slots: {
      bottle: { kind: 'image', source: 'creator', asset: A_PRODUCT, role: 'product' },
      plinth: { kind: 'image', source: 'creator', asset: A_SCENE, role: 'scene' }
    },
    steps: [
      {
        id: 'still',
        kind: 'image',
        engine: 'seedream-5.0-pro',
        inputs: ['bottle', 'plinth'],
        prompt: 'Place {{bottle}} on {{plinth}} under cool studio strip light.',
        params: { aspect: '4:5' }
      },
      {
        id: 'clip',
        kind: 'video',
        engine: 'seedance-2.5',
        inputs: ['still'],
        prompt: 'Slow macro tracking past {{still}} with subtle caustic reflections.',
        params: { aspect: '9:16', duration: 5, resolution: '720p' }
      }
    ],
    output: { from: 'clip' }
  };
}

describe('recipe v2 — faceless brand recipes & person slot safety (BRAND-PRODUCT §8·§9)', () => {
  it('still rejects faceless recipes in consumer/maker mode by default', () => {
    const checked = parseRecipe(facelessProductRecipe());
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.issues.map((i) => i.code)).toContain('selfie_missing');
    }
  });

  it('accepts faceless product/scene/look/mask recipes in brand mode with zero person inputs', () => {
    const checked = parseBrandRecipe(facelessProductRecipe());
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    if (!checked.ok) return;

    expect(recipeHasPerson(checked.recipe)).toBe(false);
    expect([...personSlots(checked.recipe)]).toEqual([]);
    expect([...personInputs(checked.recipe)]).toEqual([]);
    expect(recipeNeedsIdentity(checked.recipe)).toBe(false);
    expect(slotRole('bottle', checked.recipe.slots.bottle!)).toBe('product');
    expect(slotRole('plinth', checked.recipe.slots.plinth!)).toBe('scene');
    // No identity lock line appended when no person is in the step
    expect(engineStepPrompt(checked.recipe, checked.recipe.steps[0]!)).toBe(
      'Place Image 1 on Image 2 under cool studio strip light.'
    );
  });

  it('accepts non-person user slots (product/mask) in faceless brand mode while rejecting unroled or person user slots', () => {
    const withUserProduct = parseBrandRecipe({
      version: 2,
      slots: {
        packshot: { kind: 'image', source: 'user', required: true, role: 'product' },
        mask_region: { kind: 'image', source: 'user', required: true, role: 'mask' }
      },
      steps: [
        {
          id: 'edit',
          kind: 'image',
          engine: 'nano-banana-pro',
          inputs: ['packshot', 'mask_region'],
          prompt: 'Keep {{packshot}} geometry inside {{mask_region}} on matte paper.',
          params: { aspect: '1:1' }
        }
      ],
      output: { from: 'edit' }
    });
    expect(withUserProduct.ok, JSON.stringify(withUserProduct)).toBe(true);

    // A non-selfie user slot claiming role: 'person' is rejected so face consent cannot be bypassed
    const fakePersonSlot = parseBrandRecipe({
      version: 2,
      slots: {
        other_face: { kind: 'image', source: 'user', required: true, role: 'person' }
      },
      steps: [
        {
          id: 'shot',
          kind: 'image',
          engine: 'seedream-5.0-pro',
          inputs: ['other_face'],
          prompt: 'Editorial portrait of {{other_face}}.',
          params: { aspect: '4:5' }
        }
      ],
      output: { from: 'shot' }
    });
    expect(fakePersonSlot.ok).toBe(false);
    if (!fakePersonSlot.ok) {
      expect(fakePersonSlot.issues.map((i) => i.code)).toContain('user_slot');
    }
  });

  it('enforces full face identity & ModelArk asset rules whenever a role="person" or selfie slot is present in brand mode', () => {
    const withCast = parseBrandRecipe({
      version: 2,
      slots: {
        cast: { kind: 'image', source: 'creator', asset: A_CAST, role: 'person' },
        bottle: { kind: 'image', source: 'creator', asset: A_PRODUCT, role: 'product' }
      },
      steps: [
        {
          id: 'still',
          kind: 'image',
          engine: 'seedream-5.0-pro',
          inputs: ['cast', 'bottle'],
          prompt: 'Editorial frame of {{cast}} holding {{bottle}}.',
          params: { aspect: '4:5' }
        },
        {
          id: 'film',
          kind: 'video',
          engine: 'seedance-2.5',
          inputs: ['still'],
          prompt: '{{still}} turns toward the window light.',
          params: { aspect: '9:16', duration: 5, resolution: '720p' }
        }
      ],
      output: { from: 'film' }
    });
    expect(withCast.ok, JSON.stringify(withCast)).toBe(true);
    if (!withCast.ok) return;

    expect(recipeHasPerson(withCast.recipe)).toBe(true);
    expect([...personSlots(withCast.recipe)]).toEqual(['cast']);
    expect([...personInputs(withCast.recipe)]).toEqual(['cast', 'still', 'film']);
    expect(recipeNeedsIdentity(withCast.recipe)).toBe(true);
    expect(engineStepPrompt(withCast.recipe, withCast.recipe.steps[0]!)).toContain(
      'Image 1 shows the person to feature. Keep their identity, face and features exactly as photographed.'
    );

    // If an output step drops the person when a person slot exists, `no_identity` is still raised
    const droppedPerson = parseBrandRecipe({
      version: 2,
      slots: {
        cast: { kind: 'image', source: 'creator', asset: A_CAST, role: 'person' },
        bottle: { kind: 'image', source: 'creator', asset: A_PRODUCT, role: 'product' }
      },
      steps: [
        {
          id: 'f1',
          kind: 'image',
          engine: 'seedream-5.0-pro',
          inputs: ['cast'],
          prompt: 'Portrait of {{cast}}.',
          params: { aspect: '4:5' }
        },
        {
          id: 'f2',
          kind: 'image',
          engine: 'seedream-5.0-pro',
          inputs: ['bottle'],
          prompt: 'Close-up of {{bottle}} alone.',
          params: { aspect: '4:5' }
        }
      ],
      output: { frames: ['f1', 'f2'] }
    });
    expect(droppedPerson.ok).toBe(false);
    if (!droppedPerson.ok) {
      expect(droppedPerson.issues).toContainEqual({ code: 'no_identity', step: 'f2' });
    }
  });

  it('executes a faceless brand recipe without a selfie and routes any person slot through ctx.person()', async () => {
    const checked = parseBrandRecipe({
      version: 2,
      slots: {
        bottle: { kind: 'image', source: 'creator', asset: A_PRODUCT, role: 'product' }
      },
      steps: [
        {
          id: 'hero',
          kind: 'image',
          engine: 'seedream-5.0-pro',
          inputs: ['bottle'],
          prompt: 'Studio product still of {{bottle}} on brushed aluminum.',
          params: { aspect: '4:5' }
        }
      ],
      output: { from: 'hero' }
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;

    const stored = new Map<string, Uint8Array>();
    const store: RenderStore = {
      name: 'local',
      async put(key, bytes) {
        stored.set(key, bytes);
      },
      async read(key) {
        return stored.get(key) ?? JPEG;
      },
      async url(key) {
        return `https://store.test/${key}`;
      }
    };
    let personCalls = 0;
    const engines: RenderEngineDeps = {
      seedream: {
        async generate() {
          return {
            model: 'seedream',
            images: [
              {
                url: null,
                b64: Buffer.from(JPEG).toString('base64'),
                size: '1728x2160',
                outputFormat: 'jpeg'
              }
            ],
            usage: null
          };
        }
      }
    };

    const run = await runRecipe({
      jobId: 'job-faceless-1',
      recipe: checked.recipe,
      outputAspect: '4:5',
      state: {},
      store,
      engines,
      selfie: null,
      async makerFile(handle) {
        return handle === A_PRODUCT
          ? { key: 'maker/bottle.jpg', mime: 'image/jpeg', kind: 'image', bytes: JPEG }
          : null;
      },
      async person() {
        personCalls += 1;
        return { kind: 'asset', assetId: 'asset-should-not-be-called' };
      },
      async saveStep() {}
    });

    expect(run.kind).toBe('done');
    expect(personCalls).toBe(0);
    if (run.kind === 'done') {
      expect(run.results).toEqual([
        { step: 'hero', key: 'job-faceless-1/step-hero.jpg', mime: 'image/jpeg', bytes: JPEG.byteLength }
      ]);
    }
  });
});
