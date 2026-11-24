import { describe, expect, it } from 'vitest';
import {
  NO_LOCKS,
  TEMPLATE_KEEP_LINE_PREFIX,
  TEMPLATE_LOCK_EXAMPLE,
  TEMPLATE_LOCK_KEY_PHRASES,
  TEMPLATE_LOCK_LIMITS,
  checkLockBlock,
  lockBlockRefusalDetail,
  parseTemplateLocks,
  publicLocks,
  readLockBlockRefusal,
  type LockBlockProblem,
} from '@/lib/template-director/locks';
import { PROMPT_FIXTURES } from '../../scripts/prompt-fixtures';
import { CAST_PROMPT_FIXTURES } from '../../scripts/cast-fixtures';
import { PARITY_BASES } from './no-locks-parity.cases';

/** docs/PERSONAL-STUDIO.md §3.3 (C3) — the save-time check of a template's `Template locks:` block. */

const KEEP = TEMPLATE_KEEP_LINE_PREFIX;
const BASE = 'A woman walks through a neon alley at night while the camera dollies back.';
const text = (...lines: string[]) => lines.join('\n');

const VALID = text(
  BASE, // 1
  '', // 2
  'Template locks:', // 3
  `${KEEP}the product.`, // 4
  `${KEEP}shots 2–3.`, // 5
  `${KEEP}the hairstyle — a bright pink chin-length bob.`, // 6
  '', // 7
  'Shot 1: she turns to the lens.', // 8
);

