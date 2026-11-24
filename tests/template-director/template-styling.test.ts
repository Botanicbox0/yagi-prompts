import { describe, expect, it } from 'vitest';
import {
  NO_LOCKS,
  NO_STYLING,
  TEMPLATE_KEEP_LINE_PREFIX,
  TEMPLATE_STYLING_EXAMPLE,
  TEMPLATE_STYLING_LIMITS,
  checkLockBlock,
  parseDirectorSpecInput,
  parseTemplateLocks,
  parseTemplateStyling,
  publicStyling,
  renderLockBlock,
  renderStylingBlock,
  type TemplateStyling,
} from '@/lib/template-director';

/** docs/PERSONAL-STUDIO.md §3.4.9 (S1) — the `Template styling:` block: grammar, fail-quiet parse, projection, spec field. */

const STYLED = '- Styled by the template: ';
const PHOTO = '- Taken from the photo: ';
const KEEP = TEMPLATE_KEEP_LINE_PREFIX;
const BASE = 'A woman walks through a neon alley at night while the camera dollies back.';
const text = (...lines: string[]) => lines.join('\n');

const HAIR = `${STYLED}the hairstyle — a sleek low bun.`;
const MAKEUP = `${STYLED}the makeup — 1990s smoky plum eyes and lips.`;
const WARDROBE_PHOTO = `${PHOTO}the wardrobe.`;
const BLOCK = text('Template styling:', HAIR, MAKEUP, WARDROBE_PHOTO);

describe('parseTemplateStyling', () => {
  it('reads a valid block: styled parts with their tails, photo parts, the block exactly as written', () => {
    const styling = parseTemplateStyling(text(BASE, '', BLOCK, '', 'Shot 1: she turns.'));
    expect(styling).toEqual({
      any: true,
      styled: [
        { part: 'hair', note: 'a sleek low bun.', line: HAIR },
        { part: 'makeup', note: '1990s smoky plum eyes and lips.', line: MAKEUP },
      ],
      photo: ['outfit'],
      block: BLOCK,
    });
    expect(Object.isFrozen(styling)).toBe(true);
  });

  it('is NO_STYLING (the same object) without a header', () => {
    for (const prompt of [BASE, '', 'Template styling is decided later.', `${HAIR}\n${MAKEUP}`, undefined as unknown as string]) {
      expect(parseTemplateStyling(prompt)).toBe(NO_STYLING);
    }
  });

  it('accepts the header in any case, keys in any case, extra spaces and CRLF', () => {
    const styling = parseTemplateStyling(`${BASE}\r\n\r\n  TEMPLATE STYLING:  \r\n${STYLED}The  Hairstyle — a bob\r\n${PHOTO}THE MAKEUP\r\n`);
    expect(styling.any).toBe(true);
    expect(styling.styled).toEqual([{ part: 'hair', note: 'a bob', line: `${STYLED}The  Hairstyle — a bob` }]);
    expect(styling.photo).toEqual(['makeup']);
  });

  describe('a malformed block claims nothing (fails quiet)', () => {
    it.each([
      ['a styled line with no tail', text('Template styling:', `${STYLED}the hairstyle.`)],
      ['a styled line with an empty tail', text('Template styling:', `${STYLED}the hairstyle — `)],
      ['an unknown key', text('Template styling:', `${STYLED}the shoes — red heels.`)],
      ['a key that only starts like one', text('Template styling:', `${STYLED}the hairstyles — two buns.`)],
      ['a lock line inside the block', text('Template styling:', `${KEEP}the hairstyle — a bob.`)],
      ['a wrongly cased prefix', text('Template styling:', '- styled by the template: the hairstyle — a bob.')],
      ['a duplicate part', text('Template styling:', HAIR, `${PHOTO}the hairstyle.`)],
      ['an @ handle in the tail', text('Template styling:', `${STYLED}the hairstyle — the bun from @Image 2.`)],
      ['a tail over the limit', text('Template styling:', `${STYLED}the hairstyle — ${'x'.repeat(TEMPLATE_STYLING_LIMITS.tailMax + 1)}`)],
      ['a photo line with a tail', text('Template styling:', `${PHOTO}the hairstyle — as in the photo.`)],
      ['an empty block', text(BASE, '', 'Template styling:', '', 'Shot 1.')],
      ['an empty block at the end', text(BASE, 'Template styling:')],
      ['a second header', text('Template styling:', HAIR, '', BASE, '', 'Template styling:', MAKEUP)],
      ['ordinary text right under the block', text('Template styling:', HAIR, 'She walks to the camera.')],
      ['too many lines', text('Template styling:', HAIR, MAKEUP, WARDROBE_PHOTO, HAIR, MAKEUP)],
    ])('%s', (_name, prompt) => {
      expect(parseTemplateStyling(prompt)).toBe(NO_STYLING);
    });

    it('takes a tail of exactly the limit', () => {
      const tail = 'x'.repeat(TEMPLATE_STYLING_LIMITS.tailMax);
      expect(parseTemplateStyling(text('Template styling:', `${STYLED}the hairstyle — ${tail}`)).styled).toEqual([
        { part: 'hair', note: tail, line: `${STYLED}the hairstyle — ${tail}` },
      ]);
    });
  });

  describe('block separation', () => {
    const LOCKS = renderLockBlock([{ kind: 'product' }, { kind: 'shots', from: 2, to: 2 }]);

    it('a lock block followed directly by a styling header parses as two blocks', () => {
      const prompt = text(BASE, '', LOCKS, BLOCK);
      expect(parseTemplateLocks(prompt)).toMatchObject({ any: true, malformed: false, named: ['product'], block: LOCKS });
      expect(parseTemplateStyling(prompt)).toMatchObject({ any: true, block: BLOCK });
      expect(checkLockBlock(prompt).state).toBe('ok');
    });

    it('and the other way round', () => {
      const prompt = text(BASE, '', BLOCK, LOCKS);
      expect(parseTemplateLocks(prompt)).toMatchObject({ any: true, malformed: false, block: LOCKS });
      expect(parseTemplateStyling(prompt)).toMatchObject({ any: true, block: BLOCK });
    });

    it('a styling line under a lock header is still an unknown lock line (everything locked)', () => {
      const prompt = text('Template locks:', `${KEEP}the product.`, HAIR);
      expect(parseTemplateLocks(prompt).malformed).toBe(true);
    });

    it('a prompt with no styling header reads its lock block exactly as before', () => {
      const prompt = text('Template locks:', `${KEEP}the product.`, 'Template styling is our next step.');
      expect(parseTemplateLocks(prompt).malformed).toBe(true);
      expect(parseTemplateStyling(prompt)).toBe(NO_STYLING);
    });
  });
});

