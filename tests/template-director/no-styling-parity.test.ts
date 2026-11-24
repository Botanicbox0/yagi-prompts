import { describe, expect, it } from 'vitest';
import { NO_STYLING, parseTemplateStyling } from '@/lib/template-director';
import { PROMPT_FIXTURES } from '../../scripts/prompt-fixtures';
import { CAST_PROMPT_FIXTURES } from '../../scripts/cast-fixtures';
import { PARITY_BASES, collectCompileOutputs } from './no-locks-parity.cases';

/**
 * docs/PERSONAL-STUDIO.md §3.4.9 (S1) — a prompt WITHOUT a `Template styling:` header compiles exactly as before,
 * whatever the spec says about `own`. `no-locks-parity.test.ts` holds every such compile to the goldens of 10124dc0
 * (golden file untouched); this test adds that a spec carrying `own` gives the same prompt, path and request bodies,
 * byte for byte, across the same matrix (every base, spec, medium, cast, edit-sheet flag on/off, no key / key /
 * failing key, and the exported deterministic compiler).
 */
describe('no-styling parity', () => {
  it('no parity base and no seeded template has the header', () => {
    for (const base of Object.values(PARITY_BASES)) expect(parseTemplateStyling(base)).toBe(NO_STYLING);
    for (const fixture of [...PROMPT_FIXTURES, ...CAST_PROMPT_FIXTURES]) expect(parseTemplateStyling(fixture.text)).toBe(NO_STYLING);
  });

  it('`own` on a base without the block changes nothing in any compile output', async () => {
    const plain = await collectCompileOutputs();
    for (const own of [['hair'], ['makeup'], ['hair', 'makeup']] as const) {
      const owned = await collectCompileOutputs(undefined, { own: [...own] });
      expect(Object.keys(owned)).toEqual(Object.keys(plain));
      const differ = Object.keys(plain).filter((id) => plain[id] !== owned[id]);
      expect(differ.slice(0, 10)).toEqual([]);
    }
  }, 240_000);
});
