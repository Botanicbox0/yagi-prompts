import { describe, expect, it } from 'vitest';
import {
  displayStepPrompt, engineStepPrompt, parseRecipe, personInputs, recipeCast, recipeMakeInputs, recipeNeedsIdentity,
  type Recipe, type RecipeIssueCode,
} from '@/lib/recipes/schema';

/**
 * docs/CAST-CATEGORIES.md §3 — who a recipe asks the buyer for. The safety rules, as accepted and
 * refused examples:
 *   · a solo or couple recipe requires the buyer's selfie; a pet-only recipe requires the pet instead;
 *   · a pet is not a person: it never counts as a face, so it never reaches the verified library;
 *   · a partner IS a person, but never goes to the verified library (it is not the account's face).
 */

const selfie = { kind: 'image', source: 'user', required: true } as const;
const pet = { kind: 'image', source: 'user', required: true, role: 'pet' } as const;
const partner = { kind: 'image', source: 'user', required: true, role: 'partner' } as const;

function image(id: string, inputs: string[], prompt: string, engine = 'gpt-image-2') {
  return { id, kind: 'image', engine, inputs, prompt, params: { aspect: '4:5' } };
}
function film(id: string, inputs: string[], prompt: string) {
  return { id, kind: 'video', engine: 'seedance-2.5', inputs, prompt, params: { aspect: '9:16', duration: 10, resolution: '720p' } };
}
function codes(raw: unknown): RecipeIssueCode[] {
  const checked = parseRecipe(raw);
  return checked.ok ? [] : checked.issues.map((issue) => issue.code);
}
function ok(raw: unknown): Recipe {
  const checked = parseRecipe(raw);
  if (!checked.ok) throw new Error(`refused: ${JSON.stringify(checked.issues)}`);
  return checked.recipe;
}

const petOnly = {
  version: 2, slots: { pet },
  steps: [image('portrait', ['pet'], 'A studio portrait of {{pet}} on a powder-blue backdrop.')],
  output: { from: 'portrait' },
};
const petFilm = {
  version: 2, slots: { pet },
  steps: [film('run', ['pet'], 'The dog from {{pet}} runs along a beach at dawn.')],
  output: { from: 'run' },
};
const personAndPet = {
  version: 2, slots: { selfie, pet },
  steps: [image('walk', ['selfie', 'pet'], '{{selfie}} walks {{pet}} through a quiet park in autumn.')],
  output: { from: 'walk' },
};
const personAndPetFilm = {
  version: 2, slots: { selfie, pet },
  steps: [film('walk', ['selfie', 'pet'], '{{selfie}} walks {{pet}} through a quiet park in autumn.')],
  output: { from: 'walk' },
};
const couple = {
  version: 2, slots: { selfie, partner },
  steps: [image('portrait', ['selfie', 'partner'], '{{selfie}} and {{partner}} share an umbrella on a rainy street.')],
  output: { from: 'portrait' },
};

