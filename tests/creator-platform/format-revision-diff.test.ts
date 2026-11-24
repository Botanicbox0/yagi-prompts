import { describe, expect, it } from 'vitest';
import { canonicalJson, readRevisionRefusal, recipeSha256, recipeTextOnlyDiff, revisionRefusalDetail } from '@/lib/creator-platform/format-revision';
import { carouselRecipe, filmRecipe } from '../helpers/format-fixture';

/**
 * docs/CREATOR-PLATFORM.md (2026-11-25) — `recipeTextOnlyDiff`: a revision may change the WORDS of step prompts, step
 * notes and the recipe's intro/outro, and nothing else — not a step, an id, a kind, an engine, an input, a slot, the
 * output, a duration, a resolution, an aspect, nor whether a text field is there at all.
 */

const clone = <T>(value: T): T => structuredClone(value);
type Mutable = Record<string, any>;

describe('recipeTextOnlyDiff', () => {
  const film = filmRecipe(undefined, { note: 'Shot on a rainy night.', intro: 'How the alley film was made.' });

  it('accepts changed words in prompt, note, intro and outro, and names exactly those fields', () => {
    const next = clone(film) as Mutable;
    next.steps[0].prompt = `${next.steps[0].prompt}\n\nTemplate styling:\n- Styled by the template: the hairstyle — a sleek low bun.`;
    next.steps[0].note = 'Shot on a rainy night, handheld.';
    next.notes.intro = 'How it was made.';
    expect(recipeTextOnlyDiff(film, next)).toEqual({ ok: true, changed: ['notes.intro', 'steps.0.note', 'steps.0.prompt'] });
  });

  it('reports nothing changed for the same recipe, whatever the key order', () => {
    const reordered = JSON.parse(JSON.stringify({ output: film.output, steps: film.steps, slots: film.slots, version: film.version, notes: film.notes }));
    expect(recipeTextOnlyDiff(film, reordered)).toEqual({ ok: true, changed: [] });
    expect(canonicalJson(reordered)).toBe(canonicalJson(film));
    expect(recipeSha256(reordered)).toBe(recipeSha256(film));
    expect(recipeSha256(reordered)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a carousel: each frame’s words may change, frame by frame', () => {
    const set = carouselRecipe(['Frame one of {{selfie}} by a window.', 'Frame two of {{selfie}} on a stool.']);
    const next = clone(set) as Mutable;
    next.steps[1].prompt = 'Frame two of {{selfie}} on a stool, soft light.';
    expect(recipeTextOnlyDiff(set, next)).toEqual({ ok: true, changed: ['steps.1.prompt'] });
  });

  const structural: Array<[string, (r: Mutable) => void, string]> = [
    ['engine', (r) => { r.steps[0].engine = 'seedance-2.0'; }, 'steps.0.engine'],
    ['kind', (r) => { r.steps[0].kind = 'image'; }, 'steps.0.kind'],
    ['id', (r) => { r.steps[0].id = 'movie'; }, 'steps.0.id'],
    ['an input', (r) => { r.steps[0].inputs = ['selfie', 'selfie']; }, 'steps.0.inputs'],
    ['duration', (r) => { r.steps[0].params.duration = 12; }, 'steps.0.params.duration'],
    ['resolution', (r) => { r.steps[0].params.resolution = '1080p'; }, 'steps.0.params.resolution'],
    ['aspect', (r) => { r.steps[0].params.aspect = '16:9'; }, 'steps.0.params.aspect'],
    ['a duration given as a string', (r) => { r.steps[0].params.duration = '10'; }, 'steps.0.params.duration'],
    ['an added step', (r) => { r.steps.push({ ...r.steps[0], id: 'extra' }); }, 'steps'],
    ['a removed step', (r) => { r.steps.pop(); }, 'steps'],
    ['the output', (r) => { r.output = { from: 'other' }; }, 'output.from'],
    ['a slot', (r) => { r.slots.selfie.required = false; }, 'slots.selfie.required'],
    ['an added slot', (r) => { r.slots.look = { kind: 'image', source: 'creator', asset: `ast_${'0'.repeat(32)}` }; }, 'slots.look'],
    ['the version', (r) => { r.version = 3; }, 'version'],
    ['a note removed', (r) => { delete r.steps[0].note; }, 'steps.0.note'],
    ['notes removed', (r) => { delete r.notes; }, 'notes'],
    ['an outro added', (r) => { r.notes.outro = 'Post yours.'; }, 'notes.outro'],
    ['a prompt that is not a string', (r) => { r.steps[0].prompt = 42; }, 'steps.0.prompt'],
    ['an unknown key', (r) => { r.steps[0].seed = 7; }, 'steps.0.seed'],
  ];
  for (const [name, mutate, field] of structural) {
    it(`refuses ${name} (${field})`, () => {
      const next = clone(film) as Mutable;
      mutate(next);
      expect(recipeTextOnlyDiff(film, next)).toEqual({ ok: false, field });
    });
  }

  it('refuses a structural change hidden next to a text change', () => {
    const next = clone(film) as Mutable;
    next.steps[0].prompt = 'A different prompt about {{selfie}} in the rain.';
    next.steps[0].params.duration = 15;
    expect(recipeTextOnlyDiff(film, next)).toEqual({ ok: false, field: 'steps.0.params.duration' });
  });

  it('refuses anything that is not a recipe object', () => {
    for (const bad of [null, [], 'recipe', 1]) {
      expect(recipeTextOnlyDiff(film, bad)).toEqual({ ok: false, field: '(root)' });
      expect(recipeTextOnlyDiff(bad, film)).toEqual({ ok: false, field: '(root)' });
    }
  });

  it('the refusal detail round-trips for the admin panel', () => {
    const detail = revisionRefusalDetail({ ok: false, code: 'structural', detail: 'steps.0.engine' });
    expect(detail).toBe('formatRevision:structural steps.0.engine');
    expect(readRevisionRefusal(detail)).toEqual({ code: 'structural', detail: 'steps.0.engine' });
    expect(readRevisionRefusal('formatRevision:stale')).toEqual({ code: 'stale', detail: '' });
    expect(readRevisionRefusal('promptText: template locks: line 3 unknown_line')).toBeNull();
  });
});
