import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The brand landing's blue is one knob (2026-10-29: the founder is changing the key colour, and the
 * landing now matches brand.twings.app's soft ultramarine). The hex is written once, on `.accent`,
 * every shade is mixed from it, and the shared nav, form and FAQ on /brands are pointed at it.
 */
const read = (file: string) => readFileSync(join(process.cwd(), 'components', 'brand-studio', file), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const HEX = /#[0-9a-f]{3,8}\b/gi;

describe('brand landing accent', () => {
  const landing = strip(read('landing.module.css'));
  const vto = strip(read('studio-vto.module.css'));
  const accentRule = landing.match(/\.accent\s*\{([^}]*)\}/)?.[1] ?? '';

  it('writes the blue once, on the page wrapper, and points the site tokens at it', () => {
    expect(landing.match(/--lp-blue\s*:/g)).toHaveLength(1);
    expect(accentRule).toMatch(/--lp-blue\s*:\s*#4355e8\s*;/i);
    expect(accentRule).toMatch(/--color-blue\s*:\s*var\(--lp-blue\)\s*;/);
    expect(accentRule).toMatch(/--accent\s*:\s*var\(--lp-blue\)\s*;/);
    expect(accentRule).toMatch(/display\s*:\s*contents/);
    expect(vto).toMatch(/--st-accent\s*:\s*var\(--lp-blue/);
  });

  it('writes no other blue and no YAGI red as a literal', () => {
    const blues = (css: string) => (css.match(HEX) ?? []).filter((hex) => /^#(0000[0-9a-f]{2}|4355e8|eeeeff)$/i.test(hex));
    expect(blues(landing)).toEqual(['#4355e8']);
    expect(blues(vto)).toEqual([]);
    for (const css of [landing, vto]) expect(css).not.toMatch(/#ed1e1e\b|237[\s,]+30[\s,]+30/i);
  });

  it('keeps white CTA text and blue links readable (WCAG AA, 4.5:1)', () => {
    const hex = accentRule.match(/--lp-blue\s*:\s*(#[0-9a-f]{6})/i)?.[1] ?? '';
    const lum = (h: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    expect(1.05 / (lum(hex) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});