describe('renderStylingBlock', () => {
  it('renders the canonical block, which parses back to the same parts', () => {
    const block = renderStylingBlock([
      { part: 'hair', from: 'template', note: 'a sleek  low bun.' },
      { part: 'makeup', from: 'template', note: '1990s smoky plum eyes and lips.' },
      { part: 'outfit', from: 'photo' },
    ]);
    expect(block).toBe(text('Template styling:', HAIR, MAKEUP, WARDROBE_PHOTO));
    expect(renderStylingBlock([])).toBe('');
    expect(parseTemplateStyling(`${BASE}\n\n${TEMPLATE_STYLING_EXAMPLE}`).any).toBe(true);
  });
});

describe('publicStyling (names only)', () => {
  const styling = parseTemplateStyling(text(BASE, '', BLOCK));

  it('names the parts and never the words', () => {
    const projection = publicStyling(styling, NO_LOCKS);
    expect(projection).toEqual({ styled: ['hair', 'makeup'], photo: ['outfit'] });
    expect(JSON.stringify(projection)).not.toMatch(/bun|smoky|Styled|Taken/);
    expect(publicStyling(NO_STYLING, NO_LOCKS)).toBeNull();
  });

  it('leaves a locked part out (the lock wins), and everything when the lock block is malformed', () => {
    const hairLocked = parseTemplateLocks(renderLockBlock([{ kind: 'slot', slot: 'hair' }]));
    expect(publicStyling(styling, hairLocked)).toEqual({ styled: ['makeup'], photo: ['outfit'] });
    const all = parseTemplateLocks(text('Template locks:', `${KEEP}the shoes.`));
    expect(publicStyling(styling, all)).toEqual({ styled: [], photo: [] });
  });

  it('is built from frozen data without leaking a reference', () => {
    const projection = publicStyling(styling, NO_LOCKS)!;
    projection.styled.push('outfit');
    expect((styling as TemplateStyling).styled.map((s) => s.part)).toEqual(['hair', 'makeup']);
  });
});

describe('the spec field `own` (test 5)', () => {
  it('survives parseDirectorSpecInput from JSON and from an object', () => {
    expect(parseDirectorSpecInput(JSON.stringify({ own: ['hair'] }))?.own).toEqual(['hair']);
    expect(parseDirectorSpecInput({ audioMode: 'ambient', own: ['hair', 'makeup'] })?.own).toEqual(['hair', 'makeup']);
  });

  it('a bad value becomes undefined and the rest of the spec stands', () => {
    for (const own of [['outfit'], ['hair', 'makeup', 'hair'], 'hair', [1], [' hair'], { hair: true }]) {
      const spec = parseDirectorSpecInput({ audioMode: 'bgm', bgmMood: 'calm_mood', userMessage: '단발로', own });
      expect(spec).not.toBeNull();
      expect(spec!.own).toBeUndefined();
      expect(spec).toMatchObject({ audioMode: 'bgm', bgmMood: 'calm_mood', userMessage: '단발로' });
    }
  });

  it('an absent key stays absent', () => {
    const spec = parseDirectorSpecInput({ audioMode: 'ambient', userMessage: '단발로' })!;
    expect('own' in spec).toBe(false);
    expect(JSON.stringify(spec)).not.toContain('own');
  });
});
