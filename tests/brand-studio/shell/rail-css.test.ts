import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * docs/BRAND-STUDIO-V3.md §3 HARDLINE: the rail's stylesheet cannot reach the `topbar` or `sidebar`
 * modes. Every selector in app/(brand)/rail.css starts with the rail scope; keyframes are the only
 * other blocks. The existing workspace stylesheet carries no rail rule of its own.
 */
const ROOT = process.cwd();
const RAIL_SCOPE = '.bw-shell:has([data-brand-layout-mode="rail"]';
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

/** Every style-rule selector in `css`, with the at-rules it sits in. Comments removed, strings left alone. */
function selectors(css: string): Array<{ selector: string; at: string[] }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ selector: string; at: string[] }> = [];
  const stack: Array<{ kind: 'at' | 'rule' | 'keyframes'; name: string }> = [];
  let buffer = '';
  for (const char of text) {
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      const inKeyframes = stack.some((s) => s.kind === 'keyframes');
      if (prelude.startsWith('@')) {
        stack.push({ kind: /^@(-webkit-)?keyframes\b/.test(prelude) ? 'keyframes' : 'at', name: prelude });
      } else {
        stack.push({ kind: 'rule', name: prelude });
        if (!inKeyframes) out.push({ selector: prelude, at: stack.filter((s) => s.kind === 'at').map((s) => s.name) });
      }
    } else if (char === '}') {
      stack.pop();
      buffer = '';
    } else if (char === ';' && stack.length > 0 && stack[stack.length - 1]!.kind !== 'at') {
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return out;
}

/** Split a selector list on top-level commas (not the ones inside :is()/:has()). */
function parts(list: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
    } else current += char;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

describe('app/(brand)/rail.css', () => {
  const css = read('app/(brand)/rail.css');
  const rules = selectors(css);

  it('has rules (the parser sees the file)', () => {
    expect(rules.length).toBeGreaterThan(40);
  });

  it('scopes every selector to the rail layout mode', () => {
    const outside = rules.flatMap(({ selector }) => parts(selector)).filter((s) => !s.startsWith(RAIL_SCOPE));
    expect(outside).toEqual([]);
  });

  it('uses no colour that is not a workspace token, white, or a neutral ink tint', () => {
    const hexes = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(hexes.filter((h) => !['#ffffff', '#fff', '#000'].includes(h))).toEqual([]);
    expect(css).not.toMatch(/#ed1e1e|#fad204|\bred\b/i);
  });

  it('is loaded after the workspace stylesheet', () => {
    const layout = read('app/(brand)/layout.tsx');
    const workspace = layout.indexOf('"./workspace.css"');
    const rail = layout.indexOf('"./rail.css"');
    expect(workspace).toBeGreaterThan(-1);
    expect(rail).toBeGreaterThan(workspace);
  });
});

describe('app/(brand)/workspace.css', () => {
  it('carries no rail rule (the rail lives in its own file)', () => {
    expect(read('app/(brand)/workspace.css')).not.toContain('layout-mode="rail"');
  });
});