describe('checkLockBlock', () => {
  it('is none for a prompt with no block and nothing that looks like one', () => {
    expect(checkLockBlock(BASE)).toEqual({ state: 'none' });
    expect(checkLockBlock('')).toEqual({ state: 'none' });
    expect(checkLockBlock(undefined as unknown as string)).toEqual({ state: 'none' });
  });

  it('is ok for a valid block, with the public projection of its locks', () => {
    const check = checkLockBlock(VALID);
    expect(check).toEqual({ state: 'ok', locks: publicLocks(parseTemplateLocks(VALID)) });
    if (check.state !== 'ok') return;
    expect(check.locks).toMatchObject({ named: ['product'], slots: ['hair', 'prop'], shots: [{ from: 2, to: 3 }], all: false });
  });

  it('accepts the canonical header in any case and a CRLF prompt', () => {
    expect(checkLockBlock(text('TEMPLATE LOCKS:', `${KEEP}the sound.`)).state).toBe('ok');
    expect(checkLockBlock(`${BASE}\r\n\r\nTemplate locks:\r\n${KEEP}the brand logo.\r\n`).state).toBe('ok');
  });

  describe('malformed blocks (the template would lock everything)', () => {
    it('names a line whose key is not on the closed list', () => {
      expect(checkLockBlock(text(BASE, '', 'Template locks:', `${KEEP}the shoes.`, `${KEEP}the product.`))).toEqual({
        state: 'malformed',
        problems: [{ kind: 'unknown_line', line: 4, text: `${KEEP}the shoes.` }],
      });
    });

    it('names ordinary text that runs on after the block without a blank line', () => {
      expect(checkLockBlock(text('Template locks:', `${KEEP}the product.`, '  She walks to the camera.  '))).toEqual({
        state: 'malformed',
        problems: [{ kind: 'unknown_line', line: 3, text: 'She walks to the camera.' }],
      });
    });

    it('names a wrongly cased keep line and a shot outside the film', () => {
      const check = checkLockBlock(text('Template locks:', '- keep exactly as in the template: the product.', `${KEEP}shot 13.`));
      expect(check).toEqual({
        state: 'malformed',
        problems: [
          { kind: 'unknown_line', line: 2, text: '- keep exactly as in the template: the product.' },
          { kind: 'unknown_line', line: 3, text: `${KEEP}shot 13.` },
        ],
      });
    });

    it('cuts the offending text to 120 characters', () => {
      const long = `${KEEP}the shoes ${'x'.repeat(200)}`;
      const check = checkLockBlock(text('Template locks:', long));
      expect(check.state).toBe('malformed');
      if (check.state !== 'malformed') return;
      const problem = check.problems[0] as Extract<LockBlockProblem, { kind: 'unknown_line' }>;
      expect(problem.text).toBe(long.slice(0, 120));
    });

    it('names an empty block at its header line, at the end of the text too', () => {
      expect(checkLockBlock(text(BASE, '', 'Template locks:', '', 'Shot 1.'))).toEqual({
        state: 'malformed',
        problems: [{ kind: 'empty_block', line: 3 }],
      });
      expect(checkLockBlock(text(BASE, 'Template locks:'))).toEqual({ state: 'malformed', problems: [{ kind: 'empty_block', line: 2 }] });
    });

    it('counts too many lines and too many shot lines', () => {
      const lines = Array.from({ length: TEMPLATE_LOCK_LIMITS.max + 1 }, () => `${KEEP}the product.`);
      expect(checkLockBlock(text('Template locks:', ...lines))).toEqual({
        state: 'malformed',
        problems: [{ kind: 'too_many_lines', count: TEMPLATE_LOCK_LIMITS.max + 1, max: TEMPLATE_LOCK_LIMITS.max }],
      });
      const shots = Array.from({ length: TEMPLATE_LOCK_LIMITS.shotRangesMax + 1 }, (_, i) => `${KEEP}shot ${i + 1}.`);
      expect(checkLockBlock(text('Template locks:', ...shots))).toEqual({
        state: 'malformed',
        problems: [{ kind: 'too_many_shot_ranges', count: TEMPLATE_LOCK_LIMITS.shotRangesMax + 1, max: TEMPLATE_LOCK_LIMITS.shotRangesMax }],
      });
    });

    it('names a second header, once, even when it sits inside the first block', () => {
      expect(checkLockBlock(text('Template locks:', `${KEEP}the product.`, '', BASE, '', 'Template locks:', `${KEEP}the sound.`))).toEqual({
        state: 'malformed',
        problems: [{ kind: 'second_header', line: 6 }],
      });
      expect(checkLockBlock(text('Template locks:', 'Template locks:', `${KEEP}the sound.`))).toEqual({
        state: 'malformed',
        problems: [{ kind: 'second_header', line: 2 }],
      });
    });

    it('lists line problems in line order, then the counts', () => {
      const lines = [`${KEEP}the shoes.`, ...Array.from({ length: TEMPLATE_LOCK_LIMITS.max }, () => `${KEEP}the sound.`), 'Template locks:'];
      const check = checkLockBlock(text('Template locks:', ...lines));
      expect(check).toEqual({
        state: 'malformed',
        problems: [
          { kind: 'unknown_line', line: 2, text: `${KEEP}the shoes.` },
          { kind: 'second_header', line: 15 },
          { kind: 'too_many_lines', count: TEMPLATE_LOCK_LIMITS.max + 2, max: TEMPLATE_LOCK_LIMITS.max },
        ],
      });
    });
  });

  describe('a block that is not read at all (the template would be unlocked)', () => {
    const TYPOS = [
      'Template lock:',
      'Template Locks',
      'Templates locks:',
      'template-locks:',
      '**Template locks:**',
      '## Template locks',
      'Template locks :',
      'Template  locks:',
      '- Template locks:',
      'Template lock: the product',
      '  Template_Locks：',
    ];

    it.each(TYPOS)('names the mistyped header %j and the lock lines under it', (header) => {
      const check = checkLockBlock(text(BASE, '', header, `${KEEP}the product.`, `${KEEP}the sound.`));
      expect(check).toEqual({
        state: 'header_typo',
        problems: [
          { kind: 'header_typo', line: 3, text: header.trim() },
          { kind: 'lock_lines_without_header', line: 4 },
          { kind: 'lock_lines_without_header', line: 5 },
        ],
      });
    });

    it('names a mistyped header on its own', () => {
      expect(checkLockBlock(text(BASE, 'Template lock:'))).toEqual({
        state: 'header_typo',
        problems: [{ kind: 'header_typo', line: 2, text: 'Template lock:' }],
      });
    });

    it('names lock lines with no header, whatever bullet or case they use', () => {
      expect(checkLockBlock(text(BASE, `${KEEP}the product.`, '* Keep exactly as in the template: the sound.', 'keep exactly as in the template: the prop'))).toEqual({
        state: 'header_typo',
        problems: [
          { kind: 'lock_lines_without_header', line: 2 },
          { kind: 'lock_lines_without_header', line: 3 },
          { kind: 'lock_lines_without_header', line: 4 },
        ],
      });
    });

    it.each([
      'Then this template locks the camera on a slow dolly.',
      'The template locks the camera.',
      'Template locks the camera to a dolly for the whole film.',
      'Templates and locks are not part of this scene.',
      'Locks:',
      'She will keep exactly as in the template the same smile.',
      'Use the template: locks of hair fall over her face.',
    ])('leaves ordinary prose alone: %j', (line) => {
      expect(checkLockBlock(text(BASE, line, 'Shot 2: she smiles.'))).toEqual({ state: 'none' });
    });
  });

  it('finds no block and nothing like one in any seeded template or parity prompt but the near miss', () => {
    const prompts = [...PROMPT_FIXTURES, ...CAST_PROMPT_FIXTURES].map((fixture) => fixture.text);
    const { nearMiss, ...bases } = PARITY_BASES;
    for (const prompt of [...prompts, ...Object.values(bases)]) expect(checkLockBlock(prompt)).toEqual({ state: 'none' });
    // C1's near miss: keep lines under `Locks:` and prose that mentions "Template locks". The renders read no lock from
    // it (that is what C1 tests), which is exactly why the admin save refuses it.
    expect(checkLockBlock(nearMiss!)).toEqual({
      state: 'header_typo',
      problems: [
        { kind: 'lock_lines_without_header', line: 3 },
        { kind: 'lock_lines_without_header', line: 5 },
      ],
    });
  });
});

