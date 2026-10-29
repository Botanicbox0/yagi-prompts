import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The brand landing's blue is one knob (2026-10-29: the founder is changing the key colour). It follows
 * the site's `--color-blue`, and every shade is mixed from it, so a new blue is a one-line change.
 */
const read = (file: string) => readFileSync(join(process.cwd(), 'components', 'brand-studio', file), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('brand landing accent', () => {
  const landing = strip(read('landing.module.css'));
  const vto = strip(read('studio-vto.module.css'));

  it('sets the blue in one place, from the site key colour', () => {
    expect(landing.match(/--lp-blue\s*:/g)).toHaveLength(1);
    expect(landing).toMatch(/--lp-blue\s*:\s*var\(--color-blue\)\s*;/);
    expect(vto).toMatch(/--st-accent\s*:\s*var\(--lp-blue/);
  });

  it('writes no blue or YAGI red as a literal', () => {
    for (const css of [landing, vto]) {
      // Pure blues (#0000xx), the old hover/pressed shades, the soft tint, and #ED1E1E in any notation.
      expect(css).not.toMatch(/#0000[0-9a-f]{2}\b|#eeeeff\b/i);
      expect(css).not.toMatch(/#ed1e1e\b|237[\s,]+30[\s,]+30/i);
    }
  });
});
