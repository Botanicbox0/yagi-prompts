import { describe, expect, it } from 'vitest';
import { getDictionary } from '@/lib/i18n/dictionaries';
import { interpolate } from '@/lib/i18n/format';
import {
  NO_LOCKS,
  NO_STYLING,
  TEMPLATE_KEEP_LINE_PREFIX,
  TEMPLATE_STYLING_KEY_PHRASES,
  TEMPLATE_STYLING_LIMITS,
  checkLockBlock,
  checkStylingBlock,
  lockBlockRefusalDetail,
  lockRefusalLines,
  parseTemplateLocks,
  parseTemplateStyling,
  publicLocks,
  publicStyling,
  readLockBlockRefusal,
  stylingBlockRefusalDetail,
} from '@/lib/template-director';
import { PROMPT_FIXTURES } from '../../scripts/prompt-fixtures';
import { CAST_PROMPT_FIXTURES } from '../../scripts/cast-fixtures';
import { PARITY_BASES } from './no-locks-parity.cases';

/** docs/PERSONAL-STUDIO.md §3.4.9 (S1) — the save-time check of a template's `Template styling:` block (test 3). */

const STYLED = '- Styled by the template: ';
const PHOTO = '- Taken from the photo: ';
const KEEP = TEMPLATE_KEEP_LINE_PREFIX;
const BASE = 'A woman walks through a neon alley at night while the camera dollies back.';
const text = (...lines: string[]) => lines.join('\n');
const HAIR = `${STYLED}the hairstyle — a sleek low bun.`;
const MAKEUP = `${STYLED}the makeup — 1990s smoky plum eyes and lips.`;

const VALID = text(BASE, '', 'Template styling:', HAIR, MAKEUP, `${PHOTO}the wardrobe.`, '', 'Shot 1: she turns.');

