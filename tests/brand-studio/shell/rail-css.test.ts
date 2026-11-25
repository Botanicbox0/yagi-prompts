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

/** Every style rule with its own declarations (nested blocks left out) and the at-rules it sits in. */
function rulesWithBodies(css: string): Array<{ selector: string; at: string[]; body: string }> {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ selector: string; at: string[]; body: string }> = [];
  const stack: Array<{ kind: 'at' | 'rule' | 'keyframes'; name: string; body: string }> = [];
  let buffer = '';
  for (const char of text) {
    const top = stack[stack.length - 1];
    if (char === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@')) stack.push({ kind: /^@(-webkit-)?keyframes\b/.test(prelude) ? 'keyframes' : 'at', name: prelude, body: '' });
      else stack.push({ kind: 'rule', name: prelude, body: '' });
    } else if (char === '}') {
      const done = stack.pop();
      if (done?.kind === 'rule' && !stack.some((s) => s.kind === 'keyframes')) {
        out.push({ selector: done.name, at: stack.filter((s) => s.kind === 'at').map((s) => s.name), body: done.body });
      }
      buffer = '';
    } else if (top && top.kind === 'rule') {
      top.body += char;
      buffer += char;
      if (char === ';') buffer = '';
    } else {
      buffer += char;
    }
  }
  return out;
}

/** The values of one property in a declaration block. */
const values = (body: string, property: string) =>
  body
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d.toLowerCase().startsWith(`${property}:`))
    .map((d) => d.slice(property.length + 1).trim());

