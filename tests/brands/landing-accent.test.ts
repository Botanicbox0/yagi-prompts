import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The brand landing's blue is one knob (2026-10-29: the founder keeps tuning the key colour). The hex is
 * written once, on `.accent`, every shade is mixed from it, and the shared nav, form and FAQ on /brands
 * are pointed at it. The value itself may change; these rules may not.
 */
const read = (file: string) => readFileSync(join(process.cwd(), 'components', 'brand-studio', file), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('brand landing accent', () => {
  const landing = strip(read('landing.module.css'));
  const vto = strip(read('studio-vto.module.css'));
  const accentRule = landing.match(/\.accent\s*\{([^}]*)\}/)?.[1] ?? '';
  const blue = accentRule.match(/--lp-blue\s*:\s*(#[0-9a-f]{6})\s*;/i)?.[1]?.toLowerCase() ?? '';

  it('writes the blue once, on the page wrapper, and points the site tokens at it', () => {
    expect(blue).toMatch(/^#[0-9a-f]{6}$/);
    expect(landing.match(/--lp-blue\s*:/g)).toHaveLength(1);
    expect(accentRule).toMatch(/--color-blue\s*:\s*var\(--lp-blue\)\s*;/);
    expect(accentRule).toMatch(/--accent\s*:\s*var\(--lp-blue\)\s*;/);
    expect(accentRule).toMatch(/display\s*:\s*contents/);
    expect(vto).toMatch(/--st-accent\s*:\s*var\(--lp-blue/);
  });

  it('writes no other blue and no YAGI red as a literal', () => {
    expect(landing.toLowerCase().split(blue).length - 1).toBe(1);
    expect(vto.toLowerCase()).not.toContain(blue);
    // Earlier accents (#0000EE and its shades, #4355E8) and the old soft tint must not come back.
    for (const css of [landing, vto]) {
      expect(css).not.toMatch(/#0000[0-9a-f]{2}\b|#4355e8\b|#eeeeff\b/i);
      expect(css).not.toMatch(/#ed1e1e\b|237[\s,]+30[\s,]+30/i);
    }
  });

  it('keeps white CTA text and blue links readable (WCAG AA, 4.5:1)', () => {
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    expect(1.05 / (lum(blue) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