describe('checkStylingBlock', () => {
  it('is none without a header, ok for a valid block with its public projection', () => {
    expect(checkStylingBlock(BASE)).toEqual({ state: 'none' });
    expect(checkStylingBlock('')).toEqual({ state: 'none' });
    expect(checkStylingBlock(undefined as unknown as string)).toEqual({ state: 'none' });
    expect(checkStylingBlock(VALID)).toEqual({ state: 'ok', styling: { styled: ['hair', 'makeup'], photo: ['outfit'] } });
  });

  it('names every malformed line, then the count', () => {
    const prompt = text(
      'Template styling:', // 1
      `${STYLED}the hairstyle.`, // 2 no tail
      `${STYLED}the shoes — red.`, // 3 unknown key
      MAKEUP, // 4
      `${PHOTO}the makeup.`, // 5 duplicate
      `${STYLED}the wardrobe — from @Image 2.`, // 6 handle
    );
    expect(checkStylingBlock(prompt)).toEqual({
      state: 'malformed',
      problems: [
        { kind: 'unknown_line', line: 2, text: `${STYLED}the hairstyle.` },
        { kind: 'unknown_line', line: 3, text: `${STYLED}the shoes — red.` },
        { kind: 'duplicate_part', line: 5, text: `${PHOTO}the makeup.` },
        { kind: 'unknown_line', line: 6, text: `${STYLED}the wardrobe — from @Image 2.` },
        { kind: 'too_many_lines', count: 5, max: TEMPLATE_STYLING_LIMITS.max },
      ],
    });
  });

  it('names an empty block and a second header', () => {
    expect(checkStylingBlock(text(BASE, 'Template styling:'))).toEqual({ state: 'malformed', problems: [{ kind: 'empty_block', line: 2 }] });
    expect(checkStylingBlock(text('Template styling:', HAIR, '', 'Template styling:', MAKEUP))).toEqual({
      state: 'malformed',
      problems: [{ kind: 'second_header', line: 4 }],
    });
  });

  it('refuses a part that is both locked and declared (styled or from the photo); the parse keeps it but the lock wins', () => {
    const prompt = text(BASE, '', 'Template locks:', `${KEEP}the hairstyle — a sleek low bun.`, `${KEEP}the wardrobe.`, '', 'Template styling:', HAIR, MAKEUP, `${PHOTO}the wardrobe.`);
    expect(checkStylingBlock(prompt)).toEqual({
      state: 'malformed',
      problems: [
        { kind: 'locked_part', line: 8, text: HAIR },
        { kind: 'locked_part', line: 10, text: `${PHOTO}the wardrobe.` },
      ],
    });
    const parsed = parseTemplateStyling(prompt);
    expect(parsed.any).toBe(true);
    expect(publicStyling(parsed, parseTemplateLocks(prompt))).toEqual({ styled: ['makeup'], photo: [] });
  });

  it('leaves a malformed lock block to the lock check (no locked_part problems)', () => {
    const prompt = text('Template locks:', `${KEEP}the shoes.`, '', 'Template styling:', HAIR);
    expect(checkLockBlock(prompt).state).toBe('malformed');
    expect(checkStylingBlock(prompt).state).toBe('ok');
  });

  it('reads a lock block followed directly by a styling block as two valid blocks', () => {
    const prompt = text(BASE, '', 'Template locks:', `${KEEP}the product.`, 'Template styling:', HAIR);
    expect(checkLockBlock(prompt).state).toBe('ok');
    expect(checkStylingBlock(prompt)).toEqual({ state: 'ok', styling: { styled: ['hair'], photo: [] } });
  });

  it('refuses a styled description that says to follow the photo; the parse still reads it (save-time only, like a locked part)', () => {
    // "— swept back from the face; colour and length stay as in the photo" was written by hand once: if the buyer kept
    // their own hair, the whole tail would have gone into [Exclusions], photo clause and all.
    const tails = [
      'swept back from the face; colour and length stay as in the photo.',
      'the colour as in the reference.',
      'matching Image 1, glossy finish.',
      'same as image1 but tied.',
      'kept like the photos show.',
      'as in the photograph.',
      '사진 그대로의 색.',
    ];
    for (const tail of tails) {
      const prompt = text(BASE, '', 'Template styling:', `${STYLED}the hairstyle — ${tail}`, MAKEUP, '', 'Shot 1.');
      const check = checkStylingBlock(prompt);
      expect(check, tail).toEqual({ state: 'malformed', problems: [{ kind: 'photo_clause', line: 4, text: `${STYLED}the hairstyle — ${tail}` }] });
      // The block still parses: nothing a live template compiles changes with this check.
      expect(parseTemplateStyling(prompt).styled.map((s) => s.note), tail).toEqual([tail, '1990s smoky plum eyes and lips.']);
    }
    // Words that only look like it pass: a style, not a clause about the buyer's photo.
    for (const tail of ['editorial photoshoot polish.', 'photographic film-grain softness.', 'a sleek low bun.', 'imagery of the 1990s.']) {
      expect(checkStylingBlock(text('Template styling:', `${STYLED}the makeup — ${tail}`)).state, tail).toBe('ok');
    }
    // A photo line has no description; it is the right way to say it.
    expect(checkStylingBlock(text('Template styling:', `${PHOTO}the hairstyle.`)).state).toBe('ok');
  });

  it('finds no block in any seeded template or parity prompt', () => {
    const prompts = [...PROMPT_FIXTURES, ...CAST_PROMPT_FIXTURES].map((fixture) => fixture.text);
    for (const prompt of [...prompts, ...Object.values(PARITY_BASES)]) expect(checkStylingBlock(prompt)).toEqual({ state: 'none' });
  });
});

