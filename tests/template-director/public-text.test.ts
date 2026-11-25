import { describe, expect, it } from 'vitest';
import { shapePrompt } from '@/lib/prompts/shape';
import { PROMPT_FIXTURES } from '../../scripts/prompt-fixtures';
import { CAST_PROMPT_FIXTURES } from '../../scripts/cast-fixtures';
import { renderLockBlock } from '@/lib/template-director/locks';
import { renderStylingBlock } from '@/lib/template-director/styling';
import { publicPromptText, publicRecipeText } from '@/lib/template-director/public-text';

/**
 * docs/PERSONAL-STUDIO.md §3.3–§3.4.9 — the `Template locks:` and `Template styling:` blocks are the compiler's
 * declarations, never customer copy. Wherever a customer can read or copy a template's prompt text (the prompt shaper,
 * the copy decision, a public recipe on the template page and in the member's full recipe), both blocks are taken
 * out of the DISPLAYED text. The stored text and everything the compiler reads keep them. A text without either block
 * is handed over byte for byte.
 */

const BODY = 'A woman walks through a neon alley at night while the camera dollies back slowly.\n\n[BGM soft piano, low]';
const LOCKS = renderLockBlock([{ kind: 'product' }, { kind: 'slot', slot: 'hair', note: 'a bright pink chin-length bob.' }]);
const STYLING = renderStylingBlock([
  { part: 'makeup', from: 'template', note: '1990s smoky plum eyes and lips.' },
  { part: 'outfit', from: 'photo' },
]);
const BLOCK_WORDS = ['Template locks:', 'Template styling:', 'Keep exactly as in the template', 'Styled by the template', 'Taken from the photo', 'chin-length bob', 'smoky plum'];

describe('publicPromptText', () => {
  it('takes out both blocks, wherever they sit, and keeps every other line', () => {
    for (const text of [
      `${BODY}\n\n${LOCKS}\n\n${STYLING}`,
      `${BODY}\n\n${STYLING}\n\n${LOCKS}`,
      `${LOCKS}\n${STYLING}\n\n${BODY}`,
      `Shot 1.\n\n${STYLING}\n\nShot 2.\n\n${LOCKS}\n\nShot 3.`,
    ]) {
      const shown = publicPromptText(text);
      for (const word of BLOCK_WORDS) expect(shown, text).not.toContain(word);
    }
    expect(publicPromptText(`${BODY}\n\n${LOCKS}\n\n${STYLING}`)).toBe(BODY);
    expect(publicPromptText(`Shot 1.\n\n${STYLING}\n\nShot 2.\n\n${LOCKS}\n\nShot 3.`)).toBe('Shot 1.\n\nShot 2.\n\nShot 3.');
  });

  it('hands a text without either block over byte for byte (every seeded template too)', () => {
    for (const text of [BODY, '', '  spaced  \n\n\n\nlines  ', 'The template styling: is decided later.', ...PROMPT_FIXTURES.map((f) => f.text), ...CAST_PROMPT_FIXTURES.map((f) => f.text)]) {
      expect(publicPromptText(text)).toBe(text);
    }
  });
});

describe('publicRecipeText', () => {
  const recipe = (prompts: string[]) => ({
    presentation: 'make-first' as const,
    intro: 'Intro.',
    outro: null,
    steps: prompts.map((prompt, i) => ({ n: i + 1, kind: 'image' as const, engine: 'GPT IMAGE 2', inputs: [], prompt, note: null })),
    files: null,
  });

  it('takes the blocks out of every step prompt and nothing else', () => {
    const shown = publicRecipeText(recipe([`${BODY}\n\n${LOCKS}\n\n${STYLING}`, `Frame two.\n\n${STYLING}`]))!;
    expect(shown.steps!.map((s) => s.prompt)).toEqual([BODY, 'Frame two.']);
    expect(shown).toMatchObject({ presentation: 'make-first', intro: 'Intro.', files: null });
    for (const word of BLOCK_WORDS) expect(JSON.stringify(shown)).not.toContain(word);
  });

  it('a recipe without blocks, without steps, or none at all is the same value', () => {
    const plain = recipe([BODY, 'Frame two.']);
    expect(publicRecipeText(plain)).toBe(plain);
    const closed = { ...plain, steps: null };
    expect(publicRecipeText(closed)).toBe(closed);
    expect(publicRecipeText(null)).toBeNull();
  });
});

describe('the prompt shaper (what a reader is handed)', () => {
  const row = (promptText: string) => ({
    id: '7a000000-0000-4000-8000-000000000001', slug: 'neon', source: 'yagi' as const, authorHandle: null, models: [], title: 'Neon',
    titleKo: null, promptText, processMd: null, processMdKo: null, sourceUrl: null, textVisibility: 'public' as const, media: null,
    useCase: [], featured: false, publishedAt: null,
  });

  it('shows the text without the blocks; the same text without blocks is shown byte for byte', () => {
    const declared = shapePrompt(row(`${BODY}\n\n${LOCKS}\n\n${STYLING}`), 'pro', { publicUrl: () => null });
    expect(declared.locked).toBe(false);
    if (declared.locked) return;
    expect(declared.text).toBe(BODY);
    const plain = shapePrompt(row(BODY), 'pro', { publicUrl: () => null });
    if (plain.locked) throw new Error('locked');
    expect(plain.text).toBe(BODY);
  });
});
