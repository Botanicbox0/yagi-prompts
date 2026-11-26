import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from '@/messages/en';
import { ko } from '@/messages/ko';

const DIR = join(process.cwd(), 'components', 'brand-studio', 'prompt-pictures');
const FILES = readdirSync(DIR);
const CODE_FILES = FILES.filter((f) => /\.(ts|tsx)$/.test(f));

function flattenStrings(value: unknown, prefix = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[prefix, value]];
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      flattenStrings(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

describe('D1 screens source guards', () => {
  it('has no hardcoded Korean or English UI copy in prompt-pictures/*.tsx', () => {
    for (const file of FILES.filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(join(DIR, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, `${file} contains Korean characters`).not.toMatch(/[가-힣]/);
      // No hardcoded JSX text nodes inside tags (only `{expressions}` and whitespace).
      const textNodes = [...src.matchAll(/>([^<>{}\n]+)</g)].map((m) => m[1]!.trim()).filter(Boolean);
      expect(textNodes, `${file} has hardcoded JSX text`).toEqual([]);
    }
  });

  it('has no object/array literal in hook dependency arrays, no default []/{}, and no new timers', () => {
    for (const file of CODE_FILES) {
      const src = readFileSync(join(DIR, file), 'utf8');
      expect(src, `${file} uses timer`).not.toMatch(/\b(setTimeout|setInterval|requestAnimationFrame)\b/);
      expect(src, `${file} uses default = [] or = {}`).not.toMatch(/=\s*(\[\s*\]|\{\s*\})/);
      for (const match of src.matchAll(/\b(?:useEffect|useLayoutEffect|useMemo|useCallback)\s*\([^]*?,\s*\[([^\]]*)\]\s*\)/g)) {
        const deps = match[1]!;
        expect(deps, `${file} deps contain object/array literal`).not.toMatch(/[\{\[]/);
      }
    }
  });

  it('keeps prompt-pictures.module.css pure: local classes only, no hardcoded colours, no shadows', () => {
    const css = readFileSync(join(DIR, 'prompt-pictures.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/i);
    for (const shadow of css.matchAll(/box-shadow\s*:\s*([^;]+);/gi)) {
      expect(shadow[1]!.trim()).toBe('none');
    }
    const stripped = css.replace(/@keyframes\s+[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '').replace(/@media[^{]+\{([\s\S]*?)\n\}/g, '$1');
    for (const rule of stripped.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      const selector = rule[1]!.trim();
      if (!selector) continue;
      for (const part of selector.split(',')) {
        expect(part.trim(), `selector missing local class: ${part}`).toMatch(/\.[A-Za-z_][A-Za-z0-9_-]*/);
      }
    }
    expect(css).not.toMatch(/max-width:\s*600px/);
    expect(css).toMatch(/\.root\s*\{[^}]*justify-items:\s*start;/s);
    expect(css).toMatch(/\.frame\s*\{[^}]*justify-self:\s*start;[^}]*width:\s*100%;[^}]*max-width:\s*360px;/s);
    expect(css).toMatch(/\.image\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*360px;/s);
    expect(css).toMatch(/\.frameCompact\s*\{[^}]*max-height:\s*200px;[^}]*overflow-y:\s*auto;/s);
  });

  it('never uses shield, token, or encrypt words in any brandStudio dictionary string', () => {
    const banned = /\b(shield\w*|token\w*|encrypt\w*)\b|실드|토큰|암호화/i;
    for (const [locale, dict] of [
      ['ko', ko.brandStudio],
      ['en', en.brandStudio],
    ] as const) {
      const hits = flattenStrings(dict, `${locale}.brandStudio`).filter(([, text]) => banned.test(text));
      expect(hits).toEqual([]);
    }
  });
});