/** Agreement with the parsers the renders use, for both blocks, on prompts that carry both. */
describe('the checks agree with the parsers', () => {
  const agree = (prompt: string) => {
    const styling = parseTemplateStyling(prompt);
    const locks = parseTemplateLocks(prompt);
    const check = checkStylingBlock(prompt);
    if (check.state === 'none') expect(styling, prompt).toBe(NO_STYLING);
    if (check.state === 'ok') {
      expect(styling.any, prompt).toBe(true);
      expect(check.styling, prompt).toEqual(publicStyling(styling, locks));
    }
    if (check.state === 'malformed') {
      expect(check.problems.length, prompt).toBeGreaterThan(0);
      const grammar = check.problems.some((p) => p.kind !== 'locked_part' && p.kind !== 'photo_clause');
      // A grammar problem means the parse claims nothing; a locked part alone is read, and the lock wins; a styled
      // description that says to follow the photo is read too (refused at save only).
      expect(styling === NO_STYLING, prompt).toBe(grammar);
    }
    if (styling.any) expect(check.state, prompt).not.toBe('none');
    // The lock check keeps its own agreement with the styling lines around.
    const lockCheck = checkLockBlock(prompt);
    expect(lockCheck.state === 'ok', prompt).toBe(locks.any && !locks.malformed);
    expect(lockCheck.state === 'malformed', prompt).toBe(locks.malformed);
    if (lockCheck.state === 'none' || lockCheck.state === 'header_typo') expect(locks, prompt).toBe(NO_LOCKS);
    if (lockCheck.state === 'ok') expect(lockCheck.locks, prompt).toEqual(publicLocks(locks));
  };

  const TABLE = [
    '',
    BASE,
    VALID,
    'Template styling:',
    text('Template styling:', ''),
    text('Template styling:', HAIR),
    text('Template styling:', HAIR, 'Shot 1.'),
    text('Template styling:', HAIR, '', 'Template styling:', MAKEUP),
    text('Template locks:', `${KEEP}the product.`, 'Template styling:', HAIR),
    text('Template styling:', HAIR, 'Template locks:', `${KEEP}the product.`),
    text('Template locks:', `${KEEP}the hairstyle.`, '', 'Template styling:', HAIR),
    text('Template locks:', `${KEEP}the hairstyle.`, '', 'Template styling:', MAKEUP),
    text('Template locks:', HAIR),
    text(HAIR, MAKEUP),
    `Template styling:\r\n${HAIR}\r\n\r\nShot 1.`,
    ...Object.values(PARITY_BASES),
  ];

  it.each(TABLE.map((prompt) => [prompt]))('%#', (prompt) => agree(prompt));

  it('holds over 2,000 generated prompts mixing lock and styling lines', () => {
    const POOL = [
      '',
      '',
      BASE,
      'Shot 2: she smiles at the lens.',
      'Template styling:',
      'template styling:',
      'Template locks:',
      HAIR,
      MAKEUP,
      `${STYLED}the wardrobe — a red slip dress.`,
      `${PHOTO}the hairstyle.`,
      `${PHOTO}the wardrobe.`,
      `${STYLED}the hairstyle.`,
      `${STYLED}the shoes — red.`,
      `${STYLED}the makeup — from @Image 2.`,
      `${STYLED}the makeup — the colour as in the photo.`,
      `${KEEP}the product.`,
      `${KEEP}the hairstyle — a bob.`,
      `${KEEP}the wardrobe.`,
      `${KEEP}shot 2.`,
      `${KEEP}the shoes.`,
      '   ',
      // Whole blocks, so valid lock and styling blocks meet often enough.
      text('', 'Template locks:', `${KEEP}the hairstyle — a bob.`, ''),
      text('', 'Template styling:', HAIR, ''),
      text('', 'Template styling:', MAKEUP, `${PHOTO}the wardrobe.`, ''),
    ];
    let seed = 0x5eed_51;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const states = new Set<string>();
    let lockedOnly = 0;
    for (let i = 0; i < 2000; i += 1) {
      const length = 1 + Math.floor(next() * 14);
      const prompt = text(...Array.from({ length }, () => POOL[Math.floor(next() * POOL.length)]!));
      agree(prompt);
      const check = checkStylingBlock(prompt);
      states.add(check.state);
      if (check.state === 'malformed' && check.problems.every((p) => p.kind === 'locked_part')) lockedOnly += 1;
    }
    // The generator reaches every state, and a block refused only for a locked part, so the property is not vacuous.
    expect([...states].sort()).toEqual(['malformed', 'none', 'ok']);
    expect(lockedOnly).toBeGreaterThan(0);
  });
});