/** The last compound selector of a selector (what the rule styles), parentheses kept whole. */
function subject(selector: string): string {
  let depth = 0;
  for (let i = selector.length - 1; i >= 0; i -= 1) {
    const char = selector[i]!;
    if (char === ')') depth += 1;
    else if (char === '(') depth -= 1;
    else if (depth === 0 && (char === ' ' || char === '>' || char === '+' || char === '~')) return selector.slice(i + 1).trim();
  }
  return selector.trim();
}
/** Whether a compound selector is `.name` itself or an `:is()` list holding `.name`. */
const styles = (compound: string, name: string) =>
  compound === `.${name}` || (/^:is\(/.test(compound) && parts(compound.slice(4, -1)).includes(`.${name}`));

describe('app/(brand)/rail.css — the tidied rail (docs/BRAND-STUDIO-V3.md §3.1)', () => {
  const css = read('app/(brand)/rail.css');
  const rules = rulesWithBodies(css);
  const WIDE = '@media (min-width: 641px)';
  const PHONE = '@media (max-width: 640px)';

  it('sees the same rules as the scoping parser', () => {
    expect(rules.length).toBe(selectors(css).length);
  });

  it('keeps the rows at one 36px height and the chosen row a quiet ink wash', () => {
    const shell = rules.find((r) => r.selector === RAIL_SCOPE + ')' && r.at.includes(WIDE));
    expect(shell).toBeDefined();
    expect(values(shell!.body, '--bw-rail-row')).toEqual(['36px']);
    expect(values(shell!.body, '--bw-rail-chosen')).toEqual(['color-mix(in srgb, var(--ys-ink) 11%, transparent)']);
    const item = rules.find((r) => r.selector.endsWith('.bw-sidebar nav .bw-rail-item') && r.at.includes(WIDE));
    expect(item && values(item.body, 'height')).toEqual(['var(--bw-rail-row)']);
  });

  it('never fills the current row with the active ink or the accent', () => {
    const current = rules.filter((r) => r.selector.includes('.bw-rail-item[aria-current="page"]'));
    expect(current.length).toBeGreaterThan(0);
    for (const rule of current) {
      expect(rule.body, rule.selector).not.toMatch(/--ys-active-bg|--ys-accent/);
    }
    const chosen = current.find((r) => subject(r.selector) === '.bw-rail-item[aria-current="page"]');
    expect(chosen && values(chosen.body, 'background')).toEqual(['var(--bw-rail-chosen)']);
  });

  it('draws "+" as an outlined row: no active ink or accent background, and the old disc is gone', () => {
    const create = rules.filter((r) => r.selector.includes('.bw-rail-create-button'));
    expect(create.length).toBeGreaterThan(0);
    for (const rule of create) {
      for (const property of ['background', 'background-color']) {
        for (const value of values(rule.body, property)) expect(value, `${rule.selector} ${property}`).not.toMatch(/--ys-active-bg|--ys-accent/);
      }
    }
    const base = create.find((r) => subject(r.selector) === '.bw-rail-create-button' && r.at.includes(WIDE));
    expect(base && values(base.body, 'box-shadow')).toEqual(['inset 0 0 0 1px var(--ys-line-strong)']);
    expect(css).not.toContain('bw-rail-create-disc');
    expect(rules.some((r) => r.selector.includes('.bw-rail-create-mark'))).toBe(true);
  });

  it('hides the layout brand block, language control and sign-out row only on a wide screen with the rail block present', () => {
    for (const name of ['bw-identity', 'bw-language-menu', 'bw-signout']) {
      const hiding = rules.flatMap((rule) =>
        parts(rule.selector)
          .filter((part) => styles(subject(part), name))
          .filter(() => values(rule.body, 'display').includes('none'))
          .map((part) => ({ part, at: rule.at })),
      );
      expect(hiding.length, name).toBeGreaterThan(0);
      for (const { part, at } of hiding) {
        expect(at, `${name}: ${part}`).toContain(WIDE);
        expect(at.some((a) => a.includes('max-width')), `${name}: ${part}`).toBe(false);
        expect(part, name).toContain(':has([data-rail-workspace])');
      }
    }
  });

  it('leaves the phone top bar its brand block, language control and sign-out row', () => {
    const phone = rules.filter((r) => r.at.includes(PHONE));
    expect(phone.length).toBeGreaterThan(0);
    for (const rule of phone) {
      for (const part of parts(rule.selector)) {
        const hidden = values(rule.body, 'display').includes('none');
        for (const name of ['bw-identity', 'bw-language-menu', 'bw-signout']) {
          expect(hidden && styles(subject(part), name), `${name} hidden on a phone by ${part}`).toBe(false);
        }
        expect(part, 'no phone rule depends on the rail block').not.toContain('[data-rail-workspace]');
      }
    }
  });

  it('brings back, in the menu\'s no-script style, every layout control this file hides for the rail block', () => {
    const source = read('components/brand-workspace/rail-workspace-menu.tsx');
    const declaration = /const NO_SCRIPT_CSS =([\s\S]*?);\n/.exec(source)?.[1] ?? '';
    const fallback = [...declaration.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
    // A wide-screen block (a phone keeps its top bar either way), then the block itself hidden everywhere.
    const wide = /^@media \(min-width:641px\)\{([\s\S]*)\}\[data-rail-workspace\]\{display:none!important\}$/.exec(fallback);
    expect(wide, fallback).not.toBeNull();
    const restored = new Map(
      [...wide![1]!.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => [m[1]!.trim(), /display:([a-z-]+)!important/.exec(m[2]!)?.[1] ?? null]),
    );
    // The displays are workspace.css's own for these controls.
    expect(restored.get('.bw-sidebar>.bw-identity')).toBe('block');
    expect(restored.get('.bw-sidebar-utilities>.bw-language-menu')).toBe('contents');
    expect(read('app/(brand)/workspace.css')).toContain('.bw-language-menu{display:contents}');
    expect(restored.get('.bw-sidebar-utilities>.bw-signout')).toBe('block');
    expect(restored.get('.bw-sidebar>.bw-sidebar-utilities')).toBe('grid');
    // The fold button needs script: it goes.
    expect(restored.get('.bw-sidebar>.bw-rail-toggle')).toBe('none');

    // Every wide-screen rule here that hides a layout control because the block is present is undone above.
    const hiddenForBlock = rules
      .filter((r) => r.at.includes(WIDE) && values(r.body, 'display').includes('none'))
      .flatMap((r) => parts(r.selector).filter((part) => part.includes(':has([data-rail-workspace])')))
      .map((part) => subject(part));
    const undone = (compound: string) =>
      ['bw-identity', 'bw-language-menu', 'bw-signout', 'bw-sidebar-utilities'].some((name) => styles(compound, name));
    // The fold button's label goes with the fold button, which the no-script style hides.
    expect(hiddenForBlock.filter((compound) => !undone(compound) && compound !== '.bw-rail-label')).toEqual([]);
    expect(hiddenForBlock.length).toBeGreaterThan(0);
  });

  it('gives the folded block a face when no brand is open (the chevron and an outline, no avatar to show)', () => {
    const folded = (end: string) =>
      rules.find((r) => r.at.includes(WIDE) && r.selector.includes('[data-rail-expanded="false"]') && r.selector.endsWith(end));
    const chevron = folded('[data-rail-workspace="none"] .bw-rail-workspace-chevron');
    expect(chevron).toBeDefined();
    expect(values(chevron!.body, 'display')).toEqual(['block']);
    const trigger = folded('[data-rail-workspace="none"] .bw-rail-workspace-trigger');
    expect(trigger && values(trigger.body, 'box-shadow')).toEqual(['inset 0 0 0 1px var(--ys-line-strong)']);
    // The general folded rule still hides the chevron when a brand is open (its avatar is the face then).
    const hide = rules.find((r) => r.at.includes(WIDE) && r.selector.endsWith('[data-rail-expanded="false"]) .bw-rail-workspace-chevron'));
    expect(hide && values(hide.body, 'display')).toEqual(['none']);
  });

  it('keeps the brand block named on the folded rail: the text is clipped, never display:none', () => {
    const folded = rules.filter((r) => r.selector.includes('[data-rail-expanded="false"]') && subject(r.selector) === '.bw-rail-workspace-text');
    expect(folded.length).toBeGreaterThan(0);
    for (const rule of folded) {
      expect(values(rule.body, 'display'), rule.selector).not.toContain('none');
      expect(values(rule.body, 'clip'), rule.selector).toEqual(['rect(0 0 0 0)']);
    }
    for (const rule of rules.filter((r) => subject(r.selector) === '.bw-rail-workspace-trigger')) {
      expect(values(rule.body, 'display'), rule.selector).not.toContain('none');
    }
  });

  it('turns the fold button into an icon only with the rail block, on a wide screen', () => {
    const label = rules.find((r) => r.selector.endsWith(':has([data-rail-workspace]) .bw-rail-toggle .bw-rail-label'));
    expect(label).toBeDefined();
    expect(label!.at).toContain(WIDE);
    expect(values(label!.body, 'display')).toEqual(['none']);
  });

  it('paints hovers with the rail hover token: rgba(17, 17, 20, …) only as its fallback, or on the failed toast dot ring', () => {
    const FALLBACK = 'var(--bw-rail-hover, rgba(17, 17, 20, 0.05))';
    for (const rule of rules.filter((r) => r.selector.includes(':hover'))) {
      // The old phone value stays as the token's fallback on purpose; no hover paints a raw rgba() of its own.
      expect(rule.body.split(FALLBACK).join(''), rule.selector).not.toMatch(/rgba\(/);
    }
    const ink = rules.filter((r) => r.body.includes('rgba(17, 17, 20'));
    const notFallback = ink.filter((r) => r.body.split(FALLBACK).join('').includes('rgba(17, 17, 20'));
    expect(notFallback.map((r) => subject(r.selector))).toEqual(['.bw-rail-toast-dot']);
    expect(notFallback[0]!.selector).toContain('.bw-rail-toast[data-rail-toast="failed"]');
    expect(values(notFallback[0]!.body, 'box-shadow')).toEqual(['0 0 0 3px rgba(17, 17, 20, 0.06)']);
    // Every fallback use sits on a hover or open state, as a background.
    for (const rule of ink.filter((r) => !notFallback.includes(r))) {
      expect(rule.selector, rule.selector).toMatch(/:hover|\[aria-expanded="true"\]/);
      expect(values(rule.body, 'background'), rule.selector).toEqual([FALLBACK]);
    }
  });

  it('lets "+" and the credits line keep the row height (no inherited 42px floor)', () => {
    const create = rules.find((r) => r.at.includes(WIDE) && subject(r.selector) === '.bw-rail-create-button' && !r.selector.includes('expanded'));
    expect(create && values(create.body, 'min-height')).toEqual(['0']);
    const credits = rules.find((r) => r.at.includes(WIDE) && r.selector.endsWith(' .bw-rail .bw-rail-credits'));
    expect(credits && values(credits.body, 'min-height')).toEqual(['0']);
  });

  it('draws the 2px credits bar only in the rail foot; the bar elsewhere (the phone sheet) stays 3px', () => {
    const foot = rules.find((r) => r.selector.endsWith(' .bw-rail-foot .bw-rail-credits-bar'));
    expect(foot && values(foot.body, 'height')).toEqual(['2px']);
    const global = rules.find((r) => r.at.length === 0 && r.selector === `${RAIL_SCOPE}) .bw-rail-credits-bar`);
    expect(global && values(global.body, 'height')).toEqual(['3px']);
  });

  it('has no short-screen squeeze tied to the 홈 row any more (the foot rows it made room for are gone)', () => {
    expect(rules.filter((r) => r.selector.includes(':has([data-rail-group="home"])')).map((r) => r.selector)).toEqual([]);
  });

  it('gives the folded mode switch 36px options with the chosen one on the same wash as a chosen row', () => {
    const option = rules.find((r) => r.at.includes(WIDE) && r.selector.endsWith('[data-rail-expanded="false"]) .bw-rail-mode-option'));
    expect(option && values(option.body, 'min-height')).toEqual(['var(--bw-rail-row, 36px)']);
    const chosen = rules.find((r) => r.at.includes(WIDE) && r.selector.endsWith('[data-rail-expanded="false"]) .bw-rail-mode-option[aria-checked="true"]'));
    expect(chosen && values(chosen.body, 'background')).toEqual(['var(--bw-rail-chosen, var(--ys-hover))']);
    expect(chosen!.body).not.toMatch(/--ys-active-bg|--ys-accent/);
  });

  it('hides the switch\'s waiting count while the menu is open over it, on the expanded rail only', () => {
    const wait = rules.find((r) => subject(r.selector) === '.bw-rail-mode-wait' && r.selector.includes('.bw-rail-workspace-trigger[aria-expanded="true"]'));
    expect(wait).toBeDefined();
    expect(wait!.selector).toContain('[data-rail-expanded="true"]');
    expect(values(wait!.body, 'visibility')).toEqual(['hidden']);
  });

  it('styles the workspace menu items through the [role^="menuitem"] hook, the current page on the chosen wash', () => {
    expect(rules.some((r) => r.selector.includes('.bw-rail-workspace-menu :is(a, button)[role^="menuitem"]:focus-visible'))).toBe(true);
    const current = rules.find((r) => r.selector.endsWith('.bw-rail-workspace-menu :is(a, button)[role^="menuitem"][aria-current="page"]'));
    expect(current && values(current.body, 'background')).toEqual(['var(--bw-rail-chosen, var(--ys-hover))']);
    expect(current!.body).not.toMatch(/--ys-active-bg|--ys-accent/);
    expect(rules.some((r) => r.selector.includes('.bw-rail-workspace-trigger'))).toBe(true);
  });
});
