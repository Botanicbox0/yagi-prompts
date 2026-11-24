import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Stylesheet contracts of the redesigned workspace home and the support launcher (2026-11-25), read as text:
 * the home speaks in three type sizes, the launcher is a round ink face with the mark, coloured only by
 * tokens, and the brand's own message bubble no longer hard-codes white words.
 */
const ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

interface Rule {
  selector: string;
  at: string[];
  body: string;
}
/** Every style rule in `css` with the at-rules it sits in. Comments removed. */
function rules(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const stack: Array<{ at: boolean; name: string; start: number }> = [];
  let preludeStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '{') {
      const prelude = text.slice(preludeStart, i).trim();
      stack.push({ at: prelude.startsWith('@'), name: prelude, start: i + 1 });
      preludeStart = i + 1;
    } else if (char === '}') {
      const open = stack.pop();
      if (open && !open.at) {
        out.push({ selector: open.name, at: stack.filter((s) => s.at).map((s) => s.name), body: text.slice(open.start, i) });
      }
      preludeStart = i + 1;
    } else if (char === ';' && (stack.length === 0 || stack[stack.length - 1]!.at)) {
      // A statement at-rule (`@import …;`) or a declaration directly in an at-rule: not part of the next prelude.
      preludeStart = i + 1;
    }
  }
  return out;
}
const declarations = (body: string, property: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;{\\s])${property.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`, 'g'))].map((m) => m[1]!.trim());
const PHONE = '@media (max-width: 640px)';

describe('the home speaks in three type sizes', () => {
  const home = rules(read('components/brand-workspace/home/home.module.css'));

  it('uses only 22px (the name), 15px (lines and titles) and 12.5px (everything small)', () => {
    const sizes = home.filter((rule) => !rule.at.includes(PHONE)).flatMap((rule) => declarations(rule.body, 'font-size'));
    expect(sizes.length).toBeGreaterThan(10);
    expect(new Set(sizes)).toEqual(new Set(['22px', '15px', '12.5px']));
  });

  it('only lets the prompt field grow to 18px on a phone (iOS zooms into anything smaller)', () => {
    const phone = home.filter((rule) => rule.at.includes(PHONE));
    expect(phone.length).toBeGreaterThan(0);
    const sized = phone.filter((rule) => declarations(rule.body, 'font-size').length > 0);
    expect(sized.map((rule) => [rule.selector, declarations(rule.body, 'font-size')])).toEqual([['.promptField', ['18px']]]);
  });

  it('carries no size in a font shorthand either', () => {
    for (const rule of home) for (const value of declarations(rule.body, 'font')) expect(value, rule.selector).toBe('inherit');
  });

  it('keeps a clip over its poster out of sight until the tile plays it, and lets reduced motion stop the tile moving', () => {
    const over = home.find((rule) => rule.selector === "a.tile video[data-home-film='over-poster']");
    expect(over && declarations(over.body, 'opacity')).toEqual(['0']);
    const playing = home.find((rule) => rule.selector === "a.tile[data-playing='true'] video[data-home-film='over-poster']");
    expect(playing && declarations(playing.body, 'opacity')).toEqual(['1']);
    const calm = home.filter((rule) => rule.at.some((at) => at.includes('prefers-reduced-motion: reduce')));
    expect(calm.some((rule) => rule.selector.split(',').map((s) => s.trim()).includes('a.tile video') && declarations(rule.body, 'transition').includes('none'))).toBe(true);
  });
});

describe('the support launcher (app/(brand)/workspace.css)', () => {
  const workspace = rules(read('app/(brand)/workspace.css'));
  const rail = rules(read('app/(brand)/rail.css'));
  const base = workspace.find((rule) => rule.selector === '.bw-support-launch' && rule.at.length === 0);
  const HEX = /#[0-9a-f]{3,8}\b/i;

  it('is a 52px round face with no words to make room for', () => {
    expect(base).toBeDefined();
    expect(declarations(base!.body, 'width')).toEqual(['52px']);
    expect(declarations(base!.body, 'height')).toEqual(['52px']);
    expect(declarations(base!.body, 'padding')).toEqual(['0']);
    const radius = declarations(base!.body, 'border-radius')[0]!;
    expect(radius === '50%' || parseFloat(radius) >= 26, radius).toBe(true);
    // The old label's type settings went with the label.
    expect(declarations(base!.body, 'font-size')).toEqual([]);
    expect(workspace.some((rule) => rule.selector.includes('bw-support-launch-label'))).toBe(false);
  });

  it('is not frosted glass anywhere: no backdrop-filter on any launcher rule', () => {
    for (const rule of [...workspace, ...rail].filter((r) => r.selector.includes('.bw-support-launch'))) {
      expect(rule.body, rule.selector).not.toMatch(/backdrop-filter/);
    }
    expect(read('app/(brand)/workspace.css')).not.toMatch(/@supports not \(\(backdrop-filter:blur\(1px\)\)[^{]*\{\s*\.bw-support-launch/);
  });

  it('takes its face, mark and dot colours from tokens, never a hex value', () => {
    // An ink face with the page's colour for the mark: the inverse of the page in either theme.
    expect(declarations(base!.body, '--launch-face')).toEqual(['var(--ys-ink)']);
    expect(declarations(base!.body, '--launch-mark')).toEqual(['var(--ys-bg)']);
    // The new-reply dot is a token too, and never the face's own colour (an ink dot on an ink face cannot be seen).
    const dotColour = declarations(base!.body, '--launch-dot');
    expect(dotColour).toHaveLength(1);
    expect(dotColour[0]).toMatch(/^var\(--ys-[\w-]+\)$/);
    expect(dotColour[0]).not.toBe(declarations(base!.body, '--launch-face')[0]);
    expect(declarations(base!.body, 'background')).toEqual(['var(--launch-face)']);
    expect(declarations(base!.body, 'color')).toEqual(['var(--launch-mark)']);
    const dot = workspace.find((rule) => rule.selector === '.bw-support-launch-dot' && rule.at.length === 0);
    expect(dot && declarations(dot.body, 'background')).toEqual(['var(--launch-dot)']);
    // The dot reads on the ink face through a ring of the page's colour.
    expect(dot && declarations(dot.body, 'box-shadow')[0]).toContain('var(--ys-bg)');
    for (const rule of [...workspace, ...rail].filter((r) => /\.bw-support-launch(?:-dot|-mark)?\b/.test(r.selector))) {
      expect(rule.body, rule.selector).not.toMatch(HEX);
      for (const property of ['--launch-face', '--launch-mark', '--launch-dot']) {
        for (const value of declarations(rule.body, property)) expect(value, `${rule.selector} ${property}`).toMatch(/^(?:var\(--ys-[\w-]+\)|transparent)$/);
      }
    }
    // The rail's phone top bar restyles the launcher through the same variables, not a background of its own.
    const railLaunch = rail.filter((r) => r.selector.includes('.bw-support-launch') && !r.selector.includes(':focus-visible'));
    expect(railLaunch.length).toBeGreaterThan(0);
    for (const rule of railLaunch) {
      expect(declarations(rule.body, 'background'), rule.selector).toEqual([]);
      expect(declarations(rule.body, 'color'), rule.selector).toEqual([]);
    }
  });

  it('gives the window header\'s avatar the same ink round, from tokens', () => {
    const avatar = workspace.find((rule) => rule.selector === '.bw-concierge-avatar' && rule.at.length === 0);
    expect(avatar).toBeDefined();
    expect(declarations(avatar!.body, 'background')).toEqual(['var(--ys-ink)']);
    expect(declarations(avatar!.body, 'color')).toEqual(['var(--ys-bg)']);
    expect(avatar!.body).not.toMatch(/color\s*:\s*white/);
    // No later rule squares it off again.
    for (const rule of workspace.filter((r) => /\.bw-concierge-avatar\b(?!-)/.test(r.selector))) {
      for (const radius of declarations(rule.body, 'border-radius')) expect(radius, rule.selector).toBe('999px');
    }
  });
});

describe('the brand\'s own message bubble', () => {
  const workspace = rules(read('app/(brand)/workspace.css'));
  it('no longer hard-codes white words: they take the page colour over the ink', () => {
    const bubbles = workspace.filter((rule) => rule.selector.includes('.bw-support-bubble'));
    expect(bubbles.length).toBeGreaterThan(0);
    for (const rule of bubbles) {
      for (const color of declarations(rule.body, 'color')) expect(color, rule.selector).not.toMatch(/^(?:white|#fff(?:fff)?)$/i);
    }
    const own = bubbles.find((rule) => rule.selector === '.bw-support-bubble' && rule.at.length === 0);
    expect(own && declarations(own.body, 'color')).toEqual(['var(--ys-bg)']);
  });
});
