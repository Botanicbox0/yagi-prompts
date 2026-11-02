import { describe, expect, it } from 'vitest';
import { needsIdentity } from '@/lib/identity/service';
import {
  MAKER_ENGINE_IDS, displayStepPrompt, engineStepPrompt, exportRecipe, identityPath, legacyPromptText, parseRecipe,
  personInputs, primaryStep, promptTokens, recipeAssets, recipeMedium, recipeNeedsIdentity, type Recipe, type RecipeIssueCode,
} from '@/lib/recipes/schema';
import { isRoyalty, quoteRecipe, ROYALTY_DEFAULT_KRW } from '@/lib/recipes/pricing';

/** docs/PLATFORM-2.0.md §7.3 — the recipe rules, as accepted and refused examples. */

const A1 = `ast_${'a'.repeat(32)}`, A2 = `ast_${'b'.repeat(32)}`, V1 = `ast_${'c'.repeat(32)}`;
const selfie = { kind: 'image', source: 'user', required: true } as const;

/** The §7.3 example: a Seedream character sheet, then a Seedance film with a maker scene. */
function filmRecipe(): Record<string, unknown> {
  return {
    version: 2,
    slots: { selfie, scene: { kind: 'image', source: 'creator', asset: A1 } },
    steps: [
      { id: 'sheet', kind: 'image', engine: 'seedream-5.0-pro', inputs: ['selfie'], prompt: 'Character reference sheet of {{selfie}}, front and side views.', params: { aspect: '16:9' } },
      { id: 'shot1', kind: 'video', engine: 'seedance-2.5', inputs: ['sheet', 'scene'], prompt: 'The person from {{sheet}} walks through {{scene}} at dusk.', params: { aspect: '9:16', duration: 10, resolution: '720p' } },
    ],
    output: { from: 'shot1' },
  };
}
function carousel(n: number): Record<string, unknown> {
  return {
    version: 2,
    slots: { selfie },
    steps: Array.from({ length: n }, (_, i) => ({ id: `f${i + 1}`, kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: `Frame ${i + 1}: {{selfie}} on a sunny street.`, params: { aspect: '4:5' } })),
    output: { frames: Array.from({ length: n }, (_, i) => `f${i + 1}`) },
  };
}
const single = (kind: 'image' | 'video'): Record<string, unknown> => ({
  version: 2, slots: { selfie },
  steps: [kind === 'image'
    ? { id: 'photo', kind, engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'A film still of {{selfie}} in a diner.', params: { aspect: '4:5' } }
    : { id: 'clip', kind, engine: 'seedance-2.0', inputs: ['selfie'], prompt: 'A slow dolly in on {{selfie}} in the rain.', params: { aspect: '9:16', duration: 8, resolution: '720p' } }],
  output: { from: kind === 'image' ? 'photo' : 'clip' },
});
function mutate(base: Record<string, unknown>, change: (r: any) => void): Record<string, unknown> {
  const copy = structuredClone(base);
  change(copy);
  return copy;
}
function codes(raw: unknown): RecipeIssueCode[] {
  const checked = parseRecipe(raw);
  return checked.ok ? [] : checked.issues.map((i) => i.code);
}

describe('recipe v2 schema — accepted', () => {
  it.each([
    ['the §7.3 image → film example', filmRecipe(), 'video'],
    ['one image', single('image'), 'image'],
    ['one film', single('video'), 'video'],
    ['a one-frame carousel', carousel(1), 'carousel'],
    ['a ten-frame carousel', carousel(10), 'carousel'],
    ['a film reading a maker video', mutate(single('video'), (r) => { r.slots.move = { kind: 'video', source: 'creator', asset: V1 }; r.steps[0].inputs = ['selfie', 'move']; r.steps[0].prompt = '{{selfie}} copies the dance in {{move}}.'; }), 'video'],
    ['a carousel whose second frame reads the first', mutate(carousel(2), (r) => { r.steps[1].inputs = ['f1']; r.steps[1].prompt = 'Same person as {{f1}}, now at night.'; }), 'carousel'],
    ['a JSON string', JSON.stringify(filmRecipe()), 'video'],
    ['tokens with inner spaces', mutate(single('image'), (r) => { r.steps[0].prompt = 'A film still of {{ selfie }} in a diner.'; }), 'image'],
  ])('%s', (_name, raw, medium) => {
    const checked = parseRecipe(raw);
    expect(checked.ok, JSON.stringify(checked)).toBe(true);
    if (checked.ok) expect(checked.medium).toBe(medium);
  });
});