/** Agreement with the parser the renders use: the check never says "ok" for a block the parser reads differently. */
describe('checkLockBlock agrees with parseTemplateLocks', () => {
  const agree = (prompt: string) => {
    const parsed = parseTemplateLocks(prompt);
    const check = checkLockBlock(prompt);
    expect(check.state === 'ok', prompt).toBe(parsed.any && !parsed.malformed);
    expect(check.state === 'malformed', prompt).toBe(parsed.malformed);
    if (check.state === 'none' || check.state === 'header_typo') expect(parsed, prompt).toBe(NO_LOCKS);
    if (check.state === 'ok') expect(check.locks, prompt).toEqual(publicLocks(parsed));
    if (check.state === 'malformed' || check.state === 'header_typo') expect(check.problems.length, prompt).toBeGreaterThan(0);
  };

  const TABLE = [
    '',
    BASE,
    VALID,
    'Template locks:',
    text('Template locks:', ''),
    text('Template locks:', `${KEEP}the product.`),
    text('Template locks:', `${KEEP}the product`, `${KEEP}the prop — a red cup.`, `${KEEP}shot 4`),
    text('Template locks:', `${KEEP}the shoes.`),
    text('Template locks:', `${KEEP}the product.`, 'Shot 1.'),
    text('Template locks:', `${KEEP}the product.`, '', 'Template locks:', `${KEEP}the sound.`),
    text('Template lock:', `${KEEP}the product.`),
    text(BASE, `${KEEP}the product.`),
    text('## Template locks', `${KEEP}the product.`),
    text('Template locks:', `${KEEP}the product.`, '', 'template lock:'),
    text('Template locks:', `${KEEP}the product.`, '', `${KEEP}the sound.`),
    `Template locks:\r\n${KEEP}the brand logo.\r\n\r\nShot 1.`,
    text('Template locks:', '   ', `${KEEP}the product.`),
    text('Template locks: the product'),
    text('   template locks:   ', `   ${KEEP}the look and light.   `),
    ...Object.values(PARITY_BASES),
  ];

  it.each(TABLE.map((prompt) => [prompt]))('%#', (prompt) => agree(prompt));

  /** Property-style: random prompts from a pool of real and broken lines, with a fixed seed. */
  it('holds over 2,000 generated prompts', () => {
    const POOL = [
      '',
      '',
      BASE,
      'Shot 2: she smiles at the lens.',
      'Template locks:',
      'template locks:',
      'Template lock:',
      '## Template locks',
      '**Template locks:**',
      'Templates locks:',
      'this template locks the camera',
      `${KEEP}the product.`,
      `${KEEP}the brand logo — the red wordmark on the cap.`,
      `${KEEP}the sound.`,
      `${KEEP}shot 2.`,
      `${KEEP}shots 3–4.`,
      `${KEEP}shot 13.`,
      `${KEEP}the hairstyle — a bright pink chin-length bob.`,
      `${KEEP}the wardrobe.`,
      `${KEEP}the shoes.`,
      '- keep exactly as in the template: the product.',
      '* Keep exactly as in the template: the prop.',
      '   ',
    ];
    let seed = 0x5eed_c3;
    const next = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const states = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      const length = 1 + Math.floor(next() * 18);
      const prompt = text(...Array.from({ length }, () => POOL[Math.floor(next() * POOL.length)]!));
      agree(prompt);
      states.add(checkLockBlock(prompt).state);
    }
    // The generator reaches every state, so the property is not vacuous.
    expect([...states].sort()).toEqual(['header_typo', 'malformed', 'none', 'ok']);
  });
});