describe('the refusal an admin save returns', () => {
  const a = getDictionary('ko').admin;

  it('names each problem by line in the shared format, and reads back as a styling refusal', () => {
    const check = checkStylingBlock(text(BASE, '', 'Template styling:', `${STYLED}the shoes — red.`, HAIR, `${PHOTO}the hairstyle.`));
    expect(check.state).toBe('malformed');
    if (check.state !== 'malformed') return;
    const detail = stylingBlockRefusalDetail('promptText', check.problems);
    expect(detail).toBe(`promptText: template styling: line 4 unknown_line, line 6 duplicate_part — "${STYLED}the shoes — red."`);
    expect(readLockBlockRefusal(detail)).toEqual({
      field: 'promptText',
      items: [
        { kind: 'unknown_line', line: 4 },
        { kind: 'duplicate_part', line: 6 },
      ],
      more: 0,
      text: `${STYLED}the shoes — red.`,
      block: 'styling',
    });
  });

  it('is said in the styling sentences and rules; a lock refusal is said exactly as before', () => {
    const detail = 'promptText: template styling: line 4 locked_part, line 7 second_header, too_many_lines 5/4';
    const lines = lockRefusalLines(detail, a)!;
    expect(lines.title).toBe(a.stylingRefused);
    expect(lines.items).toEqual([
      interpolate(a.stylingProblemLockedPart, { line: 4 }),
      interpolate(a.stylingProblemSecondHeader, { line: 7 }),
      interpolate(a.stylingProblemTooManyLines, { count: 5, max: 4 }),
    ]);
    for (const key of TEMPLATE_STYLING_KEY_PHRASES) expect(lines.rules).toContain(key);
    expect(lines.rules).toContain(String(TEMPLATE_STYLING_LIMITS.tailMax));

    const lockDetail = lockBlockRefusalDetail('promptText', [{ kind: 'unknown_line', line: 4, text: `${KEEP}the shoes.` }]);
    expect(readLockBlockRefusal(lockDetail)).not.toHaveProperty('block');
    expect(lockRefusalLines(lockDetail, a)!.title).toBe(a.lockRefused);
  });

  it('a photo clause is said in its own sentence, and the rules say a description names the template style only', () => {
    const check = checkStylingBlock(text(BASE, '', 'Template styling:', `${STYLED}the hairstyle — swept back; length as in the photo.`));
    expect(check.state).toBe('malformed');
    if (check.state !== 'malformed') return;
    const detail = stylingBlockRefusalDetail('promptText', check.problems);
    expect(detail).toMatch(/^promptText: template styling: line 4 photo_clause — "/);
    expect(readLockBlockRefusal(detail)).toMatchObject({ field: 'promptText', items: [{ kind: 'photo_clause', line: 4 }], block: 'styling' });
    for (const locale of ['ko', 'en'] as const) {
      const copy = getDictionary(locale).admin;
      const lines = lockRefusalLines(detail, copy)!;
      expect(lines.title).toBe(copy.stylingRefused);
      expect(lines.items).toEqual([interpolate(copy.stylingProblemPhotoClause, { line: 4 })]);
      expect(copy.stylingProblemPhotoClause).toContain('Taken from the photo');
    }
  });

  it('reads no styling kind in a lock refusal, and no lock-only kind in a styling refusal', () => {
    expect(readLockBlockRefusal('promptText: template locks: line 4 photo_clause')).toBeNull();
    expect(readLockBlockRefusal('promptText: template locks: line 4 duplicate_part')).toBeNull();
    expect(readLockBlockRefusal('promptText: template styling: line 4 header_typo')).toBeNull();
  });
});
