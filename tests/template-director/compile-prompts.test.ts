import { describe, expect, it } from 'vitest';
import { engineStepPrompt, outputSteps, parseRecipe, type Recipe } from '@/lib/recipes/schema';
import {
  planStylingDeclaration,
  promptStyling,
  templateCardStyling,
  templateCompileSource,
  withStylingBlock,
} from '@/lib/template-director/compile-prompts';
import { renderLockBlock } from '@/lib/template-director/locks';
import { checkStylingBlock, parseTemplateStyling, renderStylingBlock } from '@/lib/template-director/styling';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S2) — which prompts the personal compile reads for a template (the render pass:
 * a recipe's result steps, each with `hasPersonSlot = inputs.includes('selfie')`, else the main text), the styling a
 * card may claim from them, and the one declaration `prompt.declareStyling` writes into all of them at once.
 */

const STYLING = renderStylingBlock([
  { part: 'hair', from: 'template', note: 'a sleek low bun.' },
  { part: 'makeup', from: 'template', note: 'soft rosy cheeks.' },
]);
const HAIR_ONLY = renderStylingBlock([{ part: 'hair', from: 'template', note: 'a sleek low bun.' }]);
const PHOTO_OUTFIT = renderStylingBlock([
  { part: 'hair', from: 'template', note: 'a sleek low bun.' },
  { part: 'outfit', from: 'photo' },
]);
const BODY = 'A slow push-in on the person in a white studio.\n\n[Shot 1 - 0.0-3.0s]: the person looks up.';

const carousel = (prompts: [string, string], inputs: [string[], string[]] = [['selfie'], ['selfie']]): Recipe => ({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [
    { id: 'frame1', kind: 'image', engine: 'gpt-image-2', inputs: inputs[0], prompt: prompts[0], params: { aspect: '4:5' } },
    { id: 'frame2', kind: 'image', engine: 'gpt-image-2', inputs: inputs[1], prompt: prompts[1], params: { aspect: '4:5' } },
  ],
  output: { frames: ['frame1', 'frame2'] },
}) as Recipe;

/** A still made from the selfie, then a film made from the still: the film step never gets the person's photo. */
const stillThenFilm = (filmPrompt: string, filmInputs: string[] = ['still']): Recipe => ({
  version: 2,
  slots: { selfie: { kind: 'image', source: 'user', required: true } },
  steps: [
    { id: 'still', kind: 'image', engine: 'gpt-image-2', inputs: ['selfie'], prompt: 'A reference still of {{selfie}} in a white studio.', params: { aspect: '9:16' } },
    { id: 'film', kind: 'video', engine: 'seedance-2.0', inputs: filmInputs, prompt: filmPrompt, params: { aspect: '9:16', duration: 10, resolution: '720p' } },
  ],
  output: { from: 'film' },
}) as Recipe;

describe('the prompts an order compiles', () => {
  it('a text template: its main text, with the person', () => {
    expect(templateCompileSource({ promptText: BODY })).toEqual({ kind: 'text', prompts: [{ stepId: null, kind: null, text: BODY, person: true }] });
  });

  it('a recipe template: every result step as the engine reads it, never the main text or a step nobody shows', () => {
    const recipe = carousel([`Frame one of {{selfie}}.\n\n${STYLING}`, `Frame two of {{selfie}}.\n\n${STYLING}`]);
    const source = templateCompileSource({ promptText: 'MAIN TEXT', recipe, recipeReady: true });
    expect(source.kind).toBe('recipe');
    expect(source.prompts.map((p) => [p.stepId, p.kind, p.person])).toEqual([['frame1', 'image', true], ['frame2', 'image', true]]);
    const checked = parseRecipe(recipe, { studio: true });
    if (!checked.ok) throw new Error('fixture recipe');
    expect(source.prompts.map((p) => p.text)).toEqual(outputSteps(checked.recipe).map((id) => engineStepPrompt(checked.recipe, checked.recipe.steps.find((s) => s.id === id)!)));
    expect(source.prompts.some((p) => p.text.includes('MAIN TEXT'))).toBe(false);

    const film = templateCompileSource({ promptText: 'MAIN', recipe: stillThenFilm('The person in {{still}} turns to the camera.'), recipeReady: true });
    expect(film.prompts.map((p) => [p.stepId, p.kind, p.person])).toEqual([['film', 'video', false]]);
  });

  it('the main text when the recipe does not parse, is missing, or the recipe tables are not there', () => {
    for (const input of [
      { promptText: BODY, recipe: { version: 2, steps: [] } as unknown, recipeReady: true },
      { promptText: BODY, recipe: null, recipeReady: true },
      { promptText: BODY, recipe: carousel(['Frame one of {{selfie}}.', 'Frame two of {{selfie}}.']), recipeReady: false },
    ]) {
      expect(templateCompileSource(input).kind).toBe('text');
    }
  });
});

describe('the styling a card claims', () => {
  it('a text template: its block, the lock winning, names only', () => {
    expect(templateCardStyling({ promptText: `${BODY}\n\n${STYLING}` })).toEqual({ styled: ['hair', 'makeup'], photo: [] });
    const locked = `${BODY}\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }])}\n\n${STYLING}`;
    expect(templateCardStyling({ promptText: locked })).toEqual({ styled: ['makeup'], photo: [] });
    expect(templateCardStyling({ promptText: BODY })).toBeNull();
  });

  it('nothing for a pet template (the compile ignores `own` for a pet) or with every part locked', () => {
    expect(templateCardStyling({ promptText: `${BODY}\n\n${STYLING}`, cast: 'pet' })).toBeNull();
    expect(templateCardStyling({ promptText: `${BODY}\n\n${STYLING}`, cast: 'couple' })).toEqual({ styled: ['hair', 'makeup'], photo: [] });
    const allLocked = `${BODY}\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }, { kind: 'slot', slot: 'makeup' }])}\n\n${STYLING}`;
    expect(promptStyling(allLocked)).toBeNull();
    expect(templateCardStyling({ promptText: allLocked })).toBeNull();
  });

  it('a recipe template: what every result step declares alike — the main text does not count', () => {
    const both = carousel([`Frame one of {{selfie}}.\n\n${STYLING}`, `Frame two of {{selfie}}.\n\n${STYLING}`]);
    expect(templateCardStyling({ promptText: BODY, recipe: both, recipeReady: true })).toEqual({ styled: ['hair', 'makeup'], photo: [] });
    // The main text alone declares it: the compile never reads it, so the card claims nothing.
    const none = carousel(['Frame one of {{selfie}}.', 'Frame two of {{selfie}}.']);
    expect(templateCardStyling({ promptText: `${BODY}\n\n${STYLING}`, recipe: none, recipeReady: true })).toBeNull();
    // One step without it, or with a different one.
    const one = carousel([`Frame one of {{selfie}}.\n\n${STYLING}`, 'Frame two of {{selfie}}.']);
    expect(templateCardStyling({ promptText: BODY, recipe: one, recipeReady: true })).toBeNull();
    const differ = carousel([`Frame one of {{selfie}}.\n\n${STYLING}`, `Frame two of {{selfie}}.\n\n${HAIR_ONLY}`]);
    expect(templateCardStyling({ promptText: BODY, recipe: differ, recipeReady: true })).toBeNull();
    // A result step compiled without the person's photo ignores `own`: nothing to offer.
    expect(templateCardStyling({ promptText: BODY, recipe: stillThenFilm(`The person in {{still}} turns.\n\n${STYLING}`), recipeReady: true })).toBeNull();
    expect(templateCardStyling({ promptText: BODY, recipe: stillThenFilm(`The person in {{selfie}} turns.\n\n${STYLING}`, ['selfie']), recipeReady: true })).toEqual({ styled: ['hair', 'makeup'], photo: [] });
  });
});

describe('writing one block into a text', () => {
  it('appends it as its own paragraph when there is none', () => {
    expect(withStylingBlock(BODY, HAIR_ONLY)).toBe(`${BODY}\n\n${HAIR_ONLY}`);
    expect(withStylingBlock(`${BODY}\n\n`, HAIR_ONLY)).toBe(`${BODY}\n\n${HAIR_ONLY}`);
  });

  it('replaces the block in place and leaves every other line as written', () => {
    const before = `${BODY}\n\n${HAIR_ONLY}\n\nAfter the block.`;
    expect(withStylingBlock(before, STYLING)).toBe(`${BODY}\n\n${STYLING}\n\nAfter the block.`);
    const locks = renderLockBlock([{ kind: 'product' }]);
    // Right under a lock block (no blank line): the lock block stays and reads the same.
    expect(withStylingBlock(`${BODY}\n\n${locks}\n${HAIR_ONLY}`, STYLING)).toBe(`${BODY}\n\n${locks}\n${STYLING}`);
  });

  it('an empty block removes every styling block and closes the gap', () => {
    expect(withStylingBlock(`${BODY}\n\n${HAIR_ONLY}`, '')).toBe(BODY);
    expect(withStylingBlock(`${BODY}\n\n${HAIR_ONLY}\n\nAfter.`, '')).toBe(`${BODY}\n\nAfter.`);
    expect(withStylingBlock(`${BODY}\n\n${HAIR_ONLY}\n\nMiddle.\n\n${STYLING}`, '')).toBe(`${BODY}\n\nMiddle.`);
    expect(withStylingBlock(BODY, '')).toBe(BODY);
  });

  it('is idempotent', () => {
    const once = withStylingBlock(BODY, STYLING);
    expect(withStylingBlock(once, STYLING)).toBe(once);
  });
});

describe('prompt.declareStyling — the plan', () => {
  it('a text template: the main text only, nothing else to touch', () => {
    const plan = planStylingDeclaration({ promptText: BODY }, STYLING);
    expect(plan).toMatchObject({ ok: true, promptText: `${BODY}\n\n${STYLING}`, recipeChanged: false, texts: 1, styling: { styled: ['hair', 'makeup'], photo: [] } });
  });

  it('a recipe template: the main text and every result step, re-validated, nothing else of the recipe', () => {
    const recipe = carousel(['Frame one of {{selfie}}.', 'Frame two of {{selfie}}.']);
    const plan = planStylingDeclaration({ promptText: 'Frame one of @image1.', recipe, recipeReady: true }, PHOTO_OUTFIT);
    if (!plan.ok) throw new Error(plan.detail);
    expect(plan.recipeChanged).toBe(true);
    expect(plan.texts).toBe(3);
    // Rule 3 (2026-11-25): the makeup the block leaves out follows the photo.
    expect(plan.styling).toEqual({ styled: ['hair'], photo: ['outfit', 'makeup'] });
    expect(plan.promptText).toBe(`Frame one of @image1.\n\n${PHOTO_OUTFIT}`);
    const written = plan.recipe as Recipe;
    expect(written.steps.map((s) => s.prompt)).toEqual([`Frame one of {{selfie}}.\n\n${PHOTO_OUTFIT}`, `Frame two of {{selfie}}.\n\n${PHOTO_OUTFIT}`]);
    expect(parseRecipe(written, { studio: true }).ok).toBe(true);
    // The input is not touched.
    expect(recipe.steps[0]!.prompt).toBe('Frame one of {{selfie}}.');
    // The card now shows exactly the declaration.
    expect(templateCardStyling({ promptText: plan.promptText, recipe: written, recipeReady: true })).toEqual(plan.styling);
  });

  it('replaces an older block everywhere, and an empty block removes it everywhere', () => {
    const recipe = carousel([`Frame one of {{selfie}}.\n\n${HAIR_ONLY}`, `Frame two of {{selfie}}.\n\n${HAIR_ONLY}`]);
    const replaced = planStylingDeclaration({ promptText: `Main.\n\n${HAIR_ONLY}`, recipe, recipeReady: true }, STYLING);
    if (!replaced.ok) throw new Error(replaced.detail);
    expect((replaced.recipe as Recipe).steps.map((s) => s.prompt)).toEqual([`Frame one of {{selfie}}.\n\n${STYLING}`, `Frame two of {{selfie}}.\n\n${STYLING}`]);
    expect(replaced.promptText).toBe(`Main.\n\n${STYLING}`);
    const removed = planStylingDeclaration({ promptText: replaced.promptText, recipe: replaced.recipe, recipeReady: true }, '  ');
    if (!removed.ok) throw new Error(removed.detail);
    expect(removed.promptText).toBe('Main.');
    expect((removed.recipe as Recipe).steps.map((s) => s.prompt)).toEqual(['Frame one of {{selfie}}.', 'Frame two of {{selfie}}.']);
    expect(removed.styling).toBeNull();
    for (const step of (removed.recipe as Recipe).steps) expect(checkStylingBlock(step.prompt).state).toBe('none');
  });

  it('refuses a block that does not read, or anything besides one block', () => {
    const bad = planStylingDeclaration({ promptText: BODY }, 'Template styling:\n- Styled by the template: the eyebrows — arched.');
    expect(bad).toMatchObject({ ok: false });
    if (!bad.ok) expect(bad.detail).toMatch(/^block: template styling: line 2 unknown_line/);
    expect(planStylingDeclaration({ promptText: BODY }, `${STYLING}\n\nAnd some prose.`)).toEqual({ ok: false, detail: 'block: one `Template styling:` block and nothing else' });
    expect(planStylingDeclaration({ promptText: BODY }, 'Just prose.')).toMatchObject({ ok: false });
  });

  it('validates every text it touches: a step whose own lock block names the part refuses the whole write', () => {
    const lockedStep = `Frame two of {{selfie}}.\n\n${renderLockBlock([{ kind: 'slot', slot: 'hair' }])}`;
    const recipe = carousel(['Frame one of {{selfie}}.', lockedStep]);
    const plan = planStylingDeclaration({ promptText: 'Main.', recipe, recipeReady: true }, HAIR_ONLY);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.detail).toMatch(/^step frame2: template styling: line \d+ locked_part/);
  });

  it('refuses when buyers would still see nothing (a result step without the photo, a pet template)', () => {
    expect(planStylingDeclaration({ promptText: 'Main.', recipe: stillThenFilm('The person in {{still}} turns to the camera.'), recipeReady: true }, STYLING)).toMatchObject({ ok: false });
    expect(planStylingDeclaration({ promptText: BODY, cast: 'pet' }, STYLING)).toMatchObject({ ok: false });
  });

  it('refuses a recipe the block would push over the step limit', () => {
    const long = `${'A very long frame prompt of {{selfie}}. '.repeat(199)}`.trim();
    const recipe = carousel([long, 'Frame two of {{selfie}}.']);
    expect(parseRecipe(recipe, { studio: true }).ok).toBe(true);
    const plan = planStylingDeclaration({ promptText: 'Main.', recipe, recipeReady: true }, STYLING);
    expect(plan).toMatchObject({ ok: false });
    if (!plan.ok) expect(plan.detail).toMatch(/^recipe:/);
  });

  it('the written block parses back to the one that was declared', () => {
    const plan = planStylingDeclaration({ promptText: BODY }, `\r\n${STYLING.replace(/\n/g, '\r\n')}\r\n`);
    if (!plan.ok) throw new Error(plan.detail);
    expect(parseTemplateStyling(plan.promptText).block).toBe(STYLING);
  });
});