describe('which photo a recipe requires, by cast', () => {
  it('a solo recipe still requires the selfie', () => {
    expect(codes({ version: 2, slots: {}, steps: [image('a', ['x'], 'Hello {{x}} there, a long prompt.')], output: { from: 'a' } })).toContain('selfie_missing');
  });

  it('a pet-only recipe needs no selfie — the pet is the required photo', () => {
    expect(codes(petOnly)).toEqual([]);
    expect(codes(petFilm)).toEqual([]);
    expect(recipeMakeInputs(ok(petOnly))).toEqual({ selfie: false, pet: true, partner: false });
  });

  it('a person + pet recipe asks for both', () => {
    expect(codes(personAndPet)).toEqual([]);
    expect(recipeMakeInputs(ok(personAndPet))).toEqual({ selfie: true, pet: true, partner: false });
  });

  it('a couple recipe requires the buyer’s selfie AND the partner', () => {
    expect(codes(couple)).toEqual([]);
    expect(recipeMakeInputs(ok(couple))).toEqual({ selfie: true, pet: false, partner: true });
    // A partner without the buyer is someone else's face with nobody's consent on file.
    const partnerOnly = { version: 2, slots: { partner }, steps: [image('p', ['partner'], 'A portrait of {{partner}} by a window.')], output: { from: 'p' } };
    expect(codes(partnerOnly)).toContain('selfie_missing');
  });

  it('an optional pet or partner slot is refused — the buyer is always asked for it', () => {
    expect(codes({ ...petOnly, slots: { pet: { ...pet, required: false } } })).toContain('cast_slot');
    expect(codes({ ...couple, slots: { selfie, partner: { ...partner, required: false } } })).toContain('cast_slot');
  });

  it('pet and partner slots use their fixed names', () => {
    const renamed = { ...petOnly, slots: { dog: pet }, steps: [image('portrait', ['dog'], 'A studio portrait of {{dog}} on a powder-blue backdrop.')] };
    expect(codes(renamed)).toContain('cast_slot');
  });

  it('one cast per recipe: pet and partner together are refused', () => {
    const mixed = {
      version: 2, slots: { selfie, partner, pet },
      steps: [image('a', ['selfie', 'partner', 'pet'], '{{selfie}} and {{partner}} hold {{pet}} in a garden.')],
      output: { from: 'a' },
    };
    expect(codes(mixed)).toContain('cast_mix');
  });

  it('every result shows the cast: a pet result without the pet is refused', () => {
    const lost = {
      version: 2, slots: { selfie, pet },
      steps: [image('a', ['selfie', 'pet'], '{{selfie}} with {{pet}} in a park, wide shot.'), image('b', ['selfie'], 'A close-up of {{selfie}} smiling at the camera.')],
      output: { frames: ['a', 'b'] },
    };
    expect(codes(lost)).toContain('no_pet');
    const lostPartner = {
      version: 2, slots: { selfie, partner },
      steps: [image('a', ['selfie', 'partner'], '{{selfie}} and {{partner}} on a bench at dusk.'), image('b', ['selfie'], 'A close-up of {{selfie}} smiling at the camera.')],
      output: { frames: ['a', 'b'] },
    };
    expect(codes(lostPartner)).toContain('no_partner');
  });

  it('the recipe names its cast', () => {
    expect(recipeCast(ok(petOnly))).toBe('pet');
    expect(recipeCast(ok(personAndPet))).toBe('pet');
    expect(recipeCast(ok(couple))).toBe('couple');
  });
});

describe('a pet is not a person', () => {
  it('a pet never counts as a face', () => {
    expect(personInputs(ok(petOnly)).size).toBe(0);
    expect([...personInputs(ok(personAndPet))]).toEqual(['selfie', 'walk']);
  });

  it('a pet-only film needs no verified library — no face check at all', () => {
    expect(recipeNeedsIdentity(ok(petFilm))).toBe(false);
    // The buyer's face in the same film still goes through it.
    expect(recipeNeedsIdentity(ok(personAndPetFilm))).toBe(true);
  });

  it('the engine is told which image is the pet, and the person line is not attached to it', () => {
    const recipe = ok(personAndPet);
    const text = engineStepPrompt(recipe, recipe.steps[0]!);
    expect(text).toContain('Image 1 shows the person to feature.');
    expect(text).toContain('Image 2 shows the pet to feature.');
    const alone = ok(petOnly);
    const lone = engineStepPrompt(alone, alone.steps[0]!);
    expect(lone).not.toContain('person');
    expect(lone).toContain('Image 1 shows the pet to feature.');
  });

  it('the readable prompt labels the pet and partner instead of “step 0”', () => {
    const labels = { selfie: '내 사진', reference: '참조 {n}', step: '{n}단계 결과', pet: '반려동물 사진', partner: '상대 사진' };
    const recipe = ok(personAndPet);
    expect(displayStepPrompt(recipe, recipe.steps[0]!, labels)).toBe('[내 사진] walks [반려동물 사진] through a quiet park in autumn.');
    const two = ok(couple);
    expect(displayStepPrompt(two, two.steps[0]!, labels)).toBe('[내 사진] and [상대 사진] share an umbrella on a rainy street.');
  });
});

describe('a partner never reaches the verified library', () => {
  it('a couple film on a ModelArk engine is refused (the library holds only the account’s own face)', () => {
    const coupleFilm = {
      version: 2, slots: { selfie, partner },
      steps: [film('dance', ['selfie', 'partner'], '{{selfie}} and {{partner}} dance in an empty ballroom.')],
      output: { from: 'dance' },
    };
    expect(codes(coupleFilm)).toContain('partner_asset');
  });

  it('…nor through an image made from the partner', () => {
    const laundered = {
      version: 2, slots: { selfie, partner },
      steps: [
        image('still', ['selfie', 'partner'], '{{selfie}} and {{partner}} on a rooftop at night.'),
        film('move', ['still'], 'The couple in {{still}} turn toward the city lights.'),
      ],
      output: { from: 'move' },
    };
    expect(codes(laundered)).toContain('partner_asset');
  });

  it('two people in one step are named as two people', () => {
    const recipe = ok(couple);
    expect(engineStepPrompt(recipe, recipe.steps[0]!)).toContain('Image 1, Image 2 show the two people to feature. Keep each person’s identity');
  });
});