describe('the refusal detail an admin save returns', () => {
  it('names each problem by line, then the first offending text', () => {
    const check = checkLockBlock(text(BASE, '', 'Template locks:', `${KEEP}the shoes.`, `${KEEP}the "socks".`));
    expect(check.state).toBe('malformed');
    if (check.state !== 'malformed') return;
    const detail = lockBlockRefusalDetail('promptText', check.problems);
    expect(detail).toBe(`promptText: template locks: line 4 unknown_line, line 5 unknown_line — "${KEEP}the shoes."`);
    expect(readLockBlockRefusal(detail)).toEqual({
      field: 'promptText',
      items: [
        { kind: 'unknown_line', line: 4 },
        { kind: 'unknown_line', line: 5 },
      ],
      more: 0,
      text: `${KEEP}the shoes.`,
    });
  });

  it('says how many more there are past three, and counts with their limit', () => {
    const problems: LockBlockProblem[] = [
      { kind: 'header_typo', line: 3, text: 'Template lock: "x"' },
      { kind: 'lock_lines_without_header', line: 4 },
      { kind: 'lock_lines_without_header', line: 5 },
      { kind: 'lock_lines_without_header', line: 6 },
      { kind: 'lock_lines_without_header', line: 7 },
    ];
    const detail = lockBlockRefusalDetail('frame 2', problems);
    expect(detail).toBe(`frame 2: template locks: line 3 header_typo, line 4 lock_lines_without_header, line 5 lock_lines_without_header, +2 — "Template lock: 'x'"`);
    expect(readLockBlockRefusal(detail)).toMatchObject({ field: 'frame 2', more: 2, items: [{ kind: 'header_typo', line: 3 }, {}, {}] });

    const counts = lockBlockRefusalDetail('promptText', [{ kind: 'too_many_lines', count: 13, max: 12 }, { kind: 'too_many_shot_ranges', count: 5, max: 4 }]);
    expect(counts).toBe('promptText: template locks: too_many_lines 13/12, too_many_shot_ranges 5/4');
    expect(readLockBlockRefusal(counts)).toEqual({
      field: 'promptText',
      items: [
        { kind: 'too_many_lines', count: 13, max: 12 },
        { kind: 'too_many_shot_ranges', count: 5, max: 4 },
      ],
      more: 0,
      text: '',
    });
  });

  it('fits the 200 characters a refusal keeps in the address, and still reads when cut there', () => {
    const worst: LockBlockProblem[] = [
      { kind: 'lock_lines_without_header', line: 4001 },
      { kind: 'lock_lines_without_header', line: 4002 },
      { kind: 'lock_lines_without_header', line: 4003 },
      ...Array.from({ length: 200 }, (_, i): LockBlockProblem => ({ kind: 'unknown_line', line: 5000 + i, text: 'y'.repeat(120) })),
    ];
    worst.unshift({ kind: 'unknown_line', line: 3999, text: 'x'.repeat(120) });
    const detail = lockBlockRefusalDetail('promptText', worst);
    expect(detail.length).toBeLessThanOrEqual(200);
    const cut = readLockBlockRefusal(`${detail.slice(0, 120)}`);
    expect(cut?.items[0]).toEqual({ kind: 'unknown_line', line: 3999 });
  });

  it('reads nothing from any other detail', () => {
    expect(readLockBlockRefusal('poster: a YAGI prompt needs a poster image')).toBeNull();
    expect(readLockBlockRefusal('promptText: String must contain at least 40 character(s)')).toBeNull();
    expect(readLockBlockRefusal('')).toBeNull();
  });
});

describe('the author help', () => {
  it('lists every key the parser accepts, in the order an author reads them', () => {
    expect(TEMPLATE_LOCK_KEY_PHRASES).toEqual([
      'the product',
      'the brand logo',
      'the sound',
      'shot N',
      'shots N–M',
      'the wardrobe',
      'the makeup',
      'the hairstyle',
      'the prop',
      'the direction',
      'the look and light',
    ]);
  });

  it('gives an example block that is itself valid', () => {
    expect(TEMPLATE_LOCK_EXAMPLE.startsWith('Template locks:\n')).toBe(true);
    const check = checkLockBlock(`${BASE}\n\n${TEMPLATE_LOCK_EXAMPLE}`);
    expect(check.state).toBe('ok');
  });
});