describe('recipe v2 schema — refused', () => {
  it.each<[string, Record<string, unknown> | string, RecipeIssueCode]>([
    ['no selfie slot', mutate(single('image'), (r) => { delete r.slots.selfie; }), 'selfie_missing'],
    ['the selfie as a maker file', mutate(single('image'), (r) => { r.slots.selfie = { kind: 'image', source: 'creator', asset: A1 }; }), 'selfie_missing'],
    ['a second customer input', mutate(single('image'), (r) => { r.slots.pet = selfie; r.steps[0].inputs = ['selfie', 'pet']; r.steps[0].prompt = '{{selfie}} with {{pet}}.'; }), 'user_slot'],
    ['an unknown engine', mutate(single('image'), (r) => { r.steps[0].engine = 'midjourney'; }), 'engine'],
    ['an unmeasured engine (GPT Image 2.5 Sunburst)', mutate(single('image'), (r) => { r.steps[0].engine = 'gpt-image-2.5-sunburst'; }), 'engine'],
    // R2: wired and priced, but outside the maker list until the real-person smoke has run (PLATFORM-2.0 §7.3).
    ['Nano Banana before its smoke', mutate(single('image'), (r) => { r.steps[0].engine = 'nano-banana-2.1'; }), 'engine'],
    ['Kling before its smoke', mutate(single('video'), (r) => { r.steps[0].engine = 'kling-omni'; }), 'engine'],
    ['a 4:3 frame Kling has no setting for', mutate(single('video'), (r) => { r.steps[0].engine = 'kling-omni'; r.steps[0].params.aspect = '4:3'; }), 'aspect'],
    ['a 20-second film on Kling 3.0 Omni', mutate(single('video'), (r) => { r.steps[0].engine = 'kling-omni'; r.steps[0].params.duration = 20; }), 'duration'],
    ['a film engine on an image step', mutate(single('image'), (r) => { r.steps[0].engine = 'seedance-2.0'; }), 'engine_kind'],
    ['a token the step does not read', mutate(single('image'), (r) => { r.steps[0].prompt = '{{selfie}} beside {{scene}}.'; }), 'unknown_token'],
    ['an input the prompt never names', mutate(filmRecipe(), (r) => { r.steps[1].prompt = 'The person from {{sheet}} at dusk.'; }), 'unused_input'],
    ['a broken token', mutate(single('image'), (r) => { r.steps[0].prompt = 'A still of {{selfie} in a diner.'; }), 'bad_token'],
    ['an engine handle', mutate(single('image'), (r) => { r.steps[0].prompt = 'A still of {{selfie}} like @image1 in a diner.'; }), 'raw_handle'],
    ['a later step as input (cycle)', mutate(filmRecipe(), (r) => { r.steps[0].inputs = ['selfie', 'shot1']; r.steps[0].prompt = '{{selfie}} as in {{shot1}}.'; }), 'forward_input'],
    ['an input that does not exist', mutate(single('image'), (r) => { r.steps[0].inputs = ['selfie', 'ghost']; r.steps[0].prompt = '{{selfie}} and {{ghost}}.'; }), 'unknown_input'],
    ['a maker video on an image step', mutate(single('image'), (r) => { r.slots.move = { kind: 'video', source: 'creator', asset: V1 }; r.steps[0].inputs = ['selfie', 'move']; r.steps[0].prompt = '{{selfie}} doing {{move}}.'; }), 'video_input'],
    ['a film fed into a film', mutate(filmRecipe(), (r) => { r.steps[0] = { ...r.steps[1], id: 'first', inputs: ['selfie'], prompt: 'Clip of {{selfie}}.' }; r.steps[1].inputs = ['first', 'scene']; r.steps[1].prompt = '{{first}} in {{scene}}.'; }), 'step_layout'],
    ['two films', mutate(single('video'), (r) => { r.steps.push({ ...r.steps[0], id: 'clip2' }); r.output = { from: 'clip2' }; }), 'step_layout'],
    ['a film first, image last', mutate(filmRecipe(), (r) => { r.steps.reverse(); }), 'forward_input'],
    ['an eleven-frame carousel', carousel(11), 'shape'],
    ['a carousel with a film', mutate(carousel(2), (r) => { r.steps[1] = { id: 'f2', kind: 'video', engine: 'seedance-2.0', inputs: ['selfie'], prompt: 'Clip of {{selfie}}.', params: { aspect: '9:16', duration: 5, resolution: '720p' } }; }), 'step_layout'],
    ['an output that is not the last step', mutate(filmRecipe(), (r) => { r.output = { from: 'sheet' }; }), 'output'],
    ['a frame that is no step', mutate(carousel(2), (r) => { r.output.frames = ['f1', 'nope']; }), 'output'],
    ['a hidden step nobody reads', mutate(carousel(2), (r) => { r.output.frames = ['f1']; }), 'output'],
    ['a result without the selfie', mutate(carousel(2), (r) => { r.slots.bg = { kind: 'image', source: 'creator', asset: A1 }; r.steps[1].inputs = ['bg']; r.steps[1].prompt = 'Just {{bg}}.'; }), 'no_identity'],
    ['a maker file nobody uses', mutate(single('image'), (r) => { r.slots.prop = { kind: 'image', source: 'creator', asset: A2 }; }), 'unused_slot'],
    ['a 20-second Seedance 2.0 film', mutate(single('video'), (r) => { r.steps[0].params.duration = 20; }), 'duration'],
    ['a 2-second film', mutate(single('video'), (r) => { r.steps[0].params.duration = 2; }), 'duration'],
    ['a step and a slot with one name', mutate(single('image'), (r) => { r.slots.photo = { kind: 'image', source: 'creator', asset: A1 }; r.steps[0].inputs = ['selfie', 'photo']; r.steps[0].prompt = '{{selfie}} and {{photo}}.'; }), 'name_clash'],
    ['an unknown property', mutate(single('image'), (r) => { r.steps[0].seed = 42; }), 'shape'],
    ['a bad asset handle', mutate(single('image'), (r) => { r.slots.prop = { kind: 'image', source: 'creator', asset: 'products/1.png' }; }), 'shape'],
    ['version 1', mutate(single('image'), (r) => { r.version = 1; }), 'shape'],
    ['an image aspect a film uses', mutate(single('image'), (r) => { r.steps[0].params.aspect = '4:3'; }), 'shape'],
    ['not JSON', '{"version":2,', 'shape'],
    ['too large', JSON.stringify(mutate(single('image'), (r) => { r.steps[0].prompt = `{{selfie}} ${'x'.repeat(50_000)}`; })), 'too_large'],
  ])('%s', (_name, raw, code) => {
    expect(codes(raw)).toContain(code);
  });
});

