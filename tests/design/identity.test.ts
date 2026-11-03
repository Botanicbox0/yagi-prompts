import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENT_MIX, COLOUR, CONTRAST_PAIRS, HARDLINES, IMAGERY, MODEL_ROLES, MOTION, TYPE, WORLD, contrast, mixAccent } from '@/lib/design/identity';

/**
 * TWINGS design identity as code (lib/design/identity.ts). The shared identity stylesheet copies the values
 * into `.identity`, which the brand landing and the personal pages both wrap themselves in; this guard keeps
 * the two equal and the rules true, so the identity cannot drift by hand.
 */
const sheet = (...path: string[]) => readFileSync(join(process.cwd(), ...path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ids = sheet('components', 'design', 'identity.module.css');
const css = sheet('components', 'brand-studio', 'v7.module.css');
const vto = sheet('components', 'brand-studio', 'studio-vto.module.css');
const rule = ids.match(/\.identity\s*\{([^}]*)\}/)?.[1] ?? '';
const token = (name: string) => rule.match(new RegExp(`--id-${name}\s*:\s*([^;]+);`))?.[1]?.trim();
const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const doc = readFileSync(join(process.cwd(), 'docs', 'design', 'IDENTITY.md'), 'utf8');
const agents = readFileSync(join(process.cwd(), 'AGENTS.md'), 'utf8');

describe('TWINGS design identity', () => {
  it('copies every colour role into the identity stylesheet, unchanged', () => {
    for (const [key, hex] of Object.entries(COLOUR)) expect(token(kebab(key)), key).toBe(hex);
  });

  it('mixes every blue shade from the accent, as the identity says', () => {
    for (const [name, mix] of Object.entries(ACCENT_MIX)) {
      expect(token(`accent-${name}`), name).toBe(`color-mix(in srgb, var(--id-accent) ${mix.accent}%, ${mix.base})`);
    }
  });

  it('writes the accent hex once and no other blue, and no YAGI red', () => {
    expect(ids.toLowerCase().split(COLOUR.accent).length - 1).toBe(1);
    // The landing reads the variables; a hex of its own would be a second source.
    expect(css.toLowerCase()).not.toContain(COLOUR.accent);
    for (const stylesheet of [ids, css]) {
      // Earlier accents (#0000EE and its shades, #4355E8, the old tint); black #000000 is the mix base, not a blue.
      expect(stylesheet).not.toMatch(/#0000(?!00)[0-9a-f]{2}\b|#4355e8\b|#eeeeff\b/i);
      expect(stylesheet).not.toMatch(/rgb\(\s*56[\s,]+117[\s,]+197/);
    }
    for (const stylesheet of [ids, css, vto]) expect(stylesheet).not.toMatch(/#ed1e1e\b|237[\s,]+30[\s,]+30/i);
    expect(vto).toMatch(/--st-accent\s*:\s*var\(--id-accent/);
  });

  it('points the shared site tokens at the identity on the brand page', () => {
    expect(rule).toMatch(/--color-blue\s*:\s*var\(--id-accent\)\s*;/);
    expect(rule).toMatch(/--accent\s*:\s*var\(--id-accent-text\)\s*;/);
    expect(ids).toMatch(/\.identity\s+:global\(\[data-theme='light'\]\)\s*\{\s*--accent\s*:\s*var\(--id-accent-text\)\s*;\s*\}/);
    expect(rule).toMatch(/display\s*:\s*contents/);
  });

  // 2026-11-03: the personal side wears the same identity (home, /video, /image, template pages, pricing).
  it('wraps the personal pages in the same identity, with no values of their own', () => {
    const personal = ids.slice(ids.indexOf('.personal'));
    expect(personal).toMatch(/\.personal\s*\{\s*--color-black\s*:\s*var\(--id-ink\)\s*;\s*\}/);
    expect(personal).toMatch(/background-color\s*:\s*var\(--id-canvas\)/);
    expect(personal).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    for (const page of ['page.tsx', 'video/page.tsx', 'image/page.tsx', 'pricing/page.tsx', 't/[slug]/page.tsx']) {
      expect(readFileSync(join(process.cwd(), 'app', '(marketing)', '[locale]', page), 'utf8'), page).toContain('<PersonalIdentity>');
    }
  });

  it('keeps every pair the page relies on readable', () => {
    for (const pair of CONTRAST_PAIRS) expect(contrast(pair.fg, pair.bg), pair.use).toBeGreaterThanOrEqual(pair.min);
    expect(mixAccent(85, '#000000')).toBe('#3063a7');
  });

  // 2026-10-30 founder: another AI must be able to read how TWINGS looks and how to generate for it.
  it('keeps the written identity in step with the code, and points every agent at it', () => {
    for (const hex of [...Object.values(COLOUR), ...Object.values(WORLD)]) expect(doc.toLowerCase(), hex).toContain(hex);
    for (const model of Object.values(MODEL_ROLES)) expect(doc, model).toContain(model);
    expect(doc).toContain(String(TYPE.display.weight));
    expect(doc).toContain('COLOUR AUTHORITY');
    expect(agents).toContain('docs/design/IDENTITY.md');
  });

  it('carries type, motion and the imagery band the stylesheet uses', () => {
    expect(rule).toContain(`--id-spring: ${MOTION.spring}`);
    expect(css).toContain(`font-weight: ${TYPE.display.weight}`);
    expect(css).toContain(`letter-spacing: ${TYPE.display.tracking}`);
    expect(token('mono')).toBe(TYPE.mono);
    expect(IMAGERY.ownedHue[0]).toBeLessThan(IMAGERY.ownedHue[1]);
    expect(HARDLINES.length).toBeGreaterThanOrEqual(5);
  });
});
