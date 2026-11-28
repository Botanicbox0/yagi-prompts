import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The /direct page is a server component. A value (a number, a string, a helper) imported from a
 * `'use client'` module arrives on the server as a client reference, and React prints its error
 * source as text instead of the value. Unit tests import the module directly and never see that, so
 * this guard reads the source: from client modules the server component may import components only.
 */
const ROOT = join(__dirname, '..', '..');
const SERVER_FILE = 'components/audience/direct-scene-studio.tsx';

function isClientModule(path: string): boolean {
  const first = readFileSync(join(ROOT, path), 'utf8').trimStart().slice(0, 14);
  return first.startsWith("'use client'") || first.startsWith('"use client"');
}

describe('/direct server component imports', () => {
  const source = readFileSync(join(ROOT, SERVER_FILE), 'utf8');

  it('is itself a server component', () => {
    expect(isClientModule(SERVER_FILE)).toBe(false);
  });

  it('takes only components (PascalCase) from client modules', () => {
    const imports = [...source.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'(\.\/direct\/[^']+)'/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const [, typeOnly, names = '', from = ''] of imports) {
      if (typeOnly) continue;
      const file = `components/audience/${from.slice(2)}`;
      const path = [`${file}.tsx`, `${file}.ts`].find((candidate) => {
        try {
          readFileSync(join(ROOT, candidate));
          return true;
        } catch {
          return false;
        }
      });
      expect(path, `cannot resolve ${from}`).toBeDefined();
      if (!isClientModule(path as string)) continue;
      for (const raw of names.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0];
        if (!name || raw.trim().startsWith('type ')) continue;
        expect(name, `${name} from client module ${from} must be a component`).toMatch(/^[A-Z][A-Za-z0-9]*$/);
        expect(name, `${name} looks like a constant, not a component`).not.toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });
});
