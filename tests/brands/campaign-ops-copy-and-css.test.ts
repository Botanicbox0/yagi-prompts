import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { campaignOpsEn, campaignOpsKo } from '@/messages/campaign-ops';
import { brandRouteAllowed } from '@/lib/routing/surfaces';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function topSelectors(css: string): string[] {
  const cleaned = stripComments(css);
  const out: string[] = [];
  let depth = 0;
  let keyframesDepth: number | null = null;
  let start = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === '{') {
      const prelude = cleaned.slice(start, i).trim();
      if (prelude.startsWith('@keyframes')) {
        keyframesDepth = depth;
      } else if (prelude && !prelude.startsWith('@') && keyframesDepth === null) {
        out.push(prelude);
      }
      depth += 1;
      start = i + 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      if (keyframesDepth !== null && depth === keyframesDepth) {
        keyframesDepth = null;
      }
      start = i + 1;
    } else if (ch === ';' && depth === 0) {
      start = i + 1;
    }
  }
  return out;
}

describe('campaign ops C1 copy and CSS guards', () => {
  it('keeps zero hardcoded Hangul customer text in components and pages', () => {
    const dirs = [
      join(ROOT, 'components', 'brand-workspace', 'campaign-ops'),
      join(ROOT, 'components', 'brand-workspace', 'process-stage'),
    ];
    const files: string[] = [
      join(ROOT, 'app', '(brand)', 'brand', 'campaigns', 'page.tsx'),
      join(ROOT, 'app', '(brand)', 'brand', 'production', 'page.tsx'),
    ];
    for (const dir of dirs) {
      for (const name of readdirSync(dir)) {
        if (/\.(ts|tsx)$/.test(name)) files.push(join(dir, name));
      }
    }
    for (const file of files) {
      const codeOnly = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(codeOnly, file).not.toMatch(/[가-힣]/);
    }
  });

  it('uses zero color literals, zero red tokens, and a local class in every CSS module selector', () => {
    const modules = [
      ['components', 'brand-workspace', 'process-stage', 'process-stage.module.css'],
      ['components', 'brand-workspace', 'campaign-ops', 'campaign-ops.module.css'],
    ];
    for (const parts of modules) {
      const css = stripComments(read(...parts));
      const label = parts.join('/');
      expect(css, label).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css, label).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color-mix)\s*\(/i);
      expect(css, label).not.toMatch(/(?<![-a-zA-Z0-9_])(?:white|black|red|blue|pink|green|gray|grey)(?![-a-zA-Z0-9_])/i);
      expect(css, label).not.toMatch(/--ys-(?:red|danger)/i);
      for (const selector of topSelectors(css)) {
        expect(selector, `${label} :: ${selector}`).toMatch(/\.[a-zA-Z_][a-zA-Z0-9_-]*/);
      }
    }
  });

  it('keeps campaignOps strings free of prices, day/people/result numbers, and vendor/internal names', () => {
    const collect = (v: unknown): string[] =>
      typeof v === 'string'
        ? [v]
        : v && typeof v === 'object'
          ? Object.values(v).flatMap(collect)
          : [];
    const allStrings = [...collect(campaignOpsKo), ...collect(campaignOpsEn)];
    for (const text of allStrings) {
      expect(text, text).not.toMatch(/\d/);
      expect(text, text).not.toMatch(/(?:\d\s*원|만원|원화|₩|\$|KRW|USD)/i);
      expect(text, text).not.toMatch(
        /\b(?:seedance|kling|runway|openai|anthropic|higgsfield|sunra|morphic|slack|supabase|toss|frame\.io|playbook)\b/i,
      );
    }
  });

  it('W3 guard: every image still in pictures.tsx exists on disk under 200 KB, lazy-decodes, is allow-listed, avoids c-logo pairs, and uses allowed frame aspects', () => {
    const pics = read('components', 'brand-workspace', 'process-stage', 'pictures.tsx');
    const css = read('components', 'brand-workspace', 'process-stage', 'process-stage.module.css');
    expect(pics).not.toContain('picDotAccent');
    expect(css).not.toContain('picDotAccent');
    expect(pics).not.toContain('/reel/landing/c-logo-raw.webp');
    expect(pics).not.toContain('/reel/landing/c-logo-ours.webp');

    const imgTags = [...pics.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]!);
    expect(imgTags.length).toBeGreaterThanOrEqual(8);
    for (const tag of imgTags) {
      expect(tag, tag).toContain('loading="lazy"');
      expect(tag, tag).toContain('decoding="async"');
    }

    const srcs = [...pics.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    expect(srcs.length).toBeGreaterThanOrEqual(8);
    for (const src of srcs) {
      expect(brandRouteAllowed(src, 'GET'), `brandRouteAllowed ${src}`).toBe(true);
      const diskPath = join(ROOT, 'public', ...src.replace(/^\//, '').split('/'));
      expect(existsSync(diskPath), `public${src}`).toBe(true);
      expect(statSync(diskPath).size, `${src} size <= 200KB`).toBeLessThanOrEqual(200 * 1024);
    }

    const reviseBlock = pics.slice(pics.indexOf("case 'p-revise'"), pics.indexOf("case 'p-done'"));
    const reviseSrcs = [...reviseBlock.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!);
    expect(reviseSrcs).toHaveLength(2);
    expect(reviseSrcs[0]).not.toBe(reviseSrcs[1]);

    const allowedAspects = new Set(['9 / 16', '4 / 5', '1 / 1', '16 / 9']);
    const aspectMatches = [...stripComments(css).matchAll(/aspect-ratio:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(aspectMatches.length).toBeGreaterThanOrEqual(5);
    for (const ratio of aspectMatches) {
      expect(allowedAspects.has(ratio), `unexpected aspect-ratio: ${ratio}`).toBe(true);
    }
  });
});
