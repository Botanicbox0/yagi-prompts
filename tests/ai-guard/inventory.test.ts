/**
 * The inventory guard (docs/PROMPT-GUARD.md "Inventory"): finds every model call in lib/ and app/ with the
 * patterns in inventory.ts and fails when one is neither adopted (a row in rows.ts) nor on the
 * not-yet-adopted list. Adding a model call without the guard, or moving one, fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CALL_PATTERNS, INVENTORY } from './inventory';
import { ROWS } from './rows';

const ROOT = path.resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      out.push(...sourceFiles(full));
    } else if (/\.(?:ts|tsx|mts|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** `file|kind` → number of matching code lines (comment lines and the wrappers' definitions skipped). */
function findCalls(): Map<string, number> {
  const found = new Map<string, number>();
  for (const dir of ['lib', 'app']) {
    for (const file of sourceFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) continue;
        if (/^export\s+async\s+function\s+callGemini(?:Structured)?Json\b/.test(code)) continue;
        if (/^import\b|^export\s*\{/.test(code)) continue;
        for (const { kind, re } of CALL_PATTERNS) {
          if (re.test(code)) found.set(`${rel}|${kind}`, (found.get(`${rel}|${kind}`) ?? 0) + 1);
        }
      }
    }
  }
  return found;
}

describe('every model call in product code is adopted or listed', () => {
  const found = findCalls();
  const listed = new Map(INVENTORY.map((e) => [`${e.file}|${e.kind}`, e]));

  it('finds no call that is neither a row nor on the not-yet-adopted list (and no count that changed)', () => {
    const unlisted = [...found].filter(([key, n]) => listed.get(key)?.count !== n).map(([key, n]) => `${key} ×${n} (listed ×${listed.get(key)?.count ?? 0})`);
    expect(unlisted, 'add a row in tests/ai-guard/rows.ts or an entry in tests/ai-guard/inventory.ts').toEqual([]);
  });

  it('lists no call that is gone', () => {
    const stale = INVENTORY.filter((e) => !found.has(`${e.file}|${e.kind}`)).map((e) => `${e.file}|${e.kind}`);
    expect(stale).toEqual([]);
  });

  it('every adopted entry is a row of the proof table, and every row is an adopted entry', () => {
    const adopted = INVENTORY.filter((e) => e.status === 'adopted');
    expect(adopted.map((e) => e.by).sort()).toEqual(ROWS.map((r) => r.site).sort());
    for (const row of ROWS) expect(adopted.find((e) => e.by === row.site)?.file).toBe(row.file);
  });

  it('every adopted file builds its request through the guard', () => {
    for (const row of ROWS) {
      const source = readFileSync(path.join(ROOT, row.file), 'utf8');
      expect(source, row.file).toContain(`site: '${row.site}'`);
      expect(source, row.file).toMatch(/guardRequest\(/);
      expect(source, row.file).toMatch(/\.check\(/);
    }
  });

  it('counts 36 audit sites plus the generator the grep found, video.understand and the two sound composer v2 calls', () => {
    const sites = INVENTORY.filter((e) => e.status !== 'wrapper').reduce((n, e) => n + e.count, 0);
    // 36 in AUDIT.md §1.2 (#36 is two lines: generations and edits), lib/images/seedream.ts, lib/brand-studio/video/understand.ts,
    // and the two calls the sound composer v2 added (the per-model design in sound/architect.ts, the MiniMax lyric draft in sound/prepare-music.ts).
    expect(sites).toBe(36 + 1 + 1 + 1 + 2);
  });
});
