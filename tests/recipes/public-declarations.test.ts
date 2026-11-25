import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPublicRecipe, recipeTeaser } from '@/lib/recipes/public';
import { displayStepPrompt, parseRecipe } from '@/lib/recipes/schema';
import { publicPromptText, publicRecipeText } from '@/lib/template-director/public-text';
import { renderLockBlock } from '@/lib/template-director/locks';
import { renderStylingBlock } from '@/lib/template-director/styling';
import { FIXTURE_FILM_PROMPT, carouselRecipe, filmRecipe, seedFormatTemplate } from '../helpers/format-fixture';
import { freshDb, runner } from '../helpers/pglite';

/**
 * docs/CREATOR-PLATFORM.md (2026-11-25) — a template that discloses its recipe prompts shows (and copies) them WITHOUT
 * the `Template styling:` / `Template locks:` blocks: those are the studio compiler's instructions. Without either block
 * the shown text is byte-identical to before. The stored recipe keeps both.
 */

const LABELS = { selfie: '내 사진', reference: '참조 {n}', step: '{n}단계 결과' };
const STYLING = renderStylingBlock([
  { part: 'hair', from: 'template', note: 'a sleek low bun.' },
  { part: 'makeup', from: 'template', note: 'soft rosy cheeks.' },
]);
const LOCKS = renderLockBlock([{ kind: 'slot', slot: 'outfit' }]);

describe('publicPromptText — the one helper, as the recipe projection uses it', () => {
  it('takes out both blocks, apart or back to back, and nothing else', () => {
    const body = 'A slow push-in on [내 사진] in a rain-lit alley.\n\nNeon reflections on wet stone.';
    expect(publicPromptText(`${body}\n\n${LOCKS}\n\n${STYLING}`)).toBe(body);
    expect(publicPromptText(`${body}\n\n${LOCKS}\n${STYLING}`)).toBe(body);
    expect(publicPromptText(`${body}\n\n${STYLING}`)).toBe(body);
    expect(publicPromptText(`${LOCKS}\n\n${body}`)).toBe(body);
    // A block in the middle: the paragraphs around it close up with one blank line.
    expect(publicPromptText(`First paragraph.\n\n${STYLING}\n\nLast paragraph.`)).toBe('First paragraph.\n\nLast paragraph.');
  });

  it('returns a text without either header byte-identical (spacing, trailing newline, an inline mention)', () => {
    for (const text of ['  Plain prompt.\n\n\n\nWith odd spacing.  \n', 'Mentions template styling: inline, not as a header.', '', 'Template lockers are not a header.']) {
      expect(publicPromptText(text)).toBe(text);
    }
  });
});

describe('loadPublicRecipe — shown and copied prompts', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = await freshDb();
  });
  afterEach(async () => db.close());

  it('a disclosed format recipe with both blocks: the full projection and the teaser carry neither; the stored recipe keeps both', async () => {
    const sql = runner(db);
    const prompt = `${FIXTURE_FILM_PROMPT}\n\n${LOCKS}\n\n${STYLING}`;
    const f = await seedFormatTemplate(sql, { recipe: filmRecipe(prompt), disclosure: { prompts: true, assets: false } });
    const shown = (await loadPublicRecipe(sql, f.templateId, LABELS))!;
    expect(shown.steps).toHaveLength(1);
    const text = shown.steps![0]!.prompt;
    expect(text).toBe(FIXTURE_FILM_PROMPT.replace('{{selfie}}', '[내 사진]'));
    for (const words of ['Template styling:', 'Template locks:', 'Styled by the template', 'Keep exactly as in the template']) expect(text).not.toContain(words);
    const teaser = recipeTeaser(shown)!;
    expect(JSON.stringify(teaser)).not.toMatch(/Template (styling|locks):/);
    // Stripped exactly once: the routes' own pass (`publicRecipeText`, the template page and /api/renders/access) finds
    // nothing left and hands back the very same object, so no text is transformed a second time.
    expect(publicRecipeText(shown)).toBe(shown);

    const stored = (await sql.query<{ recipe: { steps: Array<{ prompt: string }> } }>('select recipe from prompt_items where id = $1', [f.templateId])).rows[0]!.recipe;
    expect(stored.steps[0]!.prompt).toBe(prompt);
  });

  it('without blocks the shown text is byte-identical to the reader form; a carousel strips frame by frame', async () => {
    const sql = runner(db);
    const plain = await seedFormatTemplate(sql, { disclosure: { prompts: true, assets: false } });
    const parsed = parseRecipe(plain.recipe);
    if (!parsed.ok) throw new Error('fixture must parse');
    expect((await loadPublicRecipe(sql, plain.templateId, LABELS))!.steps![0]!.prompt).toBe(displayStepPrompt(parsed.recipe, parsed.recipe.steps[0]!, LABELS));

    const set = await seedFormatTemplate(sql, {
      recipe: carouselRecipe([`Frame one of {{selfie}} by a window.\n\n${STYLING}`, 'Frame two of {{selfie}} on a stool.']),
      disclosure: { prompts: true, assets: false },
      priceKrw: 9_900,
    });
    expect((await loadPublicRecipe(sql, set.templateId, LABELS))!.steps!.map((s) => s.prompt)).toEqual([
      'Frame one of [내 사진] by a window.',
      'Frame two of [내 사진] on a stool.',
    ]);
  });
});