describe('recipe v2 helpers', () => {
  const recipe = (parseRecipe(filmRecipe()) as { ok: true; recipe: Recipe }).recipe;

  it('numbers references by input order and names the face', () => {
    expect(engineStepPrompt(recipe, recipe.steps[1]!)).toBe('The person from Image 1 walks through Image 2 at dusk.\n\nImage 1 shows the person to feature. Keep their identity, face and features exactly as photographed.');
    const withVideo = (parseRecipe(mutate(single('video'), (r) => { r.slots.move = { kind: 'video', source: 'creator', asset: V1 }; r.steps[0].inputs = ['move', 'selfie']; r.steps[0].prompt = '{{selfie}} copies {{move}}.'; })) as { ok: true; recipe: Recipe }).recipe;
    expect(engineStepPrompt(withVideo, withVideo.steps[0]!)).toMatch(/^Image 1 copies Video 1\./);
  });

  it('shows a reader the prompt with [내 사진] and numbered references, never a token', () => {
    const labels = { selfie: '내 사진', reference: '참조 {n}', step: '{n}단계 결과' };
    expect(displayStepPrompt(recipe, recipe.steps[0]!, labels)).toBe('Character reference sheet of [내 사진], front and side views.');
    expect(displayStepPrompt(recipe, recipe.steps[1]!, labels)).toBe('The person from [1단계 결과] walks through [참조 1] at dusk.');
  });

  it('knows which inputs carry the face and when the verified library is needed', () => {
    expect([...personInputs(recipe)]).toEqual(['selfie', 'sheet', 'shot1']);
    expect(recipeNeedsIdentity(recipe)).toBe(true);
    const openai = (parseRecipe(carousel(2)) as { ok: true; recipe: Recipe }).recipe;
    expect(recipeNeedsIdentity(openai)).toBe(false);
    expect(primaryStep(recipe).id).toBe('shot1');
    expect(recipeMedium(openai)).toBe('carousel');
    expect(recipeAssets(recipe)).toEqual([A1]);
  });

  it('keeps the real-person path equal to the identity service', () => {
    for (const engine of MAKER_ENGINE_IDS) expect(identityPath(engine) === 'asset', engine).toBe(needsIdentity(engine));
  });

  it('round-trips through export and keeps the legacy prompt in the catalogue dialect', () => {
    const again = parseRecipe(exportRecipe(recipe));
    expect(again.ok && again.recipe).toEqual(recipe);
    expect(legacyPromptText(recipe)).toMatch(/^The person from @image1 walks through @image2 at dusk\./);
    expect(promptTokens('a {{x}} b {{ y_2 }}')).toEqual(['x', 'y_2']);
    expect(promptTokens('a {{X}}')).toBeNull();
  });
});

describe('maker price proposal (§8.3)', () => {
  it('adds the royalty to the cost floor of every step, frames at the image minimum', () => {
    expect(isRoyalty(ROYALTY_DEFAULT_KRW)).toBe(true);
    for (const bad of [400, 5100, 1550, 1500.5]) expect(isRoyalty(bad)).toBe(false);
    const film = quoteRecipe((parseRecipe(filmRecipe()) as { ok: true; recipe: Recipe }).recipe, 1500);
    expect(film.steps.map((s) => s.step)).toEqual(['sheet', 'shot1']);
    expect(film.floorKrw % 100).toBe(0);
    expect(film.proposedKrw).toBe(film.floorKrw + 1500);
    const three = quoteRecipe((parseRecipe(carousel(3)) as { ok: true; recipe: Recipe }).recipe, 500);
    expect(three.floorKrw).toBeGreaterThanOrEqual(3 * 200);
    expect(three.proposedCents).toBe(Math.ceil(three.proposedKrw / 1400 * 100));
  });
});
